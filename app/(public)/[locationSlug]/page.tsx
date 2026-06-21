import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationBrowse } from "@/components/public/location-browse";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

function getLocalDateString(timezone: string = "Asia/Kolkata", dateInput: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateInput);
  } catch (e) {
    return new Date(dateInput.getTime() - dateInput.getTimezoneOffset() * 60_000).toISOString().split("T")[0];
  }
}

export default async function LocationPage({
  params,
}: {
  params: Promise<{ locationSlug: string }>;
}) {
  const { locationSlug } = await params;
  const supabase = createAdminClient();

  const { data: location } = await supabase
    .from("locations")
    .select("*")
    .eq("slug", locationSlug)
    .eq("is_active", true)
    .single();

  if (!location) notFound();

  // Today in local timezone format — matches client-side local date calculation
  const todayDate = getLocalDateString(location.timezone);
  const dayStartIso = new Date(`${todayDate}T00:00:00+05:30`).toISOString();
  const dayEndIso   = new Date(`${todayDate}T23:59:59+05:30`).toISOString();

  // Run tables + today's blocked-slot data in parallel (3 queries, 1 round-trip)
  const [{ data: tables }, { data: rawItems }, { data: rawBookings }] = await Promise.all([
    supabase
      .from("tables")
      .select("*")
      .eq("location_id", location.id)
      .eq("is_active", true)
      .order("sort_order"),
    // Don't SQL-filter on scheduled_start — walk-ins have NULL there and would
    // be silently excluded, leaving the table appearing free to public bookers.
    // The post-filter loop below scopes by date using actual_start (running) or
    // scheduled_start (scheduled). Result set stays small because we already
    // restrict to open items (status: running/scheduled, not deleted).
    supabase
      .from("order_items")
      .select("table_id, actual_start, expected_end, scheduled_start, scheduled_end, status")
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),
    supabase
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(table_id)")
      .eq("status", "confirmed")
      .gte("scheduled_start", dayStartIso)
      .lte("scheduled_start", dayEndIso),
  ]);

  // Group blocked ranges by tableId (this location's tables only)
  const tableIdSet = new Set((tables ?? []).map((t) => t.id));
  const dayStartMs = new Date(dayStartIso).getTime();
  const dayEndMs   = new Date(dayEndIso).getTime();

  // Pre-initialize ALL tables with empty arrays so the client skips the API
  // call for every table today, not just those that happen to have bookings.
  const initialSlots: Record<string, { start: string; end: string }[]> = {};
  for (const t of tables ?? []) initialSlots[t.id] = [];

  for (const item of rawItems ?? []) {
    if (!item.table_id || !tableIdSet.has(item.table_id)) continue;
    const startStr = item.status === "running" ? item.actual_start : item.scheduled_start;
    if (!startStr) continue;
    const startMs = new Date(startStr).getTime();
    if (startMs < dayStartMs || startMs > dayEndMs) continue;
    if (!initialSlots[item.table_id]) initialSlots[item.table_id] = [];
    if (item.status === "running" && item.actual_start) {
      initialSlots[item.table_id].push({
        start: item.actual_start,
        end: item.expected_end ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    } else if (item.scheduled_start && item.scheduled_end) {
      initialSlots[item.table_id].push({ start: item.scheduled_start, end: item.scheduled_end });
    }
  }

  for (const b of rawBookings ?? []) {
    const tableId = (b.order_item as unknown as { table_id: string } | null)?.table_id;
    if (!tableId || !tableIdSet.has(tableId)) continue;
    if (!initialSlots[tableId]) initialSlots[tableId] = [];
    initialSlots[tableId].push({ start: b.scheduled_start, end: b.scheduled_end });
  }

  // Deduplicate by start time per table
  for (const tableId of Object.keys(initialSlots)) {
    const seen = new Set<string>();
    initialSlots[tableId] = initialSlots[tableId].filter((r) => {
      if (seen.has(r.start)) return false;
      seen.add(r.start);
      return true;
    });
  }

  return (
    <LocationBrowse
      location={location}
      tables={tables ?? []}
      initialSlots={initialSlots}
      initialDate={todayDate}
    />
  );
}
