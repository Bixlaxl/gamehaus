"use client";

import { useQuery } from "@tanstack/react-query";

interface Props {
  /** Pass a locationId to scope to one location (POS staff). Omit for owner-wide. */
  locationId?: string;
  /** Visual variant — sidebar pill on dark vs lighter inline. */
  variant?: "dark" | "light";
}

type Counts = { count: number; out_of_stock: number };

/**
 * Small count pill that lights up next to a nav link when there are items at
 * or below their low-stock threshold. Refreshes every 60s; also revalidates
 * on window focus so the count updates after stock changes elsewhere.
 */
export function LowStockNavBadge({ locationId, variant = "dark" }: Props) {
  const { data } = useQuery<Counts>({
    queryKey: ["inventory-low-count", locationId ?? "all"],
    queryFn: async () => {
      const url = locationId
        ? `/api/inventory/low-stock-count?location_id=${locationId}`
        : "/api/inventory/low-stock-count";
      const res  = await fetch(url, { cache: "no-store" });
      const body = await res.json() as { success: true; data: Counts } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  if (!data || data.count === 0) return null;

  // Red if anything is fully out; amber if just below threshold.
  const bg = data.out_of_stock > 0 ? "#ef4444" : "#f59e0b";
  const fg = "#fff";
  const sizeCls = variant === "dark"
    ? "ml-auto text-[10px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-full"
    : "ml-auto text-[10px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-full";

  return (
    <span
      className={sizeCls}
      style={{ background: bg, color: fg }}
      title={`${data.count} item${data.count === 1 ? "" : "s"} at or below threshold${
        data.out_of_stock > 0 ? ` · ${data.out_of_stock} out of stock` : ""
      }`}
    >
      {data.count}
    </span>
  );
}
