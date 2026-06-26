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
  bound_table_ids?: string[];
  free_hours_ledger?: any;
  free_hrs_used?: number;
  short_id?: string;
};

type PlanForm = {
  name: string;
  price: string;
  duration_days: string;
  discount_pct: string;
  free_hrs: string;
  bound_table_ids: string[];
};

const defaultPlanForm: PlanForm = {
  name:          "",
  price:         "",
  duration_days: "30",
  discount_pct:  "0",
  free_hrs:      "0",
  bound_table_ids: [],
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function MembershipsContent({
  initialPlans,
  initialAssignments,
  tables,
}: {
  initialPlans: MembershipPlan[];
  initialAssignments: Assignment[];
  tables: Array<{ id: string; name: string; type: string; location: { name: string } | null }>;
}) {
  const qc     = useQueryClient();
  const router = useRouter();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [planCategory, setPlanCategory] = useState<"pct" | "hours">("pct");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
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

  const TABLE_TYPES = ["snooker", "pool", "ps5", "foosball"];
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [boundTableIds, setBoundTableIds] = useState<string[]>([]);
  const [ledgerValues, setLedgerValues] = useState<Record<string, string>>({});
  const [savingPerks, setSavingPerks] = useState(false);

  function openManagePerks(a: Assignment) {
    setSelectedAssignment(a);
    setBoundTableIds(a.bound_table_ids || []);
    
    const initialLedger: Record<string, string> = {};
    TABLE_TYPES.forEach(t => {
      initialLedger[t] = String(a.free_hours_ledger?.[t] ?? 0);
    });
    setLedgerValues(initialLedger);
    setManageDialogOpen(true);
  }

  async function savePerks() {
    if (!selectedAssignment) return;
    setSavingPerks(true);
    
    const parsedLedger: Record<string, number> = {};
    TABLE_TYPES.forEach(t => {
      parsedLedger[t] = parseFloat(ledgerValues[t]) || 0;
    });

    try {
      const res = await fetch("/api/memberships/customer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membership_id: selectedAssignment.id,
          bound_table_ids: boundTableIds,
          free_hours_ledger: parsedLedger,
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || "Failed to update perks");
      
      setManageDialogOpen(false);
      router.refresh();
    } catch (e: any) {
      alert(e.message || "Failed to save perks");
    } finally {
      setSavingPerks(false);
    }
  }

  const tablesByLocation = tables.reduce((acc, table) => {
    const locName = table.location?.name || "Unknown Location";
    acc[locName] = acc[locName] || [];
    acc[locName].push(table);
    return acc;
  }, {} as Record<string, typeof tables>);

  const planMutation = useMutation({
    mutationFn: async (values: PlanForm & { editId?: string }) => {
      const payload = {
        name:          values.name,
        price:         parseFloat(values.price),
        duration_days: parseInt(values.duration_days),
        discount_pct:  planCategory === "pct" ? parseFloat(values.discount_pct) || 0 : 0,
        free_hrs:      planCategory === "hours" ? parseFloat(values.free_hrs) || 0 : 0,
        bound_table_ids: planCategory === "hours" && selectedTableId ? [selectedTableId] : [],
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
      setSelectedTableId("");
      if (values.editId) {
        const prev = qc.getQueryData<MembershipPlan[]>(["membership-plans"]);
        qc.setQueryData<MembershipPlan[]>(["membership-plans"], (old) =>
          (old ?? []).map((p) =>
            p.id === values.editId
              ? {
                  ...p,
                  name: values.name,
                  price: parseFloat(values.price),
                  duration_days: parseInt(values.duration_days),
                  discount_pct: planCategory === "pct" ? parseFloat(values.discount_pct) || 0 : 0,
                  free_hrs: planCategory === "hours" ? parseFloat(values.free_hrs) || 0 : 0,
                  bound_table_ids: planCategory === "hours" && selectedTableId ? [selectedTableId] : [],
                }
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
    setPlanCategory("pct");
    setSelectedTableId("");
    setPlanDialogOpen(true);
  }

  function openEdit(p: MembershipPlan) {
    setEditingPlan(p);
    const isHours = Number(p.free_hrs) > 0;
    setPlanCategory(isHours ? "hours" : "pct");
    const tId = p.bound_table_ids?.[0] ?? "";
    setSelectedTableId(tId);
    setPlanForm({
      name:          p.name,
      price:         String(p.price),
      duration_days: String(p.duration_days),
      discount_pct:  String(p.discount_pct),
      free_hrs:      String(p.free_hrs),
      bound_table_ids: p.bound_table_ids || [],
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
              {plan.discount_pct > 0 && <p>Type: Global Discount ({plan.discount_pct}% Off)</p>}
              {plan.free_hrs > 0 && (
                <div>
                  <p>Type: Restricted Free Hours ({plan.free_hrs} hrs)</p>
                  {plan.bound_table_ids && plan.bound_table_ids.length > 0 && (() => {
                    const matchedTable = tables.find(t => t.id === plan.bound_table_ids[0]);
                    return (
                      <p className="font-semibold text-purple-600 mt-0.5">
                        Bound to: {matchedTable ? `${matchedTable.name} (${matchedTable.location?.name || "Gamehaus"})` : "Unknown table"}
                      </p>
                    );
                  })()}
                </div>
              )}
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
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Active Member Assignments</h2>
            <span className="text-xs text-gray-400">Tip: Click a row to manage table bindings and free hours ledger</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Membership ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Plan</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Discount</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assignments.map((a) => (
                <tr
                  key={a.id}
                  className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                  onClick={() => openManagePerks(a)}
                >
                  <td className="px-4 py-3 font-mono text-xs font-bold text-purple-600">{a.short_id || "—"}</td>
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
            onSubmit={(e) => {
              e.preventDefault();
              if (planCategory === "hours" && !selectedTableId) {
                alert("Please select an asset/table to bind to this template.");
                return;
              }
              planMutation.mutate({ ...planForm, editId: editingPlan?.id });
            }}
            className="space-y-4"
          >
            {/* Category Toggle */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Plan Category</Label>
              <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                <Button
                  type="button"
                  variant={planCategory === "pct" ? "default" : "ghost"}
                  onClick={() => setPlanCategory("pct")}
                  className="w-full text-xs font-semibold rounded-lg"
                >
                  Percentage Discount
                </Button>
                <Button
                  type="button"
                  variant={planCategory === "hours" ? "default" : "ghost"}
                  onClick={() => setPlanCategory("hours")}
                  className="w-full text-xs font-semibold rounded-lg"
                >
                  Free Hours Plan
                </Button>
              </div>
            </div>

            {planCategory === "pct" ? (
              <div className="space-y-4 pt-2 border-t border-gray-50">
                <div className="space-y-2">
                  <Label>Plan Name Input (Custom text)</Label>
                  <Input
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                    placeholder="e.g. Bronze Discount"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plan Rate (Price) (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={planForm.price}
                      onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>InputValidity (days)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={planForm.duration_days}
                      onChange={(e) => setPlanForm({ ...planForm, duration_days: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Discount Percentage Input (%)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={planForm.discount_pct}
                    onChange={(e) => setPlanForm({ ...planForm, discount_pct: e.target.value })}
                    placeholder="e.g. 15"
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4 pt-2 border-t border-gray-50">
                <div className="space-y-2">
                  <Label>Plan Name Input (Custom text)</Label>
                  <Input
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                    placeholder="e.g. Snooker Master"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plan Rate (Price) Input (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={planForm.price}
                      onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Validity (days)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={planForm.duration_days}
                      onChange={(e) => setPlanForm({ ...planForm, duration_days: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Total Free Hours Input</Label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={planForm.free_hrs}
                    onChange={(e) => setPlanForm({ ...planForm, free_hrs: e.target.value })}
                    placeholder="e.g. 10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dynamic Website Tables Dropdown</Label>
                  <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an asset/table" />
                    </SelectTrigger>
                    <SelectContent>
                      {tables.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.type}) {t.location ? `— ${t.location.name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

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

      {/* Customer Profile Card / Manage Perks Dialog */}
      <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Membership Perks</DialogTitle>
          </DialogHeader>
          {selectedAssignment && (
            <div className="space-y-5 py-2">
              {/* Profile Read-Only Summary */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-medium">Customer Phone</span>
                  <span className="font-mono text-gray-900 font-semibold">{selectedAssignment.customer_phone}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-medium">Global Discount</span>
                  <span className="text-purple-600 font-bold">{selectedAssignment.plan?.discount_pct ?? 0}% Off</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-500 font-medium">Membership ID</span>
                  <span className="font-mono text-xs text-gray-400 select-all cursor-pointer hover:text-gray-600 transition-colors" title="Click to copy" onClick={() => {
                    navigator.clipboard.writeText(selectedAssignment.id);
                    alert("Membership ID copied to clipboard!");
                  }}>
                    {selectedAssignment.id} (click to copy)
                  </span>
                </div>
              </div>

              {/* Asset Binding Selector */}
              <div className="space-y-2">
                <Label className="text-gray-700 font-semibold">Bound Assets / Tables</Label>
                <p className="text-xs text-gray-500">Select tables that the customer&apos;s free-hour plan applies to.</p>
                <div className="border border-gray-150 rounded-2xl p-4 space-y-4 max-h-[220px] overflow-y-auto bg-white shadow-inner">
                  {Object.entries(tablesByLocation).map(([locName, locTables]) => (
                    <div key={locName} className="space-y-2">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{locName}</h4>
                      <div className="grid grid-cols-1 gap-2 pl-1">
                        {locTables.map((table) => {
                          const checked = boundTableIds.includes(table.id);
                          return (
                            <label key={table.id} className="flex items-center gap-2.5 text-sm cursor-pointer hover:bg-gray-50 py-1 px-1.5 rounded-lg transition-colors select-none">
                              <input
                                type="checkbox"
                                checked={checked}
                                className="rounded text-purple-600 focus:ring-purple-500"
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setBoundTableIds([...boundTableIds, table.id]);
                                  } else {
                                    setBoundTableIds(boundTableIds.filter(id => id !== table.id));
                                  }
                                }}
                              />
                              <span className="text-gray-700 font-medium">{table.name}</span>
                              <Badge variant="outline" className="text-[10px] py-0 px-1 capitalize">
                                {table.type}
                              </Badge>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {tables.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-4">No active tables configured.</p>
                  )}
                </div>
              </div>

              {/* Available Free Hours Ledger */}
              <div className="space-y-3">
                <Label className="text-gray-700 font-semibold">Available Free Hours Ledger</Label>
                <p className="text-xs text-gray-500">Edit remaining free-hour counts per table type.</p>
                <div className="grid grid-cols-2 gap-3">
                  {TABLE_TYPES.map((type) => (
                    <div key={type} className="space-y-1">
                      <Label className="text-xs font-semibold capitalize text-gray-500">{type}</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="0"
                        value={ledgerValues[type] || "0"}
                        onChange={(e) => setLedgerValues({ ...ledgerValues, [type]: e.target.value })}
                        className="rounded-xl border-gray-250 font-medium"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setManageDialogOpen(false)} disabled={savingPerks}>
                  Cancel
                </Button>
                <Button type="button" onClick={savePerks} disabled={savingPerks}>
                  {savingPerks ? "Saving Perks…" : "Save Perks"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
