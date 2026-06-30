"use client";

import { Printer, Download, ArrowLeft, CheckCircle2, Gamepad2 } from "lucide-react";
import Link from "next/link";

interface ClientBillViewProps {
  order: any;
}

function formatCurrency(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function fmtDateTime(iso: string | null, tz: string = "Asia/Kolkata") {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

function fmtTime(iso: string | null, tz: string = "Asia/Kolkata") {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  });
}

export function ClientBillView({ order }: ClientBillViewProps) {
  const location = order.locations || {};
  const activeExtras = (order.extras || []).filter((e: any) => !e.is_deleted);
  const activePayments = (order.payments || []).filter((p: any) => p.status === "completed");

  const subtotal = Number(order.subtotal) || 0;
  const discountAmount = Number(order.discount_amount) || 0;
  const advancePaid = Number(order.advance_paid) || 0;
  const pointsRedeemed = Number(order.points_redeemed) || 0;
  const amountDue = Number(order.amount_due) || 0;
  const totalPaid = advancePaid + amountDue;

  function handlePrint() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#0a0a0a] py-8 px-4 font-sans print:bg-white print:py-0 print:px-0">
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .print-container {
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            padding: 0 !important;
          }
        }
      `}</style>

      {/* Top action bar (hidden during print) */}
      <div className="max-w-xl mx-auto mb-6 flex items-center justify-between no-print">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-[#D4541A] hover:opacity-90 shadow-lg shadow-orange-950/20 transition-all active:scale-95"
          >
            <Printer className="h-4 w-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      {/* Printable Receipt Card */}
      <div className="print-container max-w-xl mx-auto bg-white dark:bg-[#111] border border-gray-200 dark:border-[#222] rounded-3xl shadow-xl overflow-hidden">
        {/* Header Branding Banner */}
        <div className="bg-[#111] text-white p-8 text-center relative overflow-hidden border-b border-gray-800">
          <div className="relative z-10 space-y-1">
            <div className="w-12 h-12 rounded-2xl bg-[#D4541A] mx-auto flex items-center justify-center mb-3 shadow-lg shadow-orange-600/30">
              <Gamepad2 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-black tracking-tight uppercase">{location.name || "Gamehaus"}</h1>
            <p className="text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">{location.address || "Gaming Lounge & Cafe"}</p>
            {location.phone && <p className="text-xs font-mono text-gray-400 mt-1">Ph: {location.phone}</p>}
          </div>
        </div>

        {/* Status Badge */}
        <div className="bg-emerald-50 dark:bg-emerald-950/20 px-6 py-3 border-b border-emerald-100 dark:border-emerald-900/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider">
            <CheckCircle2 className="h-4 w-4" /> Bill Paid & Finalized
          </div>
          <span className="text-xs font-mono font-semibold text-gray-500">
            {fmtDateTime(order.finalized_at || order.created_at, location.timezone)}
          </span>
        </div>

        {/* Customer & Order Meta */}
        <div className="p-6 border-b border-gray-100 dark:border-[#1f1f1f] grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Billed To</p>
            <p className="font-bold text-gray-900 dark:text-white">{order.customer_name || "Guest Customer"}</p>
            {order.customer_phone && <p className="text-xs font-mono text-gray-500 mt-0.5">{order.customer_phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Invoice Ref</p>
            <p className="font-mono font-bold text-gray-900 dark:text-white">#{order.id.slice(0, 8).toUpperCase()}</p>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{order.type} order</p>
          </div>
        </div>

        {/* Items breakdown */}
        <div className="p-6 space-y-6">
          {/* Gaming Sessions */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Gaming Sessions</p>
            <div className="space-y-2">
              {(order.items || []).map((item: any) => {
                const tableName = item.tables?.name || "Table";
                const modeName = item.selected_mode_name;
                const startStr = item.actual_start || item.scheduled_start;
                const endStr = item.actual_end || item.expected_end || item.scheduled_end;
                const mins = startStr && endStr ? Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / 60000) : 60;

                return (
                  <div key={item.id} className="flex items-start justify-between text-sm py-1 border-b border-dashed border-gray-100 dark:border-[#222] last:border-0">
                    <div>
                      <p className="font-bold text-gray-900 dark:text-white">
                        {tableName} {modeName ? <span className="font-normal text-orange-600 dark:text-orange-400">({modeName.replace(/ Mode$/i, "")})</span> : ""}
                      </p>
                      <p className="text-xs text-gray-500 font-mono mt-0.5">
                        {fmtTime(startStr, location.timezone)} – {fmtTime(endStr, location.timezone)} ({mins}m)
                        {item.num_people ? ` · ${item.num_people} ${item.tables?.type === "ps5" ? "ctrl" : "ppl"}` : ""}
                      </p>
                    </div>
                    <p className="font-bold font-mono text-gray-900 dark:text-white">{formatCurrency(item.final_amount ?? (item.rate_per_hour * mins / 60))}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Extras / Snacks */}
          {activeExtras.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-[#1f1f1f]">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Food & Extras</p>
              <div className="space-y-2">
                {activeExtras.map((extra: any) => (
                  <div key={extra.id} className="flex items-center justify-between text-sm py-1 border-b border-dashed border-gray-100 dark:border-[#222] last:border-0">
                    <p className="font-medium text-gray-800 dark:text-[#ddd]">
                      {extra.name} <span className="text-xs text-gray-400 font-mono">× {extra.quantity}</span>
                    </p>
                    <p className="font-bold font-mono text-gray-900 dark:text-white">{formatCurrency(extra.price * extra.quantity)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Calculation Totals */}
          <div className="pt-4 border-t border-gray-200 dark:border-[#2A2A2A] space-y-2 text-sm">
            <div className="flex justify-between text-gray-600 dark:text-[#aaa]">
              <span>Subtotal</span>
              <span className="font-mono font-semibold">{formatCurrency(subtotal)}</span>
            </div>
            {(() => {
              const pubDisc = Number(order.public_discount_amount) || 0;
              const memDisc = Math.max(0, discountAmount - pubDisc);
              return (
                <>
                  {pubDisc > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                      <span>Public Coupon / Discount</span>
                      <span className="font-mono font-semibold">−{formatCurrency(pubDisc)}</span>
                    </div>
                  )}
                  {memDisc > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-purple-600 dark:text-purple-400 font-medium">
                        <span>Membership Discount / Free Hours</span>
                        <span className="font-mono font-semibold">−{formatCurrency(memDisc)}</span>
                      </div>
                      {order.items?.filter((item: any) => Number(item.free_hours_to_redeem) > 0).map((item: any) => {
                        const tableName = item.tables?.name || "Table";
                        const hrs = Number(item.free_hours_to_redeem);
                        return (
                          <div key={item.id} className="pl-3 border-l-2 border-purple-200 dark:border-purple-900 text-xs text-purple-600 dark:text-purple-400 font-medium">
                            Redeemed {hrs} {hrs === 1 ? 'hr' : 'hrs'} for {tableName}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {pubDisc === 0 && memDisc === 0 && discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                      <span>Discount / Coupon</span>
                      <span className="font-mono font-semibold">−{formatCurrency(discountAmount)}</span>
                    </div>
                  )}
                </>
              );
            })()}
            {pointsRedeemed > 0 && (
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>Points Redeemed ({pointsRedeemed} pts)</span>
                <span className="font-mono font-semibold">−{formatCurrency(pointsRedeemed)}</span>
              </div>
            )}

            <div className="flex justify-between text-base font-black pt-3 border-t border-gray-200 dark:border-[#2A2A2A] text-gray-900 dark:text-white">
              <span>Total Amount</span>
              <span className="font-mono text-[#D4541A]">{formatCurrency(totalPaid)}</span>
            </div>

            {/* Payments summary */}
            <div className="pt-4 space-y-1.5 text-xs bg-gray-50 dark:bg-[#161616] p-4 rounded-2xl border border-gray-100 dark:border-[#222]">
              <p className="font-bold uppercase tracking-wider text-gray-400 text-[10px] mb-1">Payment Breakdown</p>
              {advancePaid > 0 && (
                <div className="flex justify-between text-gray-700 dark:text-[#ccc]">
                  <span>Online Advance Paid</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(advancePaid)}</span>
                </div>
              )}
              {activePayments.map((p: any) => (
                <div key={p.id} className="flex justify-between text-gray-700 dark:text-[#ccc]">
                  <span className="capitalize">Collected at venue ({p.method})</span>
                  <span className="font-mono font-bold text-gray-900 dark:text-white">{formatCurrency(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50 dark:bg-[#161616] border-t border-gray-100 dark:border-[#222] text-center space-y-1">
          <p className="text-xs font-bold text-gray-900 dark:text-white">Thank you for gaming with us! 🎮</p>
          <p className="text-[11px] text-gray-400">Visit again soon · {location.name}</p>
        </div>
      </div>
    </div>
  );
}
