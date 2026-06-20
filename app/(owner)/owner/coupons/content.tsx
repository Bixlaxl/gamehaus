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
import type { Coupon, Location } from "@/lib/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Copy, Check } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient();

type CouponRow = Coupon & { location: { name: string } | null };

type CouponForm = {
  location_id: string;
  code: string;
  discount_type: "percent" | "flat";
  discount_value: string;
  valid_from: string;
  valid_until: string;
  max_uses: string;
  is_public: boolean;
};

const defaultForm: CouponForm = {
  location_id: "all",
  code: "",
  discount_type: "percent",
  discount_value: "",
  valid_from: new Date().toISOString().split("T")[0],
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  max_uses: "",
  is_public: false,
};

// Convert a local YYYY-MM-DD date string to end-of-day IST (UTC+5:30)
function toEndOfDayIST(dateStr: string): string {
  return new Date(dateStr + "T23:59:59+05:30").toISOString();
}
function toStartOfDayIST(dateStr: string): string {
  return new Date(dateStr + "T00:00:00+05:30").toISOString();
}

export function CouponsContent({
  initialLocations,
  initialCoupons,
}: {
  initialLocations: Location[];
  initialCoupons: CouponRow[];
}) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen]   = useState(false);
  const [createForm, setCreateForm]   = useState<CouponForm>(defaultForm);
  const [createError, setCreateError] = useState<string | null>(null);

  const [copiedCode, setCopiedCode]   = useState<string | null>(null);
  const [editTarget, setEditTarget]   = useState<CouponRow | null>(null);
  const [editForm, setEditForm]       = useState<Partial<CouponForm>>({});
  const [editError, setEditError]     = useState<string | null>(null);

  const { data: locations } = useQuery({
    queryKey: ["locations", "active"],
    queryFn: async () => {
      // Admin-backed — see /api/locations comment. Browser-side reads
      // here hit RLS and silently drop rows.
      const res  = await fetch("/api/locations", { cache: "no-store" });
      const body = await res.json() as { success: true; data: Location[] } | { success: false; error: string };
      if (!body.success) return [];
      return body.data.filter((l) => l.is_active);
    },
    initialData: initialLocations,
    initialDataUpdatedAt: Date.now(),
    staleTime: 0,
  });

  const { data: coupons, isLoading } = useQuery({
    queryKey: ["coupons"],
    queryFn: async () => {
      const { data } = await supabase
        .from("coupons")
        .select("*, location:locations(name)")
        .order("created_at", { ascending: false });
      return (data ?? []) as CouponRow[];
    },
    initialData: initialCoupons,
    initialDataUpdatedAt: Date.now(),
    staleTime: 0,
  });

  // ── Create ──────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (values: CouponForm) => {
      const { error: dbError } = await supabase.from("coupons").insert({
        location_id:    values.location_id === "all" ? null : values.location_id,
        code:           values.code.toUpperCase(),
        discount_type:  values.discount_type,
        discount_value: parseFloat(values.discount_value),
        valid_from:     toStartOfDayIST(values.valid_from),
        valid_until:    toEndOfDayIST(values.valid_until),
        max_uses:       values.max_uses ? parseInt(values.max_uses) : null,
        is_public:      values.is_public,
      });
      if (dbError) throw new Error(dbError.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      setCreateOpen(false);
      setCreateForm(defaultForm);
      setCreateError(null);
      toast.success("Coupon created");
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  // ── Edit ─────────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<CouponForm> }) => {
      const { error } = await supabase.from("coupons").update({
        ...(values.valid_until    !== undefined && { valid_until:    toEndOfDayIST(values.valid_until) }),
        ...(values.valid_from     !== undefined && { valid_from:     toStartOfDayIST(values.valid_from) }),
        ...(values.discount_type  !== undefined && { discount_type:  values.discount_type }),
        ...(values.discount_value !== undefined && { discount_value: parseFloat(values.discount_value) }),
        ...(values.max_uses       !== undefined && { max_uses:       values.max_uses ? parseInt(values.max_uses) : null }),
        ...(values.location_id    !== undefined && { location_id:    values.location_id === "all" ? null : values.location_id }),
        ...(values.is_public      !== undefined && { is_public:      values.is_public }),
      }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, values }) => {
      await qc.cancelQueries({ queryKey: ["coupons"] });
      const prev = qc.getQueryData<CouponRow[]>(["coupons"]);
      const loc  = values.location_id && values.location_id !== "all"
        ? locations?.find((l) => l.id === values.location_id)
        : null;
      qc.setQueryData<CouponRow[]>(["coupons"], (old) =>
        (old ?? []).map((c) =>
          c.id === id
            ? {
                ...c,
                valid_until:    values.valid_until ? toEndOfDayIST(values.valid_until) : c.valid_until,
                valid_from:     values.valid_from  ? toStartOfDayIST(values.valid_from) : c.valid_from,
                discount_type:  values.discount_type ?? c.discount_type,
                discount_value: values.discount_value ? parseFloat(values.discount_value) : c.discount_value,
                max_uses:       values.max_uses !== undefined ? (values.max_uses ? parseInt(values.max_uses) : null) : c.max_uses,
                location_id:    values.location_id === "all" ? null : (values.location_id ?? c.location_id),
                location:       values.location_id !== undefined ? (loc ? { name: loc.name } : null) : c.location,
                is_public:      values.is_public !== undefined ? values.is_public : c.is_public,
              }
            : c
        )
      );
      setEditTarget(null);
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      toast.success("Coupon updated");
      setEditError(null);
    },
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["coupons"], ctx.prev);
      setEditError((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  // ── Toggle active ────────────────────────────────────────────────────────
  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("coupons").update({ is_active: false }).eq("id", id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["coupons"] });
      const prev = qc.getQueryData<CouponRow[]>(["coupons"]);
      qc.setQueryData<CouponRow[]>(["coupons"], (old) =>
        (old ?? []).map((c) => c.id === id ? { ...c, is_active: false } : c)
      );
      return { prev };
    },
    onSuccess: () => toast.success("Coupon deactivated"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["coupons"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("coupons").update({ is_active: true }).eq("id", id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["coupons"] });
      const prev = qc.getQueryData<CouponRow[]>(["coupons"]);
      qc.setQueryData<CouponRow[]>(["coupons"], (old) =>
        (old ?? []).map((c) => c.id === id ? { ...c, is_active: true } : c)
      );
      return { prev };
    },
    onSuccess: () => toast.success("Coupon reactivated"),
    onError: (err, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["coupons"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  function openEdit(c: CouponRow) {
    setEditTarget(c);
    setEditForm({
      location_id:    c.location_id ?? "all",
      discount_type:  c.discount_type,
      discount_value: String(c.discount_value),
      valid_from:     c.valid_from.split("T")[0],
      valid_until:    c.valid_until.split("T")[0],
      max_uses:       c.max_uses !== null ? String(c.max_uses) : "",
      is_public:      c.is_public,
    });
    setEditError(null);
  }

  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Coupons</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Coupon
        </Button>
      </div>

      <p className="text-sm text-gray-500">
        Coupons only apply to full prepay online bookings — not walk-ins.
      </p>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Discount</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Valid Until</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Uses</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {coupons?.map((coupon) => {
              const expired   = new Date(coupon.valid_until) < now;
              const exhausted = coupon.max_uses !== null && coupon.used_count >= coupon.max_uses;
              return (
                <tr key={coupon.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-gray-900">{coupon.code}</span>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(coupon.code);
                          setCopiedCode(coupon.code);
                          setTimeout(() => setCopiedCode(null), 1500);
                        }}
                        className="text-gray-300 hover:text-gray-600 transition-colors"
                        title="Copy code"
                      >
                        {copiedCode === coupon.code
                          ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                          : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {coupon.discount_type === "percent"
                      ? `${coupon.discount_value}%`
                      : formatCurrency(coupon.discount_value)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {coupon.location?.name ?? "All locations"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    <Badge variant={coupon.is_public ? "warning" : "outline"}>
                      {coupon.is_public ? "Public Deal" : "Private Code"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(coupon.valid_until).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {coupon.used_count}
                    {coupon.max_uses !== null && ` / ${coupon.max_uses}`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={!coupon.is_active || expired || exhausted ? "secondary" : "success"}>
                      {!coupon.is_active ? "Inactive" : expired ? "Expired" : exhausted ? "Exhausted" : "Active"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="icon" onClick={() => openEdit(coupon)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {coupon.is_active ? (
                        <Button variant="outline" size="sm" onClick={() => deactivateMutation.mutate(coupon.id)}>
                          Deactivate
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => reactivateMutation.mutate(coupon.id)}>
                          Activate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {coupons?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No coupons yet
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
            <DialogTitle>New Coupon</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); setCreateError(null); createMutation.mutate(createForm); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Code</Label>
              <Input
                value={createForm.code}
                onChange={(e) => setCreateForm({ ...createForm, code: e.target.value.toUpperCase() })}
                placeholder="SUMMER20"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={createForm.discount_type}
                  onValueChange={(v) => setCreateForm({ ...createForm, discount_type: v as "percent" | "flat" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="flat">Flat (₹)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value</Label>
                <Input
                  type="number"
                  value={createForm.discount_value}
                  onChange={(e) => setCreateForm({ ...createForm, discount_value: e.target.value })}
                  required min="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location scope</Label>
              <Select
                value={createForm.location_id}
                onValueChange={(v) => setCreateForm({ ...createForm, location_id: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valid from</Label>
                <Input
                  type="date"
                  value={createForm.valid_from}
                  onChange={(e) => setCreateForm({ ...createForm, valid_from: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Valid until</Label>
                <Input
                  type="date"
                  value={createForm.valid_until}
                  onChange={(e) => setCreateForm({ ...createForm, valid_until: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max uses (blank = unlimited)</Label>
              <Input
                type="number"
                value={createForm.max_uses}
                onChange={(e) => setCreateForm({ ...createForm, max_uses: e.target.value })}
                min="1"
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={createForm.is_public ? "public" : "private"}
                onValueChange={(v) => setCreateForm({ ...createForm, is_public: v === "public" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private Code (manually typed)</SelectItem>
                  <SelectItem value="public">Public Deal (shown on home page)</SelectItem>
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

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Coupon — {editTarget?.code}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editTarget) return;
              editMutation.mutate({ id: editTarget.id, values: editForm });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={editForm.discount_type ?? editTarget?.discount_type ?? "percent"}
                  onValueChange={(v) => setEditForm({ ...editForm, discount_type: v as "percent" | "flat" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="flat">Flat (₹)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value</Label>
                <Input
                  type="number"
                  value={editForm.discount_value ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, discount_value: e.target.value })}
                  min="0"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location scope</Label>
              <Select
                value={editForm.location_id ?? "all"}
                onValueChange={(v) => setEditForm({ ...editForm, location_id: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valid from</Label>
                <Input
                  type="date"
                  value={editForm.valid_from ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, valid_from: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Valid until</Label>
                <Input
                  type="date"
                  value={editForm.valid_until ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, valid_until: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max uses (blank = unlimited)</Label>
              <Input
                type="number"
                value={editForm.max_uses ?? ""}
                onChange={(e) => setEditForm({ ...editForm, max_uses: e.target.value })}
                min="1"
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={editForm.is_public ?? editTarget?.is_public ? "public" : "private"}
                onValueChange={(v) => setEditForm({ ...editForm, is_public: v === "public" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private Code (manually typed)</SelectItem>
                  <SelectItem value="public">Public Deal (shown on home page)</SelectItem>
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
