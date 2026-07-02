"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { CheckCircle, Calendar, Clock, MapPin, ChevronRight, AlertTriangle } from "lucide-react";

interface BookingItem {
  id: string;
  table: { name: string; type: string } | null;
  selected_mode_name?: string | null;
  booking: Array<{ scheduled_start: string; scheduled_end: string }> | null;
  rate_per_hour: number | null;
  scheduled_duration_mins: number | null;
}

interface Order {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  advance_paid: number;
  total_amount: number | null;
  type: "online" | "walk_in";
  status: "open" | "finalized" | "cancelled";
  items: BookingItem[] | null;
}

const TYPE_EMOJI: Record<string, string> = { snooker: "🎱", pool: "🎱", ps5: "🎮" };

export function BookingConfirmation({ order }: { order: Order | null }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const dark    = false;
  const bg      = dark ? "#0A0A0A" : "#F7F5F2";
  const surface = dark ? "#111"    : "#FFFFFF";
  const border  = dark ? "#222"    : "#EBEBEB";
  const textPri = dark ? "#FFF"    : "#111";
  const textSec = dark ? "#888"    : "#666";
  const textMut = dark ? "#555"    : "#AAA";
  const inputBg = dark ? "#1A1A1A" : "#F5F3EF";

  const totalAmount = (order?.items ?? []).reduce((sum, item) => {
    return sum + ((item.rate_per_hour ?? 0) * (item.scheduled_duration_mins ?? 0) / 60);
  }, 0);
  const discountAmount = (order as any)?.discount_amount ?? 0;
  const advancePaid = order?.advance_paid ?? 0;
  const amountDue   = Math.max(0, totalAmount - discountAmount - advancePaid);

  const isOnline = order?.type === "online";
  const isPaymentPending = isOnline && (order?.total_amount ?? 0) > 0 && (order?.advance_paid ?? 0) === 0 && order?.status === "open";

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}>
        <div className="text-center space-y-4 px-4">
          <p className="text-4xl">🔍</p>
          <p className="font-semibold" style={{ color: textPri }}>Booking not found</p>
          <Link href="/" className="text-sm font-semibold" style={{ color: "#D4541A" }}>
            Back to home →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: bg }}>
      <div className="max-w-md mx-auto px-4 py-12">

        {/* Success card */}
        <div
          className="rounded-3xl overflow-hidden border mb-5"
          style={{ background: surface, borderColor: border, boxShadow: dark ? "0 4px 40px rgba(0,0,0,0.5)" : "0 4px 24px rgba(0,0,0,0.08)" }}
        >
          {/* Accent top */}
          <div
            className="h-1 w-full"
            style={{
              background: isPaymentPending
                ? "linear-gradient(90deg, #EF4444, #DC2626)"
                : "linear-gradient(90deg, #10B981, #059669)"
            }}
          />

          <div className="p-7 text-center">
            {isPaymentPending ? (
              <>
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: "rgba(239,68,68,0.12)" }}
                >
                  <AlertTriangle className="h-8 w-8" style={{ color: "#EF4444" }} />
                </div>
                <h1 className="text-2xl font-bold mb-1" style={{ color: textPri }}>
                  Payment Pending / Failed
                </h1>
                <p className="text-sm px-4" style={{ color: textSec }}>
                  Your online payment was not completed. Please try booking again.
                </p>
              </>
            ) : (
              <>
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: "rgba(16,185,129,0.12)" }}
                >
                  <CheckCircle className="h-8 w-8" style={{ color: "#10B981" }} />
                </div>
                <h1 className="text-2xl font-bold mb-1" style={{ color: textPri }}>
                  Booking Confirmed!
                </h1>
                <p className="text-sm" style={{ color: textSec }}>
                  See you soon{order.customer_name ? `, ${order.customer_name}` : ""}!
                </p>
              </>
            )}
          </div>

          {/* Divider with dots */}
          <div className="flex items-center gap-0" style={{ borderTop: `1px dashed ${border}`, position: "relative" }}>
            <div className="w-5 h-5 rounded-full -ml-2.5 shrink-0" style={{ background: bg }} />
            <div className="flex-1" />
            <div className="w-5 h-5 rounded-full -mr-2.5 shrink-0" style={{ background: bg }} />
          </div>

          {/* Booked items */}
          <div className="px-6 py-5 space-y-4">
            {order.items?.map(item => (
              <div key={item.id} className="flex gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ background: inputBg }}
                >
                  {TYPE_EMOJI[item.table?.type ?? ""] ?? "🎯"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold capitalize" style={{ color: textPri }}>{item.table?.name}{item.selected_mode_name ? ` (${item.selected_mode_name})` : ""}</p>
                  {item.booking?.[0] && (
                    <div className="space-y-0.5 mt-0.5">
                      <p className="flex items-center gap-1.5 text-xs" style={{ color: textSec }}>
                        <Calendar className="h-3 w-3" />
                        {new Date(item.booking[0].scheduled_start).toLocaleDateString("en-IN", {
                          weekday: "long", day: "numeric", month: "long",
                        })}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs" style={{ color: textSec }}>
                        <Clock className="h-3 w-3" />
                        {new Date(item.booking[0].scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(item.booking[0].scheduled_end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Divider again */}
          <div className="flex items-center gap-0" style={{ borderTop: `1px dashed ${border}`, position: "relative" }}>
            <div className="w-5 h-5 rounded-full -ml-2.5 shrink-0" style={{ background: bg }} />
            <div className="flex-1" />
            <div className="w-5 h-5 rounded-full -mr-2.5 shrink-0" style={{ background: bg }} />
          </div>

          {/* Amount info */}
          <div className="px-6 py-5 space-y-2">
            <div className="flex justify-between text-sm" style={{ color: textSec }}>
              <span>Total</span>
              <span style={{ color: textPri, fontWeight: 600 }}>
                ₹{totalAmount.toLocaleString("en-IN")}
              </span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm" style={{ color: textSec }}>
                <span>Discount</span>
                <span style={{ color: "#10B981", fontWeight: 600 }}>
                  −₹{discountAmount.toLocaleString("en-IN")}
                </span>
              </div>
            )}
            {advancePaid > 0 && (
              <div className="flex justify-between text-sm" style={{ color: textSec }}>
                <span>Paid</span>
                <span style={{ color: "#10B981", fontWeight: 600 }}>
                  −₹{advancePaid.toLocaleString("en-IN")}
                </span>
              </div>
            )}
            {amountDue > 0 && (
              <div className="flex justify-between text-sm" style={{ color: textSec }}>
                <span>Pay at venue</span>
                <span style={{ color: textPri, fontWeight: 700 }}>
                  ₹{amountDue.toLocaleString("en-IN")}
                </span>
              </div>
            )}
            {amountDue === 0 && (advancePaid > 0 || discountAmount > 0) && (
              <div className="flex justify-between text-sm" style={{ color: "#10B981" }}>
                <span>Fully paid</span>
                <span>✓</span>
              </div>
            )}
          </div>

          {/* Instructions & Non-refundable notice */}
          <div className="mx-5 mb-6 space-y-2.5">
            {isPaymentPending ? (
              <div
                className="px-4 py-3 rounded-2xl"
                style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.22)" }}
              >
                <p className="flex items-start gap-2 text-xs" style={{ color: "#EF4444" }}>
                  <span className="mt-0.5 shrink-0 text-sm leading-none">⚠</span>
                  This booking slot has not been secured because the online payment failed or was not completed. Please try booking again.
                </p>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 rounded-2xl" style={{ background: inputBg }}>
                  <p className="flex items-start gap-2 text-xs" style={{ color: textSec }}>
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "#D4541A" }} />
                    Please arrive 5 minutes early. Show this confirmation at reception to check in.
                  </p>
                </div>
                {amountDue > 0 && (
                  <div
                    className="px-4 py-3 rounded-2xl"
                    style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.22)" }}
                  >
                    <p className="flex items-start gap-2 text-xs" style={{ color: dark ? "#aaa" : "#777" }}>
                      <span className="mt-0.5 shrink-0 text-sm leading-none" style={{ color: "#EF4444" }}>⚠</span>
                      {`Your advance payment is strictly non-refundable. Please pay the remaining ₹${amountDue.toLocaleString("en-IN")} at the venue.`}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Back to home */}
        <Link
          href="/"
          className="flex items-center justify-center gap-1.5 w-full py-4 rounded-2xl font-bold text-white text-sm transition-all active:scale-[0.98]"
          style={{ background: "#D4541A", boxShadow: "0 6px 20px rgba(212,84,26,0.3)" }}
        >
          {isPaymentPending ? "Try Booking Again" : "Book Another Table"}
          <ChevronRight className="h-4 w-4" />
        </Link>

        <p className="text-center text-xs mt-4" style={{ color: textMut }}>
          Questions? Call us directly at your venue.
        </p>
      </div>
    </div>
  );
}
