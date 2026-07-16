"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X, Banknote, Smartphone, Phone, MessageSquare, ExternalLink, Plus, Trash } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency, getOperatingDate } from "@/lib/utils";

// Subset of fields the bills feed actually uses — exported so the SSR page
// can cast its raw query result without duplicating the type.
export interface BillRow {
  id: string;
  location_id: string;
  type: "walk_in" | "online" | string;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  subtotal: number;
  discount_amount: number;
  public_discount_amount?: number;
  total_amount: number;
  amount_due: number;
  advance_paid: number;
  points_redeemed: number;
  finalized_at: string | null;
  created_at: string;
  items: {
    id: string;
    table_id: string;
    status: string;
    actual_start: string | null;
    actual_end:   string | null;
    expected_end: string | null;
    rate_per_hour: number;
    final_amount: number | null;
    num_people: number | null;
    table: { name: string; type: string } | { name: string; type: string }[] | null;
  }[];
  extras: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    is_deleted: boolean;
  }[];
  payments: {
    id: string;
    amount: number;
    method: "cash" | "upi" | string;
    status: string;
    collected_at: string | null;
  }[];
}

interface Props {
  locationId: string;
  locationName: string;
  initial: BillRow[];
  tables?: { id: string; name: string; type: string; hourly_rate: number }[];
  inventoryItems?: { id: string; name: string; category: string; selling_price: number; stock_count: number }[];
  locationOpeningTime?: string;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function tableNameOf(t: BillRow["items"][number]["table"]): string {
  if (!t) return "Table";
  if (Array.isArray(t)) return t[0]?.name ?? "Table";
  return t.name;
}

export function BillsContent({
  locationId,
  locationName,
  initial,
  tables = [],
  inventoryItems = [],
  locationOpeningTime = "10:00",
}: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BillRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualSessions, setManualSessions] = useState<{ id: string; tableId: string; hours: number }[]>([]);
  const [manualExtras, setManualExtras] = useState<{ id: string; itemId: string; quantity: number }[]>([]);
  const [manualPaymentMethod, setManualPaymentMethod] = useState<"cash" | "upi">("cash");
  const [manualSplitMode, setManualSplitMode] = useState(false);
  const [manualCashInput, setManualCashInput] = useState("");
  const [manualUpiInput, setManualUpiInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-balance helpers — typing in one field updates the other dynamically
  function changeManualCash(val: string) {
    const cleaned = val.replace(/[^\d.]/g, "");
    setManualCashInput(cleaned);
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) {
      setManualUpiInput(String(Math.max(0, Math.round((manualTotalPreview - n) * 100) / 100)));
    }
  }

  function changeManualUpi(val: string) {
    const cleaned = val.replace(/[^\d.]/g, "");
    setManualUpiInput(cleaned);
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) {
      setManualCashInput(String(Math.max(0, Math.round((manualTotalPreview - n) * 100) / 100)));
    }
  }

  function enterManualSplit() {
    setManualSplitMode(true);
    const half = Math.round((manualTotalPreview / 2) * 100) / 100;
    setManualCashInput(String(half));
    setManualUpiInput(String(Math.round((manualTotalPreview - half) * 100) / 100));
  }

  function exitManualSplit() {
    setManualSplitMode(false);
    setManualCashInput("");
    setManualUpiInput("");
  }

  type CustomerSuggestion = { phone: string; name: string | null; visit_count: number; points_balance: number };
  const [nameSuggestions,      setNameSuggestions]      = useState<CustomerSuggestion[]>([]);
  const [phoneSuggestions,     setPhoneSuggestions]     = useState<CustomerSuggestion[]>([]);
  const [showNameSuggestions,  setShowNameSuggestions]  = useState(false);
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const nameSearchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameSearchAbort   = useRef<AbortController | null>(null);
  const phoneSearchTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phoneSearchAbort  = useRef<AbortController | null>(null);

  function handleManualPhoneChange(val: string) {
    const cleaned = val.replace(/\D/g, "").slice(0, 10);
    setManualPhone(cleaned);

    if (phoneSearchTimer.current) clearTimeout(phoneSearchTimer.current);
    if (phoneSearchAbort.current) phoneSearchAbort.current.abort();

    if (cleaned.length === 10) {
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
      
      const lookupTimer = setTimeout(async () => {
        const res  = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(cleaned)}`);
        const data = await res.json() as { found: boolean; customer: CustomerSuggestion | null };
        if (data.found && data.customer?.name && !manualName.trim()) {
          setManualName(data.customer.name);
        }
      }, 600);
      return;
    }

    if (cleaned.length < 3) {
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
      return;
    }
    phoneSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      phoneSearchAbort.current = controller;
      try {
        const res  = await fetch(`/api/customers/search?q=${encodeURIComponent(cleaned)}`, { signal: controller.signal });
        const body = await res.json() as
          | { success: true;  data: CustomerSuggestion[] }
          | { success: false; error: string };
        if (body.success) {
          setPhoneSuggestions(body.data);
          setShowPhoneSuggestions(body.data.length > 0);
        }
      } catch {
        // Aborted or network — silent
      }
    }, 300);
  }

  function handleManualNameChange(val: string) {
    const cleaned = val.replace(/[^a-zA-Z\s]/g, "");
    setManualName(cleaned);

    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (nameSearchAbort.current) nameSearchAbort.current.abort();

    const q = cleaned.trim();
    if (q.length < 2) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      return;
    }

    nameSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      nameSearchAbort.current = controller;
      try {
        const res  = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const body = await res.json() as
          | { success: true; data: CustomerSuggestion[] }
          | { success: false; error: string };
        if (body.success) {
          setNameSuggestions(body.data);
          setShowNameSuggestions(body.data.length > 0);
        }
      } catch {
        // Aborted or network — silent
      }
    }, 300);
  }

  function pickSuggestion(s: CustomerSuggestion) {
    setManualName(s.name || "");
    setManualPhone(s.phone);
    setShowNameSuggestions(false);
    setShowPhoneSuggestions(false);
    setNameSuggestions([]);
    setPhoneSuggestions([]);
  }

  const openManualBillModal = () => {
    setManualName("");
    setManualPhone("");
    setManualSessions([]);
    setManualExtras([]);
    setManualPaymentMethod("cash");
    setManualSplitMode(false);
    setManualCashInput("");
    setManualUpiInput("");
    setNameSuggestions([]);
    setPhoneSuggestions([]);
    setShowNameSuggestions(false);
    setShowPhoneSuggestions(false);
    setManualOpen(true);
  };

  // Compute live manual total preview
  const manualTotalPreview = useMemo(() => {
    let sessionCost = 0;
    for (const s of manualSessions) {
      const tbl = tables.find((t) => t.id === s.tableId);
      if (tbl) {
        sessionCost += tbl.hourly_rate * (s.hours || 0);
      }
    }
    let extrasCost = 0;
    for (const e of manualExtras) {
      const item = inventoryItems.find((i) => i.id === e.itemId);
      if (item) {
        extrasCost += item.selling_price * (e.quantity || 0);
      }
    }
    return Math.round((sessionCost + extrasCost) * 100) / 100;
  }, [manualSessions, manualExtras, tables, inventoryItems]);

  // Auto-balance split inputs when total changes
  useEffect(() => {
    if (manualSplitMode) {
      const cashVal = parseFloat(manualCashInput) || 0;
      const newUpi = Math.max(0, Math.round((manualTotalPreview - cashVal) * 100) / 100);
      setManualUpiInput(String(newUpi));
    }
  }, [manualTotalPreview, manualSplitMode]);

   async function handleCreateManualBill(e: React.FormEvent) {
    e.preventDefault();
    if (!manualName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (manualPhone && !/^[6-9]\d{9}$/.test(manualPhone)) {
      toast.error("Enter a valid 10-digit Indian phone number starting with 6-9");
      return;
    }
    if (manualSessions.length === 0 && manualExtras.length === 0) {
      toast.error("Provide at least one table session or item");
      return;
    }

    let payments = [];
    if (manualSplitMode) {
      const cashVal = parseFloat(manualCashInput) || 0;
      const upiVal = parseFloat(manualUpiInput) || 0;
      const splitSum = cashVal + upiVal;
      if (Math.abs(splitSum - manualTotalPreview) > 0.5) {
        toast.error(`Split total ₹${splitSum} must equal ₹${manualTotalPreview}`);
        return;
      }
      if (cashVal > 0) payments.push({ method: "cash" as const, amount: cashVal });
      if (upiVal > 0) payments.push({ method: "upi" as const, amount: upiVal });
      if (payments.length === 0) {
        toast.error("Enter at least one payment amount for split");
        return;
      }
    } else {
      payments = [
        {
          method: manualPaymentMethod,
          amount: manualTotalPreview,
        },
      ];
    }

    setIsSubmitting(true);
    try {
      const payload = {
        location_id: locationId,
        customer_name: manualName,
        customer_phone: manualPhone || undefined,
        table_sessions: manualSessions.map((s) => {
          const tbl = tables.find((t) => t.id === s.tableId);
          const now = Date.now();
          const startStr = new Date(now - s.hours * 60 * 60 * 1000).toISOString();
          const endStr = new Date(now).toISOString();
          return {
            table_id: s.tableId,
            rate_per_hour: tbl?.hourly_rate ?? 0,
            start: startStr,
            end: endStr,
          };
        }),
        extras: manualExtras.map((e) => {
          const item = inventoryItems.find((i) => i.id === e.itemId);
          return {
            inventory_item_id: e.itemId,
            name: item?.name ?? "Item",
            price: item?.selling_price ?? 0,
            quantity: e.quantity,
          };
        }),
        payments,
        points_redeemed: 0,
      };

      const res = await fetch("/api/pos/manual-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error);
      }

      toast.success("Manual bill created successfully!");
      setManualName("");
      setManualPhone("");
      setManualSessions([]);
      setManualExtras([]);
      setManualPaymentMethod("cash");
      setManualSplitMode(false);
      setManualCashInput("");
      setManualUpiInput("");
      setManualOpen(false);

      queryClient.invalidateQueries({ queryKey: ["staff-bills"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to create manual bill");
    } finally {
      setIsSubmitting(false);
    }
  }

  const { data: bills = initial } = useQuery<BillRow[]>({
    queryKey: ["staff-bills", locationId, search],
    queryFn: async () => {
      const url = `/api/pos/bills?location_id=${locationId}${search ? `&q=${encodeURIComponent(search)}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json() as { success: true; data: BillRow[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: !search ? initial : undefined,
    initialDataUpdatedAt: !search ? Date.now() : undefined,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const totals = useMemo(() => {
    const count = bills.length;
    const revenue = bills.reduce((s, b) => s + (b.amount_due + b.advance_paid), 0);
    return { count, revenue };
  }, [bills]);

  async function handleSendWhatsApp(e: React.MouseEvent, bill: BillRow) {
    e.stopPropagation();
    if (!bill.customer_phone) {
      toast.error("Customer has no phone number attached");
      return;
    }
    setSendingId(bill.id);
    try {
      const res = await fetch(`/api/pos/bills/${bill.id}/send-whatsapp`, { method: "POST" });
      const body = await res.json();
      if (body.success) {
        toast.success("WhatsApp Bill link sent & opened!");
        if (body.data?.waMeUrl) {
          window.open(body.data.waMeUrl, "_blank");
        }
      } else {
        toast.error(body.error || "Failed to send WhatsApp bill");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to send WhatsApp bill");
    } finally {
      setSendingId(null);
    }
  }

  const groupedBills = useMemo(() => {
    const groups: { [dateStr: string]: BillRow[] } = {};
    for (const b of bills) {
      const dateKey = getOperatingDate(b.finalized_at, locationOpeningTime);
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(b);
    }
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return sortedDates.map((d) => ({
      dateStr: d,
      label: new Date(d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" }),
      items: groups[d],
    }));
  }, [bills, locationOpeningTime]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto w-full">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white">Bills</h1>
          <p className="text-base font-semibold opacity-70 mt-1">
            {locationName} · {totals.count} bill{totals.count === 1 ? "" : "s"} · {formatCurrency(totals.revenue)} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={openManualBillModal}
            className="bg-[#D4541A] hover:bg-[#c04b16] text-white rounded-xl h-14 px-6 text-sm font-black flex items-center gap-2 active:scale-95 transition-all"
          >
            <Plus className="h-5 w-5" />
            <span>New Manual Bill</span>
          </Button>

          <div className="relative">
            <Search className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 opacity-50" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="pl-12 w-80 h-14 text-base font-bold rounded-xl"
            />
          </div>
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center opacity-60">
          {search ? "No matching bills" : "No finalized bills yet at this location."}
        </div>
      ) : (
        <div className="space-y-8">
          {groupedBills.map((group) => (
            <div key={group.dateStr} className="space-y-4">
              <h2 className="text-2xl font-black text-gray-950 dark:text-white pt-2 border-b dark:border-[#222] pb-2">
                {group.label}
              </h2>
              <div className="rounded-2xl border overflow-hidden bg-white dark:bg-[#111]">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-[#181818] border-b dark:border-[#222]">
                    <tr>
                      <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">When</th>
                      <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Customer</th>
                      <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Tables</th>
                      <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Payment</th>
                      <th className="px-6 py-4 text-right font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Paid</th>
                      <th className="px-6 py-4 text-right font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Send Bill</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-[#222]">
                    {group.items.map((b) => {
                      const tablesList = b.items
                        .map((i) => tableNameOf(i.table))
                        .filter((n, idx, arr) => arr.indexOf(n) === idx)
                        .join(", ");
                      const total = b.amount_due + b.advance_paid;
                      const methods = b.payments
                        .filter((p) => p.status === "completed")
                        .map((p) => p.method)
                        .filter((m, idx, arr) => arr.indexOf(m) === idx);
                      return (
                        <tr
                          key={b.id}
                          onClick={() => setSelected(b)}
                          className="hover:bg-gray-50 dark:hover:bg-[#181818] cursor-pointer transition-colors"
                        >
                          <td className="px-6 py-5 font-mono text-base font-extrabold text-gray-800 dark:text-[#ddd]">
                            {fmtDateTime(b.finalized_at)}
                          </td>
                          <td className="px-6 py-5">
                            <p className="text-xl font-black text-gray-900 dark:text-white">
                              {b.customer_name ?? "—"}
                            </p>
                            {b.customer_phone && (
                              <p className="text-base font-extrabold text-gray-500 font-mono mt-0.5">
                                {b.customer_phone}
                              </p>
                            )}
                          </td>
                          <td className="px-6 py-5 text-lg font-extrabold text-gray-800 dark:text-[#ddd]">
                            {tablesList || "—"}
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex gap-2">
                              {methods.length === 0 ? "—" : methods.map((m) => (
                                <span
                                  key={m}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider"
                                  style={
                                    m === "cash"
                                      ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                                      : { background: "rgba(99,102,241,0.15)", color: "#6366f1" }
                                  }
                                >
                                  {m === "cash" ? <Banknote className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                                  {m}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right text-xl font-black tabular-nums text-gray-950 dark:text-white">
                            {formatCurrency(total)}
                          </td>
                          <td className="px-6 py-5 text-right">
                            {b.customer_phone ? (
                              <button
                                type="button"
                                disabled={sendingId === b.id}
                                onClick={(e) => handleSendWhatsApp(e, b)}
                                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 transition-all active:scale-95 disabled:opacity-40"
                                title="Send Bill link via WhatsApp"
                              >
                                <MessageSquare className="h-4 w-4" />
                                {sendingId === b.id ? "…" : "WhatsApp"}
                              </button>
                            ) : (
                              <span className="text-sm text-gray-400 italic font-extrabold">No phone</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <BillDetailModal
          bill={selected}
          onClose={() => setSelected(null)}
          onSendWhatsApp={(e) => handleSendWhatsApp(e, selected)}
          sending={sendingId === selected.id}
        />
      )}

      {manualOpen && (
        <Dialog open onOpenChange={(o) => !o && setManualOpen(false)}>
          <DialogContent className="max-w-7xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border dark:border-[#222] text-gray-900 dark:text-gray-100">
            <DialogHeader className="px-10 py-8 border-b border-gray-200 dark:border-[#1F1F1F]">
              <DialogTitle className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-3">
                New Manual Bill
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleCreateManualBill} className="max-h-[80vh] overflow-y-auto px-10 py-8 space-y-8">
              {/* Customer details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3 relative">
                  <label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer Name</label>
                  <Input
                    required
                    placeholder="Enter name"
                    value={manualName}
                    onChange={(e) => handleManualNameChange(e.target.value)}
                    onFocus={() => { if (nameSuggestions.length > 0) setShowNameSuggestions(true); }}
                    onBlur={() => {
                      setTimeout(() => setShowNameSuggestions(false), 150);
                    }}
                    autoComplete="off"
                    className="h-20 text-3xl px-6 rounded-2xl font-bold"
                  />
                  {showNameSuggestions && nameSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 z-20 rounded-xl overflow-hidden shadow-xl bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333]">
                      {nameSuggestions.map((s) => (
                        <button
                          key={s.phone}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-150 dark:hover:bg-[#222] border-b last:border-b-0 border-gray-100 dark:border-[#262626]"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-3xl font-black text-gray-900 dark:text-white truncate">
                              {s.name ?? "(no name)"}
                            </p>
                            <p className="text-xl font-extrabold text-gray-655 dark:text-[#ccc] font-mono mt-0.5">{s.phone}</p>
                          </div>
                          <span className="shrink-0 text-sm font-black uppercase tracking-wider px-3 py-2 rounded bg-amber-100 text-amber-850 dark:bg-amber-955/40 dark:text-amber-400">
                            {s.visit_count}× · {s.points_balance} pts
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-3 relative">
                  <label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer Phone (Optional)</label>
                  <Input
                    type="tel"
                    placeholder="Enter phone"
                    value={manualPhone}
                    onChange={(e) => handleManualPhoneChange(e.target.value)}
                    onFocus={() => { if (phoneSuggestions.length > 0) setShowPhoneSuggestions(true); }}
                    onBlur={() => {
                      setTimeout(() => setShowPhoneSuggestions(false), 150);
                    }}
                    autoComplete="off"
                    className="h-20 text-3xl px-6 rounded-2xl font-bold"
                  />
                  {showPhoneSuggestions && phoneSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 z-20 rounded-xl overflow-hidden shadow-xl bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333]">
                      {phoneSuggestions.map((s) => (
                        <button
                          key={s.phone}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-150 dark:hover:bg-[#222] border-b last:border-b-0 border-gray-100 dark:border-[#262626]"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-2xl font-black text-gray-900 dark:text-white truncate">
                              {s.name ?? "(no name)"}
                            </p>
                            <p className="text-lg font-extrabold text-gray-655 dark:text-[#ccc] font-mono mt-0.5">{s.phone}</p>
                          </div>
                          <span className="shrink-0 text-sm font-black uppercase tracking-wider px-3 py-2 rounded bg-amber-100 text-amber-850 dark:bg-amber-955/40 dark:text-amber-400">
                            {s.visit_count}× · {s.points_balance} pts
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Table Sessions */}
              <div className="space-y-4 border-t border-gray-200 dark:border-[#222] pt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-1.5">Table Sessions</h3>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setManualSessions([...manualSessions, { id: crypto.randomUUID(), tableId: tables[0]?.id ?? "", hours: 1 }])}
                    className="h-16 px-8 text-base rounded-2xl font-black border-gray-300 dark:border-gray-700"
                    disabled={tables.length === 0}
                  >
                    <Plus className="h-5 w-5" /> Add Session
                  </Button>
                </div>

                {manualSessions.map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-4 border border-gray-200 dark:border-[#222] p-4 rounded-2xl bg-gray-50/50 dark:bg-[#161616]">
                    <div className="flex-1">
                      <Select
                        value={s.tableId}
                        onValueChange={(val) => {
                          const updated = [...manualSessions];
                          updated[idx].tableId = val;
                          setManualSessions(updated);
                        }}
                      >
                        <SelectTrigger className="h-20 text-2xl px-6 rounded-2xl font-bold bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                          <SelectValue placeholder="Select Table" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                          {tables.map((t) => (
                            <SelectItem key={t.id} value={t.id} className="text-xl">
                              {t.name} (₹{t.hourly_rate}/hr)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-64 space-y-2">
                      <Input
                        type="number"
                        step="0.1"
                        min="0.1"
                        placeholder="Hours"
                        value={s.hours}
                        onChange={(e) => {
                          const updated = [...manualSessions];
                          updated[idx].hours = parseFloat(e.target.value) || 0;
                          setManualSessions(updated);
                        }}
                        className="h-20 text-2xl px-6 rounded-2xl font-bold text-center"
                      />
                      <div className="flex gap-1 justify-center">
                        {[
                          { label: "30m", val: 0.5 },
                          { label: "1h", val: 1.0 },
                          { label: "2h", val: 2.0 },
                          { label: "3h", val: 3.0 },
                        ].map((btn) => (
                          <button
                            key={btn.label}
                            type="button"
                            onClick={() => {
                              const updated = [...manualSessions];
                              updated[idx].hours = btn.val;
                              setManualSessions(updated);
                            }}
                            className={`flex-1 text-sm font-black py-2.5 px-1.5 rounded-xl border text-center transition-all ${
                              s.hours === btn.val
                                ? "bg-[#D4541A] text-white border-[#D4541A] shadow-sm"
                                : "bg-white dark:bg-[#1a1a1a] text-gray-550 dark:text-[#888] border-gray-250 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-[#222]"
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setManualSessions(manualSessions.filter((x) => x.id !== s.id))}
                      className="h-20 w-20 p-0 text-red-500 hover:text-red-700 bg-gray-50 dark:bg-[#1f1f1f] rounded-2xl border border-gray-200 dark:border-gray-800 hover:bg-red-50 dark:hover:bg-red-950/20"
                    >
                      <Trash className="h-6 w-6" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Extras / Inventory */}
              <div className="space-y-4 border-t border-gray-200 dark:border-[#222] pt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-1.5">Items / Beverages</h3>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setManualExtras([...manualExtras, { id: crypto.randomUUID(), itemId: inventoryItems[0]?.id ?? "", quantity: 1 }])}
                    className="h-16 px-8 text-base rounded-2xl font-black border-gray-300 dark:border-gray-700"
                    disabled={inventoryItems.length === 0}
                  >
                    <Plus className="h-5 w-5" /> Add Item
                  </Button>
                </div>

                {manualExtras.map((e, idx) => (
                  <div key={e.id} className="flex items-center gap-4 border border-gray-200 dark:border-[#222] p-4 rounded-2xl bg-gray-50/50 dark:bg-[#161616]">
                    <div className="flex-1">
                      <Select
                        value={e.itemId}
                        onValueChange={(val) => {
                          const updated = [...manualExtras];
                          updated[idx].itemId = val;
                          setManualExtras(updated);
                        }}
                      >
                        <SelectTrigger className="h-20 text-2xl px-6 rounded-2xl font-bold bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                          <SelectValue placeholder="Select Item" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                          {inventoryItems.map((item) => (
                            <SelectItem key={item.id} value={item.id} className="text-xl">
                              {item.name} (₹{item.selling_price})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-44">
                      <Input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={e.quantity}
                        onChange={(e) => {
                          const updated = [...manualExtras];
                          updated[idx].quantity = parseInt(e.target.value) || 0;
                          setManualExtras(updated);
                        }}
                        className="h-20 text-2xl px-6 rounded-2xl font-bold text-center"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setManualExtras(manualExtras.filter((x) => x.id !== e.id))}
                      className="h-20 w-20 p-0 text-red-500 hover:text-red-700 bg-gray-50 dark:bg-[#1f1f1f] rounded-2xl border border-gray-200 dark:border-gray-800 hover:bg-red-50 dark:hover:bg-red-950/20"
                    >
                      <Trash className="h-6 w-6" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Payment Method */}
              <div className="space-y-4 border-t border-gray-200 dark:border-[#222] pt-6">
                <div className="flex items-center justify-between">
                  <label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Payment Method</label>
                  <button
                    type="button"
                    onClick={manualSplitMode ? exitManualSplit : enterManualSplit}
                    className="text-base font-black text-[#D4541A] hover:underline"
                  >
                    {manualSplitMode ? "← Single Method" : "Split between Cash + UPI"}
                  </button>
                </div>

                {manualSplitMode ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-500">Cash Amount (₹)</label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={manualCashInput}
                          onChange={(e) => changeManualCash(e.target.value)}
                          className="h-16 text-xl px-5 font-bold rounded-xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-500">UPI Amount (₹)</label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={manualUpiInput}
                          onChange={(e) => changeManualUpi(e.target.value)}
                          className="h-16 text-xl px-5 font-bold rounded-xl"
                        />
                      </div>
                    </div>
                    <div
                      className="text-base font-black text-center mt-2"
                      style={{
                        color:
                          Math.abs((parseFloat(manualCashInput) || 0) + (parseFloat(manualUpiInput) || 0) - manualTotalPreview) <= 0.5
                            ? "#10b981"
                            : "#ef4444",
                      }}
                    >
                      Split sum: {formatCurrency((parseFloat(manualCashInput) || 0) + (parseFloat(manualUpiInput) || 0))} / {formatCurrency(manualTotalPreview)}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setManualPaymentMethod("cash")}
                      className={`flex-1 h-20 rounded-2xl text-xl font-black border transition-all active:scale-95 flex items-center justify-center gap-2 ${
                        manualPaymentMethod === "cash"
                          ? "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 ring-2 ring-emerald-300"
                          : "bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <Banknote className="h-6 w-6" /> Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualPaymentMethod("upi")}
                      className={`flex-1 h-20 rounded-2xl text-xl font-black border transition-all active:scale-95 flex items-center justify-center gap-2 ${
                        manualPaymentMethod === "upi"
                          ? "bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-400 ring-2 ring-indigo-300"
                          : "bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <Smartphone className="h-6 w-6" /> UPI
                    </button>
                  </div>
                )}
              </div>

              {/* Live Preview */}
              <div className="border-t border-gray-200 dark:border-[#222] pt-6 flex items-center justify-between">
                <span className="text-2xl font-extrabold text-gray-450 dark:text-gray-400">Total Billed:</span>
                <span className="text-4xl font-black text-[#D4541A]">{formatCurrency(manualTotalPreview)}</span>
              </div>

              <div className="pt-4 flex items-center gap-4">
                <Button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  className="flex-1 h-20 rounded-2xl text-xl font-black bg-white dark:bg-[#1f1f1f] text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-[#333] hover:bg-gray-100 dark:hover:bg-[#252525]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-[#D4541A] hover:bg-[#c04b16] text-white rounded-2xl h-20 text-xl font-black"
                >
                  {isSubmitting ? "Saving..." : "Create & Finalize Bill"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Detail modal — read-only view of a finalized bill
// ────────────────────────────────────────────────────────────────────────────
function BillDetailModal({
  bill, onClose, onSendWhatsApp, sending,
}: {
  bill: BillRow;
  onClose: () => void;
  onSendWhatsApp: (e: React.MouseEvent) => void;
  sending?: boolean;
}) {
  const activeExtras = bill.extras.filter((e) => !e.is_deleted);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border dark:border-[#222]">
        <DialogHeader className="px-5 py-4 border-b dark:border-[#222]">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            Bill <span className="font-mono text-xs opacity-60">#{bill.id.slice(0, 8)}</span>
            <span className="ml-auto text-xs font-normal opacity-60">{fmtDateTime(bill.finalized_at)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto">
          {/* Customer */}
          <section className="px-5 py-4 border-b dark:border-[#222] flex items-center justify-between">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Customer</h3>
              <p className="font-semibold text-base text-gray-900 dark:text-white">{bill.customer_name ?? "—"}</p>
              {bill.customer_phone && (
                <p className="text-sm font-mono text-gray-700 dark:text-[#aaa] mt-0.5">{bill.customer_phone}</p>
              )}
            </div>
            {bill.customer_phone && (
              <button
                type="button"
                disabled={sending}
                onClick={onSendWhatsApp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 transition-all active:scale-95"
              >
                <MessageSquare className="h-4 w-4" />
                {sending ? "Sending…" : "Send WhatsApp Bill"}
              </button>
            )}
          </section>

          {/* Tables */}
          <section className="px-5 py-4 border-b dark:border-[#222] space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Tables</h3>
            <ul className="space-y-1.5 text-sm">
              {bill.items.map((it) => {
                const tn = tableNameOf(it.table);
                const mins = it.actual_start && it.actual_end
                  ? Math.round((new Date(it.actual_end).getTime() - new Date(it.actual_start).getTime()) / 60000)
                  : null;
                return (
                  <li key={it.id} className="flex justify-between gap-3">
                    <span className="font-medium">
                      {tn}
                      {mins != null && <span className="opacity-60 font-normal"> · {mins}m</span>}
                      {it.num_people && <span className="opacity-60 font-normal"> · {it.num_people} ppl</span>}
                    </span>
                    <span className="tabular-nums font-semibold">
                      {formatCurrency(it.final_amount ?? 0)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Extras */}
          {activeExtras.length > 0 && (
            <section className="px-5 py-4 border-b dark:border-[#222] space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Extras</h3>
              <ul className="space-y-1.5 text-sm">
                {activeExtras.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span className="font-medium">
                      {e.name}
                      {e.quantity > 1 && <span className="opacity-60 font-normal"> × {e.quantity}</span>}
                    </span>
                    <span className="tabular-nums font-semibold">{formatCurrency(e.price * e.quantity)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Totals */}
          <section className="px-5 py-4 border-b dark:border-[#222] text-sm space-y-1.5">
            <div className="flex justify-between"><span className="opacity-70">Subtotal</span><span className="tabular-nums">{formatCurrency(bill.subtotal)}</span></div>
            {(() => {
              const pubDisc = bill.public_discount_amount ?? 0;
              const memDisc = Math.max(0, bill.discount_amount - pubDisc);
              return (
                <>
                  {pubDisc > 0 && (
                    <div className="flex justify-between text-emerald-600"><span>Public Coupon / Discount</span><span className="tabular-nums">−{formatCurrency(pubDisc)}</span></div>
                  )}
                  {memDisc > 0 && (
                    <div className="flex justify-between text-purple-600 dark:text-purple-400 font-medium"><span>Membership Discount / Free Hours</span><span className="tabular-nums">−{formatCurrency(memDisc)}</span></div>
                  )}
                  {pubDisc === 0 && memDisc === 0 && bill.discount_amount > 0 && (
                    <div className="flex justify-between text-emerald-600"><span>Discount</span><span className="tabular-nums">−{formatCurrency(bill.discount_amount)}</span></div>
                  )}
                </>
              );
            })()}
            {bill.advance_paid > 0 && (
              <div className="flex justify-between text-emerald-600"><span>Advance paid</span><span className="tabular-nums">−{formatCurrency(bill.advance_paid)}</span></div>
            )}
            {bill.points_redeemed > 0 && (
              <div className="flex justify-between text-amber-600"><span>Points redeemed ({bill.points_redeemed} pts)</span><span className="tabular-nums">−{formatCurrency(bill.points_redeemed)}</span></div>
            )}
            <div className="flex justify-between pt-2 border-t dark:border-[#222] font-bold text-base">
              <span>Collected at venue</span>
              <span className="tabular-nums text-[#D4541A]">{formatCurrency(bill.amount_due)}</span>
            </div>
          </section>

          {/* Payments */}
          <section className="px-5 py-4 space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Payments</h3>
            <ul className="space-y-2 text-sm">
              {bill.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="tabular-nums font-bold w-24">{formatCurrency(p.amount)}</span>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide"
                    style={
                      p.method === "cash"
                        ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                        : { background: "rgba(99,102,241,0.15)", color: "#6366f1" }
                    }
                  >
                    {p.method === "cash" ? <Banknote className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                    {p.method}
                  </span>
                  <span className="ml-auto text-xs opacity-60">
                    {p.status === "completed" && p.collected_at ? fmtDateTime(p.collected_at) : p.status}
                  </span>
                </li>
              ))}
              {bill.payments.length === 0 && (
                <li className="text-xs opacity-60 italic">No payment records (this bill may have been settled by advance).</li>
              )}
            </ul>
          </section>
        </div>

        <div className="px-5 py-3 border-t dark:border-[#222] flex items-center justify-between bg-gray-50 dark:bg-[#161616]">
          <a
            href={`/bill/${bill.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View Public Bill Link
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-md text-sm font-semibold bg-white dark:bg-[#222] border dark:border-gray-800 hover:bg-gray-100"
            >
              <X className="h-4 w-4 inline mr-1" /> Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { Phone };
