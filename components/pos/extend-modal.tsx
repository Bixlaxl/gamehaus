"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import type { OrderItem } from "@/lib/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { toast } from "sonner";

export function ExtendModal() {
  const extendModalItem  = usePOSStore((s) => s.extendModalItem);
  const setExtendModalItem = usePOSStore((s) => s.setExtendModalItem);
  const patchOrderItem   = usePOSStore((s) => s.patchOrderItem);
  const qc = useQueryClient();
  const [customMins, setCustomMins] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  function close() {
    setExtendModalItem(null);
    setCustomMins(""); setError(null);
  }

  async function extend(mins: number) {
    if (!extendModalItem || loading) return;
    setLoading(true); setError(null);

    // Optimistically update the expected_end so countdown refreshes instantly
    const prevExpectedEnd = extendModalItem.expected_end;
    const newExpectedEnd  = new Date(
      (prevExpectedEnd ? new Date(prevExpectedEnd) : new Date()).getTime() + mins * 60 * 1000
    ).toISOString();
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
          <div className="flex items-center justify-between">
            <DialogTitle className="text-gray-900 dark:text-white text-base font-bold">Extend Session</DialogTitle>
            <button
              onClick={close}
              className="text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-gray-500 dark:text-[#666]">
            Checks for upcoming bookings (10 min buffer).
          </p>

          {/* Quick presets */}
          <div className="grid grid-cols-2 gap-2">
            {[30, 60].map((mins) => (
              <button
                key={mins}
                onClick={() => extend(mins)}
                disabled={loading}
                className="py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-85 disabled:opacity-40
                  bg-gray-100 dark:bg-[#161616]
                  border border-gray-200 dark:border-[#2A2A2A]
                  text-gray-900 dark:text-white"
              >
                +{mins} min
              </button>
            ))}
          </div>

          {/* Custom */}
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Custom mins"
              value={customMins}
              onChange={(e) => setCustomMins(e.target.value)}
              min="5"
              max="240"
              className="flex-1 px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A]
                border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white
                placeholder-gray-400 dark:placeholder-[#444]
                focus:border-[#D4541A]"
            />
            <button
              onClick={() => extend(parseInt(customMins))}
              disabled={loading || !customMins}
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
