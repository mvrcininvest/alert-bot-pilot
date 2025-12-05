export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          atr: number | null
          created_at: string
          entry_price: number
          error_message: string | null
          exchange_executed_at: number | null
          executed_at: string | null
          id: string
          is_test: boolean | null
          latency_execution_ms: number | null
          latency_ms: number | null
          latency_webhook_ms: number | null
          leverage: number
          main_tp: number
          mode: string | null
          position_id: string | null
          raw_data: Json
          side: Database["public"]["Enums"]["position_side"]
          sl: number
          status: Database["public"]["Enums"]["alert_status"]
          strength: number | null
          symbol: string
          tier: string | null
          tp1: number | null
          tp2: number | null
          tp3: number | null
          tv_timestamp: number | null
          user_id: string | null
          webhook_received_at: string | null
        }
        Insert: {
          atr?: number | null
          created_at?: string
          entry_price: number
          error_message?: string | null
          exchange_executed_at?: number | null
          executed_at?: string | null
          id?: string
          is_test?: boolean | null
          latency_execution_ms?: number | null
          latency_ms?: number | null
          latency_webhook_ms?: number | null
          leverage: number
          main_tp: number
          mode?: string | null
          position_id?: string | null
          raw_data: Json
          side: Database["public"]["Enums"]["position_side"]
          sl: number
          status?: Database["public"]["Enums"]["alert_status"]
          strength?: number | null
          symbol: string
          tier?: string | null
          tp1?: number | null
          tp2?: number | null
          tp3?: number | null
          tv_timestamp?: number | null
          user_id?: string | null
          webhook_received_at?: string | null
        }
        Update: {
          atr?: number | null
          created_at?: string
          entry_price?: number
          error_message?: string | null
          exchange_executed_at?: number | null
          executed_at?: string | null
          id?: string
          is_test?: boolean | null
          latency_execution_ms?: number | null
          latency_ms?: number | null
          latency_webhook_ms?: number | null
          leverage?: number
          main_tp?: number
          mode?: string | null
          position_id?: string | null
          raw_data?: Json
          side?: Database["public"]["Enums"]["position_side"]
          sl?: number
          status?: Database["public"]["Enums"]["alert_status"]
          strength?: number | null
          symbol?: string
          tier?: string | null
          tp1?: number | null
          tp2?: number | null
          tp3?: number | null
          tv_timestamp?: number | null
          user_id?: string | null
          webhook_received_at?: string | null
        }
        Relationships: []
      }
      ban_history: {
        Row: {
          action: string
          created_at: string
          id: string
          performed_at: string
          performed_by: string
          reason: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          performed_at?: string
          performed_by: string
          reason?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          performed_at?: string
          performed_by?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      banned_symbols: {
        Row: {
          banned_at: string
          created_at: string
          id: string
          reason: string
          symbol: string
        }
        Insert: {
          banned_at?: string
          created_at?: string
          id?: string
          reason: string
          symbol: string
        }
        Update: {
          banned_at?: string
          created_at?: string
          id?: string
          reason?: string
          symbol?: string
        }
        Relationships: []
      }
      bot_logs: {
        Row: {
          alert_id: string | null
          created_at: string | null
          function_name: string
          id: string
          level: string
          message: string
          metadata: Json | null
          position_id: string | null
        }
        Insert: {
          alert_id?: string | null
          created_at?: string | null
          function_name: string
          id?: string
          level: string
          message: string
          metadata?: Json | null
          position_id?: string | null
        }
        Update: {
          alert_id?: string | null
          created_at?: string | null
          function_name?: string
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
          position_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_logs_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_logs_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      latency_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_id: string | null
          created_at: string
          id: string
          latency_ms: number
          threshold_ms: number
          user_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_id?: string | null
          created_at?: string
          id?: string
          latency_ms: number
          threshold_ms?: number
          user_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_id?: string | null
          created_at?: string
          id?: string
          latency_ms?: number
          threshold_ms?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "latency_alerts_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_locks: {
        Row: {
          acquired_at: string | null
          expires_at: string | null
          id: string
          instance_id: string
          lock_type: string
        }
        Insert: {
          acquired_at?: string | null
          expires_at?: string | null
          id?: string
          instance_id: string
          lock_type: string
        }
        Update: {
          acquired_at?: string | null
          expires_at?: string | null
          id?: string
          instance_id?: string
          lock_type?: string
        }
        Relationships: []
      }
      monitoring_logs: {
        Row: {
          actions_taken: string | null
          actual_data: Json | null
          check_type: string
          created_at: string
          error_message: string | null
          expected_data: Json | null
          id: string
          issues: Json | null
          position_id: string | null
          status: string
        }
        Insert: {
          actions_taken?: string | null
          actual_data?: Json | null
          check_type: string
          created_at?: string
          error_message?: string | null
          expected_data?: Json | null
          id?: string
          issues?: Json | null
          position_id?: string | null
          status: string
        }
        Update: {
          actions_taken?: string | null
          actual_data?: Json | null
          check_type?: string
          created_at?: string
          error_message?: string | null
          expected_data?: Json | null
          id?: string
          issues?: Json | null
          position_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_logs_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_metrics: {
        Row: {
          created_at: string
          date: string
          id: string
          losing_trades: number | null
          symbol: string | null
          total_fees: number | null
          total_pnl: number | null
          total_trades: number | null
          winning_trades: number | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          losing_trades?: number | null
          symbol?: string | null
          total_fees?: number | null
          total_pnl?: number | null
          total_trades?: number | null
          winning_trades?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          losing_trades?: number | null
          symbol?: string | null
          total_fees?: number | null
          total_pnl?: number | null
          total_trades?: number | null
          winning_trades?: number | null
        }
        Relationships: []
      }
      positions: {
        Row: {
          alert_id: string | null
          bitget_order_id: string | null
          check_errors: number | null
          close_price: number | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          current_price: number | null
          entry_price: number
          id: string
          last_check_at: string | null
          last_error: string | null
          leverage: number
          metadata: Json | null
          quantity: number
          realized_pnl: number | null
          side: Database["public"]["Enums"]["position_side"]
          sl_order_id: string | null
          sl_price: number
          status: Database["public"]["Enums"]["position_status"]
          symbol: string
          tp1_filled: boolean | null
          tp1_order_id: string | null
          tp1_price: number | null
          tp1_quantity: number | null
          tp2_filled: boolean | null
          tp2_order_id: string | null
          tp2_price: number | null
          tp2_quantity: number | null
          tp3_filled: boolean | null
          tp3_order_id: string | null
          tp3_price: number | null
          tp3_quantity: number | null
          unrealized_pnl: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          alert_id?: string | null
          bitget_order_id?: string | null
          check_errors?: number | null
          close_price?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_price?: number | null
          entry_price: number
          id?: string
          last_check_at?: string | null
          last_error?: string | null
          leverage: number
          metadata?: Json | null
          quantity: number
          realized_pnl?: number | null
          side: Database["public"]["Enums"]["position_side"]
          sl_order_id?: string | null
          sl_price: number
          status?: Database["public"]["Enums"]["position_status"]
          symbol: string
          tp1_filled?: boolean | null
          tp1_order_id?: string | null
          tp1_price?: number | null
          tp1_quantity?: number | null
          tp2_filled?: boolean | null
          tp2_order_id?: string | null
          tp2_price?: number | null
          tp2_quantity?: number | null
          tp3_filled?: boolean | null
          tp3_order_id?: string | null
          tp3_price?: number | null
          tp3_quantity?: number | null
          unrealized_pnl?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          alert_id?: string | null
          bitget_order_id?: string | null
          check_errors?: number | null
          close_price?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_price?: number | null
          entry_price?: number
          id?: string
          last_check_at?: string | null
          last_error?: string | null
          leverage?: number
          metadata?: Json | null
          quantity?: number
          realized_pnl?: number | null
          side?: Database["public"]["Enums"]["position_side"]
          sl_order_id?: string | null
          sl_price?: number
          status?: Database["public"]["Enums"]["position_status"]
          symbol?: string
          tp1_filled?: boolean | null
          tp1_order_id?: string | null
          tp1_price?: number | null
          tp1_quantity?: number | null
          tp2_filled?: boolean | null
          tp2_order_id?: string | null
          tp2_price?: number | null
          tp2_quantity?: number | null
          tp3_filled?: boolean | null
          tp3_order_id?: string | null
          tp3_price?: number | null
          tp3_quantity?: number | null
          unrealized_pnl?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          ban_reason: string | null
          banned_at: string | null
          banned_by: string | null
          created_at: string | null
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean | null
          is_banned: boolean | null
          last_seen_at: string | null
          notify_bot_status: boolean | null
          notify_daily_summary: boolean | null
          notify_loss_alerts: boolean | null
          notify_position_closed: boolean | null
          notify_position_opened: boolean | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id: string
          is_active?: boolean | null
          is_banned?: boolean | null
          last_seen_at?: string | null
          notify_bot_status?: boolean | null
          notify_daily_summary?: boolean | null
          notify_loss_alerts?: boolean | null
          notify_position_closed?: boolean | null
          notify_position_opened?: boolean | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_banned?: boolean | null
          last_seen_at?: string | null
          notify_bot_status?: boolean | null
          notify_daily_summary?: boolean | null
          notify_loss_alerts?: boolean | null
          notify_position_closed?: boolean | null
          notify_position_opened?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          active_time_ranges: Json | null
          adaptive_rr: boolean | null
          adaptive_rr_standard: number | null
          adaptive_rr_strong: number | null
          adaptive_rr_very_strong: number | null
          adaptive_rr_weak_signal: number | null
          adaptive_tp_high_volatility_multiplier: number | null
          adaptive_tp_low_volatility_multiplier: number | null
          adaptive_tp_spacing: boolean | null
          alert_strength_threshold: number | null
          allowed_sessions: string[] | null
          allowed_tiers: string[] | null
          atr_sl_multiplier: number | null
          atr_tp_multiplier: number | null
          atr_tp2_multiplier: number | null
          atr_tp3_multiplier: number | null
          auto_repair: boolean | null
          bot_active: boolean | null
          breakeven_trigger_tp: number | null
          calculator_type: Database["public"]["Enums"]["calculator_type"]
          category_settings: Json | null
          created_at: string
          daily_loss_limit: number | null
          daily_loss_percent: number | null
          default_leverage: number | null
          duplicate_alert_handling: boolean | null
          excluded_sessions: string[] | null
          excluded_tiers: string[] | null
          fee_aware_breakeven: boolean | null
          filter_by_tier: boolean | null
          id: string
          loss_limit_type: string | null
          max_loss_per_trade: number | null
          max_margin_per_trade: number | null
          max_open_positions: number | null
          momentum_based_tp: boolean | null
          momentum_moderate_multiplier: number | null
          momentum_strong_multiplier: number | null
          momentum_weak_multiplier: number | null
          monitor_interval_seconds: number | null
          pnl_threshold_percent: number | null
          position_size_value: number
          position_sizing_type: string
          profile_name: string | null
          require_profit_for_same_direction: boolean | null
          rr_adaptive: boolean | null
          rr_ratio: number | null
          rr_sl_percent_margin: number | null
          session_filtering_enabled: boolean | null
          simple_sl_percent: number | null
          simple_tp_percent: number | null
          simple_tp2_percent: number | null
          simple_tp3_percent: number | null
          sl_method: Database["public"]["Enums"]["sl_method"]
          sl_percent_max: number | null
          sl_percent_min: number | null
          sl_to_breakeven: boolean | null
          symbol_leverage_overrides: Json | null
          time_filtering_enabled: boolean | null
          tp_levels: number | null
          tp_strategy: Database["public"]["Enums"]["tp_strategy"]
          tp1_close_percent: number | null
          tp1_rr_ratio: number | null
          tp2_close_percent: number | null
          tp2_rr_ratio: number | null
          tp3_close_percent: number | null
          tp3_rr_ratio: number | null
          trailing_stop: boolean | null
          trailing_stop_distance: number | null
          trailing_stop_trigger_tp: number | null
          updated_at: string
          use_alert_leverage: boolean | null
          use_max_leverage_global: boolean | null
          user_timezone: string | null
        }
        Insert: {
          active_time_ranges?: Json | null
          adaptive_rr?: boolean | null
          adaptive_rr_standard?: number | null
          adaptive_rr_strong?: number | null
          adaptive_rr_very_strong?: number | null
          adaptive_rr_weak_signal?: number | null
          adaptive_tp_high_volatility_multiplier?: number | null
          adaptive_tp_low_volatility_multiplier?: number | null
          adaptive_tp_spacing?: boolean | null
          alert_strength_threshold?: number | null
          allowed_sessions?: string[] | null
          allowed_tiers?: string[] | null
          atr_sl_multiplier?: number | null
          atr_tp_multiplier?: number | null
          atr_tp2_multiplier?: number | null
          atr_tp3_multiplier?: number | null
          auto_repair?: boolean | null
          bot_active?: boolean | null
          breakeven_trigger_tp?: number | null
          calculator_type?: Database["public"]["Enums"]["calculator_type"]
          category_settings?: Json | null
          created_at?: string
          daily_loss_limit?: number | null
          daily_loss_percent?: number | null
          default_leverage?: number | null
          duplicate_alert_handling?: boolean | null
          excluded_sessions?: string[] | null
          excluded_tiers?: string[] | null
          fee_aware_breakeven?: boolean | null
          filter_by_tier?: boolean | null
          id?: string
          loss_limit_type?: string | null
          max_loss_per_trade?: number | null
          max_margin_per_trade?: number | null
          max_open_positions?: number | null
          momentum_based_tp?: boolean | null
          momentum_moderate_multiplier?: number | null
          momentum_strong_multiplier?: number | null
          momentum_weak_multiplier?: number | null
          monitor_interval_seconds?: number | null
          pnl_threshold_percent?: number | null
          position_size_value?: number
          position_sizing_type?: string
          profile_name?: string | null
          require_profit_for_same_direction?: boolean | null
          rr_adaptive?: boolean | null
          rr_ratio?: number | null
          rr_sl_percent_margin?: number | null
          session_filtering_enabled?: boolean | null
          simple_sl_percent?: number | null
          simple_tp_percent?: number | null
          simple_tp2_percent?: number | null
          simple_tp3_percent?: number | null
          sl_method?: Database["public"]["Enums"]["sl_method"]
          sl_percent_max?: number | null
          sl_percent_min?: number | null
          sl_to_breakeven?: boolean | null
          symbol_leverage_overrides?: Json | null
          time_filtering_enabled?: boolean | null
          tp_levels?: number | null
          tp_strategy?: Database["public"]["Enums"]["tp_strategy"]
          tp1_close_percent?: number | null
          tp1_rr_ratio?: number | null
          tp2_close_percent?: number | null
          tp2_rr_ratio?: number | null
          tp3_close_percent?: number | null
          tp3_rr_ratio?: number | null
          trailing_stop?: boolean | null
          trailing_stop_distance?: number | null
          trailing_stop_trigger_tp?: number | null
          updated_at?: string
          use_alert_leverage?: boolean | null
          use_max_leverage_global?: boolean | null
          user_timezone?: string | null
        }
        Update: {
          active_time_ranges?: Json | null
          adaptive_rr?: boolean | null
          adaptive_rr_standard?: number | null
          adaptive_rr_strong?: number | null
          adaptive_rr_very_strong?: number | null
          adaptive_rr_weak_signal?: number | null
          adaptive_tp_high_volatility_multiplier?: number | null
          adaptive_tp_low_volatility_multiplier?: number | null
          adaptive_tp_spacing?: boolean | null
          alert_strength_threshold?: number | null
          allowed_sessions?: string[] | null
          allowed_tiers?: string[] | null
          atr_sl_multiplier?: number | null
          atr_tp_multiplier?: number | null
          atr_tp2_multiplier?: number | null
          atr_tp3_multiplier?: number | null
          auto_repair?: boolean | null
          bot_active?: boolean | null
          breakeven_trigger_tp?: number | null
          calculator_type?: Database["public"]["Enums"]["calculator_type"]
          category_settings?: Json | null
          created_at?: string
          daily_loss_limit?: number | null
          daily_loss_percent?: number | null
          default_leverage?: number | null
          duplicate_alert_handling?: boolean | null
          excluded_sessions?: string[] | null
          excluded_tiers?: string[] | null
          fee_aware_breakeven?: boolean | null
          filter_by_tier?: boolean | null
          id?: string
          loss_limit_type?: string | null
          max_loss_per_trade?: number | null
          max_margin_per_trade?: number | null
          max_open_positions?: number | null
          momentum_based_tp?: boolean | null
          momentum_moderate_multiplier?: number | null
          momentum_strong_multiplier?: number | null
          momentum_weak_multiplier?: number | null
          monitor_interval_seconds?: number | null
          pnl_threshold_percent?: number | null
          position_size_value?: number
          position_sizing_type?: string
          profile_name?: string | null
          require_profit_for_same_direction?: boolean | null
          rr_adaptive?: boolean | null
          rr_ratio?: number | null
          rr_sl_percent_margin?: number | null
          session_filtering_enabled?: boolean | null
          simple_sl_percent?: number | null
          simple_tp_percent?: number | null
          simple_tp2_percent?: number | null
          simple_tp3_percent?: number | null
          sl_method?: Database["public"]["Enums"]["sl_method"]
          sl_percent_max?: number | null
          sl_percent_min?: number | null
          sl_to_breakeven?: boolean | null
          symbol_leverage_overrides?: Json | null
          time_filtering_enabled?: boolean | null
          tp_levels?: number | null
          tp_strategy?: Database["public"]["Enums"]["tp_strategy"]
          tp1_close_percent?: number | null
          tp1_rr_ratio?: number | null
          tp2_close_percent?: number | null
          tp2_rr_ratio?: number | null
          tp3_close_percent?: number | null
          tp3_rr_ratio?: number | null
          trailing_stop?: boolean | null
          trailing_stop_distance?: number | null
          trailing_stop_trigger_tp?: number | null
          updated_at?: string
          use_alert_leverage?: boolean | null
          use_max_leverage_global?: boolean | null
          user_timezone?: string | null
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          api_key_encrypted: string
          created_at: string
          id: string
          is_active: boolean | null
          last_validated_at: string | null
          passphrase_encrypted: string
          secret_key_encrypted: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          passphrase_encrypted: string
          secret_key_encrypted: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_validated_at?: string | null
          passphrase_encrypted?: string
          secret_key_encrypted?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          active_time_ranges: Json | null
          adaptive_rr: boolean | null
          adaptive_rr_standard: number | null
          adaptive_rr_strong: number | null
          adaptive_rr_very_strong: number | null
          adaptive_rr_weak_signal: number | null
          adaptive_tp_high_volatility_multiplier: number | null
          adaptive_tp_low_volatility_multiplier: number | null
          adaptive_tp_spacing: boolean | null
          alert_strength_threshold: number | null
          allowed_sessions: string[] | null
          allowed_tiers: string[] | null
          atr_sl_multiplier: number | null
          atr_tp_multiplier: number | null
          atr_tp2_multiplier: number | null
          atr_tp3_multiplier: number | null
          bot_active: boolean | null
          breakeven_trigger_tp: number | null
          calculator_type: Database["public"]["Enums"]["calculator_type"] | null
          category_settings: Json | null
          created_at: string | null
          daily_loss_limit: number | null
          daily_loss_percent: number | null
          default_leverage: number | null
          duplicate_alert_handling: boolean | null
          excluded_sessions: string[] | null
          excluded_tiers: string[] | null
          fee_aware_breakeven: boolean | null
          filter_by_tier: boolean | null
          id: string
          include_fees_in_calculations: boolean | null
          loss_limit_type: string | null
          max_loss_per_trade: number | null
          max_margin_per_trade: number | null
          max_open_positions: number | null
          min_profitable_tp_percent: number | null
          momentum_based_tp: boolean | null
          momentum_moderate_multiplier: number | null
          momentum_strong_multiplier: number | null
          momentum_weak_multiplier: number | null
          money_mode: Database["public"]["Enums"]["settings_mode"] | null
          pnl_threshold_percent: number | null
          position_size_value: number | null
          position_sizing_type: string | null
          require_profit_for_same_direction: boolean | null
          rr_adaptive: boolean | null
          rr_ratio: number | null
          rr_sl_percent_margin: number | null
          session_filtering_enabled: boolean | null
          simple_sl_percent: number | null
          simple_tp_percent: number | null
          simple_tp2_percent: number | null
          simple_tp3_percent: number | null
          sl_method: Database["public"]["Enums"]["sl_method"] | null
          sl_percent_max: number | null
          sl_percent_min: number | null
          sl_to_breakeven: boolean | null
          sltp_mode: Database["public"]["Enums"]["settings_mode"] | null
          symbol_leverage_overrides: Json | null
          taker_fee_rate: number | null
          tier_mode: Database["public"]["Enums"]["settings_mode"] | null
          time_filtering_enabled: boolean | null
          tp_levels: number | null
          tp_strategy: Database["public"]["Enums"]["tp_strategy"] | null
          tp1_close_percent: number | null
          tp1_rr_ratio: number | null
          tp2_close_percent: number | null
          tp2_rr_ratio: number | null
          tp3_close_percent: number | null
          tp3_rr_ratio: number | null
          trailing_stop: boolean | null
          trailing_stop_distance: number | null
          trailing_stop_trigger_tp: number | null
          updated_at: string | null
          use_alert_leverage: boolean | null
          use_max_leverage_global: boolean | null
          user_id: string
          user_timezone: string | null
        }
        Insert: {
          active_time_ranges?: Json | null
          adaptive_rr?: boolean | null
          adaptive_rr_standard?: number | null
          adaptive_rr_strong?: number | null
          adaptive_rr_very_strong?: number | null
          adaptive_rr_weak_signal?: number | null
          adaptive_tp_high_volatility_multiplier?: number | null
          adaptive_tp_low_volatility_multiplier?: number | null
          adaptive_tp_spacing?: boolean | null
          alert_strength_threshold?: number | null
          allowed_sessions?: string[] | null
          allowed_tiers?: string[] | null
          atr_sl_multiplier?: number | null
          atr_tp_multiplier?: number | null
          atr_tp2_multiplier?: number | null
          atr_tp3_multiplier?: number | null
          bot_active?: boolean | null
          breakeven_trigger_tp?: number | null
          calculator_type?:
            | Database["public"]["Enums"]["calculator_type"]
            | null
          category_settings?: Json | null
          created_at?: string | null
          daily_loss_limit?: number | null
          daily_loss_percent?: number | null
          default_leverage?: number | null
          duplicate_alert_handling?: boolean | null
          excluded_sessions?: string[] | null
          excluded_tiers?: string[] | null
          fee_aware_breakeven?: boolean | null
          filter_by_tier?: boolean | null
          id?: string
          include_fees_in_calculations?: boolean | null
          loss_limit_type?: string | null
          max_loss_per_trade?: number | null
          max_margin_per_trade?: number | null
          max_open_positions?: number | null
          min_profitable_tp_percent?: number | null
          momentum_based_tp?: boolean | null
          momentum_moderate_multiplier?: number | null
          momentum_strong_multiplier?: number | null
          momentum_weak_multiplier?: number | null
          money_mode?: Database["public"]["Enums"]["settings_mode"] | null
          pnl_threshold_percent?: number | null
          position_size_value?: number | null
          position_sizing_type?: string | null
          require_profit_for_same_direction?: boolean | null
          rr_adaptive?: boolean | null
          rr_ratio?: number | null
          rr_sl_percent_margin?: number | null
          session_filtering_enabled?: boolean | null
          simple_sl_percent?: number | null
          simple_tp_percent?: number | null
          simple_tp2_percent?: number | null
          simple_tp3_percent?: number | null
          sl_method?: Database["public"]["Enums"]["sl_method"] | null
          sl_percent_max?: number | null
          sl_percent_min?: number | null
          sl_to_breakeven?: boolean | null
          sltp_mode?: Database["public"]["Enums"]["settings_mode"] | null
          symbol_leverage_overrides?: Json | null
          taker_fee_rate?: number | null
          tier_mode?: Database["public"]["Enums"]["settings_mode"] | null
          time_filtering_enabled?: boolean | null
          tp_levels?: number | null
          tp_strategy?: Database["public"]["Enums"]["tp_strategy"] | null
          tp1_close_percent?: number | null
          tp1_rr_ratio?: number | null
          tp2_close_percent?: number | null
          tp2_rr_ratio?: number | null
          tp3_close_percent?: number | null
          tp3_rr_ratio?: number | null
          trailing_stop?: boolean | null
          trailing_stop_distance?: number | null
          trailing_stop_trigger_tp?: number | null
          updated_at?: string | null
          use_alert_leverage?: boolean | null
          use_max_leverage_global?: boolean | null
          user_id: string
          user_timezone?: string | null
        }
        Update: {
          active_time_ranges?: Json | null
          adaptive_rr?: boolean | null
          adaptive_rr_standard?: number | null
          adaptive_rr_strong?: number | null
          adaptive_rr_very_strong?: number | null
          adaptive_rr_weak_signal?: number | null
          adaptive_tp_high_volatility_multiplier?: number | null
          adaptive_tp_low_volatility_multiplier?: number | null
          adaptive_tp_spacing?: boolean | null
          alert_strength_threshold?: number | null
          allowed_sessions?: string[] | null
          allowed_tiers?: string[] | null
          atr_sl_multiplier?: number | null
          atr_tp_multiplier?: number | null
          atr_tp2_multiplier?: number | null
          atr_tp3_multiplier?: number | null
          bot_active?: boolean | null
          breakeven_trigger_tp?: number | null
          calculator_type?:
            | Database["public"]["Enums"]["calculator_type"]
            | null
          category_settings?: Json | null
          created_at?: string | null
          daily_loss_limit?: number | null
          daily_loss_percent?: number | null
          default_leverage?: number | null
          duplicate_alert_handling?: boolean | null
          excluded_sessions?: string[] | null
          excluded_tiers?: string[] | null
          fee_aware_breakeven?: boolean | null
          filter_by_tier?: boolean | null
          id?: string
          include_fees_in_calculations?: boolean | null
          loss_limit_type?: string | null
          max_loss_per_trade?: number | null
          max_margin_per_trade?: number | null
          max_open_positions?: number | null
          min_profitable_tp_percent?: number | null
          momentum_based_tp?: boolean | null
          momentum_moderate_multiplier?: number | null
          momentum_strong_multiplier?: number | null
          momentum_weak_multiplier?: number | null
          money_mode?: Database["public"]["Enums"]["settings_mode"] | null
          pnl_threshold_percent?: number | null
          position_size_value?: number | null
          position_sizing_type?: string | null
          require_profit_for_same_direction?: boolean | null
          rr_adaptive?: boolean | null
          rr_ratio?: number | null
          rr_sl_percent_margin?: number | null
          session_filtering_enabled?: boolean | null
          simple_sl_percent?: number | null
          simple_tp_percent?: number | null
          simple_tp2_percent?: number | null
          simple_tp3_percent?: number | null
          sl_method?: Database["public"]["Enums"]["sl_method"] | null
          sl_percent_max?: number | null
          sl_percent_min?: number | null
          sl_to_breakeven?: boolean | null
          sltp_mode?: Database["public"]["Enums"]["settings_mode"] | null
          symbol_leverage_overrides?: Json | null
          taker_fee_rate?: number | null
          tier_mode?: Database["public"]["Enums"]["settings_mode"] | null
          time_filtering_enabled?: boolean | null
          tp_levels?: number | null
          tp_strategy?: Database["public"]["Enums"]["tp_strategy"] | null
          tp1_close_percent?: number | null
          tp1_rr_ratio?: number | null
          tp2_close_percent?: number | null
          tp2_rr_ratio?: number | null
          tp3_close_percent?: number | null
          tp3_rr_ratio?: number | null
          trailing_stop?: boolean | null
          trailing_stop_distance?: number | null
          trailing_stop_trigger_tp?: number | null
          updated_at?: string | null
          use_alert_leverage?: boolean | null
          use_max_leverage_global?: boolean | null
          user_id?: string
          user_timezone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_and_reserve_position: {
        Args: { p_max_positions: number; p_user_id: string }
        Returns: boolean
      }
      get_leverage_stats: {
        Args: never
        Returns: {
          avg_pnl: number
          count: number
          leverage: number
          total_pnl: number
          win_rate: number
        }[]
      }
      get_margin_bucket_stats: {
        Args: never
        Returns: {
          avg_pnl: number
          count: number
          margin_bucket: string
          total_pnl: number
          win_rate: number
        }[]
      }
      get_money_management_stats: {
        Args: never
        Returns: {
          avg_pnl: number
          count: number
          margin_bucket: string
          position_sizing_type: string
          symbol_category: string
          total_pnl: number
          win_rate: number
        }[]
      }
      get_rr_stats: {
        Args: never
        Returns: {
          avg_pnl: number
          count: number
          total_pnl: number
          tp1_rr_bucket: number
          win_rate: number
        }[]
      }
      get_tier_stats: {
        Args: never
        Returns: {
          avg_pnl: number
          count: number
          tier: string
          total_pnl: number
          win_rate: number
        }[]
      }
      get_tp_distribution_stats: {
        Args: never
        Returns: {
          avg_pnl: number
          avg_tp1_close_pct: number
          close_reason: string
          count: number
          tp_levels_used: number
          win_rate: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      update_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      alert_status: "pending" | "executed" | "ignored" | "error"
      app_role: "admin" | "user"
      calculator_type: "simple_percent" | "risk_reward" | "atr_based"
      position_side: "BUY" | "SELL"
      position_status: "open" | "closed" | "error"
      settings_mode: "custom" | "copy_admin"
      sl_method: "percent_margin" | "percent_entry" | "fixed_usdt" | "atr_based"
      tp_strategy: "partial_close" | "main_tp_only" | "trailing_stop"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_status: ["pending", "executed", "ignored", "error"],
      app_role: ["admin", "user"],
      calculator_type: ["simple_percent", "risk_reward", "atr_based"],
      position_side: ["BUY", "SELL"],
      position_status: ["open", "closed", "error"],
      settings_mode: ["custom", "copy_admin"],
      sl_method: ["percent_margin", "percent_entry", "fixed_usdt", "atr_based"],
      tp_strategy: ["partial_close", "main_tp_only", "trailing_stop"],
    },
  },
} as const
