import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";

const FUNCTION_NAME = "repair-positions-history";

interface BybitHistoryPosition {
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

async function getBybitHistory(
  apiCredentials: { apiKey: string; secretKey: string; passphrase: string },
  supabase: any,
  startTime: number,
  endTime: number
): Promise<{ list: BybitHistoryPosition[] }> {
  const { data, error } = await supabase.functions.invoke("bybit-api", {
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

    // Fetch ALL positions from Bybit with cursor-based pagination
    const allBybitPositions: BybitHistoryPosition[] = [];
    let hasMore = true;
    let idLessThan: string | undefined = undefined;
    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days ago
    const endTime = Date.now();

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "🔄 Fetching all positions from Bybit using cursor-based pagination...",
    });

    while (hasMore) {
      const response: any = await supabase.functions.invoke("bybit-api", {
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
      const cursor: string | undefined = response.data.data?.cursor || response.data.data?.endId;  // Bybit may return cursor or endId
      
      if (list.length > 0) {
        allBybitPositions.push(...list);
        await log({
          functionName: FUNCTION_NAME,
          level: "info",
          message: `📥 Fetched ${list.length} positions (total: ${allBybitPositions.length}, cursor: ${cursor})`,
        });
        
        // Continue if there's a cursor and we got a full page
        if (cursor && list.length >= 20) {  // 20 is Bybit's default page size
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
      message: `✅ Fetched total ${allBybitPositions.length} positions from Bybit`,
    });

    // Now match each Bybit position with DB positions
    const verifiedIds = new Set<string>();
    const matchedBybitIndices = new Set<number>();
    let updatedCount = 0;

    for (let i = 0; i < allBybitPositions.length; i++) {
      const bybitPos = allBybitPositions[i];
      const bybitCloseTime = Number(bybitPos.utime);
      const bybitSide = bybitPos.holdSide === 'long' ? 'BUY' : 'SELL';

      // Find all potential matches in DB
      const candidates = (dbPositions || []).filter(db => {
        if (!db.closed_at) return false;
        const dbCloseTime = new Date(db.closed_at).getTime();
        const timeDiff = Math.abs(dbCloseTime - bybitCloseTime);
        
        return (
          db.symbol === bybitPos.symbol &&
          db.side === bybitSide &&
          timeDiff < 10 * 60 * 1000 // 10 minute tolerance
        );
      });

      // Find best match (closest time, not yet verified)
      const bestMatch = candidates
        .filter(c => !verifiedIds.has(c.id))
        .sort((a, b) => {
          const aTime = new Date(a.closed_at!).getTime();
          const bTime = new Date(b.closed_at!).getTime();
          return Math.abs(aTime - bybitCloseTime) - Math.abs(bTime - bybitCloseTime);
        })[0];

      if (bestMatch) {
        verifiedIds.add(bestMatch.id);
        matchedBybitIndices.add(i);  // Track matched Bybit position
        
        // Validate quantity before update - only update if Bybit data looks reasonable
        const originalQuantity = bestMatch.quantity;
        const bybitQuantity = Number(bybitPos.closeTotalPos);
        const quantityRatio = bybitQuantity / originalQuantity;
        
        // Preserve original quantity if in metadata, otherwise use current
        const originalQtyFromMetadata = bestMatch.metadata?.original_quantity;
        const useQuantity = (quantityRatio > 0.5 && quantityRatio < 2) 
          ? bybitQuantity 
          : (originalQtyFromMetadata || originalQuantity); // Keep original if Bybit data looks wrong
        
        if (quantityRatio <= 0.5 || quantityRatio >= 2) {
          await log({
            functionName: FUNCTION_NAME,
            level: "warn",
            message: `Suspicious quantity ratio (${quantityRatio.toFixed(2)}) for ${bestMatch.symbol}, keeping original`,
            metadata: { 
              positionId: bestMatch.id, 
              originalQuantity, 
              bybitQuantity,
              usingQuantity: useQuantity
            },
          });
        }
        
        // Update position with accurate Bybit data
        const { error: updateError } = await supabase
          .from("positions")
          .update({
            entry_price: Number(bybitPos.openAvgPrice),
            close_price: Number(bybitPos.closeAvgPrice),
            realized_pnl: Number(bybitPos.netProfit),
            quantity: useQuantity,
            leverage: Number(bybitPos.leverage),
            closed_at: new Date(bybitCloseTime).toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {
              ...bestMatch.metadata,
              synced_from_bybit: true,
              sync_time: new Date().toISOString(),
              quantity_validation: quantityRatio > 0.5 && quantityRatio < 2 ? 'passed' : 'failed_kept_original'
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

    // Create new positions for unmatched Bybit positions
    const unmatchedBybitPositions = allBybitPositions.filter((_, i) => !matchedBybitIndices.has(i));
    let createdCount = 0;

    if (unmatchedBybitPositions.length > 0) {
      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `📝 Creating ${unmatchedBybitPositions.length} missing positions from Bybit history`,
      });

      // Create position objects
      const newPositions = unmatchedBybitPositions.map(bybitPos => ({
        user_id: user.id,
        symbol: bybitPos.symbol,
        side: bybitPos.holdSide === 'long' ? 'BUY' : 'SELL',
        entry_price: Number(bybitPos.openAvgPrice) || 0,
        close_price: Number(bybitPos.closeAvgPrice) || 0,
        quantity: Number(bybitPos.closeTotalPos) || 0,
        leverage: Number(bybitPos.leverage) || 10,
        realized_pnl: Number(bybitPos.netProfit),
        sl_price: 0,  // Placeholder - no SL info in history
        status: 'closed',
        closed_at: new Date(Number(bybitPos.utime)).toISOString(),
        created_at: new Date(Number(bybitPos.ctime)).toISOString(),
        close_reason: 'imported_from_bybit',
        metadata: {
          imported_from_bybit: true,
          import_time: new Date().toISOString(),
          bybit_close_time: bybitPos.utime,
          bybit_create_time: bybitPos.ctime
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
        message: `✅ Created ${createdCount} new positions from Bybit history`,
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
      bybitPositions: allBybitPositions.length,
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
