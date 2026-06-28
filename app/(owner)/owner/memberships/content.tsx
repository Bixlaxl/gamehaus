"use client";

import { useState, useMemo } from "react";
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
import {
  Plus, Pencil, CreditCard, UserCheck, Search, Trash2,
  ShieldCheck, ShieldOff, Clock, Percent,
} from "lucide-react";

type Assignment = {
  id: string;
  customer_phone: string;
  customer_name?: string;
  starts_at: string;
  expires_at: string;
  is_active?: boolean;
  plan: { name: string; discount_pct: number; free_hrs: number; bound_table_ids?: string[] } | null;
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
  name:            "",
  price:           "",
  duration_days:   "30",
  discount_pct:    "0",
  free_hrs:        "0",
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

  // ─── Dialog state ─────────────────────────────────────────────────
  const [planDialogOpen, setPlanDialogOpen]     = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  // ─── Plan form state ──────────────────────────────────────────────
  const [planCategory, setPlanCategory]   = useState<"pct" | "hours">("pct");
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [editingPlan, setEditingPlan]     = useState<MembershipPlan | null>(null);
  const [planForm, setPlanForm]           = useState<PlanForm>(defaultPlanForm);

  // ─── Assign form state ────────────────────────────────────────────
  const [assignPhone, setAssignPhone]   = useState("");
  const [assignPlanId, setAssignPlanId] = useState("");
  const [assignError, setAssignError]   = useState<string | null>(null);
  const [assigning, setAssigning]       = useState(false);

  // ─── Manage perks state ───────────────────────────────────────────
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [boundTableIds, setBoundTableIds]           = useState<string[]>([]);
  const [ledgerValues, setLedgerValues]             = useState<Record<string, string>>({});
  const [savingPerks, setSavingPerks]               = useState(false);

  // ─── Search ───────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  const TABLE_TYPES = ["snooker", "pool", "ps5", "foosball", "simulator"];

  // ─── Data queries ─────────────────────────────────────────────────
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

  // Assignments are fetched client-side for real-time refresh after mutations
  const { data: assignments } = useQuery<Assignment[]>({
    queryKey: ["membership-assignments"],
    queryFn: async () => {
      const res  = await fetch("/api/memberships/assignments");
      const body = await res.json() as { success: true; data: Assignment[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: initialAssignments,
    initialDataUpdatedAt: Date.now(),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const filteredAssignments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return assignments ?? [];
    return (assignments ?? []).filter(
      (a) =>
        a.customer_phone.toLowerCase().includes(q) ||
        (a.customer_name ?? "").toLowerCase().includes(q)
    );
  }, [assignments, searchQuery]);

  const tablesByLocation = tables.reduce((acc, table) => {
    const locName = table.location?.name || "Unknown Location";
    acc[locName] = acc[locName] || [];
    acc[locName].push(table);
    return acc;
  }, {} as Record<string, typeof tables>);

  // ─── Plan mutations ───────────────────────────────────────────────
  const planMutation = useMutation({
    mutationFn: async (values: PlanForm & { editId?: string; _selectedTableId?: string; _planCategory?: "pct" | "hours" }) => {
      const cat = values._planCategory ?? planCategory;
      const tid = values._selectedTableId ?? "";
      const payload = {
        name:            values.name,
        price:           parseFloat(values.price),
        duration_days:   parseInt(values.duration_days),
        discount_pct:    cat === "pct" ? parseFloat(values.discount_pct) || 0 : 0,
        free_hrs:        cat === "hours" ? parseFloat(values.free_hrs) || 0 : 0,
        bound_table_ids: cat === "hours" ? (tid ? [tid] : values.bound_table_ids || []) : [],
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
                  name:            values.name,
                  price:           parseFloat(values.price),
                  duration_days:   parseInt(values.duration_days),
                  discount_pct:    (values._planCategory ?? planCategory) === "pct" ? parseFloat(values.discount_pct) || 0 : 0,
                  free_hrs:        (values._planCategory ?? planCategory) === "hours" ? parseFloat(values.free_hrs) || 0 : 0,
                  bound_table_ids: (values._planCategory ?? planCategory) === "hours" ? ((values._selectedTableId ?? "") ? [values._selectedTableId!] : values.bound_table_ids || []) : [],
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["membership-plans"] });
      // Also refresh assignments so newly-created plans' ledgers are visible immediately
      qc.invalidateQueries({ queryKey: ["membership-assignments"] });
    },
  });

  const deactivatePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      const res  = await fetch(`/api/memberships/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
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

  const activatePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      const res  = await fetch(`/api/memberships/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["membership-plans"] });
      const prev = qc.getQueryData<MembershipPlan[]>(["membership-plans"]);
      qc.setQueryData<MembershipPlan[]>(["membership-plans"], (old) =>
        (old ?? []).map((p) => p.id === id ? { ...p, is_active: true } : p)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["membership-plans"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["membership-plans"] }),
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      const res  = await fetch(`/api/memberships/${id}`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["membership-plans"] });
      const prev = qc.getQueryData<MembershipPlan[]>(["membership-plans"]);
      qc.setQueryData<MembershipPlan[]>(["membership-plans"], (old) =>
        (old ?? []).filter((p) => p.id !== id)
      );
      return { prev };
    },
    onError: (e, _, ctx) => {
      if (ctx?.prev) qc.setQueryData(["membership-plans"], ctx.prev);
      alert((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["membership-plans"] }),
  });

  // ─── Helpers ──────────────────────────────────────────────────────
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
    // Immediately refetch assignments so the new entry + ledger shows up without a page reload
    qc.invalidateQueries({ queryKey: ["membership-assignments"] });
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
      name:            p.name,
      price:           String(p.price),
      duration_days:   String(p.duration_days),
      discount_pct:    String(p.discount_pct),
      free_hrs:        String(p.free_hrs),
      bound_table_ids: p.bound_table_ids || [],
    });
    setPlanDialogOpen(true);
  }

  function openManagePerks(a: Assignment) {
    setSelectedAssignment(a);
    const planObj = a.plan ? (Array.isArray(a.plan) ? (a.plan as any)[0] : a.plan) : null;
    const initialBound = (a.bound_table_ids && a.bound_table_ids.length > 0)
      ? a.bound_table_ids
      : (planObj?.bound_table_ids || []);
    setBoundTableIds(initialBound);
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
          membership_id:     selectedAssignment.id,
          bound_table_ids:   boundTableIds,
          free_hours_ledger: parsedLedger,
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || "Failed to update perks");
      setManageDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["membership-assignments"] });
    } catch (e: any) {
      alert(e.message || "Failed to save perks");
    } finally {
      setSavingPerks(false);
    }
  }

  function confirmDelete(plan: MembershipPlan) {
    if (window.confirm(`Permanently delete "${plan.name}"? This cannot be undone.\n\nIf this plan is assigned to customers, you must deactivate it instead.`)) {
      deletePlanMutation.mutate(plan.id);
    }
  }

  const activePlans = (plans ?? []).filter((p) => p.is_active);

  // ─── Render ───────────────────────────────────────────────────────
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

      {/* ── Plans grid ─────────────────────────────────────────────── */}
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
              <p>{plan.duration_days} days validity</p>
              {plan.discount_pct > 0 && (
                <p className="flex items-center gap-1">
                  <Percent className="h-3 w-3 text-blue-500" />
                  Global Discount: <span className="font-semibold text-blue-600">{plan.discount_pct}% Off</span>
                </p>
              )}
              {plan.free_hrs > 0 && (
                <div className="space-y-0.5">
                  <p className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-green-500" />
                    Free Hours: <span className="font-semibold text-green-600">{plan.free_hrs} hrs</span>
                  </p>
                  {plan.bound_table_ids && plan.bound_table_ids.length > 0 && (() => {
                    const matchedTable = tables.find(t => t.id === plan.bound_table_ids[0]);
                    return (
                      <p className="font-semibold text-purple-600 pl-4">
                        Bound to: {matchedTable ? `${matchedTable.name} (${matchedTable.location?.name || "Gamehaus"})` : "Unknown table"}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => openEdit(plan)} title="Edit plan">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {plan.is_active ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-amber-600 border-amber-200 hover:bg-amber-50"
                  onClick={() => deactivatePlanMutation.mutate(plan.id)}
                  disabled={deactivatePlanMutation.isPending}
                  title="Deactivate plan"
                >
                  <ShieldOff className="h-3.5 w-3.5 mr-1" />
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-green-600 border-green-200 hover:bg-green-50"
                  onClick={() => activatePlanMutation.mutate(plan.id)}
                  disabled={activatePlanMutation.isPending}
                  title="Activate plan"
                >
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                  Activate
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 ml-auto"
                onClick={() => confirmDelete(plan)}
                disabled={deletePlanMutation.isPending}
                title="Permanently delete plan"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Active assignments ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Active Member Assignments</h2>
            <p className="text-xs text-gray-400 mt-0.5">Click a row to manage table bindings and free-hour ledger</p>
          </div>
          {/* Search by phone / name */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              type="search"
              placeholder="Search by phone or name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm rounded-xl"
            />
          </div>
        </div>

        {filteredAssignments.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-gray-400">
            <UserCheck className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">{searchQuery ? "No results found" : "No active memberships yet"}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Phone</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Plan</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Benefit</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Available Hours</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 whitespace-nowrap">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredAssignments.map((a) => {
                  const hasFreeHrs   = (a.plan?.free_hrs ?? 0) > 0;
                  const hasDiscount  = (a.plan?.discount_pct ?? 0) > 0;
                  return (
                    <tr
                      key={a.id}
                      className="hover:bg-gray-50/80 cursor-pointer transition-colors"
                      onClick={() => openManagePerks(a)}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold text-purple-600">
                        {a.short_id || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-800 font-medium max-w-[140px] truncate">
                        {a.customer_name && a.customer_name !== "Unknown"
                          ? a.customer_name
                          : <span className="text-gray-400 italic">Unknown</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {a.customer_phone}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {a.plan?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {hasFreeHrs && (
                            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                              <Clock className="h-3 w-3" />
                              {a.plan!.free_hrs} hrs total
                            </span>
                          )}
                          {hasDiscount && (
                            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                              <Percent className="h-3 w-3" />
                              {a.plan!.discount_pct}% Off
                            </span>
                          )}
                          {!hasFreeHrs && !hasDiscount && (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {hasFreeHrs ? (() => {
                          const ledger = a.free_hours_ledger && typeof a.free_hours_ledger === "object" ? a.free_hours_ledger : {};
                          const ledgerVals = Object.values(ledger).map(v => Number(v)).filter(v => !isNaN(v));
                          const remainingHrs = ledgerVals.length > 0 ? Math.max(...ledgerVals) : (a.plan?.free_hrs ?? 0);
                          return (
                            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              remainingHrs > 0
                                ? "text-purple-700 bg-purple-50 border border-purple-200"
                                : "text-gray-500 bg-gray-100 border border-gray-200"
                            }`}>
                              <Clock className="h-3 w-3" />
                              {remainingHrs} hrs avail
                            </span>
                          );
                        })() : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs whitespace-nowrap">
                        {fmtDate(a.expires_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Plan dialog (create / edit) ─────────────────────────────── */}
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
              // Snapshot selectedTableId and planCategory at submit time so onMutate
              // resetting these states doesn't corrupt the in-flight mutationFn.
              planMutation.mutate({
                ...planForm,
                editId: editingPlan?.id,
                _selectedTableId: selectedTableId,
                _planCategory: planCategory,
              });
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
                  <Label>Plan Name</Label>
                  <Input
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                    placeholder="e.g. Bronze Discount"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plan Rate (₹)</Label>
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
                  <Label>Discount Percentage (%)</Label>
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
                  <Label>Plan Name</Label>
                  <Input
                    value={planForm.name}
                    onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                    placeholder="e.g. Snooker Master"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plan Rate (₹)</Label>
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
                  <Label>Total Free Hours</Label>
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
                  <Label>Asset / Table</Label>
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

      {/* ── Assign dialog ───────────────────────────────────────────── */}
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

      {/* ── Manage Perks dialog ─────────────────────────────────────── */}
      <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Membership Perks</DialogTitle>
          </DialogHeader>
          {selectedAssignment && (
            <div className="space-y-5 py-2">
              {/* Profile Read-Only Summary */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2">
                {selectedAssignment.customer_name && selectedAssignment.customer_name !== "Unknown" && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">Customer Name</span>
                    <span className="font-semibold text-gray-900">{selectedAssignment.customer_name}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-medium">Customer Phone</span>
                  <span className="font-mono text-gray-900 font-semibold">{selectedAssignment.customer_phone}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 font-medium">Plan</span>
                  <span className="font-semibold text-gray-900">{selectedAssignment.plan?.name ?? "—"}</span>
                </div>
                {(selectedAssignment.plan?.discount_pct ?? 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">Global Discount</span>
                    <span className="text-blue-600 font-bold">{selectedAssignment.plan!.discount_pct}% Off</span>
                  </div>
                )}
                {(selectedAssignment.plan?.free_hrs ?? 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 font-medium">Plan Free Hours</span>
                    <span className="text-green-600 font-bold">{selectedAssignment.plan!.free_hrs} hrs</span>
                  </div>
                )}
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-500 font-medium">Membership ID</span>
                  <span
                    className="font-mono text-xs text-gray-400 select-all cursor-pointer hover:text-gray-600 transition-colors truncate max-w-[200px]"
                    title="Click to copy"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedAssignment.id);
                      alert("Membership ID copied to clipboard!");
                    }}
                  >
                    {selectedAssignment.short_id || selectedAssignment.id}
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
