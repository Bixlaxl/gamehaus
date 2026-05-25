"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import type { OrderItem } from "@/lib/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const EXTEND_BUFFER_MINS = 0;

// Outer gate — until the modal should actually open, this component does
// nothing. Crucially it does NOT subscribe to `now` or `tables`, so when
// closed it costs zero re-renders even during realtime ticks or the 1s clock.
export function ExtendModal() {
  const extendModalItem = usePOSStore((s) => s.extendModalItem);
  if (!extendModalItem) return null;
  return <ExtendModalInner item={extendModalItem} />;
}

function ExtendModalInner({ item }: { item: NonNullable<ReturnType<typeof usePOSStore.getState>["extendModalItem"]> }) {
  const setExtendModalItem = usePOSStore((s) => s.setExtendModalItem);
  const patchOrderItem     = usePOSStore((s) => s.patchOrderItem);
  const tables             = usePOSStore((s) => s.tables);
  const closingTime        = usePOSStore((s) => s.closingTime);
  const now                = usePOSStore((s) => s.now);
  const qc = useQueryClient();
  const [customMins, setCustomMins] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Keep the rest of the component working with the existing local name.
  const extendModalItem = item;

  function close() {
    setExtendModalItem(null);
    setCustomMins(""); setError(null);
  }

  // ─── Max allowed extension (anchored to expected_end) ─────────────────────
  // We always extend from expected_end (the originally booked end) — not from
  // "now" — so brief staff delays don't shrink the customer's add-on time.
  const anchorMs = extendModalItem?.expected_end
    ? new Date(extendModalItem.expected_end).getTime()
    : now.getTime();

  const upcomingBooking = extendModalItem
    ? tables.find((t) => t.id === extendModalItem.table_id)?.upcomingBooking ?? null
    : null;

  // Today's shop closing in ms. Treat closings <6am as next-day (midnight cross).
  const closingMs = (() => {
    const [ch, cm] = closingTime.split(":").map(Number);
    const close = new Date(now);
    close.setHours(ch, cm, 0, 0);
    if (close.getTime() < now.getTime() && ch < 6) close.setDate(close.getDate() + 1);
    return close.getTime();
  })();

  // Whichever boundary is closer caps the extension
  const bookingBoundaryMs = upcomingBooking
    ? new Date(upcomingBooking.scheduled_start).getTime() - EXTEND_BUFFER_MINS * 60 * 1000
    : Infinity;
  const ceilingMs    = Math.min(closingMs, bookingBoundaryMs);
  const maxExtendMins = Math.max(0, Math.floor((ceilingMs - anchorMs) / 60000));

  function blockedReason(): string | null {
    if (maxExtendMins > 0) return null;
    if (bookingBoundaryMs < closingMs) return "Next booking too close to extend";
    return "Past shop closing — can't extend further";
  }

  async function extend(mins: number) {
    if (!extendModalItem || loading) return;
    if (mins <= 0 || mins > maxExtendMins) {
      setError(maxExtendMins > 0
        ? `Maximum extension is ${maxExtendMins} min`
        : (blockedReason() ?? "Cannot extend"));
      return;
    }
    setLoading(true); setError(null);

    // Anchor optimistic update to expected_end too (server does the same)
    const prevExpectedEnd = extendModalItem.expected_end;
    const newExpectedEnd  = new Date(anchorMs + mins * 60 * 1000).toISOString();
    patchOrderItem(extendModalItem.id, { expected_end: newExpectedEnd });
    close();

    const res  = await fetch("/api/sessions/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_item_id: extendModalItem.id, extend_mins: mins }),
    });

    const body = await res.json() as
      | { success: true;  data: { new_expected_end: string; message: string } }
      | { success: false; error: string };

    if (!body.success) {
      patchOrderItem(extendModalItem.id, { expected_end: prevExpectedEnd } as Partial<OrderItem>);
      toast.error(body.error ?? "Failed to extend session");
    } else {
      patchOrderItem(extendModalItem.id, { expected_end: body.data.new_expected_end });
      qc.invalidateQueries({ queryKey: ["pos-orders"] });
    }
    setLoading(false);
  }

  return (
    <Dialog open={!!extendModalItem} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xs p-0 gap-0 bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-gray-200 dark:border-[#1F1F1F]">
          <DialogTitle className="text-gray-900 dark:text-white text-base font-bold">Extend Session</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-gray-500 dark:text-[#666]">
            {maxExtendMins > 0
              ? `Up to ${maxExtendMins} min available (until ${
                  bookingBoundaryMs < closingMs ? "next booking" : "shop closing"
                }).`
              : (blockedReason() ?? "Cannot extend")}
          </p>

          {/* Quick presets — disabled when they would exceed shop closing or next booking */}
          <div className="grid grid-cols-3 gap-2">
            {[15, 30, 60].map((mins) => {
              const blocked = mins > maxExtendMins;
              return (
                <button
                  key={mins}
                  onClick={() => extend(mins)}
                  disabled={loading || blocked}
                  title={blocked ? (blockedReason() ?? "Too close to next limit") : `Extend by ${mins} minutes`}
                  className={`py-2.5 rounded-xl text-sm font-bold transition-all
                    ${blocked
                      ? "bg-gray-50 dark:bg-[#0d0d0d] text-gray-300 dark:text-[#333] line-through cursor-not-allowed"
                      : "bg-gray-100 dark:bg-[#161616] border border-gray-200 dark:border-[#2A2A2A] text-gray-900 dark:text-white hover:opacity-85"}
                    disabled:opacity-60`}
                >
                  +{mins} min
                </button>
              );
            })}
          </div>

          {/* Custom — client cap matches the same ceiling as presets */}
          <div className="flex gap-2">
            <input
              type="number"
              placeholder={maxExtendMins > 0 ? `Max ${maxExtendMins} min` : "Unavailable"}
              value={customMins}
              onChange={(e) => setCustomMins(e.target.value)}
              min="5"
              max={maxExtendMins || undefined}
              disabled={maxExtendMins === 0}
              className="flex-1 px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A]
                border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white
                placeholder-gray-400 dark:placeholder-[#444]
                focus:border-[#D4541A] disabled:opacity-40"
            />
            <button
              onClick={() => extend(parseInt(customMins))}
              disabled={
                loading ||
                !customMins ||
                parseInt(customMins) > maxExtendMins ||
                parseInt(customMins) <= 0
              }
              className="px-4 py-2.5 rounded-lg font-bold text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-40"
              style={{ background: "#D4541A" }}
            >
              Extend
            </button>
          </div>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{ background: "rgba(239,68,68,0.07)", color: "#f87171", border: "1px solid rgba(239,68,68,0.18)" }}
            >
              {error}
            </p>
          )}

          <button
            onClick={close}
            className="w-full py-2 rounded-xl text-sm font-medium transition-colors
              bg-gray-100 dark:bg-[#161616]
              border border-gray-200 dark:border-[#1F1F1F]
              text-gray-500 dark:text-[#666]
              hover:text-gray-900 dark:hover:text-white"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
