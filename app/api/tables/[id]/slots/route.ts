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

  // IST is UTC+5:30. Use a wide enough window (±1 day) and post-filter by IST date.
  const dayStart = `${date}T00:00:00+05:30`;
  const dayEnd   = `${date}T23:59:59+05:30`;
  const dayStartMs = new Date(dayStart).getTime();
  const dayEndMs   = new Date(dayEnd).getTime();

  // Fetch both running/scheduled order_items and confirmed bookings for this table.
  // We deduplicate by order_item id so a booking row + its order_item are never double-counted.
  const [{ data: rawItems }, { data: rawBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, table_id, actual_start, actual_end, expected_end, scheduled_start, scheduled_end, status")
      .eq("table_id", tableId)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),

    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id)")
      .eq("order_items.table_id", tableId)
      .eq("status", "confirmed")
      .gte("scheduled_start", new Date(dayStartMs).toISOString())
      .lte("scheduled_start", new Date(dayEndMs).toISOString()),
  ]);

  const blocked: { start: string; end: string }[] = [];
  const processedItemIds = new Set<string>();

  (rawItems ?? []).forEach((item) => {
    if (item.id) processedItemIds.add(item.id);
    const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
    const endStr   = item.status === "running"
      ? (item.expected_end ?? new Date(Date.now() + 4 * 3600 * 1000).toISOString())
      : item.scheduled_end;
    if (!startStr || !endStr) return;
    // Only include ranges that touch today's window
    const startMs = new Date(startStr).getTime();
    const endMs   = new Date(endStr).getTime();
    if (startMs > dayEndMs || endMs < dayStartMs) return;
    blocked.push({ start: startStr, end: endStr });
  });

  (rawBookings ?? []).forEach((b) => {
    const oi = b.order_item as unknown as { id: string; table_id: string } | null;
    if (!oi || !b.scheduled_start || !b.scheduled_end) return;
    if (oi.id && processedItemIds.has(oi.id)) return; // dedup
    if (oi.id) processedItemIds.add(oi.id);
    blocked.push({ start: b.scheduled_start, end: b.scheduled_end });
  });

  // Deduplicate by start time
  const seen = new Set<string>();
  const unique = blocked.filter((r) => {
    if (seen.has(r.start)) return false;
    seen.add(r.start);
    return true;
  });

  return NextResponse.json(ok(unique));
}
