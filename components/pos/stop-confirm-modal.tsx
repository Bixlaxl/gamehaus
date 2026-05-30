"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Square } from "lucide-react";
import { toast } from "sonner";

interface Props {
  locationId: string;
}

// Outer gate — when no item is set the modal does nothing. This prevents the
// `tables` subscription from triggering a re-render of an invisible modal on
// every realtime tick.
export function StopConfirmModal({ locationId }: Props) {
  const item = usePOSStore((s) => s.stopConfirmItem);
  if (!item) return null;
  return <StopConfirmModalInner locationId={locationId} item={item} />;
}

function StopConfirmModalInner({
  locationId, item,
}: Props & { item: NonNullable<ReturnType<typeof usePOSStore.getState>["stopConfirmItem"]> }) {
  const setStopConfirmItem = usePOSStore((s) => s.setStopConfirmItem);
  const patchOrderItem     = usePOSStore((s) => s.patchOrderItem);
  const tables             = usePOSStore((s) => s.tables);
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  function close() {
    setStopConfirmItem(null);
  }

  async function confirm() {
    if (!item || loading) return;
    setLoading(true);
    const nowISO = new Date().toISOString();
    patchOrderItem(item.id, { status: "finished", actual_end: nowISO });
    close();
    const res = await fetch("/api/sessions/stop", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ order_item_id: item.id }),
    });
    if (!res.ok) {
      patchOrderItem(item.id, { status: "running", actual_end: null });
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? `Failed to stop session (${res.status})`);
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
    setLoading(false);
  }

  const tableName = item ? tables.find((t) => t.id === item.table_id)?.name ?? "this table" : "";

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xs p-0 gap-0 bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-[#1F1F1F]">
          <DialogTitle className="text-gray-900 dark:text-white text-base font-bold">
            Stop session?
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-[#ccc]">
            Stop the session on <span className="font-bold text-gray-900 dark:text-white">{tableName}</span>?
            The bill will be ready to collect.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={close}
              disabled={loading}
              className="py-2.5 rounded-xl text-sm font-bold transition-colors
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-800 dark:text-white hover:bg-gray-200 dark:hover:bg-[#222] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={loading}
              className="py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40
                flex items-center justify-center gap-1.5"
              style={{ background: "#ef4444" }}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {loading ? "Stopping…" : "Confirm stop"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
