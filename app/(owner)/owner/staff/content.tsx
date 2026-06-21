"use client";

import { useState } from "react";
import Link from "next/link";
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
import type { User, Location } from "@/lib/supabase/types";
import { Plus, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient();

type StaffRow = User & { locations: { name: string } | null };

export function StaffContent({
  initialLocations,
  initialStaff,
}: {
  initialLocations: Location[];
  initialStaff: StaffRow[];
}) {
  const qc = useQueryClient();

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen]   = useState(false);
  const [createForm, setCreateForm]   = useState({ name: "", email: "", password: "", location_id: "" });
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit dialog
  const [editTarget, setEditTarget]   = useState<StaffRow | null>(null);
  const [editForm, setEditForm]       = useState({ name: "", email: "", password: "", location_id: "" });
  const [editError, setEditError]     = useState<string | null>(null);

  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const { data: locations } = useQuery({
    queryKey: ["locations", "active"],
    queryFn: async () => {
      // Admin-backed — see /api/locations comment. Browser-side reads here
      // hit RLS and silently drop rows.
      const res  = await fetch("/api/locations", { cache: "no-store" });
      const body = await res.json() as { success: true; data: Location[] } | { success: false; error: string };
      if (!body.success) return [];
      return body.data.filter((l) => l.is_active);
    },
    initialData: initialLocations,
    initialDataUpdatedAt: Date.now(),
    staleTime: 0,
  });

  const { data: staff, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("*, locations(name)")
        .eq("role", "staff")
        .order("created_at", { ascending: false });
      return (data ?? []) as StaffRow[];
    },
    initialData: initialStaff,
    initialDataUpdatedAt: Date.now(),
    staleTime: 0,
  });

  // ── Create ──────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (values: typeof createForm) => {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await res.json()) as { success: true } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setCreateOpen(false);
      setCreateForm({ name: "", email: "", password: "", location_id: "" });
      setCreateError(null);
      toast.success("Staff member created");
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  // ── Edit ─────────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async ({ id, name, email, password, location_id }: { id: string; name: string; email: string; password?: string; location_id: string }) => {
      const payload: any = {
        name,
        email,
        location_id: location_id || null,
      };
      if (password) {
        payload.password = password;
      }
      const res = await fetch(`/api/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error ?? "Failed to update staff member");
    },
    onMutate: async ({ id, name, email, password, location_id }) => {
      await qc.cancelQueries({ queryKey: ["staff"] });
      const prev = qc.getQueryData<StaffRow[]>(["staff"]);
      const loc  = locations?.find((l) => l.id === location_id);
      qc.setQueryData<StaffRow[]>(["staff"], (old) =>
        (old ?? []).map((s) =>
          s.id === id
            ? {
                ...s,
                name,
                email,
                location_id: location_id || null,
                locations: loc ? { name: loc.name } : null,
                login_password: password || s.login_password
              }
            : s
        )
      );
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Staff member updated");
      setEditTarget(null);
      setEditError(null);
    },
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["staff"], ctx.prev);
      setEditError((err as Error).message);
    },
  });

  // ── Toggle active ────────────────────────────────────────────────────────
  // Goes through the API (admin client) — browser-client writes were RLS-blocked
  // for the anon role and silently failed.
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: active }),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error ?? "Failed to update");
    },
    onMutate: async ({ id, active }) => {
      await qc.cancelQueries({ queryKey: ["staff"] });
      const prev = qc.getQueryData<StaffRow[]>(["staff"]);
      qc.setQueryData<StaffRow[]>(["staff"], (old) =>
        (old ?? []).map((s) => s.id === id ? { ...s, is_active: active } : s)
      );
      return { prev };
    },
    onSuccess: (_, { active }) => toast.success(active ? "Staff reactivated" : "Staff deactivated"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["staff"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/staff/${id}`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error ?? "Failed to delete");
    },
    onMutate: async (id) => {
      setDeleteTarget(null);
      await qc.cancelQueries({ queryKey: ["staff"] });
      const prev = qc.getQueryData<StaffRow[]>(["staff"]);
      qc.setQueryData<StaffRow[]>(["staff"], (old) => (old ?? []).filter((s) => s.id !== id));
      return { prev };
    },
    onSuccess: () => toast.success("Staff member deleted"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["staff"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });

  function openEdit(s: StaffRow) {
    setEditTarget(s);
    setEditForm({ name: s.name, email: s.email, password: "", location_id: s.location_id ?? "" });
    setEditError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staff</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Password</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {staff?.map((s) => {
              const revealed = revealedIds.has(s.id);
              return (
                <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/owner/staff/${s.id}`}
                      className="text-gray-900 hover:text-[#D4541A] transition-colors"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.email}</td>
                  <td className="px-4 py-3">
                    {s.login_password ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-gray-700">
                          {revealed ? s.login_password : "••••••••"}
                        </span>
                        <button
                          onClick={() => toggleReveal(s.id)}
                          className="text-gray-400 hover:text-gray-700 transition-colors"
                        >
                          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.locations?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={s.is_active ? "success" : "secondary"}>
                      {s.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="icon" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleActiveMutation.mutate({ id: s.id, active: !s.is_active })}
                      >
                        {s.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {staff?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No staff yet. Add your first staff member.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); setCreateError(null); createMutation.mutate(createForm); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="sname">Name</Label>
              <Input
                id="sname"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="semail">Email</Label>
              <Input
                id="semail"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spwd">Temporary Password</Label>
              <Input
                id="spwd"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={createForm.location_id}
                onValueChange={(v) => setCreateForm({ ...createForm, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign location" />
                </SelectTrigger>
                <SelectContent>
                  {locations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Staff Member?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) will be permanently deleted.
              Their login access will be revoked immediately.
            </p>
            <p className="text-xs text-gray-400">This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Staff Member</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editTarget) return;
              editMutation.mutate({ id: editTarget.id, ...editForm });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>New Password (optional)</Label>
              <Input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Leave blank to keep unchanged"
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={editForm.location_id}
                onValueChange={(v) => setEditForm({ ...editForm, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign location" />
                </SelectTrigger>
                <SelectContent>
                  {locations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
