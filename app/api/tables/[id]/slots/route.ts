import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { isPs5Conflict, getConsoleNumber } from "@/lib/utils";

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

  // 1. Fetch target table to verify type
  const { data: targetTable, error: targetTableErr } = await admin
    .from("tables")
    .select("location_id, name, type")
    .eq("id", tableId)
    .single();

  if (targetTableErr || !targetTable) {
    return NextResponse.json(err("Table not found", "NOT_FOUND"), { status: 404 });
  }

  // 2. Load all active tables in location to map PS5 console dependencies
  const { data: allTables } = await admin
    .from("tables")
    .select("id, name, type")
    .eq("location_id", targetTable.location_id)
    .eq("is_active", true);

  const hasPs5 = targetTable.type === "ps5";
  const queryTableIds = hasPs5
    ? (allTables?.filter((t) => t.type === "ps5").map((t) => t.id) ?? [tableId])
    : [tableId];

  const reqConsole = hasPs5 ? getConsoleNumber(targetTable.name) : null;
  const otherConsoleTableIds = hasPs5
    ? (allTables
        ?.filter((t) => {
          if (t.type !== "ps5") return false;
          const c = getConsoleNumber(t.name);
          return c !== null && reqConsole !== null && c !== reqConsole;
        })
        .map((t) => t.id) ?? [])
    : [];

  // Don't SQL-filter on scheduled_start — walk-ins have NULL scheduled_start
  // and would be excluded, leaving the table appearing free to public bookers.
  // Post-filter handles date scoping using actual_start (running) or scheduled_start (scheduled).
  const [{ data: rawItems }, { data: rawBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("table_id, actual_start, actual_end, expected_end, scheduled_start, scheduled_end, status, num_people")
      .in("table_id", queryTableIds)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),

    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(table_id, num_people)")
      .in("order_items.table_id", queryTableIds)
      .eq("status", "confirmed")
      .gte("scheduled_start", new Date(dayStartMs).toISOString())
      .lte("scheduled_start", new Date(dayEndMs).toISOString()),
  ]);

  const items = (rawItems ?? []).filter(item => {
    const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
    if (!startStr) return false;
    const startMs = new Date(startStr).getTime();
    const isSameDay = startMs >= dayStartMs && startMs <= dayEndMs;
    if (!isSameDay) return false;

    if (hasPs5) {
      const exTable = allTables?.find(t => t.id === item.table_id);
      if (!exTable) return false;
      return isPs5Conflict({
        reqTableId: tableId,
        reqTableName: targetTable.name,
        reqTableType: targetTable.type,
        reqNumPeople: 1, // default to 1-pax check on slot views
        exTableId: item.table_id,
        exTableName: exTable.name,
        exTableType: exTable.type,
        exNumPeople: item.num_people ?? 1
      });
    }
    return item.table_id === tableId;
  });

  const bookings = (rawBookings ?? []).filter(b => {
    const oi = b.order_item as unknown as { table_id: string; num_people: number | null } | null;
    if (!oi) return false;

    if (hasPs5) {
      const exTable = allTables?.find(t => t.id === oi.table_id);
      if (!exTable) return false;
      return isPs5Conflict({
        reqTableId: tableId,
        reqTableName: targetTable.name,
        reqTableType: targetTable.type,
        reqNumPeople: 1,
        exTableId: oi.table_id,
        exTableName: exTable.name,
        exTableType: exTable.type,
        exNumPeople: oi.num_people ?? 1
      });
    }
    return oi.table_id === tableId;
  });

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

  const otherConsoleBlocked: { start: string; end: string }[] = [];
  if (hasPs5 && reqConsole !== null) {
    const otherConsoleItems = (rawItems ?? []).filter((item) => {
      const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
      if (!startStr) return false;
      const startMs = new Date(startStr).getTime();
      const isSameDay = startMs >= dayStartMs && startMs <= dayEndMs;
      if (!isSameDay) return false;
      return otherConsoleTableIds.includes(item.table_id);
    });

    const otherConsoleBookings = (rawBookings ?? []).filter((b) => {
      const oi = b.order_item as unknown as { table_id: string } | null;
      if (!oi) return false;
      return otherConsoleTableIds.includes(oi.table_id);
    });

    for (const item of otherConsoleItems) {
      if (item.status === "running" && item.actual_start) {
        otherConsoleBlocked.push({
          start: item.actual_start,
          end:   item.expected_end ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        });
      } else if (item.status === "scheduled" && item.scheduled_start && item.scheduled_end) {
        otherConsoleBlocked.push({ start: item.scheduled_start, end: item.scheduled_end });
      }
    }

    for (const b of otherConsoleBookings) {
      otherConsoleBlocked.push({ start: b.scheduled_start, end: b.scheduled_end });
    }
  }

  // Deduplicate otherConsoleBlocked by start time
  const otherSeen = new Set<string>();
  const uniqueOther = otherConsoleBlocked.filter(r => {
    if (otherSeen.has(r.start)) return false;
    otherSeen.add(r.start);
    return true;
  });

  return NextResponse.json({
    ...ok(unique),
    otherConsoleBlocked: uniqueOther,
  });
}
