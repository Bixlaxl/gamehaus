"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { groupOrders } from "@/lib/billing/grouping";
import { subscribeToPOS } from "@/lib/realtime/subscriptions";
import { Search, X, Banknote, Smartphone, Phone, MessageSquare, ExternalLink, Plus, Trash } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FinalizeBillModal } from "@/components/pos/finalize-bill-modal";
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
  points_redeemed_online: number;
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
  tables?: { id: string; name: string; type: string; hourly_rate: number; modes?: any; people_pricing?: any }[];
  inventoryItems?: { id: string; name: string; category: string; selling_price: number; stock_count: number }[];
  locationOpeningTime?: string;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
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
  const setFinalizeOrderId = usePOSStore((s) => s.setFinalizeOrderId);
  const [billTab, setBillTab] = useState<"unpaid" | "finalized">("unpaid");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BillRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Fetch active open orders for the Unpaid Bill Feed
  const { data: openOrders = [] } = useQuery<BillRow[]>({
    queryKey: ["pos-orders", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/pos/orders?locationId=${locationId}`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });

  const setOpenOrders = usePOSStore((s) => s.setOpenOrders);
  const handleOrderItemChange = usePOSStore((s) => s.handleOrderItemChange);
  const handleOrderChange = usePOSStore((s) => s.handleOrderChange);
  const handleTableChange = usePOSStore((s) => s.handleTableChange);

  const openOrdersZustand = usePOSStore((s) => s.openOrders);

  // Synchronize React Query fetched openOrders into the Zustand store
  useEffect(() => {
    if (openOrders && openOrders.length > 0) {
      setOpenOrders(openOrders as any);
    }
  }, [openOrders, setOpenOrders]);

  // Subscribe to Supabase Realtime channel
  useEffect(() => {
    const unsubscribe = subscribeToPOS(locationId, {
      handleOrderItemChange,
      handleOrderChange,
      handleTableChange,
      onBookingsChange: () => {
        queryClient.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      },
      onExtrasChange: () => {
        queryClient.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      }
    });
    return unsubscribe;
  }, [locationId, handleOrderItemChange, handleOrderChange, handleTableChange, queryClient]);

  const openOrdersToUse = openOrdersZustand.length > 0 ? openOrdersZustand : openOrders;

  const groupedOpenOrders = useMemo(() => {
    return groupOrders(openOrdersToUse as any[]);
  }, [openOrdersToUse]);

  // Filter open orders locally based on search
  const filteredOpenOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (groupedOpenOrders as any[]).filter((o) => {
      const hasContent = (o.items && o.items.length > 0) || (o.extras && o.extras.length > 0);
      if (!hasContent) return false;
      if (!q) return true;
      const name = (o.customer_name ?? "").toLowerCase();
      const phone = o.customer_phone ?? "";
      return name.includes(q) || phone.includes(q);
    });
  }, [groupedOpenOrders, search]);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualSessions, setManualSessions] = useState<{ id: string; tableId: string; hours: number; numPeople?: number; selectedModeName?: string }[]>([]);
  const [manualExtras, setManualExtras] = useState<{ id: string; itemId: string; quantity: number }[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
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
        let baseRate = tbl.hourly_rate;
        let pp: Record<string, number> = (tbl as any).people_pricing ?? {};

        if (s.selectedModeName && (tbl as any).modes && Array.isArray((tbl as any).modes)) {
          const mode = ((tbl as any).modes as any[]).find((m) => m.name === s.selectedModeName);
          if (mode) {
            baseRate = Number(mode.hourly_rate);
            pp = (mode.people_pricing ?? {}) as Record<string, number>;
          }
        }

        const peopleKey = String(s.numPeople ?? 2);
        const rate = pp[peopleKey] != null ? Number(pp[peopleKey]) : baseRate;
        sessionCost += rate * (s.hours || 0);
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
          let baseRate = tbl?.hourly_rate ?? 0;
          let pp: Record<string, number> = (tbl as any)?.people_pricing ?? {};

          if (s.selectedModeName && (tbl as any)?.modes && Array.isArray((tbl as any).modes)) {
            const mode = ((tbl as any).modes as any[]).find((m) => m.name === s.selectedModeName);
            if (mode) {
              baseRate = Number(mode.hourly_rate);
              pp = (mode.people_pricing ?? {}) as Record<string, number>;
            }
          }

          const peopleKey = String(s.numPeople ?? 2);
          const rate = pp[peopleKey] != null ? Number(pp[peopleKey]) : baseRate;

          const now = Date.now();
          const startStr = new Date(now - s.hours * 60 * 60 * 1000).toISOString();
          const endStr = new Date(now).toISOString();
          return {
            table_id: s.tableId,
            rate_per_hour: rate,
            start: startStr,
            end: endStr,
            num_people: s.numPeople ?? null,
            selected_mode_name: s.selectedModeName ?? null,
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

      {/* Tabs Selector */}
      <div className="flex border-b border-gray-200 dark:border-[#222] pb-px">
        <button
          type="button"
          onClick={() => setBillTab("unpaid")}
          className={`px-6 py-3.5 text-lg font-black tracking-tight border-b-2 transition-all ${
            billTab === "unpaid"
              ? "border-[#D4541A] text-[#D4541A]"
              : "border-transparent text-gray-550 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Unpaid / Active Tabs ({filteredOpenOrders.length})
        </button>
        <button
          type="button"
          onClick={() => setBillTab("finalized")}
          className={`px-6 py-3.5 text-lg font-black tracking-tight border-b-2 transition-all ${
            billTab === "finalized"
              ? "border-[#D4541A] text-[#D4541A]"
              : "border-transparent text-gray-550 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Collected Bills ({bills.length})
        </button>
      </div>

      {billTab === "unpaid" ? (
        filteredOpenOrders.length === 0 ? (
          <div className="rounded-2xl border p-12 text-center opacity-60">
            {search ? "No matching unpaid bills" : "No unpaid bills or active tabs at this location."}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border overflow-hidden bg-white dark:bg-[#111]">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-[#181818] border-b dark:border-[#222]">
                  <tr>
                    <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Checked In</th>
                    <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Customer</th>
                    <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Status / Tables</th>
                    <th className="px-6 py-4 text-left font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Type</th>
                    <th className="px-6 py-4 text-right font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Total Billed</th>
                    <th className="px-6 py-4 text-right font-extrabold text-gray-700 dark:text-[#aaa] uppercase text-xs tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-[#222]">
                  {filteredOpenOrders.map((o) => {
                    const tablesList = (o.items ?? [])
                      .map((i: any) => tableNameOf(i.table))
                      .filter((n: any, idx: any, arr: any) => arr.indexOf(n) === idx)
                      .join(", ");
                    const isAnyRunning = (o.items ?? []).some((i: any) => i.status === "running");
                    const isAnyScheduled = (o.items ?? []).some((i: any) => i.status === "scheduled");
                    
                    let subtotal = 0;
                    for (const item of o.items ?? []) {
                      if (item.status === "running" || item.status === "finished") {
                        const start = new Date(item.actual_start ?? o.created_at).getTime();
                        const end = item.actual_end ? new Date(item.actual_end).getTime() : Date.now();
                        const durationHrs = Math.max(0, (end - start) / 3600000);
                        subtotal += durationHrs * item.rate_per_hour;
                      }
                    }
                    for (const extra of o.extras ?? []) {
                      if (!extra.is_deleted) {
                        subtotal += extra.price * extra.quantity;
                      }
                    }
                    subtotal = Math.round(subtotal * 100) / 100;
                    
                    return (
                      <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-[#181818] transition-colors">
                        <td className="px-6 py-5 font-mono text-base font-extrabold text-gray-800 dark:text-[#ddd]">
                          {fmtDateTime(o.created_at)}
                        </td>
                        <td className="px-6 py-5">
                          <p className="text-xl font-black text-gray-900 dark:text-white">
                            {o.customer_name ?? "—"}
                          </p>
                          {o.customer_phone && (
                            <p className="text-base font-extrabold text-gray-500 font-mono mt-0.5">
                              {o.customer_phone}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1">
                            <span className="text-lg font-extrabold text-gray-800 dark:text-[#ddd]">
                              {tablesList || "(Extras only)"}
                            </span>
                            <span
                              className="self-start text-xs font-black px-2 py-1 rounded-md uppercase tracking-wider"
                              style={
                                isAnyRunning
                                  ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                                  : isAnyScheduled
                                  ? { background: "rgba(59,130,246,0.15)", color: "#3b82f6" }
                                  : { background: "rgba(245,158,11,0.15)", color: "#f59e0b" }
                              }
                            >
                              {isAnyRunning ? "Playing" : isAnyScheduled ? "Scheduled" : "Session Ended"}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider"
                            style={
                              o.type === "walk_in"
                                ? { background: "rgba(59,130,246,0.15)", color: "#3b82f6" }
                                : { background: "rgba(168,85,247,0.15)", color: "#a855f7" }
                            }
                          >
                            {o.type}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right text-xl font-black tabular-nums text-gray-950 dark:text-white">
                          {formatCurrency(subtotal)}
                        </td>
                        <td className="px-6 py-5 text-right">
                          <Button
                            type="button"
                            onClick={() => setFinalizeOrderId(o.id)}
                            className="bg-[#D4541A] hover:bg-[#c04b16] text-white rounded-xl h-11 px-5 text-sm font-black transition-all active:scale-95 shadow"
                          >
                            Collect Bill
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        bills.length === 0 ? (
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
        )
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
                    onClick={() => {
                      const firstTable = tables[0];
                      const firstMode = firstTable?.modes && Array.isArray(firstTable.modes) && firstTable.modes.length > 0
                        ? (firstTable.modes as any[])[0].name
                        : undefined;
                      setManualSessions([
                        ...manualSessions,
                        {
                          id: crypto.randomUUID(),
                          tableId: firstTable?.id ?? "",
                          hours: 1,
                          numPeople: 2,
                          selectedModeName: firstMode,
                        }
                      ]);
                    }}
                    className="h-16 px-8 text-base rounded-2xl font-black border-gray-300 dark:border-gray-700"
                    disabled={tables.length === 0}
                  >
                    <Plus className="h-5 w-5" /> Add Session
                  </Button>
                </div>

                {manualSessions.map((s, idx) => {
                  const tbl = tables.find((t) => t.id === s.tableId);
                  const isPs5 = tbl?.type?.toLowerCase() === "ps5";
                  const modesList = tbl?.modes && Array.isArray(tbl.modes) ? (tbl.modes as any[]) : [];
                  const hoursPart = Math.floor(s.hours);
                  const minsPart = Math.round((s.hours - hoursPart) * 60);

                  return (
                    <div key={s.id} className="border border-gray-200 dark:border-[#222] p-6 rounded-2xl bg-gray-50/50 dark:bg-[#161616] space-y-5 text-left">
                      {/* Header row: Table selection, optional Mode selection, and Delete button */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <div className={`${modesList.length > 0 ? "md:col-span-6" : "md:col-span-10"}`}>
                          <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">Table / Console</label>
                          <Select
                            value={s.tableId}
                            onValueChange={(val) => {
                              const updated = [...manualSessions];
                              const newTbl = tables.find((t) => t.id === val);
                              const newModes = newTbl?.modes && Array.isArray(newTbl.modes) ? (newTbl.modes as any[]) : [];
                              updated[idx].tableId = val;
                              updated[idx].selectedModeName = newModes.length > 0 ? newModes[0].name : undefined;
                              setManualSessions(updated);
                            }}
                          >
                            <SelectTrigger className="h-16 text-xl px-5 rounded-xl font-bold bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                              <SelectValue placeholder="Select Table" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                              {tables.map((t) => (
                                <SelectItem key={t.id} value={t.id} className="text-lg">
                                  {t.name} (₹{t.hourly_rate}/hr)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {modesList.length > 0 && (
                          <div className="md:col-span-4">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">Mode</label>
                            <Select
                              value={s.selectedModeName ?? ""}
                              onValueChange={(val) => {
                                const updated = [...manualSessions];
                                updated[idx].selectedModeName = val;
                                setManualSessions(updated);
                              }}
                            >
                              <SelectTrigger className="h-16 text-xl px-5 rounded-xl font-bold bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                                <SelectValue placeholder="Select Mode" />
                              </SelectTrigger>
                              <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                                {modesList.map((m) => (
                                  <SelectItem key={m.name} value={m.name} className="text-lg">
                                    {m.name} (₹{m.hourly_rate}/hr)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        <div className="md:col-span-2 flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setManualSessions(manualSessions.filter((x) => x.id !== s.id))}
                            className="h-16 w-16 p-0 text-red-500 hover:text-red-700 bg-white dark:bg-[#1f1f1f] rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-red-50 dark:hover:bg-red-950/20 shadow-sm"
                          >
                            <Trash className="h-5 w-5" />
                          </Button>
                        </div>
                      </div>

                      {/* Main grid fields: Duration & Players/Controllers */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Time duration inputs */}
                        <div className="space-y-2">
                          <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">Duration</label>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center bg-white dark:bg-[#181818] border border-gray-200 dark:border-gray-800 rounded-xl px-4 h-16">
                              <input
                                type="number"
                                min="0"
                                max="23"
                                placeholder="0"
                                value={hoursPart || ""}
                                onChange={(e) => {
                                  const h = Math.max(0, parseInt(e.target.value) || 0);
                                  const updated = [...manualSessions];
                                  updated[idx].hours = h + minsPart / 60;
                                  setManualSessions(updated);
                                }}
                                className="w-full text-xl font-bold bg-transparent border-0 p-0 text-center focus:ring-0 focus:outline-none text-gray-900 dark:text-white"
                              />
                              <span className="text-sm font-bold text-gray-400 ml-1">hrs</span>
                            </div>

                            <div className="flex-1 flex items-center bg-white dark:bg-[#181818] border border-gray-200 dark:border-gray-800 rounded-xl px-4 h-16">
                              <input
                                type="number"
                                min="0"
                                max="59"
                                placeholder="0"
                                value={minsPart || ""}
                                onChange={(e) => {
                                  const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                  const updated = [...manualSessions];
                                  updated[idx].hours = hoursPart + m / 60;
                                  setManualSessions(updated);
                                }}
                                className="w-full text-xl font-bold bg-transparent border-0 p-0 text-center focus:ring-0 focus:outline-none text-gray-900 dark:text-white"
                              />
                              <span className="text-sm font-bold text-gray-400 ml-1">mins</span>
                            </div>
                          </div>

                          {/* Quick presets */}
                          <div className="flex gap-1.5 pt-1.5">
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
                                className={`flex-1 text-xs font-black py-2 rounded-lg border text-center transition-all ${
                                  Math.abs(s.hours - btn.val) < 0.01
                                    ? "bg-[#D4541A] text-white border-[#D4541A] shadow-sm"
                                    : "bg-white dark:bg-[#1a1a1a] text-gray-500 dark:text-[#888] border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-[#222]"
                                }`}
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Players / Controllers count */}
                        <div className="space-y-2">
                          <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">
                            {isPs5 ? "Controllers" : "Players Count"}
                          </label>
                          <div className="flex items-center justify-between bg-white dark:bg-[#181818] border border-gray-200 dark:border-gray-800 rounded-xl px-4 h-16">
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...manualSessions];
                                updated[idx].numPeople = Math.max(1, (s.numPeople ?? 2) - 1);
                                setManualSessions(updated);
                              }}
                              className="text-gray-500 hover:text-gray-800 dark:hover:text-white px-2 py-1 text-2xl font-bold"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              placeholder="2"
                              value={s.numPeople ?? 2}
                              onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value) || 1);
                                const updated = [...manualSessions];
                                updated[idx].numPeople = val;
                                setManualSessions(updated);
                              }}
                              className="w-full text-xl font-bold bg-transparent border-0 p-0 text-center focus:ring-0 focus:outline-none text-gray-900 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...manualSessions];
                                updated[idx].numPeople = (s.numPeople ?? 2) + 1;
                                setManualSessions(updated);
                              }}
                              className="text-gray-500 hover:text-gray-800 dark:hover:text-white px-2 py-1 text-2xl font-bold"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Extras / Inventory */}
              <div className="space-y-4 border-t border-gray-200 dark:border-[#222] pt-6 text-left">
                <h3 className="text-2xl font-black text-gray-800 dark:text-white flex items-center gap-1.5">Items / Beverages</h3>
                
                {/* Search & Add Box */}
                <div className="relative">
                  <Search className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 opacity-50" />
                  <Input
                    type="text"
                    placeholder="Type to search and add drinks or snacks (e.g. Water, Coke)..."
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    className="pl-12 h-16 text-lg font-bold rounded-xl"
                  />
                  
                  {itemSearchQuery.trim() && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-60 overflow-y-auto rounded-xl shadow-xl bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333]">
                      {inventoryItems
                        .filter((item) => item.name.toLowerCase().includes(itemSearchQuery.toLowerCase()))
                        .slice(0, 5)
                        .map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              const existingIdx = manualExtras.findIndex((x) => x.itemId === item.id);
                              if (existingIdx > -1) {
                                const updated = [...manualExtras];
                                updated[existingIdx].quantity += 1;
                                setManualExtras(updated);
                              } else {
                                setManualExtras([
                                  ...manualExtras,
                                  { id: crypto.randomUUID(), itemId: item.id, quantity: 1 },
                                ]);
                              }
                              setItemSearchQuery("");
                              toast.success(`Added ${item.name}`);
                            }}
                            className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-100 dark:hover:bg-[#222] border-b last:border-b-0 border-gray-100 dark:border-[#262626]"
                          >
                            <span className="text-lg font-bold text-gray-900 dark:text-white">{item.name}</span>
                            <span className="text-base font-extrabold text-gray-500 font-mono">₹{item.selling_price}</span>
                          </button>
                        ))}
                      {inventoryItems.filter((item) => item.name.toLowerCase().includes(itemSearchQuery.toLowerCase())).length === 0 && (
                        <div className="px-5 py-4 text-gray-500 text-sm font-semibold">No matching items found</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Added Extras List */}
                <div className="space-y-3">
                  {manualExtras.map((e, idx) => {
                    const item = inventoryItems.find((i) => i.id === e.itemId);
                    if (!item) return null;

                    return (
                      <div key={e.id} className="flex items-center gap-4 border border-gray-200 dark:border-[#222] p-4 rounded-xl bg-white dark:bg-[#161616] shadow-sm">
                        <div className="flex-1 min-w-0">
                          <p className="text-lg font-black text-gray-900 dark:text-white truncate">{item.name}</p>
                          <p className="text-sm font-extrabold text-gray-500 font-mono mt-0.5 font-bold">₹{item.selling_price} each</p>
                        </div>

                        {/* Quantity adjust */}
                        <div className="flex items-center bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-xl px-3 h-14 w-36">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...manualExtras];
                              updated[idx].quantity = Math.max(1, e.quantity - 1);
                              setManualExtras(updated);
                            }}
                            className="text-gray-500 hover:text-gray-800 dark:hover:text-white px-2 text-xl font-bold"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={e.quantity}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              const updated = [...manualExtras];
                              updated[idx].quantity = val;
                              setManualExtras(updated);
                            }}
                            className="w-full text-base font-bold bg-transparent border-0 p-0 text-center focus:ring-0 focus:outline-none text-gray-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...manualExtras];
                              updated[idx].quantity = e.quantity + 1;
                              setManualExtras(updated);
                            }}
                            className="text-gray-500 hover:text-gray-800 dark:hover:text-white px-2 text-xl font-bold"
                          >
                            +
                          </button>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setManualExtras(manualExtras.filter((x) => x.id !== e.id))}
                          className="h-14 w-14 p-0 text-red-500 hover:text-red-700 bg-gray-50 dark:bg-[#1f1f1f] rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-red-50 dark:hover:bg-red-950/20 shadow-sm"
                        >
                          <Trash className="h-5 w-5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
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

      <FinalizeBillModal locationId={locationId} />
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
          {(() => {
            const tableItemsSubtotal = (bill.items ?? []).reduce((sum: number, i: any) => sum + (Number(i.final_amount) || 0), 0);
            const extrasSubtotal = (bill.extras ?? []).filter((e: any) => !e.is_deleted).reduce((sum: number, e: any) => sum + (Number(e.price) * Number(e.quantity) || 0), 0);
            const displaySubtotal = Math.max(bill.subtotal, Math.round((tableItemsSubtotal + extrasSubtotal) * 100) / 100);
            const pubDisc = bill.public_discount_amount ?? 0;
            const memDisc = Math.max(0, bill.discount_amount - pubDisc);
            const computedDue = Math.max(0, Math.round((displaySubtotal - bill.discount_amount - (bill.advance_paid ?? 0) - (bill.points_redeemed ?? 0)) * 100) / 100);
            const displayDue = (bill.advance_paid ?? 0) > 0 && extrasSubtotal > 0 && bill.amount_due === 0 ? computedDue : bill.amount_due;
            return (
              <section className="px-5 py-4 border-b dark:border-[#222] text-sm space-y-1.5">
                <div className="flex justify-between"><span className="opacity-70">Subtotal</span><span className="tabular-nums">{formatCurrency(displaySubtotal)}</span></div>
                {pubDisc > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>Public Discount</span><span className="tabular-nums">−{formatCurrency(pubDisc)}</span></div>
                )}
                {memDisc > 0 && (
                  <div className="flex justify-between text-purple-600 dark:text-purple-400 font-medium"><span>Membership Discount</span><span className="tabular-nums">−{formatCurrency(memDisc)}</span></div>
                )}
                {pubDisc === 0 && memDisc === 0 && bill.discount_amount > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>Public Discount</span><span className="tabular-nums">−{formatCurrency(bill.discount_amount)}</span></div>
                )}
                {bill.advance_paid > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>Advance paid</span><span className="tabular-nums">−{formatCurrency(bill.advance_paid)}</span></div>
                )}
                {bill.points_redeemed_online > 0 && (
                  <div className="flex justify-between text-amber-600"><span>Points Redeemed (Online) ({bill.points_redeemed_online} pts)</span><span className="tabular-nums">−{formatCurrency(bill.points_redeemed_online)}</span></div>
                )}
                {bill.points_redeemed - (bill.points_redeemed_online ?? 0) > 0 && (
                  <div className="flex justify-between text-amber-600"><span>Points Redeemed (At Venue) ({bill.points_redeemed - (bill.points_redeemed_online ?? 0)} pts)</span><span className="tabular-nums">−{formatCurrency(bill.points_redeemed - (bill.points_redeemed_online ?? 0))}</span></div>
                )}
                <div className="flex justify-between pt-2 border-t dark:border-[#222] font-bold text-base">
                  <span>Collected at venue</span>
                  <span className="tabular-nums text-[#D4541A]">{formatCurrency(displayDue)}</span>
                </div>
              </section>
            );
          })()}

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
