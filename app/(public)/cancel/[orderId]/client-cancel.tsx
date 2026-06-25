"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { XCircle, Calendar, Clock, ChevronRight, CheckCircle, Loader2 } from "lucide-react";

interface FormattedItem {
  id: string;
  tableName: string;
  tableType: string;
  scheduledStart: string;
  scheduledEnd: string;
}

interface ClientCancelPageProps {
  orderId: string;
  locationName: string;
  customerName: string;
  advancePaid: number;
  earliestStartMs: number;
  refundPct: number;
  refundAmount: number;
  items: FormattedItem[];
  timezone: string;
}

const TYPE_EMOJI: Record<string, string> = { snooker: "🎱", pool: "🎱", ps5: "🎮" };

export function ClientCancelPage({
  orderId,
  locationName,
  customerName,
  advancePaid,
  earliestStartMs,
  refundPct,
  refundAmount,
  items,
  timezone,
}: ClientCancelPageProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dark = false;
  const bg = dark ? "#0A0A0A" : "#F7F5F2";
  const surface = dark ? "#111" : "#FFFFFF";
  const border = dark ? "#222" : "#EBEBEB";
  const textPri = dark ? "#FFF" : "#111";
  const textSec = dark ? "#888" : "#666";
  const textMut = dark ? "#555" : "#AAA";
  const inputBg = dark ? "#1A1A1A" : "#F5F3EF";

  // Calculate hours left statically based on current time
  const hoursLeft = Math.max(0, (earliestStartMs - Date.now()) / 3_600_000);
  const formattedHoursLeft = hoursLeft >= 1
    ? `${Math.floor(hoursLeft)}h ${Math.round((hoursLeft % 1) * 60)}m`
    : `${Math.round(hoursLeft * 60)}m`;

  async function handleCancel() {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
      });

      const body = await res.json() as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        setError(body.error || "Failed to process cancellation. Please contact the venue directly.");
      } else {
        setSuccess(true);
      }
    } catch (err) {
      console.error("Cancellation error:", err);
      setError("An unexpected error occurred. Please try again or call the venue.");
    } finally {
      setLoading(false);
    }
  }

  // Format date and time helpers
  const formatLocalDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: timezone,
    });
  };

  const formatLocalTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center transition-colors duration-300" style={{ background: bg }}>
        <div className="max-w-md w-full px-4 py-12">
          <div
            className="rounded-3xl overflow-hidden border p-8 text-center space-y-6"
            style={{ background: surface, borderColor: border, boxShadow: dark ? "0 4px 40px rgba(0,0,0,0.5)" : "0 4px 24px rgba(0,0,0,0.08)" }}
          >
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "rgba(16,185,129,0.12)" }}
            >
              <CheckCircle className="h-10 w-10 animate-bounce" style={{ color: "#10B981" }} />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: textPri }}>
                Cancellation Confirmed
              </h1>
              <p className="text-sm" style={{ color: textSec }}>
                Your booking has been successfully cancelled and your slots have been released.
              </p>
            </div>

            {/* Refund Card */}
            <div className="p-5 rounded-2xl text-left border space-y-3" style={{ background: inputBg, borderColor: border }}>
              <div className="flex justify-between items-center text-sm">
                <span style={{ color: textSec }}>Refund Amount</span>
                <span className="font-bold text-lg" style={{ color: "#10B981" }}>₹{refundAmount}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span style={{ color: textSec }}>Refund Percentage</span>
                <span className="font-semibold" style={{ color: textPri }}>{refundPct}% of paid amount</span>
              </div>
              {refundAmount > 0 && (
                <p className="text-[10px] leading-relaxed pt-1" style={{ color: textSec }}>
                  * The refund has been initiated to your original payment source and should reflect in 5-7 business days.
                </p>
              )}
            </div>

            <div className="pt-2">
              <Link
                href="/"
                className="flex items-center justify-center gap-1.5 w-full py-4 rounded-2xl font-bold text-white text-sm transition-all active:scale-[0.98] shadow-lg"
                style={{ background: "#D4541A", boxShadow: "0 6px 20px rgba(212,84,26,0.3)" }}
              >
                Back to Home
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center transition-colors duration-300" style={{ background: bg }}>
      <div className="max-w-md w-full px-4 py-12">
        <div
          className="rounded-3xl overflow-hidden border mb-5"
          style={{ background: surface, borderColor: border, boxShadow: dark ? "0 4px 40px rgba(0,0,0,0.5)" : "0 4px 24px rgba(0,0,0,0.08)" }}
        >
          {/* Red Accent Top */}
          <div className="h-1 w-full bg-red-500" />

          <div className="p-7 text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(239,68,68,0.1)" }}
            >
              <XCircle className="h-8 w-8" style={{ color: "#EF4444" }} />
            </div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: textPri }}>
              Cancel Your Booking?
            </h1>
            <p className="text-xs" style={{ color: textSec }}>
              Booking starts in <strong style={{ color: "#D4541A" }}>{formattedHoursLeft}</strong>
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-0 border-t border-dashed" style={{ borderColor: border, position: "relative" }}>
            <div className="w-5 h-5 rounded-full -ml-2.5 shrink-0" style={{ background: bg, borderRight: `1px solid ${border}` }} />
            <div className="flex-1" />
            <div className="w-5 h-5 rounded-full -mr-2.5 shrink-0" style={{ background: bg, borderLeft: `1px solid ${border}` }} />
          </div>

          {/* Items Summary */}
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: textSec }}>Your Booking Details</p>
            {items.map((item) => (
              <div key={item.id} className="flex gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ background: inputBg }}
                >
                  {TYPE_EMOJI[item.tableType] ?? "🎯"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold capitalize text-sm" style={{ color: textPri }}>{item.tableName}</p>
                  <div className="space-y-0.5 mt-0.5">
                    <p className="flex items-center gap-1.5 text-xs" style={{ color: textSec }}>
                      <Calendar className="h-3 w-3" />
                      {formatLocalDate(item.scheduledStart)}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs" style={{ color: textSec }}>
                      <Clock className="h-3 w-3" />
                      {formatLocalTime(item.scheduledStart)} – {formatLocalTime(item.scheduledEnd)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-0 border-t border-dashed" style={{ borderColor: border, position: "relative" }}>
            <div className="w-5 h-5 rounded-full -ml-2.5 shrink-0" style={{ background: bg, borderRight: `1px solid ${border}` }} />
            <div className="flex-1" />
            <div className="w-5 h-5 rounded-full -mr-2.5 shrink-0" style={{ background: bg, borderLeft: `1px solid ${border}` }} />
          </div>

          {/* Policy & Refund matching */}
          <div className="px-6 py-5 space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: textSec }}>Paid Online</span>
              <span className="font-semibold" style={{ color: textPri }}>₹{advancePaid}</span>
            </div>

            <div className="flex justify-between items-center text-sm">
              <span style={{ color: textSec }}>Eligible Refund ({refundPct}%)</span>
              <span className="font-bold text-base" style={{ color: refundAmount > 0 ? "#10B981" : "#EF4444" }}>
                ₹{refundAmount}
              </span>
            </div>

            {refundPct < 100 && (
              <div className="px-4 py-3 rounded-2xl bg-red-500/5 border border-red-500/10 text-xs text-red-500">
                ⚠️ Based on the cancellation policy, a cancellation fee of <strong>{100 - refundPct}%</strong> applies because your play time starts in less than 3 hours.
              </div>
            )}

            {error && (
              <div className="px-4 py-3 rounded-2xl bg-red-500/5 border border-red-500/20 text-xs text-red-500">
                {error}
              </div>
            )}
          </div>

          {/* Confirm Button */}
          <div className="px-6 pb-6 pt-2">
            <button
              onClick={handleCancel}
              disabled={loading}
              className="w-full py-4 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
              style={{
                background: "#EF4444",
                boxShadow: "0 8px 28px rgba(239,68,68,0.2)",
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Processing Cancellation...
                </>
              ) : (
                "Confirm Cancellation"
              )}
            </button>
          </div>
        </div>

        <Link
          href="/"
          className="flex items-center justify-center gap-1.5 w-full py-4 rounded-2xl font-bold text-sm border hover:bg-gray-100 dark:hover:bg-neutral-900 transition-all active:scale-[0.98]"
          style={{ color: textSec, borderColor: border, background: "transparent" }}
        >
          Keep My Booking
        </Link>
      </div>
    </div>
  );
}
