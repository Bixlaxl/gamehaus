import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tableId } = await params;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  if (!date) return NextResponse.json(err("date required", "VALIDATION_ERROR"), { status: 400 });

  const admin = createAdminClient();

  // IST is UTC+5:30. A "day" in IST starts at 18:30 UTC the previous day.
  // Use a wide enough window (±1 day in UTC) and then filter by effective start in code.
  const dayStart = `${date}T00:00:00+05:30`;
  const dayEnd   = `${date}T23:59:59+05:30`;
  const dayStartMs = new Date(dayStart).getTime();
  const dayEndMs   = new Date(dayEnd).getTime();

  // Fetch all active sessions for this table (no OR needed — filter in code)
  const { data: rawItems } = await admin
    .from("order_items")
    .select("actual_start, actual_end, expected_end, scheduled_start, scheduled_end, status")
    .eq("table_id", tableId)
    .eq("is_deleted", false)
    .in("status", ["running", "scheduled"]);

  // Keep only sessions whose effective start falls on the requested date (IST)
  const items = (rawItems ?? []).filter(item => {
    const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
    if (!startStr) return false;
    const startMs = new Date(startStr).getTime();
    return startMs >= dayStartMs && startMs <= dayEndMs;
  });

  // Fetch confirmed bookings for this table on the given date
  const { data: rawBookings } = await admin
    .from("bookings")
    .select("scheduled_start, scheduled_end, order_item:order_items!inner(table_id)")
    .eq("status", "confirmed")
    .gte("scheduled_start", new Date(dayStartMs).toISOString())
    .lte("scheduled_start", new Date(dayEndMs).toISOString());

  // Filter bookings to only those for this table
  const bookings = (rawBookings ?? []).filter(
    b => (b.order_item as { table_id: string } | null)?.table_id === tableId
  );

  const blocked: { start: string; end: string }[] = [];

  for (const item of items) {
    if (item.status === "running" && item.actual_start) {
      blocked.push({
        start: item.actual_start,
        end:   item.expected_end ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    } else if (item.status === "scheduled" && item.scheduled_start && item.scheduled_end) {
      blocked.push({ start: item.scheduled_start, end: item.scheduled_end });
    }
  }

  for (const b of bookings) {
    blocked.push({ start: b.scheduled_start, end: b.scheduled_end });
  }

  // Deduplicate by start time
  const seen = new Set<string>();
  const unique = blocked.filter(r => {
    if (seen.has(r.start)) return false;
    seen.add(r.start);
    return true;
  });

  return NextResponse.json(ok(unique));
}
