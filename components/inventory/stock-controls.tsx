"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Minus, History, X } from "lucide-react";
import type { InventoryItem, InventoryStockLog } from "@/lib/supabase/types";

type LogEntry = InventoryStockLog & { actor: { name: string | null } | null };

interface StockBadgeProps {
  item: InventoryItem;
  size?: "sm" | "md";
}

export function StockBadge({ item, size = "md" }: StockBadgeProps) {
  const isOut  = item.stock_count <= 0;
  const isLow  = !isOut && item.stock_count <= item.low_stock_threshold;
  const cls = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";
  if (isOut) {
    return <span className={`${cls} font-bold uppercase tracking-wide rounded bg-red-500/15 text-red-400`}>Out</span>;
  }
  if (isLow) {
    return <span className={`${cls} font-bold uppercase tracking-wide rounded bg-amber-500/15 text-amber-500`}>Low · {item.stock_count}</span>;
  }
  return <span className={`${cls} font-bold tabular-nums rounded bg-emerald-500/12 text-emerald-500`}>{item.stock_count} in stock</span>;
}

interface StockControlsProps {
  item: InventoryItem;
  invalidateKeys?: (string | string[])[];
  // Visual: dark = on POS / owner-dark backgrounds, light = on owner-light cards
  theme?: "light" | "dark";
}

export function StockControls({ item, invalidateKeys = [], theme = "light" }: StockControlsProps) {
  const qc = useQueryClient();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [logOpen,    setLogOpen]    = useState(false);
  const [direction,  setDirection]  = useState<"add" | "remove">("add");
  const [qty,        setQty]        = useState("");

  const adjust = useMutation({
    mutationFn: async () => {
      const n = parseInt(qty);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a positive quantity");
      const change = direction === "add" ? n : -n;
      const reason = direction === "add" ? "restock" : "adjustment";
      const res = await fetch(`/api/inventory/${item.id}/stock`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ change, reason }),
      });
      const body = await res.json() as { success: true; data: { stock_count: number } } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    onSuccess: () => {
      toast.success(direction === "add" ? "Stock added" : "Stock reduced");
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
      for (const key of invalidateKeys) {
        qc.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }
      setAdjustOpen(false);
      setQty("");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function openAdjust(dir: "add" | "remove") {
    setDirection(dir);
    setQty("");
    setAdjustOpen(true);
  }

  // Buttons inherit theme so they look right on both dark POS and lighter owner backgrounds.
  const btnBase = theme === "dark"
    ? "bg-[#1f1f1f] border-[#333] text-white hover:bg-[#262626]"
    : "bg-gray-100 border-gray-200 text-gray-900 hover:bg-gray-200";

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => openAdjust("add")}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${btnBase}`}
          title="Add stock (restock)"
        >
          <Plus className="h-3.5 w-3.5" />
          Stock
        </button>
        <button
          onClick={() => openAdjust("remove")}
          className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${btnBase}`}
          title="Remove stock (waste / count-down)"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setLogOpen(true)}
          className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${btnBase}`}
          title="Restock history"
        >
          <History className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Adjust modal */}
      <Dialog open={adjustOpen} onOpenChange={(o) => !o && setAdjustOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {direction === "add" ? "Add stock" : "Remove stock"} — {item.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="text-sm text-gray-600">
              Current on hand: <span className="font-bold text-gray-900">{item.stock_count}</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Quantity
              </label>
              <Input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 12"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setAdjustOpen(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-800 hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => adjust.mutate()}
              disabled={adjust.isPending || !qty}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#D4541A] hover:opacity-90 disabled:opacity-40"
            >
              {adjust.isPending ? "Saving…" : direction === "add" ? "Add to stock" : "Remove from stock"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History drawer */}
      {logOpen && <StockLogDrawer itemId={item.id} itemName={item.name} onClose={() => setLogOpen(false)} />}
    </>
  );
}

function StockLogDrawer({ itemId, itemName, onClose }: { itemId: string; itemName: string; onClose: () => void }) {
  const { data: entries = [], isLoading } = useQuery<LogEntry[]>({
    queryKey: ["stock-log", itemId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/${itemId}/stock?limit=100`);
      const body = await res.json() as { success: true; data: LogEntry[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    staleTime: 10 * 1000,
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] flex flex-col bg-white dark:bg-[#0e0e0e] border-l border-gray-200 dark:border-[#1f1f1f] shadow-2xl">
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#1f1f1f]">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white text-base">Stock history</h2>
            <p className="text-xs text-gray-500 dark:text-[#888] truncate">{itemName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-[#888] py-12 text-center">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-[#888] py-12 text-center">No history yet</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => {
                const pos = e.change > 0;
                return (
                  <li key={e.id} className="rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-100 dark:border-[#222] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold capitalize" style={{ color: pos ? "#10b981" : "#ef4444" }}>
                          {pos ? "+" : ""}{e.change} · {e.reason}
                        </p>
                        {e.note && (
                          <p className="text-xs text-gray-600 dark:text-[#bbb] mt-0.5 truncate">{e.note}</p>
                        )}
                        <p className="text-[11px] text-gray-400 dark:text-[#666] mt-1">
                          {new Date(e.created_at).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                          {e.actor?.name && <> · {e.actor.name}</>}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
