"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Table, Location } from "@/lib/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, Image } from "lucide-react";

const supabase = createClient();

type TableForm = {
  location_id: string;
  name: string;
  type: "snooker" | "pool" | "ps5" | "foosball";
  size: string;
  description: string;
  hourly_rate: string;
  sort_order: string;
  image_file: File | null;
};

const defaultForm: TableForm = {
  location_id: "",
  name: "",
  type: "snooker",
  size: "",
  description: "",
  hourly_rate: "",
  sort_order: "0",
  image_file: null,
};

export function TablesContent({
  initialLocations,
  initialTables,
}: {
  initialLocations: Location[];
  initialTables: Table[];
}) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const [form, setForm] = useState<TableForm>(defaultForm);
  const [deleteConfirm, setDeleteConfirm] = useState<Table | null>(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<Table | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>("all");

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("*")
        .eq("is_active", true);
      return data ?? [];
    },
    initialData: initialLocations,
  });

  const { data: tables, isLoading } = useQuery({
    queryKey: ["tables", selectedLocation],
    queryFn: async () => {
      let query = supabase
        .from("tables")
        .select("*")
        .order("sort_order");
      if (selectedLocation !== "all") {
        query = query.eq("location_id", selectedLocation);
      }
      const { data } = await query;
      return data ?? [];
    },
    initialData: selectedLocation === "all" ? initialTables : undefined,
  });

  async function uploadImage(file: File, tableId: string, locationId: string): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tableId", tableId);
    fd.append("locationId", locationId);
    const res = await fetch("/api/tables/upload", { method: "POST", body: fd });
    const body = await res.json() as { success: true; data: { url: string } } | { success: false; error: string };
    if (!body.success) throw new Error(body.error);
    return body.data.url;
  }

  const upsertMutation = useMutation({
    mutationFn: async (values: TableForm & { editId?: string }) => {
      const payload = {
        location_id: values.location_id,
        name: values.name,
        type: values.type,
        size: values.size || undefined,
        description: values.description || undefined,
        hourly_rate: parseFloat(values.hourly_rate),
        sort_order: parseInt(values.sort_order),
      };

      if (values.editId) {
        const res = await fetch(`/api/tables/${values.editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { success: true; data: { id: string; location_id: string } } | { success: false; error: string };
        if (!body.success) throw new Error(body.error);
        if (values.image_file) {
          const url = await uploadImage(values.image_file, body.data.id, body.data.location_id);
          await fetch(`/api/tables/${body.data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url }),
          });
        }
      } else {
        const res = await fetch("/api/tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { success: true; data: { id: string; location_id: string } } | { success: false; error: string };
        if (!body.success) throw new Error(body.error);
        if (values.image_file) {
          const url = await uploadImage(values.image_file, body.data.id, body.data.location_id);
          await fetch(`/api/tables/${body.data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url }),
          });
        }
      }
    },
    onMutate: async (values) => {
      if (!values.editId) return undefined;
      await qc.cancelQueries({ queryKey: ["tables"] });
      const prev = qc.getQueryData<Table[]>(["tables", selectedLocation]);
      qc.setQueryData<Table[]>(["tables", selectedLocation], (old) =>
        (old ?? []).map((t) =>
          t.id === values.editId
            ? {
                ...t,
                name:         values.name,
                type:         values.type,
                hourly_rate:  parseFloat(values.hourly_rate),
                sort_order:   parseInt(values.sort_order),
                size:         values.size || null,
                description:  values.description || null,
                location_id:  values.location_id,
              }
            : t
        )
      );
      setDialogOpen(false);
      setEditing(null);
      setForm(defaultForm);
      return { prev };
    },
    onSuccess: (_, values) => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      if (!values.editId) {
        setDialogOpen(false);
        setEditing(null);
        setForm(defaultForm);
      }
    },
    onError: (err, values, ctx) => {
      if (values.editId && ctx?.prev) {
        qc.setQueryData(["tables", selectedLocation], ctx.prev);
        alert((err as Error).message);
      }
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tables/${id}`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      setDeleteConfirm(null);
      await qc.cancelQueries({ queryKey: ["tables"] });
      const prev = qc.getQueryData<Table[]>(["tables", selectedLocation]);
      qc.setQueryData<Table[]>(["tables", selectedLocation], (old) =>
        (old ?? []).map((t) => t.id === id ? { ...t, is_active: false } : t)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tables", selectedLocation], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["tables"] });
      const prev = qc.getQueryData<Table[]>(["tables", selectedLocation]);
      qc.setQueryData<Table[]>(["tables", selectedLocation], (old) =>
        (old ?? []).map((t) => t.id === id ? { ...t, is_active: true } : t)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tables", selectedLocation], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tables/${id}?permanent=true`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      setPermanentDeleteConfirm(null);
      await qc.cancelQueries({ queryKey: ["tables"] });
      const prev = qc.getQueryData<Table[]>(["tables", selectedLocation]);
      qc.setQueryData<Table[]>(["tables", selectedLocation], (old) =>
        (old ?? []).filter((t) => t.id !== id)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tables", selectedLocation], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });

  function openAdd() {
    setEditing(null);
    setForm({ ...defaultForm, location_id: locations?.[0]?.id ?? "" });
    setDialogOpen(true);
  }

  function openEdit(t: Table) {
    setEditing(t);
    setForm({
      location_id: t.location_id,
      name: t.name,
      type: t.type,
      size: t.size ?? "",
      description: t.description ?? "",
      hourly_rate: String(t.hourly_rate),
      sort_order: String(t.sort_order),
      image_file: null,
    });
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    upsertMutation.mutate({ ...form, editId: editing?.id });
  }

  const typeIcon: Record<string, string> = {
    snooker: "🎱",
    pool: "🎱",
    ps5: "🎮",
    foosball: "⚽",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tables</h1>
        <div className="flex items-center gap-3">
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations?.map((loc: Location) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Table
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tables?.map((table) => {
          const loc = locations?.find((l: Location) => l.id === table.location_id);
          return (
            <div
              key={table.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="h-36 bg-gray-100 flex items-center justify-center">
                {table.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={table.image_url}
                    alt={table.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Image className="h-8 w-8 text-gray-300" />
                )}
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span>{typeIcon[table.type]}</span>
                    <h3 className="font-semibold text-gray-900">{table.name}</h3>
                  </div>
                  <Badge variant={table.is_active ? "success" : "secondary"}>
                    {table.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500">{loc?.name ?? "—"}</p>
                <p className="text-sm font-medium">
                  {formatCurrency(table.hourly_rate)}/hr
                </p>
                <div className="flex items-center gap-2 pt-1">
                  {!table.is_active && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reactivateMutation.mutate(table.id)}
                      >
                        Reactivate
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setPermanentDeleteConfirm(table)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openEdit(table)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {table.is_active && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setDeleteConfirm(table)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Table" : "Add Table"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations?.map((loc: Location) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tname">Name</Label>
                <Input
                  id="tname"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm({ ...form, type: v as TableForm["type"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="snooker">Snooker</SelectItem>
                    <SelectItem value="pool">Pool</SelectItem>
                    <SelectItem value="ps5">PS5</SelectItem>
                    <SelectItem value="foosball">Foosball</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rate">Rate (₹/hr)</Label>
                <Input
                  id="rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hourly_rate}
                  onChange={(e) =>
                    setForm({ ...form, hourly_rate: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sort">Sort Order</Label>
                <Input
                  id="sort"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm({ ...form, sort_order: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="size">Size (optional)</Label>
              <Input
                id="size"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                placeholder="e.g. 6ft, 7ft"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description (optional)</Label>
              <Input
                id="desc"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="img">Table Image</Label>
              <Input
                id="img"
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setForm({ ...form, image_file: e.target.files?.[0] ?? null })
                }
              />
            </div>
            {upsertMutation.error && (
              <p className="text-sm text-destructive">
                {(upsertMutation.error as Error).message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate Table?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{deleteConfirm?.name}</strong> will be marked inactive.
            Existing sessions and bookings are preserved.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirm && softDeleteMutation.mutate(deleteConfirm.id)
              }
              disabled={softDeleteMutation.isPending}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent delete confirmation */}
      <Dialog open={!!permanentDeleteConfirm} onOpenChange={() => setPermanentDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete Table?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{permanentDeleteConfirm?.name}</strong> will be permanently deleted and cannot be recovered. All associated data will be lost.
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
