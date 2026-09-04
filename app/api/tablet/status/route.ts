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

  // 1. Fetch table details + location closing time in one query
  const { data: table, error: tableErr } = await admin
    .from("tables")
    .select("id, name, type, hourly_rate, people_pricing, location:locations(name, closing_time)")
    .eq("id", tableId)
    .single();

  if (tableErr || !table) {
    return NextResponse.json(err("Table not found", "NOT_FOUND"), { status: 404 });
  }

  // Strip the location join from the object returned to the tablet
  const { location: locationData, ...tableForClient } = table as any;
  tableForClient.location_name = locationData?.name;
  const closingTime: string | null = locationData?.closing_time ?? null;

  // 2. Fetch active running session on this table
  // Prioritise running over scheduled so active sessions are not interrupted by future bookings.
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
    // No running session — look for the next scheduled session
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
    return NextResponse.json(ok({ table: tableForClient, session: null }));
  }

  // 3. Build session data
  let sessionData = null;

  if (item.status === "running" && item.actual_start) {
    const startMs = new Date(item.actual_start).getTime();
    const nowMs   = Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));

    let expectedEndIso  = item.expected_end;
    let remainingSeconds = 0;
    let isOvertime       = false;

    if (item.expected_end) {
      const endMs  = new Date(item.expected_end).getTime();
      remainingSeconds = Math.max(0, Math.floor((endMs - nowMs) / 1000));
      isOvertime       = nowMs > endMs;
    }

    // 4. Fetch extras AND next scheduled booking on this table in parallel
    const [{ data: extras = [] }, { data: nextBooking }] = await Promise.all([
      admin
        .from("order_extras")
        .select("*")
        .eq("order_id", item.order_id)
        .eq("is_deleted", false),
      admin
        .from("order_items")
        .select("scheduled_start")
        .eq("table_id", tableId)
        .eq("status", "scheduled")
        .eq("is_deleted", false)
        .gt("scheduled_start", new Date().toISOString())
        .order("scheduled_start", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    // 5. Compute max_extend_mins — mirrors server-side extend validation exactly.
    //    Anchored to expected_end (not now) so brief overtime delays don't shrink
    //    the available extension window.
    const anchorMs = item.expected_end
      ? new Date(item.expected_end).getTime()
      : nowMs;
    let ceilingMs = Infinity;

    if (nextBooking?.scheduled_start) {
      ceilingMs = Math.min(ceilingMs, new Date(nextBooking.scheduled_start).getTime());
    }

    if (closingTime) {
      const [ch, cm]       = closingTime.split(":").map(Number);
      const IST_OFFSET_MS  = 5.5 * 60 * 60 * 1000;
      const nowIst         = new Date(nowMs + IST_OFFSET_MS);
      const y = nowIst.getUTCFullYear(), mo = nowIst.getUTCMonth(), d = nowIst.getUTCDate();
      let closesMs         = Date.UTC(y, mo, d, ch, cm) - IST_OFFSET_MS;
      const crossesMidnight = (ch * 60 + cm) <= (nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes());
      if (crossesMidnight && ch < 6) closesMs += 24 * 60 * 60 * 1000;
      ceilingMs = Math.min(ceilingMs, closesMs);
    }

    const maxExtendMins = ceilingMs === Infinity
      ? 240   // no ceiling — cap at schema max
      : Math.max(0, Math.floor((ceilingMs - anchorMs) / 60000));

    // 6. Calculate bill (if overtime, extend expected_end in-memory to now)
    const billingItem = { ...item };
    if (isOvertime) billingItem.expected_end = new Date().toISOString();

    const billResult = calculateBill(
      [billingItem as any],
      extras || [],
      new Date(),
      null,
      item.order?.advance_paid ?? 0,
      item.order?.discount_amount ?? 0
    );

    sessionData = {
      order_item_id:    item.id,
      order_id:         item.order_id,
      status:           item.status,
      actual_start:     item.actual_start,
      expected_end:     expectedEndIso,
      num_people:       item.num_people,
      rate_per_hour:    item.rate_per_hour,
      elapsed_seconds:  elapsedSeconds,
      remaining_seconds: remainingSeconds,
      is_overtime:      isOvertime,
      current_bill:     billResult.totalDue,
      advance_paid:     item.order?.advance_paid ?? 0,
      max_extend_mins:  maxExtendMins,
      customer_name:    item.order?.customer_name ?? null,
      extras: (extras || []).map(e => ({
        id:       e.id,
        name:     e.name,
        quantity: e.quantity,
        price:    e.price,
        amount:   Math.round(e.price * e.quantity * 100) / 100,
      })),
    };
  } else {
    // Scheduled but not yet started
    sessionData = {
      order_item_id:   item.id,
      order_id:        item.order_id,
      status:          item.status,
      scheduled_start: item.scheduled_start,
      scheduled_end:   item.scheduled_end,
      num_people:      item.num_people,
      rate_per_hour:   item.rate_per_hour,
      current_bill:    item.order?.advance_paid ?? 0,
      max_extend_mins: 0,
      customer_name:   item.order?.customer_name ?? null,
      extras:          [],
    };
  }

  return NextResponse.json(ok({ table: tableForClient, session: sessionData }));
}
