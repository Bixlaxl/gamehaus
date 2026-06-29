"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Banknote, Smartphone, MessageSquare, MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { BillRow } from "@/app/(pos)/pos/bills/content";

type LocationLite = { id: string; name: string };

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
        <div className="rounded-2xl border overflow-hidden bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">When</th>
                {selectedLocation === "all" && (
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">Location</th>
                )}
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">Tables</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">Payment</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">Paid</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground uppercase text-[11px] tracking-wide">Send Bill</th>
              </tr>
            </thead>
            <tbody className="divide-y">
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
                const locName = locationMap.get(b.location_id) ?? "Location";

                return (
                  <tr
                    key={b.id}
                    onClick={() => setSelected(b)}
                    className="hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium">{fmtDateTime(b.finalized_at)}</td>
                    {selectedLocation === "all" && (
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-muted text-foreground">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {locName}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{b.customer_name ?? "—"}</p>
                      {b.customer_phone && <p className="text-xs text-muted-foreground">{b.customer_phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-foreground">{tablesList || "—"}</td>
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
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-foreground">{formatCurrency(total)}</td>
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
                        <span className="text-xs text-muted-foreground italic">No phone</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        />
      )}
    </div>
  );
}

function OwnerBillDetailModal({
  bill, locationName, onClose, onSendWhatsApp, sending,
}: {
  bill: BillRow;
  locationName: string;
  onClose: () => void;
  onSendWhatsApp: (e: React.MouseEvent) => void;
  sending?: boolean;
}) {
  const activeExtras = bill.extras.filter((e) => !e.is_deleted);

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
      </DialogContent>
    </Dialog>
  );
}
