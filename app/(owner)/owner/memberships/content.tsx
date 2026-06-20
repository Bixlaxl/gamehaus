"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { MembershipPlan } from "@/lib/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, CreditCard, UserCheck } from "lucide-react";

type Assignment = {
  id: string;
  customer_phone: string;
  starts_at: string;
  expires_at: string;
  plan: { name: string; discount_pct: number; free_hrs: number } | null;
};

type PlanForm = {
  name: string;
  price: string;
  duration_days: string;
  discount_pct: string;
  free_hrs: string;
};

const defaultPlanForm: PlanForm = {
  name:          "",
  price:         "",
  duration_days: "30",
  discount_pct:  "0",
  free_hrs:      "0",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function MembershipsContent({
  initialPlans,
  initialAssignments,
}: {
  initialPlans: MembershipPlan[];
  initialAssignments: Assignment[];
}) {
  const qc     = useQueryClient();
  const router = useRouter();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(defaultPlanForm);
  const [assignPhone, setAssignPhone] = useState("");
  const [assignPlanId, setAssignPlanId] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const { data: plans } = useQuery<MembershipPlan[]>({
    queryKey: ["membership-plans"],
    queryFn: async () => {
      const res  = await fetch("/api/memberships");
      const body = await res.json() as { success: true; data: MembershipPlan[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: initialPlans,
    initialDataUpdatedAt: Date.now(),
    staleTime: 0,
  });

  // Assignments come from server props directly — router.refresh() pulls fresh data after mutations
  const assignments = initialAssignments;

  const planMutation = useMutation({
    mutationFn: async (values: PlanForm & { editId?: string }) => {
      const payload = {
        name:          values.name,
        price:         parseFloat(values.price),
        duration_days: parseInt(values.duration_days),
        discount_pct:  parseFloat(values.discount_pct) || 0,
        free_hrs:      parseFloat(values.free_hrs) || 0,
      };
      const url    = values.editId ? `/api/memberships/${values.editId}` : "/api/memberships";
      const method = values.editId ? "PATCH" : "POST";
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: (values) => {
      setPlanDialogOpen(false);
      setEditingPlan(null);
      setPlanForm(defaultPlanForm);
      if (values.editId) {
        const prev = qc.getQueryData<MembershipPlan[]>(["membership-plans"]);
        qc.setQueryData<MembershipPlan[]>(["membership-plans"], (old) =>
          (old ?? []).map((p) =>
            p.id === values.editId
              ? { ...p, name: values.name, price: parseFloat(values.price), duration_days: parseInt(values.duration_days), discount_pct: parseFloat(values.discount_pct) || 0, free_hrs: parseFloat(values.free_hrs) || 0 }
              : p
          )
        );
        return { prev };
      }
    },
    onError: (e, values, ctx) => {
      if (values.editId && ctx?.prev) qc.setQueryData(["membership-plans"], ctx.prev);
      alert((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["membership-plans"] }),
  });

  const deactivatePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      const res  = await fetch(`/api/memberships/${id}`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["membership-plans"] });
      const prev = qc.getQueryData<MembershipPlan[]>(["membership-plans"]);
      qc.setQueryData<MembershipPlan[]>(["membership-plans"], (old) =>
        (old ?? []).map((p) => p.id === id ? { ...p, is_active: false } : p)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["membership-plans"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["membership-plans"] }),
  });

  async function assignMembership() {
    if (!assignPhone.trim() || !assignPlanId) {
      setAssignError("Phone and plan are required");
      return;
    }
    setAssignError(null);
    setAssigning(true);
    const res  = await fetch("/api/memberships/assign", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ customer_phone: assignPhone.trim(), plan_id: assignPlanId }),
    });
    const body = await res.json() as { success: boolean; error?: string };
    if (!body.success) {
      setAssignError(body.error ?? "Failed to assign");
      setAssigning(false);
      return;
    }
    setAssignDialogOpen(false);
    setAssignPhone("");
    setAssignPlanId("");
    setAssigning(false);
    router.refresh();
  }

  function openAdd() {
    setEditingPlan(null);
    setPlanForm(defaultPlanForm);
    setPlanDialogOpen(true);
  }

  function openEdit(p: MembershipPlan) {
    setEditingPlan(p);
    setPlanForm({
      name:          p.name,
      price:         String(p.price),
      duration_days: String(p.duration_days),
      discount_pct:  String(p.discount_pct),
      free_hrs:      String(p.free_hrs),
    });
    setPlanDialogOpen(true);
  }

  const activePlans = (plans ?? []).filter((p) => p.is_active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Memberships</h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setAssignDialogOpen(true)}>
            <UserCheck className="h-4 w-4" />
            Assign to Customer
          </Button>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            New Plan
          </Button>
        </div>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(plans ?? []).length === 0 && (
          <div className="col-span-full flex flex-col items-center py-14 text-gray-400">
            <CreditCard className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No membership plans yet</p>
          </div>
        )}
        {(plans ?? []).map((plan) => (
          <div
            key={plan.id}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{plan.name}</h3>
              <Badge variant={plan.is_active ? "success" : "secondary"}>
                {plan.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-2xl font-bold tabular-nums" style={{ color: "#D4541A" }}>
              {formatCurrency(plan.price)}
            </p>
            <div className="space-y-1 text-xs text-gray-500">
              <p>{plan.duration_days} days</p>
              {plan.discount_pct > 0 && <p>{plan.discount_pct}% off on every visit</p>}
              {plan.free_hrs > 0 && <p>{plan.free_hrs} free hours included</p>}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => openEdit(plan)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {plan.is_active && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => deactivatePlanMutation.mutate(plan.id)}
                >
                  Deactivate
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Active assignments */}
      {assignments.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Active Member Assignments</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Plan</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Discount</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assignments.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{a.customer_phone}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{a.plan?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {a.plan?.discount_pct ? `${a.plan.discount_pct}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmtDate(a.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plan dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Edit Plan" : "New Membership Plan"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); planMutation.mutate({ ...planForm, editId: editingPlan?.id }); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Plan Name</Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder="e.g. Monthly Pass"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Price (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={planForm.price}
                  onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Duration (days)</Label>
                <Input
                  type="number"
                  min="1"
                  value={planForm.duration_days}
                  onChange={(e) => setPlanForm({ ...planForm, duration_days: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Discount %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={planForm.discount_pct}
                  onChange={(e) => setPlanForm({ ...planForm, discount_pct: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Free Hours</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={planForm.free_hrs}
                  onChange={(e) => setPlanForm({ ...planForm, free_hrs: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={planMutation.isPending}>
                {planMutation.isPending ? "Saving…" : editingPlan ? "Save Changes" : "Create Plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Membership</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Customer Phone</Label>
              <Input
                type="tel"
                value={assignPhone}
                onChange={(e) => setAssignPhone(e.target.value)}
                placeholder="10-digit mobile number"
              />
            </div>
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={assignPlanId} onValueChange={setAssignPlanId}>
                <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
                <SelectContent>
                  {activePlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {formatCurrency(p.price)} / {p.duration_days}d
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {assignError && (
              <p className="text-xs text-red-500">{assignError}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)} disabled={assigning}>Cancel</Button>
              <Button onClick={assignMembership} disabled={assigning}>
                {assigning ? "Assigning…" : "Assign"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
