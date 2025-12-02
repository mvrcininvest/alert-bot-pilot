import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";

const FUNCTION_NAME = "fix-positions-data";

interface Position {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  close_price: number;
  quantity: number;
  leverage: number;
  realized_pnl: number;
  closed_at: string;
  metadata: any;
}

interface BybitOrder {
  orderId: string;
  symbol: string;
  leverage: string;
  size: string;
  cTime: string;
  uTime: string;
  side: string;
  posSide: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "🔧 Starting positions data fix (quantity & leverage)",
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

    // Get user's API keys
    const userKeys = await getUserApiKeys(user.id);
    if (!userKeys) {
      throw new Error("No active API keys found");
    }

    const apiCredentials = {
      apiKey: userKeys.apiKey,
      secretKey: userKeys.secretKey,
      passphrase: userKeys.passphrase
    };

    // Fetch all closed positions that need fixing
    const { data: positions, error: posError } = await supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "closed")
      .not("realized_pnl", "is", null)
      .not("close_price", "is", null)
      .not("entry_price", "is", null)
      .order("closed_at", { ascending: false });

    if (posError) throw posError;

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: `📊 Found ${positions?.length || 0} closed positions to check`,
    });

    // Step 1: Fix quantity for positions where calculated differs from stored
    let quantityFixCount = 0;
    const quantityUpdates: { id: string; calculated_quantity: number }[] = [];
    const minPriceDiffPercent = 0.001; // 0.1% - skip if price diff too small (fees dominate)

    for (const pos of positions || []) {
      const priceDiff = Math.abs(pos.close_price - pos.entry_price);
      if (priceDiff === 0 || !pos.realized_pnl) continue;

      // Check if price difference is large enough to calculate quantity accurately
      const priceDiffPercent = priceDiff / pos.entry_price;
      
      if (priceDiffPercent < minPriceDiffPercent) {
        // Price diff too small - fees dominate PnL, skip this position
        await log({
          functionName: FUNCTION_NAME,
          level: "info",
          message: `Skipping ${pos.symbol}: price diff too small (${(priceDiffPercent * 100).toFixed(4)}%), fees dominate`,
          metadata: { positionId: pos.id, priceDiffPercent },
        });
        continue;
      }

      // Calculate quantity from PnL: quantity = |realized_pnl| / |close_price - entry_price|
      const calculatedQuantity = Math.abs(pos.realized_pnl) / priceDiff;
      const storedQuantity = pos.quantity;
      
      // Check if difference is > 5%
      const percentDiff = Math.abs(calculatedQuantity - storedQuantity) / storedQuantity;
      
      if (percentDiff > 0.05) {
        quantityUpdates.push({
          id: pos.id,
          calculated_quantity: calculatedQuantity
        });
      }
    }

    if (quantityUpdates.length > 0) {
      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `🔢 Fixing quantity for ${quantityUpdates.length} positions`,
      });

      // Update in batches
      for (const update of quantityUpdates) {
        const { error: updateError } = await supabase
          .from("positions")
          .update({
            quantity: update.calculated_quantity,
            metadata: {
              ...(positions?.find(p => p.id === update.id)?.metadata || {}),
              quantity_calculated: true,
              quantity_fixed_at: new Date().toISOString()
            }
          })
          .eq("id", update.id);

        if (!updateError) {
          quantityFixCount++;
        } else {
          await log({
            functionName: FUNCTION_NAME,
            level: "error",
            message: `Failed to update quantity for position ${update.id}`,
            metadata: { error: updateError.message },
          });
        }
      }

      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: `✅ Fixed quantity for ${quantityFixCount} positions`,
      });
    }

    // Step 2: Fix leverage by fetching from orders-history
    // Get positions with leverage = 10 (default fallback)
    const positionsNeedingLeverage = (positions || []).filter(p => p.leverage === 10);
    
    if (positionsNeedingLeverage.length === 0) {
      await log({
        functionName: FUNCTION_NAME,
        level: "info",
        message: "✅ No positions need leverage fix",
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Positions data fixed",
          summary: {
            quantityFixed: quantityFixCount,
            leverageFixed: 0,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: `📊 Found ${positionsNeedingLeverage.length} positions with leverage=10 to fix`,
    });

    // Fetch orders history from Bybit with pagination
    const allOrders: BybitOrder[] = [];
    let hasMore = true;
    let idLessThan: string | undefined = undefined;
    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days
    const endTime = Date.now();

    while (hasMore && allOrders.length < 1000) { // Limit to 1000 orders max
      const response: any = await supabase.functions.invoke("bybit-api", {
        body: {
          action: "get_orders_history",
          params: {
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            limit: "100",
            ...(idLessThan && { idLessThan })
          },
          apiCredentials
        },
      });

      if (response.error || !response.data?.success) {
        await log({
          functionName: FUNCTION_NAME,
          level: "error",
          message: "Failed to fetch orders history",
          metadata: { error: response.data?.error || response.error?.message },
        });
        break;
      }

      const list = response.data.data?.entrustedList || response.data.data?.orderList || response.data.data?.list || [];
      const cursor = response.data.data?.endId;

      if (list.length > 0) {
        allOrders.push(...list);
        
        if (cursor && list.length >= 100) {
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
      message: `📥 Fetched ${allOrders.length} orders from Bybit`,
    });

    // Match orders to positions and update leverage
    let leverageFixCount = 0;

    for (const pos of positionsNeedingLeverage) {
      const posClosedTime = new Date(pos.closed_at).getTime();
      const posSide = pos.side === 'BUY' ? 'long' : 'short';

      // Find matching orders (within 10 minutes of position close)
      const matchingOrders = allOrders.filter(order => {
        const orderTime = Number(order.cTime);
        const timeDiff = Math.abs(orderTime - posClosedTime);
        
        return (
          order.symbol === pos.symbol &&
          order.posSide === posSide &&
          timeDiff < 10 * 60 * 1000 // 10 minutes
        );
      });

      if (matchingOrders.length > 0) {
        // Use leverage from the first matching order
        const leverage = Number(matchingOrders[0].leverage);
        
        if (leverage && leverage !== 10) {
          const { error: updateError } = await supabase
            .from("positions")
            .update({
              leverage: leverage,
              metadata: {
                ...(pos.metadata || {}),
                leverage_from_orders: true,
                leverage_fixed_at: new Date().toISOString(),
                matched_order_id: matchingOrders[0].orderId
              }
            })
            .eq("id", pos.id);

          if (!updateError) {
            leverageFixCount++;
          } else {
            await log({
              functionName: FUNCTION_NAME,
              level: "error",
              message: `Failed to update leverage for position ${pos.id}`,
              metadata: { error: updateError.message },
            });
          }
        }
      }
    }

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: `✅ Fixed leverage for ${leverageFixCount} positions`,
    });

    const summary = {
      quantityFixed: quantityFixCount,
      leverageFixed: leverageFixCount,
      positionsChecked: positions?.length || 0,
      ordersProcessed: allOrders.length,
    };

    await log({
      functionName: FUNCTION_NAME,
      level: "info",
      message: "✅ Positions data fix completed",
      metadata: summary,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Positions data fixed successfully",
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
      message: "Error fixing positions data",
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
