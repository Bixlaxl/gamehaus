"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Banknote, Smartphone, MessageSquare, MapPin, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatCurrency, getOperatingDate } from "@/lib/utils";
import type { BillRow } from "@/app/(pos)/pos/bills/content";

type LocationLite = { id: string; name: string; opening_time?: string };

interface Props {
  initialLocations: LocationLite[];
  initial: BillRow[];
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

export function OwnerBillsContent({ initialLocations, initial }: Props) {
  const queryClient = useQueryClient();
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BillRow | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    initialLocations.forEach((l) => map.set(l.id, l.name));
    return map;
  }, [initialLocations]);

  const { data: bills = initial } = useQuery<BillRow[]>({
    queryKey: ["owner-bills", selectedLocation, search],
    queryFn: async () => {
      let url = `/api/pos/bills?limit=100`;
      if (selectedLocation !== "all") {
        url += `&location_id=${selectedLocation}`;
      }
      if (search) {
        url += `&q=${encodeURIComponent(search)}`;
      }
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json()) as { success: true; data: BillRow[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: selectedLocation === "all" && !search ? initial : undefined,
    initialDataUpdatedAt: selectedLocation === "all" && !search ? Date.now() : undefined,
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

  async function handleDeleteBill(billId: string) {
    if (!confirm("Are you sure you want to delete this finalized bill? This will revert inventory stock and loyalty points.")) return;
    const res = await fetch(`/api/pos/bills/${billId}`, { method: "DELETE" });
    const body = await res.json();
    if (body.success) {
      toast.success("Bill deleted successfully!");
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["owner-bills"] });
    } else {
      toast.error(body.error || "Failed to delete bill");
    }
  }

  const earliestOpening = useMemo(() => {
    let minOpenMins = 600; // default 10:00
    if (initialLocations && initialLocations.length > 0) {
      minOpenMins = Infinity;
      for (const l of initialLocations) {
        const op = l.opening_time ?? "10:00";
        const [oh, om] = op.split(":").map(Number);
        const openMins = oh * 60 + om;
        if (openMins < minOpenMins) minOpenMins = openMins;
      }
    }
    return `${String(Math.floor(minOpenMins / 60)).padStart(2, "0")}:${String(minOpenMins % 60).padStart(2, "0")}`;
  }, [initialLocations]);

  const selectedLocationOpeningTime = useMemo(() => {
    if (selectedLocation === "all") return earliestOpening;
    const loc = initialLocations.find((l) => l.id === selectedLocation);
    return loc?.opening_time ?? earliestOpening;
  }, [selectedLocation, initialLocations, earliestOpening]);

  const groupedBills = useMemo(() => {
    const groups: { [dateStr: string]: BillRow[] } = {};
    for (const b of bills) {
      const dateKey = getOperatingDate(b.finalized_at, selectedLocationOpeningTime);
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
  }, [bills, selectedLocationOpeningTime]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bills & Receipts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totals.count} bill{totals.count === 1 ? "" : "s"} · {formatCurrency(totals.revenue)} total revenue collected
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-48">
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger>
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {initialLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="pl-9 w-64"
            />
          </div>
        </div>
      </div>

      {/* Bills Table */}
      {bills.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center text-muted-foreground bg-card">
          {search ? "No matching bills found" : "No finalized bills recorded yet."}
        </div>
      ) : (
        <div className="space-y-8">
          {groupedBills.map((group) => (
            <div key={group.dateStr} className="space-y-4">
              <h2 className="text-xl font-black text-foreground pt-2 border-b dark:border-[#222] pb-2">
                {group.label}
              </h2>
              {/* Mobile View (stacked cards) */}
              <div className="block md:hidden space-y-4">
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
                  const locName = locationMap.get(b.location_id) ?? "Location";

                  return (
                    <div
                      key={b.id}
                      onClick={() => setSelected(b)}
                      className="border border-gray-150 dark:border-[#222] rounded-2xl p-4 bg-gray-50/50 dark:bg-[#161616] cursor-pointer space-y-3.5 shadow-sm active:scale-[0.99] transition-transform"
                    >
                      {/* DateTime & Location */}
                      <div className="flex justify-between items-center flex-wrap gap-2 text-sm">
                        <span className="font-mono font-bold text-gray-550 dark:text-gray-400">
                          {fmtDateTime(b.finalized_at)}
                        </span>
                        {selectedLocation === "all" && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-muted text-foreground text-xs font-black">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {locName}
                          </span>
                        )}
                      </div>

                      {/* Customer Info */}
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Customer</p>
                        <p className="text-xl font-black text-foreground">{b.customer_name ?? "—"}</p>
                        {b.customer_phone && (
                          <p className="text-base font-bold text-muted-foreground mt-0.5">{b.customer_phone}</p>
                        )}
                      </div>

                      {/* Tables & Payments & Total */}
                      <div className="grid grid-cols-2 gap-2 text-sm bg-white dark:bg-[#111] p-3 rounded-xl border dark:border-gray-800">
                        <div>
                          <p className="text-gray-450 font-bold text-[11px] uppercase">Tables</p>
                          <p className="font-black text-foreground mt-0.5">{tablesList || "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-450 font-bold text-[11px] uppercase">Paid Total</p>
                          <p className="font-black text-emerald-500 mt-0.5">{formatCurrency(total)}</p>
                        </div>
                      </div>

                      {/* Payment Methods & Send button */}
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="flex gap-1 flex-wrap">
                          {methods.length === 0 ? "—" : methods.map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider"
                              style={
                                m === "cash"
                                  ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                                  : { background: "rgba(99,102,241,0.15)", color: "#6366f1" }
                              }
                            >
                              {m}
                            </span>
                          ))}
                        </div>

                        {b.customer_phone ? (
                          <button
                            type="button"
                            disabled={sendingId === b.id}
                            onClick={(e) => handleSendWhatsApp(e, b)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 transition-all active:scale-95 disabled:opacity-40"
                            title="Send Bill link via WhatsApp"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {sendingId === b.id ? "…" : "WhatsApp"}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic font-bold">No phone</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop View (HTML Table) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-base">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-4 text-left font-black text-muted-foreground uppercase text-sm tracking-wide">When</th>
                      {selectedLocation === "all" && (
                        <th className="px-4 py-4 text-left font-black text-muted-foreground uppercase text-sm tracking-wide">Location</th>
                      )}
                      <th className="px-4 py-4 text-left font-black text-muted-foreground uppercase text-sm tracking-wide">Customer</th>
                      <th className="px-4 py-4 text-left font-black text-muted-foreground uppercase text-sm tracking-wide">Tables</th>
                      <th className="px-4 py-4 text-left font-black text-muted-foreground uppercase text-sm tracking-wide">Payment</th>
                      <th className="px-4 py-4 text-right font-black text-muted-foreground uppercase text-sm tracking-wide">Paid</th>
                      <th className="px-4 py-4 text-right font-black text-muted-foreground uppercase text-sm tracking-wide">Send Bill</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#222]">
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
                      const locName = locationMap.get(b.location_id) ?? "Location";

                      return (
                        <tr
                          key={b.id}
                          onClick={() => setSelected(b)}
                          className="hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-5 font-mono text-base font-bold">{fmtDateTime(b.finalized_at)}</td>
                          {selectedLocation === "all" && (
                            <td className="px-4 py-5">
                              <span className="inline-flex items-center gap-1.5 text-base font-extrabold px-3 py-1.5 rounded-md bg-muted text-foreground">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                {locName}
                              </span>
                            </td>
                          )}
                          <td className="px-4 py-5">
                            <p className="font-black text-foreground text-lg md:text-xl">{b.customer_name ?? "—"}</p>
                            {b.customer_phone && <p className="text-base text-muted-foreground font-bold mt-1">{b.customer_phone}</p>}
                          </td>
                          <td className="px-4 py-5 text-foreground font-extrabold text-lg">{tablesList || "—"}</td>
                          <td className="px-4 py-5">
                            <div className="flex gap-2">
                              {methods.length === 0 ? "—" : methods.map((m) => (
                                <span
                                  key={m}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-black uppercase tracking-wider"
                                  style={
                                    m === "cash"
                                      ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                                      : { background: "rgba(99,102,241,0.15)", color: "#6366f1" }
                                  }
                                >
                                  {m === "cash" ? <Banknote className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                                  {m}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-5 text-right font-black tabular-nums text-foreground text-lg md:text-xl">{formatCurrency(total)}</td>
                          <td className="px-4 py-5 text-right">
                            {b.customer_phone ? (
                              <button
                                type="button"
                                disabled={sendingId === b.id}
                                onClick={(e) => handleSendWhatsApp(e, b)}
                                className="inline-flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl text-base font-black text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 transition-all active:scale-95 disabled:opacity-40"
                                title="Send Bill link via WhatsApp"
                              >
                                <MessageSquare className="h-4 w-4" />
                                {sendingId === b.id ? "…" : "WhatsApp"}
                              </button>
                            ) : (
                              <span className="text-base text-muted-foreground italic font-bold">No phone</span>
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

      {/* Bill Detail Modal */}
      {selected && (
        <OwnerBillDetailModal
          bill={selected}
          locationName={locationMap.get(selected.location_id) ?? "Location"}
          onClose={() => setSelected(null)}
          onSendWhatsApp={(e) => handleSendWhatsApp(e, selected)}
          sending={sendingId === selected.id}
          onDelete={async () => {
            await handleDeleteBill(selected.id);
          }}
        />
      )}
    </div>
  );
}

function OwnerBillDetailModal({
  bill, locationName, onClose, onSendWhatsApp, sending, onDelete,
}: {
  bill: BillRow;
  locationName: string;
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
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden bg-card border">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            Bill <span className="font-mono text-xs opacity-60">#{bill.id.slice(0, 8)}</span>
            <span className="text-xs font-normal opacity-60">({locationName})</span>
            <span className="ml-auto text-xs font-normal opacity-60">{fmtDateTime(bill.finalized_at)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto">
          {/* Customer */}
          <section className="px-5 py-4 border-b flex items-center justify-between">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Customer</h3>
              <p className="font-semibold text-base text-foreground">{bill.customer_name ?? "—"}</p>
              {bill.customer_phone && (
                <p className="text-sm font-mono text-muted-foreground mt-0.5">{bill.customer_phone}</p>
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
          <section className="px-5 py-4 border-b space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Tables</h3>
            <ul className="space-y-1.5 text-sm">
              {bill.items.map((it) => {
                const tn = tableNameOf(it.table);
                const mins = it.actual_start && it.actual_end
                  ? Math.round((new Date(it.actual_end).getTime() - new Date(it.actual_start).getTime()) / 60000)
                  : null;
                return (
                  <li key={it.id} className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-foreground">{tn}</span>
                      {mins !== null && (
                        <span className="text-xs text-muted-foreground ml-2">({mins} mins)</span>
                      )}
                    </div>
                    <span className="font-mono font-medium text-foreground">
                      {it.final_amount !== null ? formatCurrency(it.final_amount) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Extras / Food & Beverages */}
          {activeExtras.length > 0 && (
            <section className="px-5 py-4 border-b space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Extras / F&B</h3>
              <ul className="space-y-1 text-sm">
                {activeExtras.map((ex) => (
                  <li key={ex.id} className="flex items-center justify-between">
                    <span className="text-foreground">
                      {ex.name} <span className="text-xs text-muted-foreground">×{ex.quantity}</span>
                    </span>
                    <span className="font-mono font-medium text-foreground">{formatCurrency(ex.price * ex.quantity)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Totals & Payments */}
          <section className="px-5 py-4 space-y-3 bg-muted/20">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(bill.subtotal)}</span>
              </div>
              {bill.discount_amount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Discount</span>
                  <span className="font-mono">-{formatCurrency(bill.discount_amount)}</span>
                </div>
              )}
              {bill.advance_paid > 0 && (
                <div className="flex justify-between text-indigo-600 dark:text-indigo-400">
                  <span>Advance Paid</span>
                  <span className="font-mono">-{formatCurrency(bill.advance_paid)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t text-foreground">
                <span>Total Amount</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(bill.total_amount)}
                </span>
              </div>
            </div>

            {/* Payment breakdowns */}
            {bill.payments.length > 0 && (
              <div className="pt-2 border-t space-y-1.5">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment Breakdown</h4>
                {bill.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="capitalize font-medium text-foreground">{p.method} ({p.status})</span>
                    <span className="font-mono font-bold text-foreground">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between bg-muted/40">
          <a
            href={`/bill/${bill.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View Public Bill Link
          </a>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              size="sm"
            >
              {deleting ? "Deleting…" : "Delete Bill"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={deleting}
            >
              <X className="h-4 w-4 inline mr-1" /> Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
