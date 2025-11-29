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
  closeTotalPos: string;
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

    // Fetch ALL positions from Bitget with cursor-based pagination
    const allBitgetPositions: BitgetHistoryPosition[] = [];
    let hasMore = true;
    let idLessThan: string | undefined = undefined;
    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days ago
    const endTime = Date.now();

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "🔄 Fetching all positions from Bitget using cursor-based pagination...",
    });

    while (hasMore) {
      const response: any = await supabase.functions.invoke("bitget-api", {
        body: {
          action: "get_position_history",
          params: {
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            limit: "100",
            ...(idLessThan && { idLessThan })  // Add cursor if available
          },
          apiCredentials
        },
      });

      if (response.error || !response.data?.success) {
        throw new Error(response.data?.error || response.error?.message || "Failed to fetch history");
      }
      
      const list = response.data.data?.list || [];
      const cursor: string | undefined = response.data.data?.cursor || response.data.data?.endId;  // Bitget may return cursor or endId
      
      if (list.length > 0) {
        allBitgetPositions.push(...list);
        await log({
          functionName: FUNCTION_NAME,
          level: "info",
          message: `📥 Fetched ${list.length} positions (total: ${allBitgetPositions.length}, cursor: ${cursor})`,
        });
        
        // Continue if there's a cursor and we got a full page
        if (cursor && list.length >= 20) {  // 20 is Bitget's default page size
          idLessThan = cursor;
        } else {
          hasMore = false;
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
    const matchedBitgetIndices = new Set<number>();
    let updatedCount = 0;

    for (let i = 0; i < allBitgetPositions.length; i++) {
      const bitgetPos = allBitgetPositions[i];
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
        matchedBitgetIndices.add(i);  // Track matched Bitget position
        
        // Update position with accurate Bitget data
        const { error: updateError } = await supabase
          .from("positions")
          .update({
            entry_price: Number(bitgetPos.openAvgPrice),
            close_price: Number(bitgetPos.closeAvgPrice),
            realized_pnl: Number(bitgetPos.netProfit),
            quantity: Number(bitgetPos.closeTotalPos),
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

    // Create new positions for unmatched Bitget positions
    const unmatchedBitgetPositions = allBitgetPositions.filter((_, i) => !matchedBitgetIndices.has(i));
    let createdCount = 0;

    if (unmatchedBitgetPositions.length > 0) {
      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `📝 Creating ${unmatchedBitgetPositions.length} missing positions from Bitget history`,
      });

      // Create position objects
      const newPositions = unmatchedBitgetPositions.map(bitgetPos => ({
        user_id: user.id,
        symbol: bitgetPos.symbol,
        side: bitgetPos.holdSide === 'long' ? 'BUY' : 'SELL',
        entry_price: Number(bitgetPos.openAvgPrice),
        close_price: Number(bitgetPos.closeAvgPrice),
        quantity: Number(bitgetPos.closeTotalPos),
        leverage: Number(bitgetPos.leverage),
        realized_pnl: Number(bitgetPos.netProfit),
        sl_price: 0,  // Placeholder - no SL info in history
        status: 'closed',
        closed_at: new Date(Number(bitgetPos.utime)).toISOString(),
        created_at: new Date(Number(bitgetPos.ctime)).toISOString(),
        close_reason: 'imported_from_bitget',
        metadata: {
          imported_from_bitget: true,
          import_time: new Date().toISOString(),
          bitget_close_time: bitgetPos.utime,
          bitget_create_time: bitgetPos.ctime
        }
      }));

      // Batch insert 10 at a time to avoid timeout
      for (let i = 0; i < newPositions.length; i += 10) {
        const batch = newPositions.slice(i, i + 10);
        const { error: insertError, data: insertedData } = await supabase
          .from("positions")
          .insert(batch)
          .select();

        if (!insertError && insertedData) {
          createdCount += insertedData.length;
          await log({
            functionName: FUNCTION_NAME,
            level: "info",
            message: `✅ Created batch of ${insertedData.length} positions (${createdCount}/${newPositions.length})`,
          });
        } else if (insertError) {
          await log({
            functionName: FUNCTION_NAME,
            level: "error",
            message: `Failed to create batch of positions`,
            metadata: { error: insertError.message, batchSize: batch.length },
          });
        }
      }

      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `✅ Created ${createdCount} new positions from Bitget history`,
      });
    }

    // Delete all unverified positions (duplicates/orphans)
    const toDelete = (dbPositions || []).filter(p => !verifiedIds.has(p.id));
    
    if (toDelete.length > 0) {
      await log({
        functionName: FUNCTION_NAME,
        level: "warn",
        message: `🗑️ Starting deletion of ${toDelete.length} duplicate/orphan positions`,
      });

      // Delete one by one to avoid timeout
      let deletedCount = 0;
      for (const pos of toDelete) {
        const { error: deleteError } = await supabase
          .from("positions")
          .delete()
          .eq("id", pos.id);

        if (!deleteError) {
          deletedCount++;
        } else {
          await log({
            functionName: FUNCTION_NAME,
            level: "error",
            message: `Failed to delete position ${pos.id}`,
            metadata: { error: deleteError.message, symbol: pos.symbol, side: pos.side },
            positionId: pos.id,
          });
        }
      }

      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `🗑️ Deleted ${deletedCount} of ${toDelete.length} duplicate/orphan positions`,
      });
    }

    const summary = {
      bitgetPositions: allBitgetPositions.length,
      dbPositionsBefore: dbPositions?.length || 0,
      verified: verifiedIds.size,
      updated: updatedCount,
      created: createdCount,
      deleted: toDelete.length,
      dbPositionsAfter: verifiedIds.size + createdCount,
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
