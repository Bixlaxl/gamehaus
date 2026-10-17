"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, X, Plus } from "lucide-react";
import type { InventoryItem } from "@/lib/supabase/types";
import { StockControls } from "./stock-controls";

type LowItem = Pick<InventoryItem, "id" | "name" | "stock_count" | "low_stock_threshold" | "location_id" | "image_url" | "selling_price" | "is_active" | "category" | "cost_price" | "sort_order" | "created_at"> & {
  location?: { name: string } | { name: string }[] | null;
};

interface Props {
  /** Pass to scope to one location (POS staff). Omit for owner-wide. */
  locationId?: string;
  /** "dark" matches the POS / owner sidebar; "light" for white backgrounds. */
  variant?: "dark" | "light";
  /** Where to send "View all" link. */
  inventoryHref?: string;
  /** Dropdown alignment: 'right' for topbars / mobile headers, 'sidebar' to fly out to the right */
  align?: "right" | "sidebar";
}

export function StockAlertsBell({
  locationId, variant = "dark", inventoryHref = "/owner/inventory", align = "right",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const scope = locationId ?? "all";

  const { data: items = [] } = useQuery<LowItem[]>({
    queryKey: ["inventory-low-list", scope],
    queryFn: async () => {
      const url = locationId
        ? `/api/inventory/low-stock-list?location_id=${locationId}`
        : "/api/inventory/low-stock-list";
      const res  = await fetch(url, { cache: "no-store" });
      const body = await res.json() as { success: true; data: LowItem[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Close dropdown on outside click, ignoring clicks inside portals (dialogs, toasts, select dropdowns)
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest("[data-radix-portal]") ||
        target.closest("[data-sonner-toaster]") ||
        target.closest('[role="dialog"]')
      ) {
        return;
      }
      if (wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const count = items.length;
  const outCount = items.filter((i) => i.stock_count <= 0).length;
  const bg = outCount > 0 ? "#ef4444" : "#f59e0b";

  const buttonBase = variant === "dark"
    ? "hover:bg-[#1f1f1f] text-[#bbb] hover:text-white"
    : "hover:bg-gray-100 text-gray-600 hover:text-gray-900";

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${buttonBase}`}
        title={count > 0 ? `${count} low-stock item${count === 1 ? "" : "s"}` : "Stock alerts"}
        aria-label="Stock alerts"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold tabular-nums flex items-center justify-center text-white"
            style={{ background: bg, boxShadow: "0 0 0 2px var(--bell-ring,#161616)" }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute z-40 mt-2 w-[300px] sm:w-[340px] max-w-[calc(100vw-32px)] rounded-xl shadow-2xl overflow-hidden"
          style={{
            left:  align === "sidebar" ? "calc(100% + 6px)" : "auto",
            right: align === "sidebar" ? "auto" : 0,
            top:   align === "sidebar" ? 0 : "100%",
            background: variant === "dark" ? "#161616" : "#fff",
            border:     variant === "dark" ? "1px solid #2a2a2a" : "1px solid rgba(0,0,0,0.08)",
          }}
        >
          <div className={`flex items-center justify-between px-3 py-2.5 border-b ${variant === "dark" ? "border-[#2a2a2a]" : "border-gray-100"}`}>
            <div className="flex items-center gap-2">
              <Bell className={`h-3.5 w-3.5 ${variant === "dark" ? "text-[#bbb]" : "text-gray-500"}`} />
              <span className={`text-xs font-bold uppercase tracking-wide ${variant === "dark" ? "text-white" : "text-gray-900"}`}>
                Stock alerts {count > 0 && <span className="opacity-60 font-mono">· {count}</span>}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className={variant === "dark" ? "text-[#888] hover:text-white" : "text-gray-400 hover:text-gray-900"}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {count === 0 ? (
            <div className={`p-6 text-center text-xs ${variant === "dark" ? "text-[#888]" : "text-gray-500"}`}>
              All items are above threshold.
            </div>
          ) : (
            <ul className={`max-h-[60vh] overflow-y-auto divide-y ${variant === "dark" ? "divide-[#222]" : "divide-gray-100"}`}>
              {items.map((it) => {
                const isOut = it.stock_count <= 0;
                const locName = Array.isArray(it.location) ? it.location[0]?.name : it.location?.name;
                return (
                  <li key={it.id} className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold truncate ${variant === "dark" ? "text-white" : "text-gray-900"}`}>
                        {it.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className="text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{
                            background: isOut ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                            color:      isOut ? "#ef4444" : "#f59e0b",
                          }}
                        >
                          {isOut ? "OUT" : `${it.stock_count} / ${it.low_stock_threshold}`}
                        </span>
                        {locName && !locationId && (
                          <span className={`text-[10px] truncate ${variant === "dark" ? "text-[#888]" : "text-gray-500"}`}>
                            {locName}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Quick restock — reuses the existing stock-adjust controls */}
                    <StockControls
                      item={it as unknown as InventoryItem}
                      theme={variant}
                      invalidateKeys={[
                        ["inventory-low-list", scope],
                        ["inventory-low-count", scope],
                        ["inventory"],
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            href={inventoryHref}
            onClick={() => setOpen(false)}
            className={`block text-center px-3 py-2.5 text-xs font-bold uppercase tracking-wide border-t ${
              variant === "dark"
                ? "border-[#2a2a2a] text-[#D4541A] hover:bg-[#1f1f1f]"
                : "border-gray-100 text-[#D4541A] hover:bg-gray-50"
            }`}
          >
            <Plus className="inline h-3 w-3 mr-1" />
            View inventory
          </Link>
        </div>
      )}
    </div>
  );
}
