import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Edit a finalized bill — staff-allowed corrections only.
 *
 * Allowed:
 *   - customer_name / customer_phone (typo fixes)
 *   - payments[].method                (recorded cash, customer actually paid upi, etc.)
 *
 * NOT allowed via this endpoint:
 *   - line items, prices, discounts, totals — they need an audit trail and
 *     should be handled by the owner via a refund / re-finalize flow.
 *
 * Staff is restricted to bills at their own location; owner can edit any.
 */
const patchSchema = z.object({
  customer_name:  z.string().min(1).max(100).optional(),
  customer_phone: z.string().max(20).nullable().optional(),
  // Map of payment_id → new method. Amount stays as recorded (this is a
  // method-correction, not a refund/adjustment).
  payment_methods: z.record(z.string(), z.enum(["cash", "upi"])).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data: viewer } = await admin
    .from("users").select("role, location_id").eq("id", session.user.id).single();
  if (!viewer) return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });

  // Look up the order so we can enforce location scope for staff edits
  const { data: order, error: lookupErr } = await admin
    .from("orders").select("id, location_id, status, customer_phone").eq("id", orderId).single();
  if (lookupErr || !order) {
    return NextResponse.json(err("Bill not found", "NOT_FOUND"), { status: 404 });
  }
  if (viewer.role === "staff" && viewer.location_id !== order.location_id) {
    return NextResponse.json(err("This bill belongs to a different location", "FORBIDDEN"), { status: 403 });
  }
  if (order.status !== "finalized") {
    return NextResponse.json(err("Only finalized bills can be edited here", "INVALID_STATE"), { status: 400 });
  }

  // ── Apply customer field changes ──────────────────────────────────────────
  const orderPatch: { customer_name?: string; customer_phone?: string | null } = {};
  if (parsed.data.customer_name  !== undefined) orderPatch.customer_name  = parsed.data.customer_name;
  if (parsed.data.customer_phone !== undefined) orderPatch.customer_phone = parsed.data.customer_phone;

  if (Object.keys(orderPatch).length > 0) {
    const { error: upErr } = await admin.from("orders").update(orderPatch).eq("id", orderId);
    if (upErr) return NextResponse.json(err(upErr.message, "DB_ERROR"), { status: 500 });

    // Keep customer_profiles in sync — if phone exists, mirror the new name
    // so the owner customers list reflects the edit on next refresh.
    const phoneForProfile = orderPatch.customer_phone ?? order.customer_phone;
    if (phoneForProfile && orderPatch.customer_name) {
      await admin.from("customer_profiles").upsert(
        { phone: phoneForProfile, name: orderPatch.customer_name },
        { onConflict: "phone", ignoreDuplicates: false }
      );
    }
  }

  // ── Apply payment method changes ──────────────────────────────────────────
  if (parsed.data.payment_methods) {
    const entries = Object.entries(parsed.data.payment_methods);
    for (const [pid, method] of entries) {
      const { error: pErr } = await admin
        .from("payments").update({ method }).eq("id", pid).eq("order_id", orderId);
      if (pErr) return NextResponse.json(err(pErr.message, "DB_ERROR"), { status: 500 });
    }
  }

  return NextResponse.json(ok({ updated: true }));
}
