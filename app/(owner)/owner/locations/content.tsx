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
    queryKey: ["locations", "all"],
    queryFn: async () => {
      // Admin-backed API — bypasses RLS so the owner sees every location,
      // not only those a browser-side query happens to be allowed to read.
      const res = await fetch("/api/locations", { cache: "no-store" });
      const body = await res.json() as
        | { success: true;  data: Location[] }
        | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: initialLocations,
    initialDataUpdatedAt: Date.now(),
    staleTime: 5 * 60 * 1000,
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
  image_urls: string[];
};

const defaultForm: LocationForm = {
  name: "",
  address: "",
  phone: "",
  slug: "",
  opening_time: "10:00",
  closing_time: "23:00",
  timezone: "Asia/Kolkata",
  image_urls: [],
};

async function uploadFiles(locationId: string, files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("locationId", locationId);
    const res = await fetch("/api/locations/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const errJson = await res.json();
      throw new Error(errJson.error || "Failed to upload image");
    }
    const json = await res.json();
    urls.push(json.data.url);
  }
  return urls;
}

export function LocationsContent({ initialLocations }: { initialLocations: Location[] }) {
  const qc = useQueryClient();
  const { data: locations, isLoading } = useLocations(initialLocations);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<LocationForm>(defaultForm);
  const [newFiles, setNewFiles] = useState<{ id: string; file: File; preview: string }[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<Location | null>(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<Location | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      newFiles.forEach((f) => URL.revokeObjectURL(f.preview));
      setNewFiles([]);
      setEditing(null);
      setForm(defaultForm);
      setFormError(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files).map(file => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file)
      }));
      setNewFiles(prev => [...prev, ...filesArray]);
    }
  };

  const removeNewFile = (id: string, preview: string) => {
    setNewFiles(prev => prev.filter(f => f.id !== id));
    URL.revokeObjectURL(preview);
  };

  const upsertMutation = useMutation({
    mutationFn: async (values: LocationForm & { editId?: string; filesToUpload: File[] }) => {
      const { editId, filesToUpload, ...formValues } = values;
      let finalUrls = [...formValues.image_urls];

      if (editId) {
        if (filesToUpload.length > 0) {
          const uploadedUrls = await uploadFiles(editId, filesToUpload);
          finalUrls = [...finalUrls, ...uploadedUrls];
        }

        const payload = {
          name: formValues.name,
          address: formValues.address,
          phone: formValues.phone || null,
          opening_time: formValues.opening_time,
          closing_time: formValues.closing_time,
          timezone: formValues.timezone,
          image_urls: finalUrls,
        };

        const res = await fetch(`/api/locations/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
      } else {
        const payload = {
          name: formValues.name,
          address: formValues.address,
          phone: formValues.phone || null,
          slug: formValues.slug,
          opening_time: formValues.opening_time,
          closing_time: formValues.closing_time,
          timezone: formValues.timezone,
          image_urls: [],
        };

        const res = await fetch("/api/locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        const newId = json.data.id;

        if (filesToUpload.length > 0) {
          const uploadedUrls = await uploadFiles(newId, filesToUpload);
          const patchRes = await fetch(`/api/locations/${newId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_urls: uploadedUrls }),
          });
          const patchJson = await patchRes.json();
          if (!patchJson.success) throw new Error(patchJson.error);
        }
      }
    },
    onMutate: async (values) => {
      if (!values.editId) return undefined;
      await qc.cancelQueries({ queryKey: ["locations", "all"] });
      const prev = qc.getQueryData<Location[]>(["locations", "all"]);
      qc.setQueryData<Location[]>(["locations", "all"], (old) =>
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
      return { prev };
    },
    onSuccess: (_, values) => {
      qc.invalidateQueries({ queryKey: ["locations"] });
      qc.invalidateQueries({ queryKey: ["pos-location"] });
      qc.invalidateQueries({ queryKey: ["location-info-detail"] });
      toast.success(values.editId ? "Location updated" : "Location created");
      newFiles.forEach((f) => URL.revokeObjectURL(f.preview));
      setNewFiles([]);
      setDialogOpen(false);
      setEditing(null);
      setForm(defaultForm);
      setFormError(null);
    },
    onError: (err, values, ctx) => {
      if (values.editId && ctx?.prev) {
        qc.setQueryData(["locations"], ctx.prev);
      }
      setFormError((err as Error).message);
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
      await qc.cancelQueries({ queryKey: ["locations", "all"] });
      const prev = qc.getQueryData<Location[]>(["locations", "all"]);
      qc.setQueryData<Location[]>(["locations", "all"], (old) =>
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
      await qc.cancelQueries({ queryKey: ["locations", "all"] });
      const prev = qc.getQueryData<Location[]>(["locations", "all"]);
      qc.setQueryData<Location[]>(["locations", "all"], (old) =>
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

  // Permanent delete — only offered once the location is already deactivated.
  // API will block with a friendly FK error if any tables/staff/orders still
  // reference it (which is almost always the case).
  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/locations/${id}?permanent=true`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
    },
    onMutate: async (id) => {
      setPermanentDeleteConfirm(null);
      await qc.cancelQueries({ queryKey: ["locations", "all"] });
      const prev = qc.getQueryData<Location[]>(["locations", "all"]);
      qc.setQueryData<Location[]>(["locations", "all"], (old) =>
        (old ?? []).filter((l) => l.id !== id)
      );
      return { prev };
    },
    onSuccess: () => toast.success("Location permanently deleted"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["locations"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });

  function openAdd() {
    setEditing(null);
    setForm(defaultForm);
    newFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setNewFiles([]);
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
      image_urls: loc.image_urls || [],
    });
    newFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setNewFiles([]);
    setFormError(null);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    upsertMutation.mutate({ ...form, editId: editing?.id, filesToUpload: newFiles.map(f => f.file) });
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
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start justify-between gap-4"
          >
            <div className="flex items-start gap-4">
              {loc.image_urls && loc.image_urls.length > 0 ? (
                <img
                  src={loc.image_urls[0]}
                  alt={loc.name}
                  className="w-16 h-16 rounded-xl object-cover border border-gray-100 shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-50 border border-gray-100 shrink-0 flex items-center justify-center text-gray-400 text-xs">
                  No Image
                </div>
              )}
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
              {loc.is_active ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDeleteConfirm(loc)}
                  title="Deactivate"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setPermanentDeleteConfirm(loc)}
                  title="Permanently delete"
                >
                  Delete permanently
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
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
              <Label>Location Images</Label>
              <div className="grid grid-cols-4 gap-2 border border-dashed border-gray-200 rounded-lg p-3">
                {form.image_urls.map((url, idx) => (
                  <div key={`existing-${idx}`} className="relative aspect-square group rounded-md overflow-hidden border border-gray-100">
                    <img src={url} alt="Existing" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => {
                        setForm(prev => ({
                          ...prev,
                          image_urls: prev.image_urls.filter((_, i) => i !== idx)
                        }));
                      }}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                    >
                      <Trash2 className="h-4 w-4 text-white" />
                    </button>
                  </div>
                ))}
                {newFiles.map((f) => (
                  <div key={f.id} className="relative aspect-square group rounded-md overflow-hidden border border-gray-100">
                    <img src={f.preview} alt="New preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeNewFile(f.id, f.preview)}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                    >
                      <Trash2 className="h-4 w-4 text-white" />
                    </button>
                  </div>
                ))}
                <label className="relative aspect-square flex flex-col items-center justify-center border border-dashed border-gray-300 rounded-md cursor-pointer hover:bg-gray-50 transition-colors">
                  <Plus className="h-6 w-6 text-gray-400" />
                  <span className="text-[10px] text-gray-400 mt-1 font-medium">Add Image</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
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

      {/* Permanent delete confirmation */}
      <Dialog
        open={!!permanentDeleteConfirm}
        onOpenChange={() => setPermanentDeleteConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete Location?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{permanentDeleteConfirm?.name}</strong> will be permanently deleted and cannot be recovered.
            If it still has tables, staff, or past orders, deletion will be blocked — you&apos;ll need to clear those first.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermanentDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                permanentDeleteConfirm && permanentDeleteMutation.mutate(permanentDeleteConfirm.id)
              }
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
