import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err, assignMembershipSchema } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body = await request.json() as unknown;
  const parsed = assignMembershipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.issues[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { customer_phone, plan_id, starts_at } = parsed.data;

  const admin = createAdminClient();
  const { data: plan, error: planErr } = await admin
    .from("membership_plans")
    .select("*")
    .eq("id", plan_id)
    .single();

  if (planErr || !plan) {
    return NextResponse.json(err("Plan not found", "NOT_FOUND"), { status: 404 });
  }

  const startsAt  = starts_at ? new Date(starts_at) : new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setDate(expiresAt.getDate() + plan.duration_days);

  // Deactivate any existing active memberships for this customer
  await admin
    .from("customer_memberships")
    .update({ is_active: false })
    .eq("customer_phone", customer_phone)
    .eq("is_active", true);

  const { data, error } = await admin
    .from("customer_memberships")
    .insert({
      customer_phone,
      plan_id,
      starts_at:  startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select(`*, plan:membership_plans(*)`)
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data), { status: 201 });
}
