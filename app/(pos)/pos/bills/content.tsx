"use client";

import { useMemo, useState } from "react";
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
import { formatCurrency } from "@/lib/utils";

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
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        payments: [
          {
            method: manualPaymentMethod,
            amount: manualTotalPreview,
          },
        ],
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

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bills</h1>
          <p className="text-sm opacity-70 mt-0.5">
            {locationName} · {totals.count} bill{totals.count === 1 ? "" : "s"} · {formatCurrency(totals.revenue)} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setManualOpen(true)}
            className="bg-[#D4541A] hover:bg-[#c04b16] text-white rounded-xl h-9 px-4 text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>New Manual Bill</span>
          </Button>

          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="pl-9 w-64"
            />
          </div>
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center opacity-60">
          {search ? "No matching bills" : "No finalized bills yet at this location."}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-white dark:bg-[#111]">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-[#181818] border-b dark:border-[#222]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-[#aaa] uppercase text-[11px] tracking-wide">When</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-[#aaa] uppercase text-[11px] tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-[#aaa] uppercase text-[11px] tracking-wide">Tables</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-[#aaa] uppercase text-[11px] tracking-wide">Payment</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-[#aaa] uppercase text-[11px] tracking-wide">Paid</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-[#aaa] uppercase text-[11px] tracking-wide">Send Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-[#222]">
              {bills.map((b) => {
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
                    <td className="px-4 py-3 font-mono text-sm font-medium">{fmtDateTime(b.finalized_at)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{b.customer_name ?? "—"}</p>
                      {b.customer_phone && <p className="text-xs opacity-70">{b.customer_phone}</p>}
                    </td>
                    <td className="px-4 py-3">{tablesList || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {methods.length === 0 ? "—" : methods.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
                            style={
                              m === "cash"
                                ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                                : { background: "rgba(99,102,241,0.15)", color: "#6366f1" }
                            }
                          >
                            {m === "cash" ? <Banknote className="h-2.5 w-2.5" /> : <Smartphone className="h-2.5 w-2.5" />}
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{formatCurrency(total)}</td>
                    <td className="px-4 py-3 text-right">
                      {b.customer_phone ? (
                        <button
                          type="button"
                          disabled={sendingId === b.id}
                          onClick={(e) => handleSendWhatsApp(e, b)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 transition-all active:scale-95 disabled:opacity-40"
                          title="Send Bill link via WhatsApp"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {sendingId === b.id ? "…" : "WhatsApp"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 italic">No phone</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <BillDetailModal
          bill={selected}
          onClose={() => setSelected(null)}
          onSendWhatsApp={(e) => handleSendWhatsApp(e, selected)}
          sending={sendingId === selected.id}
          onDelete={async () => {
            if (!confirm("Are you sure you want to delete this finalized bill? This will revert inventory stock and loyalty points.")) return;
            const res = await fetch(`/api/pos/bills/${selected.id}`, { method: "DELETE" });
            const body = await res.json();
            if (body.success) {
              toast.success("Bill deleted successfully!");
              setSelected(null);
              queryClient.invalidateQueries({ queryKey: ["staff-bills"] });
            } else {
              toast.error(body.error || "Failed to delete bill");
            }
          }}
        />
      )}

      {manualOpen && (
        <Dialog open onOpenChange={(o) => !o && setManualOpen(false)}>
          <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border dark:border-[#222] text-gray-900 dark:text-gray-100">
            <DialogHeader className="px-5 py-4 border-b dark:border-[#222]">
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                New Manual Bill
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleCreateManualBill} className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
              {/* Customer details */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Customer Name</label>
                  <Input
                    required
                    placeholder="Enter name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Customer Phone (Optional)</label>
                  <Input
                    placeholder="Enter phone"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {/* Table Sessions */}
              <div className="space-y-2 border-t dark:border-[#222] pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Table Sessions</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualSessions([...manualSessions, { id: crypto.randomUUID(), tableId: tables[0]?.id ?? "", hours: 1 }])}
                    className="h-8 px-2 text-xs flex items-center gap-1 border-gray-300 dark:border-gray-700"
                    disabled={tables.length === 0}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Session
                  </Button>
                </div>

                {manualSessions.map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-2 border dark:border-[#222] p-2 rounded-lg bg-gray-50/50 dark:bg-[#161616]">
                    <div className="flex-1">
                      <Select
                        value={s.tableId}
                        onValueChange={(val) => {
                          const updated = [...manualSessions];
                          updated[idx].tableId = val;
                          setManualSessions(updated);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                          <SelectValue placeholder="Select Table" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                          {tables.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name} (₹{t.hourly_rate}/hr)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-24">
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
                        className="h-8 text-xs text-right"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setManualSessions(manualSessions.filter((x) => x.id !== s.id))}
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-transparent"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Extras / Inventory */}
              <div className="space-y-2 border-t dark:border-[#222] pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Items / Beverages</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualExtras([...manualExtras, { id: crypto.randomUUID(), itemId: inventoryItems[0]?.id ?? "", quantity: 1 }])}
                    className="h-8 px-2 text-xs flex items-center gap-1 border-gray-300 dark:border-gray-700"
                    disabled={inventoryItems.length === 0}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Item
                  </Button>
                </div>

                {manualExtras.map((e, idx) => (
                  <div key={e.id} className="flex items-center gap-2 border dark:border-[#222] p-2 rounded-lg bg-gray-50/50 dark:bg-[#161616]">
                    <div className="flex-1">
                      <Select
                        value={e.itemId}
                        onValueChange={(val) => {
                          const updated = [...manualExtras];
                          updated[idx].itemId = val;
                          setManualExtras(updated);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                          <SelectValue placeholder="Select Item" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                          {inventoryItems.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} (₹{item.selling_price})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-20">
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
                        className="h-8 text-xs text-right"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setManualExtras(manualExtras.filter((x) => x.id !== e.id))}
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-transparent"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Payment Method */}
              <div className="space-y-1.5 border-t dark:border-[#222] pt-4">
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Payment Method</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setManualPaymentMethod("cash")}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                      manualPaymentMethod === "cash"
                        ? "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800"
                    }`}
                  >
                    <Banknote className="h-4 w-4" /> Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualPaymentMethod("upi")}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                      manualPaymentMethod === "upi"
                        ? "bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-400"
                        : "bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800"
                    }`}
                  >
                    <Smartphone className="h-4 w-4" /> UPI
                  </button>
                </div>
              </div>

              {/* Live Preview */}
              <div className="border-t dark:border-[#222] pt-4 flex items-center justify-between text-sm">
                <span className="font-semibold text-gray-500">Total Billed:</span>
                <span className="text-lg font-bold text-[#D4541A]">{formatCurrency(manualTotalPreview)}</span>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <Button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  variant="outline"
                  className="flex-1 rounded-xl h-10 border-gray-300 dark:border-gray-700"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-[#D4541A] hover:bg-[#c04b16] text-white rounded-xl h-10 font-bold"
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
  bill, onClose, onSendWhatsApp, sending, onDelete,
}: {
  bill: BillRow;
  onClose: () => void;
  onSendWhatsApp: (e: React.MouseEvent) => void;
  sending?: boolean;
  onDelete: () => Promise<void>;
}) {
  const activeExtras = bill.extras.filter((e) => !e.is_deleted);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

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
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-2 rounded-md text-sm font-semibold text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-950/20 dark:text-red-400 hover:bg-red-100 disabled:opacity-50 transition-all active:scale-95"
            >
              {deleting ? "Deleting…" : "Delete Bill"}
            </button>
            <button
              onClick={onClose}
              disabled={deleting}
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
