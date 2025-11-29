import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";

const FUNCTION_NAME = "repair-positions-history";

interface BitgetHistoryPosition {
  symbol: string;
  netProfit: string;
  openAvgPrice: string;
  closeAvgPrice: string;
  ctime: string;
  utime: string;
  holdSide: string;
  total: string;
  leverage: string;
}

async function getBitgetHistory(
  apiCredentials: { apiKey: string; secretKey: string; passphrase: string },
  supabase: any,
  startTime: number,
  endTime: number
): Promise<{ list: BitgetHistoryPosition[] }> {
  const { data, error } = await supabase.functions.invoke("bitget-api", {
    body: {
      action: "get_position_history",
      params: {
        startTime: startTime.toString(),
        endTime: endTime.toString(),
        pageSize: "100"
      },
      apiCredentials
    },
  });

  if (error) throw error;
  if (!data.success) throw new Error(data.error || "Failed to fetch history");
  
  return data.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "🔧 Starting position history repair",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user's API keys (decrypted)
    const userKeys = await getUserApiKeys(user.id);
    if (!userKeys) {
      throw new Error("No active API keys found");
    }

    const apiCredentials = {
      apiKey: userKeys.apiKey,
      secretKey: userKeys.secretKey,
      passphrase: userKeys.passphrase
    };

    // Fetch all closed positions from DB for this user
    const { data: dbPositions, error: dbError } = await supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "closed")
      .order("closed_at", { ascending: false });

    if (dbError) throw dbError;

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: `📊 Found ${dbPositions?.length || 0} closed positions in DB`,
    });

    // Fetch ALL positions from Bitget with pagination
    const allBitgetPositions: BitgetHistoryPosition[] = [];
    let hasMore = true;
    let endTime = Date.now();
    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days ago

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "🔄 Fetching all positions from Bitget...",
    });

    while (hasMore) {
      const { data, error } = await supabase.functions.invoke("bitget-api", {
        body: {
          action: "get_position_history",
          params: {
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            pageSize: "100"
          },
          apiCredentials
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to fetch history");
      }
      
      if (data.data?.list && data.data.list.length > 0) {
        allBitgetPositions.push(...data.data.list);
        await log({
          functionName: FUNCTION_NAME,
          level: "info",
          message: `📥 Fetched ${data.data.list.length} positions (total: ${allBitgetPositions.length})`,
        });
        
        if (data.data.list.length < 100) {
          hasMore = false;
        } else {
          // Use time of last position as new endTime
          const lastPosition = data.data.list[data.data.list.length - 1];
          endTime = Number(lastPosition.ctime) - 1;
        }
      } else {
        hasMore = false;
      }
    }

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: `✅ Fetched total ${allBitgetPositions.length} positions from Bitget`,
    });

    // Now match each Bitget position with DB positions
    const verifiedIds = new Set<string>();
    let updatedCount = 0;

    for (const bitgetPos of allBitgetPositions) {
      const bitgetCloseTime = Number(bitgetPos.utime);
      const bitgetSide = bitgetPos.holdSide === 'long' ? 'BUY' : 'SELL';

      // Find all potential matches in DB
      const candidates = (dbPositions || []).filter(db => {
        if (!db.closed_at) return false;
        const dbCloseTime = new Date(db.closed_at).getTime();
        const timeDiff = Math.abs(dbCloseTime - bitgetCloseTime);
        
        return (
          db.symbol === bitgetPos.symbol &&
          db.side === bitgetSide &&
          timeDiff < 10 * 60 * 1000 // 10 minute tolerance
        );
      });

      // Find best match (closest time, not yet verified)
      const bestMatch = candidates
        .filter(c => !verifiedIds.has(c.id))
        .sort((a, b) => {
          const aTime = new Date(a.closed_at!).getTime();
          const bTime = new Date(b.closed_at!).getTime();
          return Math.abs(aTime - bitgetCloseTime) - Math.abs(bTime - bitgetCloseTime);
        })[0];

      if (bestMatch) {
        verifiedIds.add(bestMatch.id);
        
        // Update position with accurate Bitget data
        const { error: updateError } = await supabase
          .from("positions")
          .update({
            entry_price: Number(bitgetPos.openAvgPrice),
            close_price: Number(bitgetPos.closeAvgPrice),
            realized_pnl: Number(bitgetPos.netProfit),
            quantity: Number(bitgetPos.total),
            leverage: Number(bitgetPos.leverage),
            closed_at: new Date(bitgetCloseTime).toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {
              ...bestMatch.metadata,
              synced_from_bitget: true,
              sync_time: new Date().toISOString()
            }
          })
          .eq("id", bestMatch.id);

        if (!updateError) {
          updatedCount++;
        }
      }
    }

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: `✅ Verified and updated ${verifiedIds.size} positions`,
    });

    // Delete all unverified positions (duplicates/orphans)
    const toDelete = (dbPositions || []).filter(p => !verifiedIds.has(p.id));
    
    if (toDelete.length > 0) {
      // Log deletions
      for (const pos of toDelete) {
        await log({
          functionName: FUNCTION_NAME,
          level: "warn",
          message: `🗑️ Deleting duplicate/orphan position: ${pos.symbol} ${pos.side}`,
          metadata: {
            positionId: pos.id,
            symbol: pos.symbol,
            side: pos.side,
            closedAt: pos.closed_at,
            realizedPnl: pos.realized_pnl,
            closeReason: pos.close_reason,
          },
          positionId: pos.id,
        });
      }

      const { error: deleteError } = await supabase
        .from("positions")
        .delete()
        .in("id", toDelete.map(p => p.id));

      if (deleteError) {
        await log({
          functionName: FUNCTION_NAME,
          level: "error",
          message: "Failed to delete positions",
          metadata: { error: deleteError.message },
        });
        throw deleteError;
      }

      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `🗑️ Deleted ${toDelete.length} duplicate/orphan positions`,
      });
    }

    const summary = {
      bitgetPositions: allBitgetPositions.length,
      dbPositionsBefore: dbPositions?.length || 0,
      verified: verifiedIds.size,
      updated: updatedCount,
      deleted: toDelete.length,
      dbPositionsAfter: verifiedIds.size,
    };

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "✅ Position history repair completed",
      metadata: summary,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Position history repaired successfully",
        summary,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await log({
      functionName: FUNCTION_NAME,
      level: "error",
      message: "Error repairing position history",
      metadata: { error: errorMessage },
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
