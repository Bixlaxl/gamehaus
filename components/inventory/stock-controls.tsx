"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  const [mounted, setMounted] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string>(itemId);
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedStaff, setSelectedStaff] = useState<string>("all");

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["locations-lite"],
    queryFn: async () => {
      const res = await fetch("/api/locations");
      const body = await res.json();
      return body.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["staff-lite"],
    queryFn: async () => {
      const res = await fetch("/api/staff");
      const body = await res.json();
      return body.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: allItems = [] } = useQuery<any[]>({
    queryKey: ["inventory-items-lite"],
    queryFn: async () => {
      const res = await fetch("/api/inventory");
      const body = await res.json();
      return body.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: entries = [], isLoading } = useQuery<any[]>({
    queryKey: ["stock-logs-filtered", selectedItem, selectedLocation, selectedStaff],
    queryFn: async () => {
      let url = `/api/inventory/stock-logs?limit=100`;
      if (selectedItem && selectedItem !== "all") {
        url += `&inventory_item_id=${selectedItem}`;
      }
      if (selectedLocation && selectedLocation !== "all") {
        url += `&location_id=${selectedLocation}`;
      }
      if (selectedStaff && selectedStaff !== "all") {
        url += `&created_by=${selectedStaff}`;
      }
      const res = await fetch(url);
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    staleTime: 5 * 1000,
  });

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[500px] md:w-[600px] flex flex-col bg-white dark:bg-[#0e0e0e] border-l border-gray-200 dark:border-[#1f1f1f] shadow-2xl">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-[#1f1f1f]">
          <div className="min-w-0">
            <h2 className="font-black text-gray-900 dark:text-white text-xl">Stock History Logs</h2>
            <p className="text-sm text-gray-500 dark:text-[#888] truncate mt-0.5">{itemName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="shrink-0 px-6 py-5 bg-gray-50/50 dark:bg-[#121212]/50 border-b border-gray-200 dark:border-[#1f1f1f] space-y-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Filter Logs</h3>
          
          <div className="grid grid-cols-1 gap-3">
            {/* Item selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500">Item</label>
              <Select value={selectedItem} onValueChange={setSelectedItem}>
                <SelectTrigger className="h-10 text-sm font-semibold rounded-xl border dark:border-[#222]">
                  <SelectValue placeholder="All Items" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                  <SelectItem value="all">All Items</SelectItem>
                  {allItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Location selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500">Location</label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="h-10 text-sm font-semibold rounded-xl border dark:border-[#222]">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Staff selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500">Staff / Customer</label>
              <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                <SelectTrigger className="h-10 text-sm font-semibold rounded-xl border dark:border-[#222]">
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                  <SelectItem value="all">All Users</SelectItem>
                  {staffList.map((st) => (
                    <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-[#888] py-12 text-center">Loading stock logs...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-[#888] py-12 text-center">No logs found matching filters</p>
          ) : (
            <ul className="space-y-3.5">
              {entries.map((e) => {
                const pos = e.change > 0;
                return (
                  <li key={e.id} className="rounded-2xl bg-gray-50 dark:bg-[#161616] border border-gray-100 dark:border-[#222] p-4 shadow-sm hover:scale-[1.01] transition-transform">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-baseline justify-between flex-wrap gap-2">
                          <p className="text-base font-black capitalize tabular-nums" style={{ color: pos ? "#10b981" : "#ef4444" }}>
                            {pos ? "+" : ""}{e.change} · {e.reason === 'adjustment' && e.note?.includes('Staff consumption') ? 'staff drink' : e.reason}
                          </p>
                          <span className="text-[11px] font-bold text-gray-400 dark:text-[#555] uppercase bg-gray-200/50 dark:bg-gray-800/50 px-2 py-0.5 rounded-md">
                            {e.item?.name ?? "Inventory Item"}
                          </span>
                        </div>
                        {e.note && (
                          <p className="text-sm font-semibold text-gray-700 dark:text-[#ddd] mt-1">{e.note}</p>
                        )}
                        <div className="flex justify-between items-center text-xs text-gray-400 dark:text-[#666] pt-1.5 border-t border-gray-100/50 dark:border-gray-800/50 mt-1">
                          <span>
                            {new Date(e.created_at).toLocaleString("en-IN", {
                              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                          {e.actor?.name && (
                            <span className="font-extrabold text-gray-550 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 px-2 py-0.5 rounded">
                              👤 {e.actor.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
