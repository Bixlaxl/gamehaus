"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { InventoryItem } from "@/lib/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import NextImage from "next/image";
import { Plus, Pencil, Trash2, Package, Image as ImageIcon } from "lucide-react";
import { StockBadge, StockControls } from "@/components/inventory/stock-controls";

type LocationLite = { id: string; name: string };

type ItemForm = {
  location_id: string;
  name: string;
  category: string;
  selling_price: string;
  cost_price: string;
  sort_order: string;
  show_at_checkout: boolean;
  image_file: File | null;
};

const defaultForm: ItemForm = {
  location_id: "",
  name: "",
  category: "Beverages",
  selling_price: "",
  cost_price: "",
  sort_order: "0",
  show_at_checkout: false,
  image_file: null,
};

const CATEGORIES = ["Beverages", "Snacks", "Accessories", "Other"];

export function InventoryContent({
  initialLocations,
  initialItems,
}: {
  initialLocations: LocationLite[];
  initialItems: InventoryItem[];
}) {
  const qc = useQueryClient();
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editing,         setEditing]         = useState<InventoryItem | null>(null);
  const [form,            setForm]            = useState<ItemForm>(defaultForm);
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [searchQuery,     setSearchQuery]     = useState("");
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<InventoryItem | null>(null);

  const { data: items } = useQuery<InventoryItem[]>({
    queryKey: ["inventory", selectedLocation],
    queryFn: async () => {
      const url = selectedLocation === "all"
        ? "/api/inventory"
        : `/api/inventory?location_id=${selectedLocation}`;
      const res = await fetch(url);
      const body = await res.json() as { success: true; data: InventoryItem[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: selectedLocation === "all" ? initialItems : undefined,
    initialDataUpdatedAt: Date.now(),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const displayed = useMemo(() => {
    const list = items ?? [];
    const q = searchQuery.toLowerCase().trim();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)) : list;
  }, [items, searchQuery]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const item of displayed) {
      const cat = item.category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }, [displayed]);

  async function uploadImage(file: File, itemId: string, locationId: string): Promise<string> {
    // Compress + convert to WebP client-side before the upload. Inventory cards
    // render small (~80px thumbs) so we don't need a huge source — 800px is
    // plenty even on retina, keeps the upload payload <60 KB.
    const compressed = await compressImage(file, { maxWidth: 800, quality: 0.85, format: "webp" });
    const fd = new FormData();
    fd.append("file", compressed);
    fd.append("itemId", itemId);
    fd.append("locationId", locationId);
    const res = await fetch("/api/inventory/upload", { method: "POST", body: fd });
    const body = await res.json() as { success: true; data: { url: string } } | { success: false; error: string };
    if (!body.success) throw new Error(body.error);
    return body.data.url;
  }

  const upsertMutation = useMutation({
    mutationFn: async (values: ItemForm & { editId?: string }) => {
      const payload = {
        location_id:      values.location_id,
        name:             values.name,
        category:         values.category,
        selling_price:    parseFloat(values.selling_price),
        cost_price:       parseFloat(values.cost_price) || 0,
        sort_order:       parseInt(values.sort_order) || 0,
        show_at_checkout: values.show_at_checkout,
      };

      if (values.editId) {
        const res = await fetch(`/api/inventory/${values.editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { success: true; data: InventoryItem } | { success: false; error: string };
        if (!body.success) throw new Error(body.error);
        if (values.image_file) {
          const url = await uploadImage(values.image_file, body.data.id, body.data.location_id);
          await fetch(`/api/inventory/${body.data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url }),
          });
        }
      } else {
        const res = await fetch("/api/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { success: true; data: InventoryItem } | { success: false; error: string };
        if (!body.success) throw new Error(body.error);
        if (values.image_file) {
          const url = await uploadImage(values.image_file, body.data.id, body.data.location_id);
          await fetch(`/api/inventory/${body.data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url }),
          });
        }
      }
    },
    onMutate: async (values) => {
      if (!values.editId) return undefined;
      await qc.cancelQueries({ queryKey: ["inventory"] });
      const prev = qc.getQueryData<InventoryItem[]>(["inventory", selectedLocation]);
      qc.setQueryData<InventoryItem[]>(["inventory", selectedLocation], (old) =>
        (old ?? []).map((i) =>
          i.id === values.editId
            ? {
                ...i,
                name:          values.name,
                category:      values.category,
                selling_price: parseFloat(values.selling_price),
                cost_price:    parseFloat(values.cost_price) || 0,
                sort_order:    parseInt(values.sort_order) || 0,
                location_id:   values.location_id,
              }
            : i
        )
      );
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
      setDialogOpen(false);
      setEditing(null);
      setForm(defaultForm);
    },
    onError: (e, values, ctx) => {
      if (values.editId && ctx?.prev) {
        qc.setQueryData(["inventory", selectedLocation], ctx.prev);
      }
      alert((e as Error).message);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async ({ id, is_active }) => {
      await qc.cancelQueries({ queryKey: ["inventory"] });
      const prev = qc.getQueryData<InventoryItem[]>(["inventory", selectedLocation]);
      qc.setQueryData<InventoryItem[]>(["inventory", selectedLocation], (old) =>
        (old ?? []).map((i) => i.id === id ? { ...i, is_active } : i)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["inventory", selectedLocation], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
    },
  });

  // Permanent delete — only offered once item is already deactivated.
  // API will block this with a friendly FK error if the item has been sold.
  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/inventory/${id}?permanent=true`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      setPermanentDeleteConfirm(null);
      await qc.cancelQueries({ queryKey: ["inventory"] });
      const prev = qc.getQueryData<InventoryItem[]>(["inventory", selectedLocation]);
      qc.setQueryData<InventoryItem[]>(["inventory", selectedLocation], (old) =>
        (old ?? []).filter((i) => i.id !== id)
      );
      return { prev };
    },
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["inventory", selectedLocation], ctx.prev);
      alert((err as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
    },
  });

  function openAdd() {
    setEditing(null);
    setForm({ ...defaultForm, location_id: initialLocations[0]?.id ?? "" });
    setDialogOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setForm({
      location_id:      item.location_id,
      name:             item.name,
      category:         item.category,
      selling_price:    String(item.selling_price),
      cost_price:       String(item.cost_price),
      sort_order:       String(item.sort_order),
      show_at_checkout: Boolean(item.show_at_checkout),
      image_file:       null,
    });
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.selling_price) return;
    upsertMutation.mutate({ ...form, editId: editing?.id });
  }

  const margin = (item: InventoryItem) => {
    if (item.selling_price === 0) return 0;
    return Math.round(((item.selling_price - item.cost_price) / item.selling_price) * 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Inventory</h1>
        <div className="flex items-center gap-3">
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {initialLocations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      <div className="relative max-w-xs">
        <input
          placeholder="Search items…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-4 pr-4 py-2 text-sm rounded-xl border border-gray-200 bg-white outline-none focus:border-[#D4541A]"
        />
      </div>

      {grouped.size === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Package className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No inventory items yet</p>
        </div>
      )}

      {[...grouped.entries()].map(([category, catItems]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">{category}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {catItems.map((item) => {
              const loc = initialLocations.find((l) => l.id === item.location_id);
              const m   = margin(item);
              // Low-stock items get tinted so the owner spots them at a glance,
              // not just from the badge. Out-of-stock = red, low = amber.
              const isOut = item.stock_count <= 0;
              const isLow = !isOut && item.stock_count <= item.low_stock_threshold;
              const cardStyle = isOut
                ? { background: "rgba(239,68,68,0.04)", borderColor: "rgba(239,68,68,0.35)" }
                : isLow
                ? { background: "rgba(245,158,11,0.04)", borderColor: "rgba(245,158,11,0.40)" }
                : {};
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border-2 shadow-sm overflow-hidden bg-white border-gray-100"
                  style={cardStyle}
                >
                  <div className="relative h-32 bg-gray-100 flex items-center justify-center">
                    {item.image_url ? (
                      <NextImage
                        src={item.image_url}
                        alt={item.name}
                        fill
                        className="object-contain p-2"
                        sizes="(max-width: 768px) 50vw, 25vw"
                      />
                    ) : (
                      <ImageIcon className="h-7 w-7 text-gray-300" />
                    )}
                  </div>
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-semibold text-gray-900 text-sm truncate">{item.name}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.show_at_checkout && (
                          <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-200 bg-purple-50">
                            Online Checkout
                          </Badge>
                        )}
                        <Badge variant={item.is_active ? "success" : "secondary"}>
                          {item.is_active ? "Active" : "Off"}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">{loc?.name ?? "—"}</p>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(item.selling_price)}</p>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={
                          m >= 50
                            ? { background: "rgba(16,185,129,0.1)", color: "#10b981" }
                            : m >= 20
                            ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                            : { background: "rgba(239,68,68,0.1)", color: "#ef4444" }
                        }
                      >
                        {m}% margin
                      </span>
                    </div>
                    {item.cost_price > 0 && (
                      <p className="text-xs text-gray-400">Cost: {formatCurrency(item.cost_price)}</p>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <StockBadge item={item} size="sm" />
                      <StockControls item={item} invalidateKeys={[["inventory", selectedLocation]]} />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => toggleMutation.mutate({ id: item.id, is_active: !item.is_active })}
                      >
                        {item.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      {!item.is_active && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setPermanentDeleteConfirm(item)}
                          title="Permanently delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {initialLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Coke 500ml"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Selling Price (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.selling_price}
                  onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                  placeholder="e.g. 60"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Cost Price (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                  placeholder="e.g. 30"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 pb-1">
              <input
                type="checkbox"
                id="show_at_checkout"
                checked={form.show_at_checkout}
                onChange={(e) => setForm({ ...form, show_at_checkout: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-[#D4541A] focus:ring-[#D4541A]"
              />
              <Label htmlFor="show_at_checkout" className="cursor-pointer text-sm font-semibold text-gray-900">
                Offer as Add-on at Online Checkout
              </Label>
            </div>

            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Image</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setForm({ ...form, image_file: e.target.files?.[0] ?? null })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? "Saving…" : editing ? "Save Changes" : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Permanent delete confirmation */}
      <Dialog open={!!permanentDeleteConfirm} onOpenChange={() => setPermanentDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete Item?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{permanentDeleteConfirm?.name}</strong> will be permanently deleted and cannot be recovered.
            If it has ever been sold, deletion will be blocked — deactivate is the safe choice for that case.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermanentDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => permanentDeleteConfirm && permanentDeleteMutation.mutate(permanentDeleteConfirm.id)}
              disabled={permanentDeleteMutation.isPending}
            >
              {permanentDeleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
