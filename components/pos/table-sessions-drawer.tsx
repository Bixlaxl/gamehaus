"use client";

import { usePOSStore } from "@/store/pos";
import { formatCurrency, formatElapsed, formatCountdown } from "@/lib/utils";
import { calculateBill } from "@/lib/billing/engine";
import { X, UserPlus } from "lucide-react";
import type { OrderItem } from "@/lib/supabase/types";

const typeIcon: Record<string, string> = {
  snooker:  "🎱",
  pool:     "🎱",
  ps5:      "🎮",
  foosball: "⚽",
};

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string, now: Date) {
  const d = new Date(iso);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const itemDay = new Date(d); itemDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((itemDay.getTime() - today.getTime()) / 86400000);
  const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 0) return timeStr;
  if (dayDiff === -1) return `Yesterday ${timeStr}`;
  if (dayDiff === 1) return `Tomorrow ${timeStr}`;
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${timeStr}`;
}

export function TableSessionsDrawer() {
  const { tableSessionsTableId, setTableSessionsTableId, tables, openOrders, selectOrder, now, setWalkInWithTable } =
    usePOSStore();

  if (!tableSessionsTableId) return null;

  const table = tables.find((t) => t.id === tableSessionsTableId);
  if (!table) return null;

  type SessionEntry = {
    orderId: string;
    customerName: string;
    customerPhone: string | null;
    orderType: string;
    item: OrderItem & { table?: unknown };
  };

  const sessions: SessionEntry[] = [];
  for (const order of openOrders) {
    for (const item of order.items) {
      if (item.table_id === tableSessionsTableId && item.status !== "cancelled" && !item.is_deleted) {
        sessions.push({
          orderId: order.id,
          customerName: order.customer_name,
          customerPhone: order.customer_phone ?? null,
          orderType: order.type,
          item,
        });
      }
    }
  }

  sessions.sort((a, b) => {
    const ta = new Date(a.item.actual_start ?? a.item.scheduled_start ?? 0).getTime();
    const tb = new Date(b.item.actual_start ?? b.item.scheduled_start ?? 0).getTime();
    return ta - tb;
  });

  function selectSession(orderId: string) {
    selectOrder(orderId);
    setTableSessionsTableId(null);
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setTableSessionsTableId(null)} />

      <div className="fixed top-0 left-0 bottom-0 z-40 w-72 flex flex-col shadow-2xl bg-white dark:bg-black border-r border-gray-200 dark:border-[#1F1F1F]">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-[#1F1F1F]">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{typeIcon[table.type] ?? "🎱"}</span>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-sm leading-tight">{table.name}</p>
              <p className="text-xs mt-0.5 text-gray-400 dark:text-[#444]">{formatCurrency(table.hourly_rate)}/hr</p>
            </div>
          </div>
          <button
            onClick={() => setTableSessionsTableId(null)}
            className="p-1.5 rounded-lg transition-colors text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.length === 0 && (
            <div className="py-10 text-center space-y-1">
              <p className="text-sm text-gray-400 dark:text-[#555]">No active sessions</p>
              <p className="text-xs text-gray-300 dark:text-[#333]">Start a walk-in below</p>
            </div>
          )}

          {sessions.map((s) => {
            const item        = s.item;
            const isRunning   = item.status === "running";
            const isScheduled = item.status === "scheduled";
            const isFinished  = item.status === "finished";

            let countdown  = "";
            let elapsed    = "";
            let isOvertime = false;
            let liveBill   = 0;

            if (isRunning) {
              if (item.actual_start) elapsed = formatElapsed(new Date(item.actual_start), now);
              if (item.expected_end) {
                const end  = new Date(item.expected_end);
                isOvertime = end.getTime() < now.getTime();
                countdown  = formatCountdown(end, now);
              }
              liveBill = calculateBill([item as OrderItem], [], now).subtotal;
            }

            const timeLabel = isRunning && item.actual_start
              ? `${fmtDateTime(item.actual_start, now)} → ${item.expected_end ? fmtTime(item.expected_end) : "?"}`
              : item.scheduled_start && item.scheduled_end
                ? `${fmtDateTime(item.scheduled_start, now)} → ${fmtTime(item.scheduled_end)}`
                : isFinished && item.actual_start && item.actual_end
                  ? `${fmtDateTime(item.actual_start, now)} → ${fmtTime(item.actual_end)}`
                  : "—";

            const accentColor = isRunning
              ? isOvertime ? "#ef4444" : "#10b981"
              : isScheduled ? "#f59e0b"
              : "#D0D0D0";

            const avatarBg = isRunning
              ? isOvertime ? "#7f1d1d" : "#064e3b"
              : isScheduled ? "#78350f"
              : "#e5e7eb";

            return (
              <button
                key={`${s.orderId}-${item.id}`}
                onClick={() => selectSession(s.orderId)}
                className="w-full text-left rounded-xl p-3.5 transition-all hover:brightness-95 dark:hover:brightness-110 active:scale-[0.98]
                  bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#1F1F1F]"
                style={{ borderLeft: `3px solid ${accentColor}` }}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
                    style={{ background: avatarBg }}
                  >
                    {initials(s.customerName)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{s.customerName}</p>
                      <span
                        className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                        style={
                          isRunning && isOvertime
                            ? { background: "rgba(239,68,68,0.1)", color: "#ef4444" }
                            : isRunning
                              ? { background: "rgba(16,185,129,0.1)", color: "#10b981" }
                              : isScheduled
                                ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                                : { background: "rgba(0,0,0,0.05)", color: "#999" }
                        }
                      >
                        {isRunning && isOvertime ? "Overtime" : item.status}
                      </span>
                    </div>

                    {s.customerPhone && (
                      <p className="text-xs mt-0.5 truncate text-gray-400 dark:text-[#555]">{s.customerPhone}</p>
                    )}

                    <p className="text-xs font-mono mt-1 text-gray-400 dark:text-[#444]">{timeLabel}</p>

                    {isRunning && (
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs font-mono tabular-nums text-gray-400 dark:text-[#555]">{elapsed}</span>
                        <span
                          className="text-xs font-mono font-semibold tabular-nums"
                          style={{ color: isOvertime ? "#ef4444" : "#10b981" }}
                        >
                          {isOvertime ? "OVERTIME" : `${countdown} left`}
                        </span>
                      </div>
                    )}

                    {isRunning && liveBill > 0 && (
                      <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5 text-right">
                        {formatCurrency(liveBill)}
                      </p>
                    )}

                    <div className="mt-1.5">
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                        style={
                          s.orderType === "walk_in"
                            ? { background: "rgba(212,84,26,0.1)", color: "#D4541A" }
                            : { background: "rgba(139,92,246,0.1)", color: "#a78bfa" }
                        }
                      >
                        {s.orderType === "walk_in" ? "Walk-in" : "Online"}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="shrink-0 p-3 border-t border-gray-200 dark:border-[#1F1F1F]">
          <button
            onClick={() => {
              setTableSessionsTableId(null);
              setWalkInWithTable(tableSessionsTableId);
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-white text-sm transition-opacity hover:opacity-85"
            style={{ background: "#D4541A" }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Walk-in for {table.name}
          </button>
        </div>
      </div>
    </>
  );
}
