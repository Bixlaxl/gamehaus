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

  // Check if there is an existing customer_memberships row with this customer_phone to reuse their short_id
  let shortId = "";
  const { data: existingMember } = await admin
    .from("customer_memberships")
    .select("short_id")
    .eq("customer_phone", customer_phone)
    .not("short_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (existingMember && existingMember.short_id) {
    shortId = existingMember.short_id;
  } else {
    // Generate unique short_id
    let isUnique = false;
    let attempts = 0;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    while (!isUnique && attempts < 10) {
      attempts++;
      let candidate = "";
      for (let i = 0; i < 6; i++) {
        candidate += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const { data: existing } = await admin
        .from("customer_memberships")
        .select("id")
        .eq("short_id", candidate)
        .maybeSingle();
      if (!existing) {
        shortId = candidate;
        isUnique = true;
      }
    }
    if (!shortId) {
      for (let i = 0; i < 6; i++) {
        shortId += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
  }

  // Query the table types to initialize the free hours ledger
  let initialLedger: Record<string, number> = {};
  const boundIds: string[] = plan.bound_table_ids ?? [];

  if (boundIds.length > 0) {
    const { data: tables } = await admin
      .from("tables")
      .select("id, type")
      .in("id", boundIds);
    
    if (tables && tables.length > 0) {
      tables.forEach((t) => {
        initialLedger[t.type] = Number(plan.free_hrs) || 0;
      });
    }
  } else {
    const { data: allTables } = await admin.from("tables").select("id, type").eq("is_active", true);
    if (allTables && allTables.length > 0) {
      allTables.forEach((t) => {
        initialLedger[t.type] = Number(plan.free_hrs) || 0;
      });
    }
  }

  const { data, error } = await admin
    .from("customer_memberships")
    .insert({
      customer_phone,
      plan_id,
      starts_at:  startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      bound_table_ids: boundIds,
      free_hours_ledger: initialLedger,
      short_id: shortId,
    })

    .select(`*, plan:membership_plans(*)`)
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data), { status: 201 });
}
