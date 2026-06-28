import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateBill } from "@/lib/billing/engine";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tableId = searchParams.get("table_id");
  if (!tableId) {
    return NextResponse.json(err("table_id required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Fetch table details
  const { data: table, error: tableErr } = await admin
    .from("tables")
    .select("id, name, type, hourly_rate, people_pricing")
    .eq("id", tableId)
    .single();

  if (tableErr || !table) {
    return NextResponse.json(err("Table not found", "NOT_FOUND"), { status: 404 });
  }

  // 2. Fetch active session running or scheduled on this table
  // Prioritize running sessions over scheduled sessions so that active sessions are not interrupted by future bookings.
  let { data: item, error: itemErr } = await admin
    .from("order_items")
    .select("*, order:orders(*)")
    .eq("table_id", tableId)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (itemErr) {
    return NextResponse.json(err(itemErr.message, "DB_ERROR"), { status: 500 });
  }

  if (!item) {
    // If no running session exists, look for the next scheduled session (ordered by scheduled_start ascending to get the nearest upcoming session)
    const { data: schedItem, error: schedErr } = await admin
      .from("order_items")
      .select("*, order:orders(*)")
      .eq("table_id", tableId)
      .eq("status", "scheduled")
      .order("scheduled_start", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (schedErr) {
      return NextResponse.json(err(schedErr.message, "DB_ERROR"), { status: 500 });
    }
    item = schedItem;
  }

  if (!item) {
    return NextResponse.json(ok({ table, session: null }));
  }

  // 3. If running, calculate countdown and live bill
  let sessionData = null;

  if (item.status === "running" && item.actual_start) {
    const startMs = new Date(item.actual_start).getTime();
    const nowMs = Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    
    let expectedEndIso = item.expected_end;
    let remainingSeconds = 0;
    let isOvertime = false;

    if (item.expected_end) {
      const endMs = new Date(item.expected_end).getTime();
      remainingSeconds = Math.max(0, Math.floor((endMs - nowMs) / 1000));
      isOvertime = nowMs > endMs;
    }

    // 4. Fetch order extras (beverages, snacks)
    const { data: extras = [] } = await admin
      .from("order_extras")
      .select("*")
      .eq("order_id", item.order_id)
      .eq("is_deleted", false);

    // 5. Calculate bill (if overtime/lapsed, extend expected_end in-memory to now)
    const billingItem = { ...item };
    if (isOvertime) {
      billingItem.expected_end = new Date().toISOString();
    }

    const billResult = calculateBill(
      [billingItem as any],
      extras || [],
      new Date(),
      null,
      item.order?.advance_paid ?? 0,
      item.order?.discount_amount ?? 0
    );

    sessionData = {
      order_item_id: item.id,
      order_id: item.order_id,
      status: item.status,
      actual_start: item.actual_start,
      expected_end: expectedEndIso,
      num_people: item.num_people,
      rate_per_hour: item.rate_per_hour,
      elapsed_seconds: elapsedSeconds,
      remaining_seconds: remainingSeconds,
      is_overtime: isOvertime,
      current_bill: billResult.totalDue,
      extras: (extras || []).map(e => ({
        id: e.id,
        name: e.name,
        quantity: e.quantity,
        price: e.price,
        amount: Math.round(e.price * e.quantity * 100) / 100
      }))
    };
  } else {
    // Session is scheduled but not yet started (checked in)
    sessionData = {
      order_item_id: item.id,
      order_id: item.order_id,
      status: item.status,
      scheduled_start: item.scheduled_start,
      scheduled_end: item.scheduled_end,
      num_people: item.num_people,
      rate_per_hour: item.rate_per_hour,
      current_bill: item.order?.advance_paid ?? 0,
      extras: []
    };
  }

  return NextResponse.json(ok({ table, session: sessionData }));
}
