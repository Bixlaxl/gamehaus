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
  type: z.enum(["snooker", "pool", "ps5", "foosball"]),
  size: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  hourly_rate: z.number().positive(),
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
  items: z.array(
    z.object({
      table_id: z.string().uuid(),
      scheduled_start: z.string().datetime().optional(),
      scheduled_end: z.string().datetime().optional(),
      scheduled_duration_mins: z.number().int().positive().optional(),
      rate_per_hour: z.number().positive(),
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

// Add extra
export const addExtraSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().positive().default(1),
});

// Finalize bill
export const finalizeBillSchema = z.object({
  order_id: z.string().uuid(),
  payment_method: z.enum(["cash", "upi", "card"]),
  coupon_code: z.string().optional(),
});

// Check-in booking
export const checkinSchema = z.object({
  booking_id: z.string().uuid(),
});

// No-show
export const noshowSchema = z.object({
  booking_id: z.string().uuid(),
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
});

// Staff create
export const createStaffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  location_id: z.string().uuid(),
});
