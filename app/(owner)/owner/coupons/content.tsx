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
import { formatFriendlyTime, formatFriendlyDays } from "@/lib/coupons";
import { Plus, Pencil, Copy, Check, Clock } from "lucide-react";
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
  time_mode: "full_day" | "time_slot";
  valid_from_time: string;
  valid_until_time: string;
  max_uses: string;
  is_public: boolean;
  valid_days: number[];
};

const defaultForm: CouponForm = {
  location_id: "all",
  code: "",
  discount_type: "percent",
  discount_value: "",
  valid_from: new Date().toISOString().split("T")[0],
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  time_mode: "full_day",
  valid_from_time: "13:00",
  valid_until_time: "18:00",
  max_uses: "",
  is_public: false,
  valid_days: [],
};

// Convert a local YYYY-MM-DD date string to end-of-day IST (UTC+5:30)
function toEndOfDayIST(dateStr: string): string {
  return new Date(dateStr + "T23:59:59+05:30").toISOString();
}
function toStartOfDayIST(dateStr: string): string {
  return new Date(dateStr + "T00:00:00+05:30").toISOString();
}

const WEEKDAYS = [
  { label: "M", value: 1, fullName: "Monday" },
  { label: "T", value: 2, fullName: "Tuesday" },
  { label: "W", value: 3, fullName: "Wednesday" },
  { label: "T", value: 4, fullName: "Thursday" },
  { label: "F", value: 5, fullName: "Friday" },
  { label: "S", value: 6, fullName: "Saturday" },
  { label: "S", value: 0, fullName: "Sunday" },
];

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
      const payload: any = {
        location_id:      values.location_id === "all" ? null : values.location_id,
        code:             values.code.toUpperCase(),
        discount_type:    values.discount_type,
        discount_value:   parseFloat(values.discount_value),
        valid_from:       toStartOfDayIST(values.valid_from),
        valid_until:      toEndOfDayIST(values.valid_until),
        valid_from_time:  values.time_mode === "time_slot" && values.valid_from_time ? values.valid_from_time : null,
        valid_until_time: values.time_mode === "time_slot" && values.valid_until_time ? values.valid_until_time : null,
        max_uses:         values.max_uses ? parseInt(values.max_uses) : null,
        is_public:        values.is_public,
      };
      if (values.valid_days && values.valid_days.length > 0) {
        payload.valid_days = values.valid_days;
      }
      const { error: dbError } = await supabase.from("coupons").insert(payload);
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
      const payload: any = {};
      let hasChanges = false;

      if (editTarget) {
        if (values.valid_until !== undefined) {
          const formatted = toEndOfDayIST(values.valid_until);
          if (formatted !== editTarget.valid_until) {
            payload.valid_until = formatted;
            hasChanges = true;
          }
        }
        if (values.valid_from !== undefined) {
          const formatted = toStartOfDayIST(values.valid_from);
          if (formatted !== editTarget.valid_from) {
            payload.valid_from = formatted;
            hasChanges = true;
          }
        }
        if (values.time_mode !== undefined || values.valid_from_time !== undefined || values.valid_until_time !== undefined) {
          const mode = values.time_mode ?? (editTarget.valid_from_time ? "time_slot" : "full_day");
          const fromT = mode === "time_slot" ? (values.valid_from_time ?? editTarget.valid_from_time ?? "13:00") : null;
          const untilT = mode === "time_slot" ? (values.valid_until_time ?? editTarget.valid_until_time ?? "18:00") : null;
          if (fromT !== editTarget.valid_from_time || untilT !== editTarget.valid_until_time) {
            payload.valid_from_time = fromT;
            payload.valid_until_time = untilT;
            hasChanges = true;
          }
        }
        if (values.discount_type !== undefined && values.discount_type !== editTarget.discount_type) {
          payload.discount_type = values.discount_type;
          hasChanges = true;
        }
        if (values.discount_value !== undefined) {
          const val = parseFloat(values.discount_value);
          if (val !== Number(editTarget.discount_value)) {
            payload.discount_value = val;
            hasChanges = true;
          }
        }
        if (values.max_uses !== undefined) {
          const val = values.max_uses ? parseInt(values.max_uses) : null;
          if (val !== editTarget.max_uses) {
            payload.max_uses = val;
            hasChanges = true;
          }
        }
        if (values.location_id !== undefined) {
          const val = values.location_id === "all" ? null : values.location_id;
          if (val !== editTarget.location_id) {
            payload.location_id = val;
            hasChanges = true;
          }
        }
        if (values.is_public !== undefined && values.is_public !== editTarget.is_public) {
          payload.is_public = values.is_public;
          hasChanges = true;
        }
        if (values.valid_days !== undefined) {
          const oldDays = editTarget.valid_days || [];
          const newDays = values.valid_days || [];
          const same = oldDays.length === newDays.length && oldDays.every(d => newDays.includes(d));
          if (!same) {
            if (newDays.length > 0) {
              payload.valid_days = newDays;
            }
            hasChanges = true;
          }
        }
      }

      if (!hasChanges) {
        return;
      }

      const { error } = await supabase.from("coupons").update(payload).eq("id", id);
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
                valid_until:      values.valid_until ? toEndOfDayIST(values.valid_until) : c.valid_until,
                valid_from:       values.valid_from  ? toStartOfDayIST(values.valid_from) : c.valid_from,
                valid_from_time:  values.time_mode === "full_day" ? null : (values.valid_from_time ?? c.valid_from_time),
                valid_until_time: values.time_mode === "full_day" ? null : (values.valid_until_time ?? c.valid_until_time),
                discount_type:    values.discount_type ?? c.discount_type,
                discount_value:   values.discount_value ? parseFloat(values.discount_value) : c.discount_value,
                max_uses:         values.max_uses !== undefined ? (values.max_uses ? parseInt(values.max_uses) : null) : c.max_uses,
                location_id:      values.location_id === "all" ? null : (values.location_id ?? c.location_id),
                location:         values.location_id !== undefined ? (loc ? { name: loc.name } : null) : c.location,
                is_public:        values.is_public !== undefined ? values.is_public : c.is_public,
                valid_days:       values.valid_days !== undefined ? (values.valid_days.length > 0 ? values.valid_days : null) : c.valid_days,
              }
            : c
        )
      );
      setEditTarget(null);
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      setEditTarget(null);
      setEditError(null);
      toast.success("Coupon updated");
    },
    onError: (e: Error) => setEditError(e.message),
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
    const hasTimeSlot = !!(c.valid_from_time && c.valid_until_time);
    setEditTarget(c);
    setEditForm({
      location_id:      c.location_id ?? "all",
      discount_type:    c.discount_type,
      discount_value:   String(c.discount_value),
      valid_from:       c.valid_from.split("T")[0],
      valid_until:      c.valid_until.split("T")[0],
      time_mode:        hasTimeSlot ? "time_slot" : "full_day",
      valid_from_time:  c.valid_from_time ?? "13:00",
      valid_until_time: c.valid_until_time ?? "18:00",
      max_uses:         c.max_uses !== null ? String(c.max_uses) : "",
      is_public:        c.is_public,
      valid_days:       c.valid_days || [],
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

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
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
                    <div>{new Date(coupon.valid_until).toLocaleDateString("en-IN")}</div>
                    {coupon.valid_days && coupon.valid_days.length > 0 && (
                      <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                        {formatFriendlyDays(coupon.valid_days)}
                      </div>
                    )}
                    {coupon.valid_from_time && coupon.valid_until_time ? (
                      <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                        <Clock className="h-3 w-3" />
                        <span>{formatFriendlyTime(coupon.valid_from_time)} - {formatFriendlyTime(coupon.valid_until_time)}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-gray-400 block mt-0.5">Full Day</span>
                    )}
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
              <Label>Time Availability</Label>
              <Select
                value={createForm.time_mode}
                onValueChange={(v) => setCreateForm({ ...createForm, time_mode: v as "full_day" | "time_slot" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">Full Day (No time restrictions)</SelectItem>
                  <SelectItem value="time_slot">Specific Time Slot (Happy Hours)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createForm.time_mode === "time_slot" && (
              <div className="grid grid-cols-2 gap-4 bg-amber-500/5 p-3 rounded-xl border border-amber-500/20">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-amber-700 dark:text-amber-400">From Time</Label>
                  <Input
                    type="time"
                    value={createForm.valid_from_time}
                    onChange={(e) => setCreateForm({ ...createForm, valid_from_time: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-amber-700 dark:text-amber-400">Until Time</Label>
                  <Input
                    type="time"
                    value={createForm.valid_until_time}
                    onChange={(e) => setCreateForm({ ...createForm, valid_until_time: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Day Availability</Label>
              <div className="flex gap-1.5 flex-wrap">
                {WEEKDAYS.map((d) => {
                  const active = createForm.valid_days.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        const updated = active
                          ? createForm.valid_days.filter((v) => v !== d.value)
                          : [...createForm.valid_days, d.value];
                        setCreateForm({ ...createForm, valid_days: updated });
                      }}
                      className={`h-9 w-9 rounded-full text-xs font-bold transition-all border ${
                        active
                          ? "bg-[#D4541A] border-[#D4541A] text-white"
                          : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                      title={d.fullName}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500">
                Leave all unselected to make valid on all days.
              </p>
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
              <Label>Time Availability</Label>
              <Select
                value={editForm.time_mode ?? "full_day"}
                onValueChange={(v) => setEditForm({ ...editForm, time_mode: v as "full_day" | "time_slot" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">Full Day (No time restrictions)</SelectItem>
                  <SelectItem value="time_slot">Specific Time Slot (Happy Hours)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(editForm.time_mode ?? (editTarget?.valid_from_time ? "time_slot" : "full_day")) === "time_slot" && (
              <div className="grid grid-cols-2 gap-4 bg-amber-500/5 p-3 rounded-xl border border-amber-500/20">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-amber-700 dark:text-amber-400">From Time</Label>
                  <Input
                    type="time"
                    value={editForm.valid_from_time ?? editTarget?.valid_from_time ?? "13:00"}
                    onChange={(e) => setEditForm({ ...editForm, valid_from_time: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-amber-700 dark:text-amber-400">Until Time</Label>
                  <Input
                    type="time"
                    value={editForm.valid_until_time ?? editTarget?.valid_until_time ?? "18:00"}
                    onChange={(e) => setEditForm({ ...editForm, valid_until_time: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Day Availability</Label>
              <div className="flex gap-1.5 flex-wrap">
                {WEEKDAYS.map((d) => {
                  const active = (editForm.valid_days ?? editTarget?.valid_days ?? []).includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        const currentDays = editForm.valid_days ?? editTarget?.valid_days ?? [];
                        const updated = active
                          ? currentDays.filter((v) => v !== d.value)
                          : [...currentDays, d.value];
                        setEditForm({ ...editForm, valid_days: updated });
                      }}
                      className={`h-9 w-9 rounded-full text-xs font-bold transition-all border ${
                        active
                          ? "bg-[#D4541A] border-[#D4541A] text-white"
                          : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                      title={d.fullName}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500">
                Leave all unselected to make valid on all days.
              </p>
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
