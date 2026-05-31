"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Clock3, ChevronRight, CheckCircle2, XCircle } from "lucide-react";

type StaffBookingRow = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: "pending" | "confirmed" | "cancelled" | string;
  order:      { customer_name: string | null; customer_phone: string | null; advance_paid: number | null } | null;
  order_item: { status: "scheduled" | "running" | "finished" | "cancelled" | string; table: { name: string; type: string } | null } | null;
};

interface Props {
  locationId:      string;
  locationName:    string;
  initialBookings: StaffBookingRow[];
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function StaffBookingsContent({ locationId, locationName, initialBookings }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<{ id: string; action: "checkin" | "noshow" } | null>(null);

  const { data: bookings = initialBookings } = useQuery<StaffBookingRow[]>({
    queryKey: ["staff-bookings", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/pos/bookings?locationId=${locationId}`, { cache: "no-store" });
      const body = await res.json() as { success: true; data: StaffBookingRow[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: initialBookings,
    initialDataUpdatedAt: Date.now(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Group by date so today and tomorrow are visually separated
  const grouped = useMemo(() => {
    const today    = new Date().toISOString().split("T")[0];
    const buckets: Record<string, StaffBookingRow[]> = {};
    for (const b of bookings) {
      const dateKey = b.scheduled_start.split("T")[0];
      (buckets[dateKey] ??= []).push(b);
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({
        date,
        label: date === today ? "Today" : "Tomorrow",
        list,
      }));
  }, [bookings]);

  async function checkIn(b: StaffBookingRow) {
    setBusy({ id: b.id, action: "checkin" });
    const res = await fetch(`/api/bookings/${b.id}/checkin`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? "Check-in failed");
    } else {
      toast.success("Checked in");
      qc.invalidateQueries({ queryKey: ["staff-bookings", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-orders",     locationId] });
    }
    setBusy(null);
  }

  async function noShow(b: StaffBookingRow) {
    if (!confirm(`Mark ${b.order?.customer_name ?? "this customer"} as no-show? The slot will be freed.`)) return;
    setBusy({ id: b.id, action: "noshow" });
    const res = await fetch(`/api/bookings/${b.id}/noshow`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? "Failed to mark no-show");
    } else {
      toast.success("Marked no-show");
      qc.invalidateQueries({ queryKey: ["staff-bookings", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings",   locationId] });
    }
    setBusy(null);
  }

  function copyPhone(phone: string) {
    navigator.clipboard.writeText(phone).then(
      () => toast.success(`Copied ${phone}`),
      () => toast.error("Copy failed"),
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-[#111] border-b border-[#1f1f1f]">
        <div className="flex items-center gap-3">
          <h1 className="font-extrabold text-white text-sm tracking-tight">Bookings</h1>
          <span className="text-[#555] font-bold">·</span>
          <span className="text-xs font-medium text-[#888]">{locationName}</span>
        </div>
        <span className="text-[11px] font-semibold text-[#888]">
          {bookings.length} total · next 2 days
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {grouped.length === 0 && (
            <div className="text-center py-24 text-[#666]">
              <Clock3 className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="font-semibold text-[#999]">No bookings in the next 2 days</p>
            </div>
          )}

          {grouped.map((bucket) => (
            <section key={bucket.date}>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#888]">
                  {bucket.label}
                </h2>
                <span className="text-[11px] font-mono text-[#666]">{fmtDate(bucket.date + "T00:00:00")}</span>
              </div>

              <ul className="space-y-2">
                {bucket.list.map((b) => {
                  const status      = b.order_item?.status ?? "—";
                  const checkedIn   = status === "running" || status === "finished";
                  const cancelled   = status === "cancelled";
                  const showActions = status === "scheduled";
                  const isBusy      = busy?.id === b.id;
                  return (
                    <li
                      key={b.id}
                      className="rounded-xl bg-[#111] border border-[#222] p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                    >
                      <div className="shrink-0 w-20 text-center">
                        <p className="font-mono font-bold tabular-nums text-white text-base leading-tight">
                          {fmtTime(b.scheduled_start)}
                        </p>
                        <p className="font-mono text-[11px] text-[#888] leading-tight">
                          → {fmtTime(b.scheduled_end)}
                        </p>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="font-bold text-white truncate">
                            {b.order?.customer_name ?? "—"}
                          </p>
                          {b.order_item?.table && (
                            <span
                              className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                              style={{ background: "rgba(212,84,26,0.12)", color: "#D4541A" }}
                            >
                              {b.order_item.table.name}
                            </span>
                          )}
                          {checkedIn && (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                              Checked in
                            </span>
                          )}
                          {cancelled && (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                              No-show
                            </span>
                          )}
                          {(b.order?.advance_paid ?? 0) > 0 && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#888]">
                              ₹{b.order!.advance_paid} advance
                            </span>
                          )}
                        </div>
                        {b.order?.customer_phone && (
                          <button
                            onClick={() => copyPhone(b.order!.customer_phone!)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-[#999] hover:text-[#f59e0b] transition-colors"
                            title="Click to copy"
                          >
                            <Phone className="h-3 w-3" />
                            {b.order.customer_phone}
                          </button>
                        )}
                      </div>

                      {showActions ? (
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => checkIn(b)}
                            disabled={isBusy}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {busy?.action === "checkin" && isBusy ? "…" : "Check in"}
                          </button>
                          <button
                            onClick={() => noShow(b)}
                            disabled={isBusy}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-[#ddd] border border-[#333] hover:bg-[#1f1f1f] transition-colors disabled:opacity-40"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {busy?.action === "noshow" && isBusy ? "…" : "No-show"}
                          </button>
                        </div>
                      ) : (
                        <ChevronRight className="h-4 w-4 text-[#333] shrink-0" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
