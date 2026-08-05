"use client";

import { useState, useEffect, useMemo } from "react";
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

export interface StockLogDrawerProps {
  itemId?: string;
  itemName?: string;
  initialType?: string;
  onClose: () => void;
}

export function StockLogDrawer({ itemId = "all", itemName = "All Inventory Items", initialType = "all", onClose }: StockLogDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string>(itemId);
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>(initialType);

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
    queryKey: ["stock-logs-filtered", selectedItem, selectedLocation, selectedType],
    queryFn: async () => {
      let url = `/api/inventory/stock-logs?limit=200`;
      if (selectedItem && selectedItem !== "all") {
        url += `&inventory_item_id=${selectedItem}`;
      }
      if (selectedLocation && selectedLocation !== "all") {
        url += `&location_id=${selectedLocation}`;
      }
      if (selectedType && selectedType !== "all") {
        url += `&type=${selectedType}`;
      }
      const res = await fetch(url);
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    staleTime: 5 * 1000,
  });

  // Calculate summary metrics for loaded entries
  const metrics = useMemo(() => {
    let staffUnits = 0;
    let staffValue = 0;
    let restockUnits = 0;
    let salesUnits = 0;

    for (const e of entries) {
      const isStaff = e.reason === "adjustment" && (e.note?.toLowerCase().includes("staff") || e.note?.toLowerCase().includes("consumption") || e.note?.toLowerCase().includes("intake"));
      const isRestock = e.reason === "restock";
      const isSale = e.reason === "sale";
      const absQty = Math.abs(Number(e.change || 0));

      if (isStaff) {
        staffUnits += absQty;
        staffValue += absQty * Number(e.item?.selling_price || 0);
      } else if (isRestock) {
        restockUnits += absQty;
      } else if (isSale) {
        salesUnits += absQty;
      }
    }

    return { staffUnits, staffValue, restockUnits, salesUnits };
  }, [entries]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[600px] md:w-[720px] lg:w-[800px] flex flex-col bg-white dark:bg-[#0e0e0e] border-l border-gray-200 dark:border-[#1f1f1f] shadow-2xl">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#0e0e0e]">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white text-xl flex items-center gap-2">
              <History className="h-5 w-5 text-[#D4541A]" />
              Stock Audit Logs
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 font-medium">
              {selectedItem === "all" ? "All Inventory Items" : itemName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary Metric Cards */}
        <div className="shrink-0 px-6 py-4 bg-gray-50/80 dark:bg-[#121212] border-b border-gray-200 dark:border-[#1f1f1f] grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-300">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">☕ Staff Intake</div>
            <div className="text-lg font-extrabold mt-0.5">{metrics.staffUnits} units</div>
            <div className="text-xs font-medium text-amber-600 dark:text-amber-500">₹{metrics.staffValue.toLocaleString("en-IN")} value</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 dark:text-emerald-300">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">📦 Restocked</div>
            <div className="text-lg font-extrabold mt-0.5">+{metrics.restockUnits} units</div>
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-500">Added to inventory</div>
          </div>
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-300">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">🛒 Customer Sales</div>
            <div className="text-lg font-extrabold mt-0.5">{metrics.salesUnits} units</div>
            <div className="text-xs font-medium text-blue-600 dark:text-blue-500">Sold via orders</div>
          </div>
        </div>

        {/* Quick Type Filter Chips */}
        <div className="shrink-0 px-6 py-3 bg-white dark:bg-[#0e0e0e] border-b border-gray-150 dark:border-[#1f1f1f] flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedType("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedType === "all"
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-xs"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            📋 All Activity
          </button>
          <button
            onClick={() => setSelectedType("staff")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedType === "staff"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/40 hover:bg-amber-100"
            }`}
          >
            ☕ Staff Intake Only
          </button>
          <button
            onClick={() => setSelectedType("restock")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedType === "restock"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40 hover:bg-emerald-100"
            }`}
          >
            📦 Restocks
          </button>
          <button
            onClick={() => setSelectedType("customer")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedType === "customer"
                ? "bg-blue-600 text-white shadow-xs"
                : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/40 hover:bg-blue-100"
            }`}
          >
            🛒 Sales
          </button>
          <button
            onClick={() => setSelectedType("waste")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              selectedType === "waste"
                ? "bg-red-600 text-white shadow-xs"
                : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200/50 dark:border-red-800/40 hover:bg-red-100"
            }`}
          >
            🗑️ Adjustments / Waste
          </button>
        </div>

        {/* Filters Selectors */}
        <div className="shrink-0 px-6 py-3 bg-gray-50/50 dark:bg-[#121212]/50 border-b border-gray-200 dark:border-[#1f1f1f] grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Item Filter</label>
            <Select value={selectedItem} onValueChange={setSelectedItem}>
              <SelectTrigger className="h-9 text-xs font-semibold rounded-lg">
                <SelectValue placeholder="All Items" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">All Items</SelectItem>
                {allItems.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="text-xs font-semibold">{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Location</label>
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="h-9 text-xs font-semibold rounded-lg">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">All Locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id} className="text-xs font-semibold">{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">Loading stock logs...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No logs found matching filters</p>
          ) : (
            <ul className="space-y-3">
              {entries.map((e) => {
                const pos = e.change > 0;
                const isStaff = e.reason === "adjustment" && (e.note?.toLowerCase().includes("staff") || e.note?.toLowerCase().includes("consumption") || e.note?.toLowerCase().includes("intake"));
                const isRestock = e.reason === "restock";
                const isSale = e.reason === "sale";

                return (
                  <li key={e.id} className="rounded-2xl bg-white dark:bg-[#161616] border border-gray-150 dark:border-[#222] p-4 shadow-2xs hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            {isStaff ? (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                                ☕ Staff Intake
                              </span>
                            ) : isRestock ? (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                                📦 Restock
                              </span>
                            ) : isSale ? (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                                🛒 Sale
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-gray-500/15 text-gray-700 dark:text-gray-300 border border-gray-500/20">
                                🗑️ Adjustment
                              </span>
                            )}
                            <span className="font-bold text-gray-900 dark:text-white text-sm">
                              {e.item?.name ?? "Inventory Item"}
                            </span>
                          </div>
                          <span className="text-base font-extrabold tabular-nums" style={{ color: pos ? "#10b981" : isStaff ? "#d97706" : "#ef4444" }}>
                            {pos ? "+" : ""}{e.change} {Math.abs(e.change) === 1 ? "unit" : "units"}
                          </span>
                        </div>

                        {e.note && (
                          <p className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                            {e.note}
                          </p>
                        )}

                        <div className="flex justify-between items-center text-xs text-gray-400 dark:text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-800/80 mt-1">
                          <span>
                            {new Date(e.created_at).toLocaleString("en-IN", {
                              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
                            })}
                          </span>
                          {e.actor?.name && (
                            <span className="font-semibold text-gray-600 dark:text-gray-400">
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
