import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

const schema = z.object({
  booking_id:      z.string().uuid(),
  target_table_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }
  const { booking_id, target_table_id } = parsed.data;

  const admin = createAdminClient();
  const { data: viewer } = await admin
    .from("users").select("role, location_id").eq("id", session.user.id).single();
  if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  // Load booking with joined order item and source table
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("*, order_item:order_items(*, table:tables(*))")
    .eq("id", booking_id)
    .single();

  if (bookingErr || !booking) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }

  const orderItem = booking.order_item as any;
  const sourceTable = orderItem?.table as any;
  if (!orderItem || !sourceTable) {
    return NextResponse.json(err("Booking order item or table not found", "NOT_FOUND"), { status: 404 });
  }

  // Load target table
  const { data: targetTable, error: tableErr } = await admin
    .from("tables")
    .select("*")
    .eq("id", target_table_id)
    .single();

  if (tableErr || !targetTable) {
    return NextResponse.json(err("Target table not found", "NOT_FOUND"), { status: 404 });
  }

  // Authorize location boundary for staff
  if (viewer.role === "staff" && (viewer.location_id !== sourceTable.location_id || viewer.location_id !== targetTable.location_id)) {
    return NextResponse.json(err("Forbidden: Location mismatch", "FORBIDDEN"), { status: 403 });
  }

  // Enforce that both tables are "Medium" tables
  const isSourceMedium = sourceTable.name.toLowerCase().includes("medium");
  const isTargetMedium = targetTable.name.toLowerCase().includes("medium");
  if (!isSourceMedium || !isTargetMedium) {
    return NextResponse.json(err("Table switching is restricted to Medium Tables only", "VALIDATION_ERROR"), { status: 400 });
  }

  if (sourceTable.id === targetTable.id) {
    return NextResponse.json(err("Target table is identical to current table", "VALIDATION_ERROR"), { status: 400 });
  }

  // Conflict overlap checks on target table
  const startMs = new Date(booking.scheduled_start).getTime();
  const endMs   = new Date(booking.scheduled_end).getTime();

  const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, table_id, actual_start, expected_end, scheduled_start, scheduled_end, status")
      .eq("table_id", target_table_id)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),
    admin
      .from("bookings")
      .select("id, scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id)")
      .eq("status", "confirmed")
      .eq("order_items.table_id", target_table_id)
      .neq("id", booking_id),
  ]);

  const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && aE > bS;
  let isConflict = false;

  for (const ex of (existingItems ?? [])) {
    if (ex.id === orderItem.id) continue;
    const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
    const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
    if (exS && exE && overlaps(startMs, endMs, new Date(exS).getTime(), new Date(exE).getTime())) {
      isConflict = true;
      break;
    }
  }

  if (!isConflict) {
    for (const b of (existingBookings ?? [])) {
      if (!b.scheduled_start || !b.scheduled_end) continue;
      if (!overlaps(startMs, endMs, new Date(b.scheduled_start).getTime(), new Date(b.scheduled_end).getTime())) continue;
      isConflict = true;
      break;
    }
  }

  if (isConflict) {
    return NextResponse.json(err("Conflict: target table is occupied during this time window", "TABLE_TAKEN"), { status: 409 });
  }

  // Update table ID on order item
  const { error: updateErr } = await admin
    .from("order_items")
    .update({ table_id: target_table_id })
    .eq("id", orderItem.id);

  if (updateErr) {
    return NextResponse.json(err(updateErr.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ success: true }));
}
