"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import NextImage from "next/image";
import { Search, Image as ImageIcon } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { StockBadge, StockControls } from "@/components/inventory/stock-controls";
import type { InventoryItem } from "@/lib/supabase/types";

interface Props {
  locationId:   string;
  locationName: string;
  initialItems: InventoryItem[];
}

export function StaffInventoryContent({ locationId, locationName, initialItems }: Props) {
  const [search, setSearch] = useState("");

  const { data: items = initialItems } = useQuery<InventoryItem[]>({
    queryKey: ["inventory", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory?location_id=${locationId}`);
      const body = await res.json() as { success: true; data: InventoryItem[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: initialItems,
    initialDataUpdatedAt: Date.now(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
      : items;
    const buckets: Record<string, InventoryItem[]> = {};
    for (const i of list) (buckets[i.category] ??= []).push(i);
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  }, [items, search]);

  const lowOrOut = items.filter((i) => i.stock_count <= i.low_stock_threshold).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-[#111] border-b border-[#1f1f1f]">
        <div className="flex items-center gap-3">
          <h1 className="font-extrabold text-white text-sm tracking-tight">Inventory</h1>
          <span className="text-[#555] font-bold">·</span>
          <span className="text-xs font-medium text-[#888]">{locationName}</span>
        </div>
        <div className="flex items-center gap-3">
          {lowOrOut > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-amber-500/15 text-amber-500">
              {lowOrOut} low / out
            </span>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#666]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1a1a1a] border border-[#333] text-white placeholder-[#666] focus:border-[#D4541A] focus:outline-none w-48"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-6xl mx-auto space-y-8">
          {grouped.length === 0 && (
            <div className="text-center py-24 text-[#666]">
              <p className="font-semibold text-[#999]">No items found</p>
            </div>
          )}

          {grouped.map(([category, list]) => (
            <section key={category}>
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#888] mb-3">
                {category} <span className="text-[#555] font-mono ml-1">· {list.length}</span>
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl bg-[#111] border border-[#222] p-3 flex items-center gap-3"
                  >
                    <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-[#1a1a1a] flex items-center justify-center">
                      {item.image_url ? (
                        <NextImage src={item.image_url} alt={item.name} width={56} height={56} className="object-cover w-full h-full" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-[#444]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white text-sm truncate">{item.name}</p>
                      <p className="text-[11px] text-[#888] mt-0.5">
                        {formatCurrency(item.selling_price)}
                      </p>
                      <div className="mt-1.5"><StockBadge item={item} size="sm" /></div>
                    </div>
                    <div className="shrink-0">
                      <StockControls
                        item={item}
                        theme="dark"
                        invalidateKeys={[["inventory", locationId]]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
