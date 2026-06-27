import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { checkConsolePoolConflict, isConsoleTable, getSimulatorTotalCapacity, isSimulatorTable } from "@/lib/utils";

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

  // 2. Load all active tables in location to map console/simulator capacity pools
  const { data: rawAllTables } = await admin
    .from("tables")
    .select("id, name, type, people_pricing")
    .eq("location_id", targetTable.location_id)
    .eq("is_active", true);

  const allTables = (rawAllTables ?? []) as Array<{ id: string; name: string; type: string; people_pricing?: Record<string, unknown> | null }>;

  const isConsole = isConsoleTable(targetTable);

  const queryTableIds = isConsole
    ? allTables.filter((t) => isConsoleTable(t)).map((t) => t.id)
    : [tableId];




  // 3. Fetch running items and confirmed bookings
  const [{ data: rawItems }, { data: rawBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, table_id, actual_start, actual_end, expected_end, scheduled_start, scheduled_end, status, num_people")
      .in("table_id", queryTableIds)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),

    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id, num_people)")
      .in("order_items.table_id", queryTableIds)
      .eq("status", "confirmed")
      .gte("scheduled_start", new Date(dayStartMs).toISOString())
      .lte("scheduled_start", new Date(dayEndMs).toISOString()),
  ]);

  const activeRanges: Array<{ tableId: string; numPeople?: number | null; startMs: number; endMs: number; startIso: string; endIso: string }> = [];
  const processedItemIds = new Set<string>();

  (rawItems ?? []).forEach((item) => {
    if (item.id) processedItemIds.add(item.id);
    const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
    const endStr   = item.status === "running"
      ? (item.expected_end ?? new Date(Date.now() + 4 * 3600 * 1000).toISOString())
      : item.scheduled_end;
    if (!startStr || !endStr) return;
    const startMs = new Date(startStr).getTime();
    const endMs   = new Date(endStr).getTime();
    activeRanges.push({ tableId: item.table_id, numPeople: item.num_people, startMs, endMs, startIso: startStr, endIso: endStr });
  });

  (rawBookings ?? []).forEach((b) => {
    const oi = b.order_item as unknown as { id: string; table_id: string; num_people?: number | null } | null;
    if (!oi || !b.scheduled_start || !b.scheduled_end) return;
    if (oi.id && processedItemIds.has(oi.id)) return;
    if (oi.id) processedItemIds.add(oi.id);
    const startMs = new Date(b.scheduled_start).getTime();
    const endMs   = new Date(b.scheduled_end).getTime();
    activeRanges.push({ tableId: oi.table_id, numPeople: oi.num_people, startMs, endMs, startIso: b.scheduled_start, endIso: b.scheduled_end });
  });


  const blocked: { start: string; end: string }[] = [];

  if (!isConsole) {
    activeRanges.forEach((r) => {
      if (r.tableId === tableId) {
        blocked.push({ start: r.startIso, end: r.endIso });
      }
    });
  } else {
    // Generate 15-min slots for the day and check pool conflict for each slot
    const slotStepMs = 15 * 60 * 1000;
    for (let slotMs = dayStartMs; slotMs < dayEndMs; slotMs += slotStepMs) {
      const slotEndMs = slotMs + slotStepMs;
      const occupiedItems = activeRanges
        .filter((r) => slotMs < r.endMs && slotEndMs > r.startMs)
        .map((r) => ({ tableId: r.tableId, numPeople: r.numPeople }));

      const isConflict = checkConsolePoolConflict({
        reqTableId: tableId,
        reqNumPeople: 1, // default to 1 for slot availability check
        allTables,
        occupiedItems,
      });

      if (isConflict) {
        blocked.push({
          start: new Date(slotMs).toISOString(),
          end:   new Date(slotEndMs).toISOString(),
        });
      }
    }
  }


  // Deduplicate by start time
  const seen = new Set<string>();
  const unique = blocked.filter((r) => {
    if (seen.has(r.start)) return false;
    seen.add(r.start);
    return true;
  });

  // Debug payload — helps diagnose over-blocking in production
  const standalonePs5Count = allTables.filter(t => (t.type as string) === "ps5" && !t.name.toLowerCase().includes("simulator")).length;
  const simCapacity = getSimulatorTotalCapacity(allTables);
  const reqTableInfo = allTables.find(t => t.id === tableId);

  return NextResponse.json({
    ...ok(unique),
    otherConsoleBlocked: [],
    _debug: {
      tableId,
      tableName: reqTableInfo?.name,
      tableType: reqTableInfo?.type,
      isConsole,
      totalPs5Consoles: Math.max(2, standalonePs5Count),
      totalSimulatorsCapacity: simCapacity,
      activeRanges: activeRanges.map(r => ({ tableId: r.tableId, numPeople: r.numPeople, start: r.startIso, end: r.endIso })),
      allTablesSummary: allTables.map(t => ({ id: t.id, name: t.name, type: t.type, isSimulator: isSimulatorTable(t), isConsole: isConsoleTable(t), hasPeoplePricing: !!t.people_pricing, ppKeys: t.people_pricing ? Object.keys(t.people_pricing) : [] })),
    },
  });
}

