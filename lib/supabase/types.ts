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
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          role: "owner" | "staff";
          location_id?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          role?: "owner" | "staff";
          location_id?: string | null;
          is_active?: boolean;
          created_at?: string;
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
          type: "snooker" | "pool" | "ps5" | "foosball";
          size: string | null;
          description: string | null;
          image_url: string | null;
          hourly_rate: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          location_id: string;
          name: string;
          type: "snooker" | "pool" | "ps5" | "foosball";
          size?: string | null;
          description?: string | null;
          image_url?: string | null;
          hourly_rate: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          location_id?: string;
          name?: string;
          type?: "snooker" | "pool" | "ps5";
          size?: string | null;
          description?: string | null;
          image_url?: string | null;
          hourly_rate?: number;
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
          total_amount: number | null;
          advance_paid: number;
          amount_due: number | null;
          created_by: string | null;
          created_at: string;
          finalized_at: string | null;
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
          total_amount?: number | null;
          advance_paid?: number;
          amount_due?: number | null;
          created_by?: string | null;
          created_at?: string;
          finalized_at?: string | null;
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
          total_amount?: number | null;
          advance_paid?: number;
          amount_due?: number | null;
          created_by?: string | null;
          created_at?: string;
          finalized_at?: string | null;
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
          is_deleted: boolean;
          deleted_at: string | null;
          created_at: string;
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
          is_deleted?: boolean;
          deleted_at?: string | null;
          created_at?: string;
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
          is_deleted?: boolean;
          deleted_at?: string | null;
          created_at?: string;
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
          quantity: number;
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
          quantity?: number;
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
          quantity?: number;
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
          status: "confirmed" | "checked_in" | "no_show" | "cancelled";
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
          status?: "confirmed" | "checked_in" | "no_show" | "cancelled";
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
          status?: "confirmed" | "checked_in" | "no_show" | "cancelled";
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
          last_visit_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          name?: string | null;
          visit_count?: number;
          total_spent?: number;
          last_visit_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          name?: string | null;
          visit_count?: number;
          total_spent?: number;
          last_visit_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
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
