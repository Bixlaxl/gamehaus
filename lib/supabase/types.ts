export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      locations: {
        Row: {
          id: string;
          name: string;
          address: string;
          phone: string | null;
          timezone: string;
          opening_time: string;
          closing_time: string;
          slug: string;
          is_active: boolean;
          image_urls: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          address: string;
          phone?: string | null;
          timezone?: string;
          opening_time?: string;
          closing_time?: string;
          slug: string;
          is_active?: boolean;
          image_urls?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          address?: string;
          phone?: string | null;
          timezone?: string;
          opening_time?: string;
          closing_time?: string;
          slug?: string;
          is_active?: boolean;
          image_urls?: string[];
          created_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          name: string;
          email: string;
          role: "owner" | "staff";
          location_id: string | null;
          is_active: boolean;
          created_at: string;
          login_password: string | null;
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          role: "owner" | "staff";
          location_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          login_password?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          role?: "owner" | "staff";
          location_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          login_password?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "users_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          }
        ];
      };
      tables: {
        Row: {
          id: string;
          location_id: string;
          name: string;
          type: string;
          size: string | null;
          description: string | null;
          image_url: string | null;
          hourly_rate: number;
          people_pricing: Record<string, number> | null;
          modes: TableMode[] | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          location_id: string;
          name: string;
          type: string;
          size?: string | null;
          description?: string | null;
          image_url?: string | null;
          hourly_rate: number;
          people_pricing?: Record<string, number> | null;
          modes?: TableMode[] | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          location_id?: string;
          name?: string;
          type?: string;
          size?: string | null;
          description?: string | null;
          image_url?: string | null;
          hourly_rate?: number;
          people_pricing?: Record<string, number> | null;
          modes?: TableMode[] | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tables_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          }
        ];
      };
      coupons: {
        Row: {
          id: string;
          location_id: string | null;
          code: string;
          discount_type: "percent" | "flat";
          discount_value: number;
          valid_from: string;
          valid_until: string;
          max_uses: number | null;
          used_count: number;
          is_active: boolean;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          location_id?: string | null;
          code: string;
          discount_type: "percent" | "flat";
          discount_value: number;
          valid_from: string;
          valid_until: string;
          max_uses?: number | null;
          used_count?: number;
          is_active?: boolean;
          is_public?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          location_id?: string | null;
          code?: string;
          discount_type?: "percent" | "flat";
          discount_value?: number;
          valid_from?: string;
          valid_until?: string;
          max_uses?: number | null;
          used_count?: number;
          is_active?: boolean;
          is_public?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coupons_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          }
        ];
      };
      orders: {
        Row: {
          id: string;
          location_id: string;
          type: "online" | "walk_in";
          customer_name: string;
          customer_phone: string | null;
          status: "open" | "finalized" | "cancelled";
          coupon_id: string | null;
          subtotal: number | null;
          discount_amount: number;
          public_discount_amount: number;
          total_amount: number | null;
          advance_paid: number;
          amount_due: number | null;
          points_redeemed: number;
          created_by: string | null;
          created_at: string;
          finalized_at: string | null;
          membership_id: string | null;
        };
        Insert: {
          id?: string;
          location_id: string;
          type: "online" | "walk_in";
          customer_name: string;
          customer_phone?: string | null;
          status?: "open" | "finalized" | "cancelled";
          coupon_id?: string | null;
          subtotal?: number | null;
          discount_amount?: number;
          public_discount_amount?: number;
          total_amount?: number | null;
          advance_paid?: number;
          amount_due?: number | null;
          points_redeemed?: number;
          created_by?: string | null;
          created_at?: string;
          finalized_at?: string | null;
          membership_id?: string | null;
        };
        Update: {
          id?: string;
          location_id?: string;
          type?: "online" | "walk_in";
          customer_name?: string;
          customer_phone?: string | null;
          status?: "open" | "finalized" | "cancelled";
          coupon_id?: string | null;
          subtotal?: number | null;
          discount_amount?: number;
          public_discount_amount?: number;
          total_amount?: number | null;
          advance_paid?: number;
          amount_due?: number | null;
          points_redeemed?: number;
          created_by?: string | null;
          created_at?: string;
          finalized_at?: string | null;
          membership_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "customer_memberships";
            referencedColumns: ["id"];
          }
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          table_id: string;
          status: "scheduled" | "running" | "finished" | "cancelled";
          scheduled_start: string | null;
          scheduled_end: string | null;
          scheduled_duration_mins: number | null;
          actual_start: string | null;
          actual_end: string | null;
          expected_end: string | null;
          extended_mins: number;
          rate_per_hour: number;
          final_amount: number | null;
           num_people: number | null;
          is_deleted: boolean;
          deleted_at: string | null;
          created_at: string;
          free_hours_to_redeem?: number | null;
          membership_id?: string | null;
          selected_mode_name?: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          table_id: string;
          status?: "scheduled" | "running" | "finished" | "cancelled";
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          scheduled_duration_mins?: number | null;
          actual_start?: string | null;
          actual_end?: string | null;
          expected_end?: string | null;
          extended_mins?: number;
          rate_per_hour: number;
          final_amount?: number | null;
          num_people?: number | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          free_hours_to_redeem?: number | null;
          membership_id?: string | null;
          selected_mode_name?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          table_id?: string;
          status?: "scheduled" | "running" | "finished" | "cancelled";
          scheduled_start?: string | null;
          scheduled_end?: string | null;
          scheduled_duration_mins?: number | null;
          actual_start?: string | null;
          actual_end?: string | null;
          expected_end?: string | null;
          extended_mins?: number;
          rate_per_hour?: number;
          final_amount?: number | null;
          num_people?: number | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          free_hours_to_redeem?: number | null;
          membership_id?: string | null;
          selected_mode_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_table_id_fkey";
            columns: ["table_id"];
            isOneToOne: false;
            referencedRelation: "tables";
            referencedColumns: ["id"];
          }
        ];
      };
      order_extras: {
        Row: {
          id: string;
          order_id: string;
          name: string;
          price: number;
          cost_price: number;
          quantity: number;
          inventory_item_id: string | null;
          is_deleted: boolean;
          deleted_at: string | null;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          name: string;
          price: number;
          cost_price?: number;
          quantity?: number;
          inventory_item_id?: string | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          name?: string;
          price?: number;
          cost_price?: number;
          quantity?: number;
          inventory_item_id?: string | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_extras_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_extras_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      bookings: {
        Row: {
          id: string;
          order_id: string;
          order_item_id: string;
          scheduled_start: string;
          scheduled_end: string;
          held_until: string;
          status: "confirmed" | "checked_in" | "finished" | "completed" | "no_show" | "cancelled";
          no_show_marked_by: string | null;
          no_show_marked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          order_item_id: string;
          scheduled_start: string;
          scheduled_end: string;
          held_until: string;
          status?: "confirmed" | "checked_in" | "finished" | "completed" | "no_show" | "cancelled";
          no_show_marked_by?: string | null;
          no_show_marked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          order_item_id?: string;
          scheduled_start?: string;
          scheduled_end?: string;
          held_until?: string;
          status?: "confirmed" | "checked_in" | "finished" | "completed" | "no_show" | "cancelled";
          no_show_marked_by?: string | null;
          no_show_marked_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_no_show_marked_by_fkey";
            columns: ["no_show_marked_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      payments: {
        Row: {
          id: string;
          order_id: string;
          amount: number;
          method: "cash" | "upi" | "card" | "razorpay";
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          status: "pending" | "completed" | "failed" | "refunded";
          collected_by: string | null;
          collected_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          amount: number;
          method: "cash" | "upi" | "card" | "razorpay";
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          status?: "pending" | "completed" | "failed" | "refunded";
          collected_by?: string | null;
          collected_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          amount?: number;
          method?: "cash" | "upi" | "card" | "razorpay";
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          status?: "pending" | "completed" | "failed" | "refunded";
          collected_by?: string | null;
          collected_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_collected_by_fkey";
            columns: ["collected_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      table_availability_overrides: {
        Row: {
          id: string;
          table_id: string;
          date: string;
          start_time: string | null;
          end_time: string | null;
          is_blocked: boolean;
          reason: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          table_id: string;
          date: string;
          start_time?: string | null;
          end_time?: string | null;
          is_blocked?: boolean;
          reason?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          table_id?: string;
          date?: string;
          start_time?: string | null;
          end_time?: string | null;
          is_blocked?: boolean;
          reason?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "table_availability_overrides_table_id_fkey";
            columns: ["table_id"];
            isOneToOne: false;
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "table_availability_overrides_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      customer_profiles: {
        Row: {
          id: string;
          phone: string;
          name: string | null;
          visit_count: number;
          total_spent: number;
          points_balance: number;
          last_visit_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          name?: string | null;
          visit_count?: number;
          total_spent?: number;
          points_balance?: number;
          last_visit_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          name?: string | null;
          visit_count?: number;
          total_spent?: number;
          points_balance?: number;
          last_visit_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      inventory_items: {
        Row: {
          id: string;
          location_id: string;
          name: string;
          category: string;
          selling_price: number;
          cost_price: number;
          image_url: string | null;
          is_active: boolean;
          show_at_checkout: boolean;
          sort_order: number;
          stock_count: number;
          low_stock_threshold: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          location_id: string;
          name: string;
          category?: string;
          selling_price: number;
          cost_price?: number;
          image_url?: string | null;
          is_active?: boolean;
          show_at_checkout?: boolean;
          sort_order?: number;
          stock_count?: number;
          low_stock_threshold?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          location_id?: string;
          name?: string;
          category?: string;
          selling_price?: number;
          cost_price?: number;
          image_url?: string | null;
          is_active?: boolean;
          show_at_checkout?: boolean;
          sort_order?: number;
          stock_count?: number;
          low_stock_threshold?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          }
        ];
      };
      app_settings: {
        Row: {
          id: number;
          data: Record<string, unknown>;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          data?: Record<string, unknown>;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: number;
          data?: Record<string, unknown>;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      inventory_stock_logs: {
        Row: {
          id: string;
          inventory_item_id: string;
          location_id: string;
          change: number;
          reason: "restock" | "sale" | "adjustment" | "reverse";
          order_extra_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inventory_item_id: string;
          location_id: string;
          change: number;
          reason: "restock" | "sale" | "adjustment" | "reverse";
          order_extra_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          inventory_item_id?: string;
          location_id?: string;
          change?: number;
          reason?: "restock" | "sale" | "adjustment" | "reverse";
          order_extra_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_stock_logs_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          }
        ];
      };
      membership_plans: {
        Row: {
          id: string;
          name: string;
          price: number;
          duration_days: number;
          discount_pct: number;
          free_hrs: number;
          is_active: boolean;
          created_at: string;
          bound_table_ids: string[];
        };
        Insert: {
          id?: string;
          name: string;
          price: number;
          duration_days: number;
          discount_pct?: number;
          free_hrs?: number;
          is_active?: boolean;
          created_at?: string;
          bound_table_ids?: string[];
        };
        Update: {
          id?: string;
          name?: string;
          price?: number;
          duration_days?: number;
          discount_pct?: number;
          free_hrs?: number;
          is_active?: boolean;
          created_at?: string;
          bound_table_ids?: string[];
        };
        Relationships: [];
      };
      customer_memberships: {
        Row: {
          id: string;
          customer_phone: string;
          plan_id: string;
          starts_at: string;
          expires_at: string;
          free_hrs_used: number;
          is_active: boolean;
          created_at: string;
          bound_table_ids: string[];
          free_hours_ledger: Json;
          short_id: string | null;
        };
        Insert: {
          id?: string;
          customer_phone: string;
          plan_id: string;
          starts_at?: string;
          expires_at: string;
          free_hrs_used?: number;
          is_active?: boolean;
          created_at?: string;
          bound_table_ids?: string[];
          free_hours_ledger?: Json;
          short_id?: string | null;
        };
        Update: {
          id?: string;
          customer_phone?: string;
          plan_id?: string;
          starts_at?: string;
          expires_at?: string;
          free_hrs_used?: number;
          is_active?: boolean;
          created_at?: string;
          bound_table_ids?: string[];
          free_hours_ledger?: Json;
          short_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_memberships_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "membership_plans";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience row types
export type Location = Database["public"]["Tables"]["locations"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Table = Database["public"]["Tables"]["tables"]["Row"];
export type Order = Database["public"]["Tables"]["orders"]["Row"];
export type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
export type OrderExtra = Database["public"]["Tables"]["order_extras"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type Coupon = Database["public"]["Tables"]["coupons"]["Row"];
export type TableAvailabilityOverride =
  Database["public"]["Tables"]["table_availability_overrides"]["Row"];
export type CustomerProfile =
  Database["public"]["Tables"]["customer_profiles"]["Row"];
export type InventoryItem =
  Database["public"]["Tables"]["inventory_items"]["Row"];
export type InventoryStockLog =
  Database["public"]["Tables"]["inventory_stock_logs"]["Row"];

// app_settings is a single-row jsonb-blob table; the AppSettings shape lives
// in lib/settings.ts. We expose the row type here so the supabase client knows
// the table exists.
export type MembershipPlan =
  Database["public"]["Tables"]["membership_plans"]["Row"];
export type CustomerMembership =
  Database["public"]["Tables"]["customer_memberships"]["Row"];

export interface TableMode {
  id: string;
  name: string;
  icon?: string | null;
  hourly_rate: number;
  pricing_basis?: "none" | "player" | "controller";
  people_pricing?: Record<string, number> | null;
}
