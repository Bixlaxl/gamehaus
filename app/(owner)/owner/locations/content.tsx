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
import type { Location } from "@/lib/supabase/types";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient();

function useLocations(initialLocations: Location[]) {
  return useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data;
    },
    initialData: initialLocations,
  });
}

type LocationForm = {
  name: string;
  address: string;
  phone: string;
  slug: string;
  opening_time: string;
  closing_time: string;
  timezone: string;
};

const defaultForm: LocationForm = {
  name: "",
  address: "",
  phone: "",
  slug: "",
  opening_time: "10:00",
  closing_time: "23:00",
  timezone: "Asia/Kolkata",
};

export function LocationsContent({ initialLocations }: { initialLocations: Location[] }) {
  const qc = useQueryClient();
  const { data: locations, isLoading } = useLocations(initialLocations);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<LocationForm>(defaultForm);
  const [deleteConfirm, setDeleteConfirm] = useState<Location | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const upsertMutation = useMutation({
    mutationFn: async (values: LocationForm & { editId?: string }) => {
      const res = values.editId
        ? await fetch(`/api/locations/${values.editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) })
        : await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
    },
    onMutate: async (values) => {
      if (!values.editId) return undefined;
      await qc.cancelQueries({ queryKey: ["locations"] });
      const prev = qc.getQueryData<Location[]>(["locations"]);
      qc.setQueryData<Location[]>(["locations"], (old) =>
        (old ?? []).map((l) =>
          l.id === values.editId
            ? {
                ...l,
                name:         values.name,
                address:      values.address,
                phone:        values.phone || null,
                opening_time: values.opening_time,
                closing_time: values.closing_time,
                timezone:     values.timezone,
              }
            : l
        )
      );
      setDialogOpen(false);
      setEditing(null);
      setForm(defaultForm);
      setFormError(null);
      return { prev };
    },
    onSuccess: (_, values) => {
      qc.invalidateQueries({ queryKey: ["locations"] });
      toast.success(values.editId ? "Location updated" : "Location created");
      if (!values.editId) {
        setDialogOpen(false);
        setEditing(null);
        setForm(defaultForm);
        setFormError(null);
      }
    },
    onError: (err, values, ctx) => {
      if (values.editId && ctx?.prev) {
        qc.setQueryData(["locations"], ctx.prev);
      }
      setFormError((err as Error).message);
      if (values.editId) setDialogOpen(true);
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
    },
    onMutate: async (id) => {
      setDeleteConfirm(null);
      await qc.cancelQueries({ queryKey: ["locations"] });
      const prev = qc.getQueryData<Location[]>(["locations"]);
      qc.setQueryData<Location[]>(["locations"], (old) =>
        (old ?? []).map((l) => l.id === id ? { ...l, is_active: false } : l)
      );
      return { prev };
    },
    onSuccess: () => toast.success("Location deactivated"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["locations"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/locations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: true }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["locations"] });
      const prev = qc.getQueryData<Location[]>(["locations"]);
      qc.setQueryData<Location[]>(["locations"], (old) =>
        (old ?? []).map((l) => l.id === id ? { ...l, is_active: true } : l)
      );
      return { prev };
    },
    onSuccess: () => toast.success("Location reactivated"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["locations"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });

  function openAdd() {
    setEditing(null);
    setForm(defaultForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(loc: Location) {
    setEditing(loc);
    setForm({
      name: loc.name,
      address: loc.address,
      phone: loc.phone ?? "",
      slug: loc.slug,
      opening_time: loc.opening_time,
      closing_time: loc.closing_time,
      timezone: loc.timezone,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    upsertMutation.mutate({ ...form, editId: editing?.id });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Locations</h1>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4" />
          Add Location
        </Button>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="grid gap-4">
        {locations?.map((loc) => (
          <div
            key={loc.id}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start justify-between"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-900">{loc.name}</h2>
                <Badge variant={loc.is_active ? "success" : "secondary"}>
                  {loc.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-sm text-gray-500">{loc.address}</p>
              {loc.phone && (
                <p className="text-sm text-gray-500">{loc.phone}</p>
              )}
              <p className="text-xs text-gray-400">
                /{loc.slug} · {loc.opening_time} – {loc.closing_time}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!loc.is_active && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reactivateMutation.mutate(loc.id)}
                >
                  Reactivate
                </Button>
              )}
              <Button variant="outline" size="icon" onClick={() => openEdit(loc)}>
                <Pencil className="h-4 w-4" />
              </Button>
              {loc.is_active && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDeleteConfirm(loc)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Location" : "Add Location"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">
                Slug{" "}
                <span className="text-gray-400 text-xs">(URL-safe, lowercase)</span>
              </Label>
              <Input
                id="slug"
                value={form.slug}
                onChange={(e) =>
                  setForm({
                    ...form,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                  })
                }
                required
                disabled={!!editing}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="opening">Opens</Label>
                <Input
                  id="opening"
                  type="time"
                  value={form.opening_time}
                  onChange={(e) =>
                    setForm({ ...form, opening_time: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="closing">Closes</Label>
                <Input
                  id="closing"
                  type="time"
                  value={form.closing_time}
                  onChange={(e) =>
                    setForm({ ...form, closing_time: e.target.value })
                  }
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="America/New_York">America/New_York (ET)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
              </select>
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
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

      {/* Soft delete confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate Location?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{deleteConfirm?.name}</strong> will be marked inactive. All
            associated tables and staff will remain in the system. This does not
            delete any data.
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
    </div>
  );
}
