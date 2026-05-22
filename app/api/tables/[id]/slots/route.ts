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

  // Don't SQL-filter on scheduled_start — walk-ins have NULL scheduled_start
  // and would be excluded, leaving the table appearing free to public bookers.
  // Post-filter handles date scoping using actual_start (running) or scheduled_start (scheduled).
  const [{ data: rawItems }, { data: rawBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("actual_start, actual_end, expected_end, scheduled_start, scheduled_end, status")
      .eq("table_id", tableId)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),

    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(table_id)")
      .eq("order_items.table_id", tableId)
      .eq("status", "confirmed")
      .gte("scheduled_start", new Date(dayStartMs).toISOString())
      .lte("scheduled_start", new Date(dayEndMs).toISOString()),
  ]);

  const items = (rawItems ?? []).filter(item => {
    const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
    if (!startStr) return false;
    const startMs = new Date(startStr).getTime();
    return startMs >= dayStartMs && startMs <= dayEndMs;
  });

  const bookings = rawBookings ?? [];

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
