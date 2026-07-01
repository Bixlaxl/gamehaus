import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { mergeSettings, type AppSettings } from "@/lib/settings";

export const runtime = "edge";

const cancellationTier = z.object({
  hours_before: z.number().nonnegative(),
  refund_pct:   z.number().min(0).max(100),
});

const settingsSchema = z.object({
  loyalty: z.object({
    earn_rupees_per_point:   z.number().positive(),
    redeem_rupees_per_point: z.number().positive(),
    min_points_to_redeem:    z.number().int().nonnegative(),
  }).partial().optional(),
  stock: z.object({
    default_low_threshold: z.number().int().nonnegative(),
  }).partial().optional(),
  booking: z.object({
    advance_amount_per_table: z.number().nonnegative(),
    cancellation_full:        z.array(cancellationTier),
    cancellation_advance:     z.array(cancellationTier),
  }).partial().optional(),
}).partial();

/** GET — public. All fields here (loyalty rates, advance amount, cancellation
 *  tiers) are values customers need to see at booking time, so we don't gate
 *  reads on auth. Writes still require owner role. */
export async function GET() {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("data").eq("id", 1).single();
  return NextResponse.json(ok(mergeSettings((data?.data ?? null) as Partial<AppSettings> | null)));
}

/** PATCH — owner only. Partial body, merged onto stored data. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  const { data: viewer } = await admin
    .from("users").select("role").eq("id", session.user.id).single();
  if (viewer?.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const body: unknown = await request.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  // Merge incoming partial onto current data + defaults so DB always stores
  // a fully-populated blob.
  const { data: cur } = await admin.from("app_settings").select("data").eq("id", 1).single();
  const current = mergeSettings((cur?.data ?? null) as Partial<AppSettings> | null);
  const next: AppSettings = {
    loyalty: { ...current.loyalty, ...(parsed.data.loyalty ?? {}) },
    stock:   { ...current.stock,   ...(parsed.data.stock   ?? {}) },
    booking: {
      ...current.booking,
      ...(parsed.data.booking ?? {}),
      cancellation_full:    parsed.data.booking?.cancellation_full    ?? current.booking.cancellation_full,
      cancellation_advance: parsed.data.booking?.cancellation_advance ?? current.booking.cancellation_advance,
    },
  };

  const { error } = await admin
    .from("app_settings")
    .upsert({
      id:         1,
      data:       next as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
      updated_by: session.user.id,
    });

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(next));
}

