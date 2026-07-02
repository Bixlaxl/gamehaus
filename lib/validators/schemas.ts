import { z } from "zod";

// Standard API response — use everywhere
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string };

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function err(error: string, code: string): ApiResponse<never> {
  return { success: false, error, code };
}

/**
 * Translate a Supabase/Postgres error into a friendlier message for the owner UI.
 * Currently handles foreign-key violations (SQLSTATE 23503) which is what the
 * owner panel hits when trying to permanently delete a record that has child rows.
 *
 * Falls back to the original message for anything else.
 */
export function friendlyDbError(
  dbError: { message: string; code?: string } | null | undefined,
  context: { entity: "location" | "table" | "staff" | "inventory item" }
): { message: string; code: string } {
  if (!dbError) return { message: "Database error", code: "DB_ERROR" };

  // 23503 = foreign_key_violation — the target row has children that reference it
  if (dbError.code === "23503") {
    const friendly: Record<typeof context.entity, string> = {
      "location":
        "Cannot permanently delete — this location still has tables, staff, or past orders. Deactivate it instead.",
      "table":
        "Cannot permanently delete — this table has past sessions or orders attached. Deactivate it instead.",
      "staff":
        "Cannot permanently delete — this staff member has past orders attributed to them. Deactivate them instead.",
      "inventory item":
        "Cannot permanently delete — this item has been sold before. Deactivate it instead.",
    };
    return { message: friendly[context.entity], code: "FK_CONSTRAINT" };
  }

  return { message: dbError.message, code: "DB_ERROR" };
}

// Location
export const locationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  phone: z.string().optional(),
  timezone: z.string().default("Asia/Kolkata"),
  opening_time: z.string().regex(/^\d{2}:\d{2}$/),
  closing_time: z.string().regex(/^\d{2}:\d{2}$/),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
});

// Table
export const tableSchema = z.object({
  location_id: z.string().uuid(),
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  hourly_rate: z.number().positive(),
  people_pricing: z.record(z.string(), z.number()).nullable().optional(),
  modes: z.array(z.object({
    id: z.string(),
    name: z.string().min(1),
    icon: z.string().nullable().optional(),
    hourly_rate: z.number().positive(),
    pricing_basis: z.enum(["none", "player", "controller"]).optional(),
    people_pricing: z.record(z.string(), z.number()).nullable().optional(),
  })).nullable().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export const updateTableSchema = tableSchema.partial();

// Order
export const createOrderSchema = z.object({
  location_id: z.string().uuid(),
  type: z.enum(["online", "walk_in"]),
  customer_name: z.string().min(1),
  customer_phone: z.string().optional(),
  membership_id: z.string().uuid().optional(),
  points_redeemed: z.number().int().min(0).optional().default(0),
  coupon_code: z.string().optional(),
  payment_mode: z.enum(["advance", "full"]).optional(),
  extras: z.array(
    z.object({
      inventory_item_id: z.string().uuid(),
      quantity: z.number().int().positive(),
    })
  ).optional(),
  items: z.array(
    z.object({
      table_id: z.string().uuid(),
      scheduled_start: z.string().datetime().optional(),
      scheduled_end: z.string().datetime().optional(),
      scheduled_duration_mins: z.number().int().positive().optional(),
      rate_per_hour: z.number().positive(),
      num_people: z.number().int().positive().max(20).optional(),
      free_hours_to_redeem: z.number().nonnegative().optional(),
      membership_id: z.string().uuid().optional().nullable(),
      selected_mode_name: z.string().optional().nullable(),
    })
  ),
});

// Session start
export const startSessionSchema = z.object({
  order_item_id: z.string().uuid(),
});

// Session stop
export const stopSessionSchema = z.object({
  order_item_id: z.string().uuid(),
});

// Session extend
export const extendSessionSchema = z.object({
  order_item_id: z.string().uuid(),
  extend_mins: z.number().int().positive().max(240),
});

// Change player / controller count mid-session — rate_per_hour is re-resolved
// from the table's people_pricing JSON on the server.
export const setPeopleSchema = z.object({
  order_item_id: z.string().uuid(),
  num_people:    z.number().int().positive().max(20),
});

// Add extra
export const addExtraSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  cost_price: z.number().min(0).optional().default(0),
  quantity: z.number().int().positive().default(1),
  inventory_item_id: z.string().uuid().optional(),
});



// Coupon
export const couponSchema = z.object({
  location_id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).toUpperCase(),
  discount_type: z.enum(["percent", "flat"]),
  discount_value: z.number().positive(),
  valid_from: z.string().datetime(),
  valid_until: z.string().datetime(),
  max_uses: z.number().int().positive().optional(),
  is_public: z.boolean().optional(),
});

// Inventory item
export const inventoryItemSchema = z.object({
  location_id: z.string().uuid(),
  name: z.string().min(1),
  category: z.string().min(1).default("Other"),
  selling_price: z.number().min(0),
  cost_price: z.number().min(0).default(0),
  image_url: z.string().url().nullable().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  show_at_checkout: z.boolean().optional(),
});

export const updateInventoryItemSchema = inventoryItemSchema.partial();

// Membership plan
export const membershipPlanSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  duration_days: z.number().int().positive(),
  discount_pct: z.number().min(0).max(100).default(0),
  free_hrs: z.number().min(0).default(0),
  bound_table_ids: z.array(z.string().uuid()).optional().default([]),
  is_active: z.boolean().optional(),
});

export const updateMembershipPlanSchema = membershipPlanSchema.partial();

// Assign membership to customer
export const assignMembershipSchema = z.object({
  customer_phone: z.string().min(1),
  plan_id: z.string().uuid(),
  starts_at: z.string().datetime().optional(),
});

// Staff create
export const createStaffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  location_id: z.string().uuid(),
});

// Staff update
export const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  location_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});
