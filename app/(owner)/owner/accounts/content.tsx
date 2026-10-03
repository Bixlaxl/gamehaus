"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { formatCurrency, shiftDayStr } from "@/lib/utils";
import type { DailyAccountRecord } from "@/lib/accounts/types";
import {
  Calculator,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  History,
  Building2,
  Receipt,
  Wallet,
  Clock,
  UserCheck,
  ShieldCheck,
  ArrowRight
} from "lucide-react";

interface LocationOption {
  id: string;
  name: string;
  opening_time?: string;
  closing_time?: string;
}

interface OwnerAccountsContentProps {
  locations: LocationOption[];
  initialDate: string;
  userName: string;
  userRole?: "owner" | "staff";
}

export function OwnerAccountsContent({
  locations,
  initialDate,
  userName,
  userRole = "owner",
}: OwnerAccountsContentProps) {
  const isOwner = userRole === "owner";

  const [selectedLocId, setSelectedLocId] = useState<string>(locations[0]?.id || "");
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [activeTab, setActiveTab] = useState<"audit" | "night" | "day" | "history">(
    isOwner ? "audit" : "night"
  );

  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<DailyAccountRecord[]>([]);
  const [posHints, setPosHints] = useState<{
    upi_hint: number;
    cash_hint: number;
    total_hint: number;
  } | null>(null);
  const [previousNightClosing, setPreviousNightClosing] = useState<number | null>(null);

  // Night shift inputs (for staff)
  const [nightUpi, setNightUpi] = useState<string>("");
  const [nightCash, setNightCash] = useState<string>("");
  const [nightOpening, setNightOpening] = useState<string>("");
  const [nightExpenses, setNightExpenses] = useState<string>("");
  const [nightClosing, setNightClosing] = useState<string>("");
  const [nightNotes, setNightNotes] = useState<string>("");
  const [submittingNight, setSubmittingNight] = useState(false);

  // Day shift inputs (for staff)
  const [dayOpening, setDayOpening] = useState<string>("");
  const [dayNotes, setDayNotes] = useState<string>("");
  const [submittingDay, setSubmittingDay] = useState(false);

  async function loadData() {
    if (!selectedLocId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/owner/accounts?locationId=${selectedLocId}&date=${selectedDate}`
      );
      const json = await res.json();
      if (json.success) {
        setRecords(json.data.records || []);
        setPosHints(json.data.pos_hints || null);
        setPreviousNightClosing(json.data.previous_night_closing ?? null);

        const currentRec = (json.data.records || []).find(
          (r: DailyAccountRecord) => r.business_date === selectedDate
        );

        if (currentRec) {
          if (currentRec.night_submitted_at) {
            setNightUpi(String(currentRec.night_upi ?? ""));
            setNightCash(String(currentRec.night_cash ?? ""));
            setNightOpening(String(currentRec.night_opening_balance ?? ""));
            setNightExpenses(String(currentRec.night_expenses ?? ""));
            setNightClosing(String(currentRec.night_closing_balance ?? ""));
            setNightNotes(currentRec.night_notes || "");
          } else {
            // Unsubmitted: BLANK FOR BLIND RECONCILIATION
            setNightUpi("");
            setNightCash("");
            setNightOpening("");
            setNightExpenses("");
            setNightClosing("");
            setNightNotes("");
          }

          if (currentRec.day_submitted_at) {
            setDayOpening(String(currentRec.day_opening_balance ?? ""));
            setDayNotes(currentRec.day_notes || "");
          } else {
            setDayOpening("");
            setDayNotes("");
          }
        } else {
          // No record yet: completely blank inputs
          setNightUpi("");
          setNightCash("");
          setNightOpening("");
          setNightExpenses("");
          setNightClosing("");
          setNightNotes("");
          setDayOpening("");
          setDayNotes("");
        }
      } else {
        toast.error(json.error?.message || "Failed to load account data");
      }
    } catch {
      toast.error("Network error loading accounts data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocId, selectedDate]);

  const currentRecord = useMemo(() => {
    return records.find((r) => r.business_date === selectedDate);
  }, [records, selectedDate]);

  // Live Calculations for staff input
  const numNightUpi = parseFloat(nightUpi) || 0;
  const numNightCash = parseFloat(nightCash) || 0;
  const numNightOpening = parseFloat(nightOpening) || 0;
  const numNightExpenses = parseFloat(nightExpenses) || 0;
  const numNightClosing = parseFloat(nightClosing) || 0;

  const liveNightEarnings = numNightUpi + numNightCash;
  const liveExpectedClosing = numNightOpening + numNightCash - numNightExpenses;
  const liveNightDiff = Math.round((numNightClosing - liveExpectedClosing) * 100) / 100;
  const liveNightTallied = Math.abs(liveNightDiff) < 0.01 && nightClosing.trim() !== "";

  const numDayOpening = parseFloat(dayOpening) || 0;
  const prevClosingForDay = previousNightClosing ?? 0;
  const liveDayDiff = Math.round((numDayOpening - prevClosingForDay) * 100) / 100;
  const liveDayTallied = Math.abs(liveDayDiff) < 0.01 && dayOpening.trim() !== "";

  async function handleNightSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nightOpening.trim()) {
      toast.error("Please enter the Opening Cash in drawer.");
      return;
    }
    if (!nightCash.trim()) {
      toast.error("Please enter the Cash Collected from sales.");
      return;
    }
    if (!nightUpi.trim()) {
      toast.error("Please enter the UPI / digital receipts amount.");
      return;
    }
    if (!nightClosing.trim()) {
      toast.error("Please enter the Closing Cash counted in drawer.");
      return;
    }
    if (numNightExpenses > 0 && !nightNotes.trim()) {
      toast.error("Please provide a note describing the petty expenses.");
      return;
    }

    setSubmittingNight(true);
    try {
      const res = await fetch("/api/owner/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "night_entry",
          location_id: selectedLocId,
          business_date: selectedDate,
          upi: numNightUpi,
          cash: numNightCash,
          opening_balance: numNightOpening,
          expenses: numNightExpenses,
          closing_balance: numNightClosing,
          notes: nightNotes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.data.is_tallied) {
          toast.success("Night shift accounts verified & tallied! (₹0 difference)");
        } else {
          toast.warning(
            `Shift saved with difference: ${formatCurrency(Math.abs(json.data.difference))}`
          );
        }
        await loadData();
      } else {
        toast.error(json.error?.message || "Failed to save entry");
      }
    } catch {
      toast.error("Network error saving entry");
    } finally {
      setSubmittingNight(false);
    }
  }

  async function handleDaySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dayOpening.trim()) {
      toast.error("Please enter the drawer opening cash counted.");
      return;
    }
    setSubmittingDay(true);
    try {
      const res = await fetch("/api/owner/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "day_handover",
          location_id: selectedLocId,
          business_date: selectedDate,
          opening_balance: numDayOpening,
          notes: dayNotes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.data.is_tallied) {
          toast.success("Day handover verified with previous night's closing!");
        } else {
          toast.warning(
            `Handover saved with difference: ${formatCurrency(Math.abs(json.data.difference))}`
          );
        }
        await loadData();
      } else {
        toast.error(json.error?.message || "Failed to save handover");
      }
    } catch {
      toast.error("Network error saving handover");
    } finally {
      setSubmittingDay(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-[#1E1E1E]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-orange-500/10 text-[#D4541A]">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
              {isOwner ? "Accounts Audit & Reconciliation" : "Shift Accounts Tally"}
              {isOwner && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-500/10 text-[#D4541A] uppercase tracking-wider">
                  Owner Portal
                </span>
              )}
            </h1>
            <p className="text-xs text-gray-500 dark:text-[#888]">
              {isOwner
                ? "Executive oversight, reconciliation, and audit logs of staff drawer counts."
                : `Logged in as ${userName} — Count physical cash and enter actual shift receipts.`}
            </p>
          </div>
        </div>

        {/* Controls: Location + Date + Quick buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {locations.length > 1 && (
            <div className="flex items-center gap-1.5 bg-white dark:bg-[#161616] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#262626] shadow-sm">
              <Building2 className="h-3.5 w-3.5 text-gray-400" />
              <select
                value={selectedLocId}
                onChange={(e) => setSelectedLocId(e.target.value)}
                className="bg-transparent text-xs font-semibold text-gray-800 dark:text-white focus:outline-none"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id} className="dark:bg-[#161616] text-black dark:text-white">
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-white dark:bg-[#161616] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#262626] shadow-sm">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-semibold text-gray-800 dark:text-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDate(initialDate)}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold transition ${
                selectedDate === initialDate
                  ? "bg-[#D4541A] text-white"
                  : "bg-white dark:bg-[#161616] border border-gray-200 dark:border-[#262626] text-gray-600 dark:text-[#aaa] hover:bg-gray-50"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setSelectedDate(shiftDayStr(initialDate, -1))}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold transition ${
                selectedDate === shiftDayStr(initialDate, -1)
                  ? "bg-[#D4541A] text-white"
                  : "bg-white dark:bg-[#161616] border border-gray-200 dark:border-[#262626] text-gray-600 dark:text-[#aaa] hover:bg-gray-50"
              }`}
            >
              Yesterday
            </button>
          </div>
        </div>
      </div>

      {/* Top Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4">
        {/* Card 1: Night Close Status */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm flex sm:flex-col justify-between items-center sm:items-start">
          <div className="w-full flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#666]">
              Night Shift Close
            </span>
            <span className="text-xs font-mono font-bold text-gray-900 dark:text-white">
              {currentRecord?.night_submitted_at
                ? formatCurrency(currentRecord.night_closing_balance)
                : "Unclosed"}
            </span>
          </div>

          <div className="mt-1.5 sm:mt-2">
            {currentRecord?.night_submitted_at ? (
              currentRecord.night_is_tallied ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-black">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Tallied (₹0 Diff)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-black">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {currentRecord.night_difference > 0 ? "+" : ""}
                  {formatCurrency(currentRecord.night_difference)}
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium">
                <RotateCcw className="h-3 w-3" /> Pending Staff Close
              </span>
            )}
          </div>
        </div>

        {/* Card 2: Day Handover */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm flex sm:flex-col justify-between items-center sm:items-start">
          <div className="w-full flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#666]">
              Day Handover
            </span>
            <span className="text-xs font-mono font-bold text-gray-900 dark:text-white">
              Prev: {formatCurrency(previousNightClosing ?? 0)}
            </span>
          </div>

          <div className="mt-1.5 sm:mt-2">
            {currentRecord?.day_submitted_at ? (
              currentRecord.day_is_tallied ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-black">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Handover Tallied
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-black">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {(currentRecord.day_difference ?? 0) > 0 ? "+" : ""}
                  {formatCurrency(currentRecord.day_difference ?? 0)}
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#1c1c1c] text-gray-500 text-xs font-medium">
                <RotateCcw className="h-3 w-3" /> Pending Handover
              </span>
            )}
          </div>
        </div>

        {/* Card 3: Shift Earnings */}
        <div className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm flex sm:flex-col justify-between items-center sm:items-start">
          <div className="w-full flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#666]">
              Sales Collected
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              UPI {formatCurrency(currentRecord?.night_upi ?? (isOwner ? (posHints?.upi_hint ?? 0) : numNightUpi))} · Cash{" "}
              {formatCurrency(currentRecord?.night_cash ?? (isOwner ? (posHints?.cash_hint ?? 0) : numNightCash))}
            </span>
          </div>

          <div className="mt-1.5 sm:mt-2">
            <span className="text-lg font-black text-gray-900 dark:text-white tracking-tight">
              {formatCurrency(
                currentRecord?.night_total_earnings ??
                  (isOwner ? (posHints?.total_hint ?? 0) : liveNightEarnings)
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 dark:bg-[#161616] p-1 rounded-xl flex items-center gap-1 border border-gray-200/80 dark:border-[#222]">
        {isOwner ? (
          <>
            <button
              onClick={() => setActiveTab("audit")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === "audit"
                  ? "bg-white dark:bg-[#222] text-[#D4541A] shadow-sm"
                  : "text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Shift Reconciliation Audit</span>
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === "history"
                  ? "bg-white dark:bg-[#222] text-[#D4541A] shadow-sm"
                  : "text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>History Ledger ({records.length})</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setActiveTab("night")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === "night"
                  ? "bg-white dark:bg-[#222] text-[#D4541A] shadow-sm"
                  : "text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Night Shift Close</span>
            </button>
            <button
              onClick={() => setActiveTab("day")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === "day"
                  ? "bg-white dark:bg-[#222] text-[#D4541A] shadow-sm"
                  : "text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              <span>Day Handover</span>
            </button>
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* OWNER VIEW: EXECUTIVE AUDIT & RECONCILIATION */}
      {/* ========================================================================= */}
      {isOwner && activeTab === "audit" && (
        <div className="space-y-4">
          {/* Submitter & Status Banner */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100 dark:border-[#1A1A1A]">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  Shift Reconciliation Report ({selectedDate})
                </h2>
                <p className="text-xs text-gray-500 dark:text-[#888] mt-0.5">
                  Comparison between Staff physical drawer counts and POS recorded transactions.
                </p>
              </div>

              {currentRecord?.night_submitted_at ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5" />
                    Submitted by {currentRecord.night_submitted_by_name || "Staff"}
                  </span>
                  <span className="text-gray-400 font-mono text-[11px]">
                    {new Date(currentRecord.night_submitted_at).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </span>
                </div>
              ) : (
                <span className="px-3 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 animate-pulse" />
                  Staff Has Not Submitted Night Close Yet
                </span>
              )}
            </div>

            {/* Reconciliation Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {/* Box 1: Cash Sales */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222] space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#666]">
                  Cash Sales Collected
                </span>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">Staff Counted:</span>
                    <span className="font-mono font-bold text-gray-900 dark:text-white">
                      {formatCurrency(currentRecord?.night_cash ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">POS Recorded:</span>
                    <span className="font-mono text-gray-700 dark:text-[#ccc]">
                      {formatCurrency(posHints?.cash_hint ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-[#262626] font-bold">
                    <span>Difference:</span>
                    <span
                      className={`font-mono ${
                        Math.abs((currentRecord?.night_cash ?? 0) - (posHints?.cash_hint ?? 0)) < 0.5
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {((currentRecord?.night_cash ?? 0) - (posHints?.cash_hint ?? 0)) > 0 ? "+" : ""}
                      {formatCurrency((currentRecord?.night_cash ?? 0) - (posHints?.cash_hint ?? 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Box 2: UPI Receipts */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222] space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#666]">
                  UPI / QR Receipts
                </span>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">Staff Statement:</span>
                    <span className="font-mono font-bold text-gray-900 dark:text-white">
                      {formatCurrency(currentRecord?.night_upi ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">POS Recorded:</span>
                    <span className="font-mono text-gray-700 dark:text-[#ccc]">
                      {formatCurrency(posHints?.upi_hint ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-[#262626] font-bold">
                    <span>Difference:</span>
                    <span
                      className={`font-mono ${
                        Math.abs((currentRecord?.night_upi ?? 0) - (posHints?.upi_hint ?? 0)) < 0.5
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {((currentRecord?.night_upi ?? 0) - (posHints?.upi_hint ?? 0)) > 0 ? "+" : ""}
                      {formatCurrency((currentRecord?.night_upi ?? 0) - (posHints?.upi_hint ?? 0))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Box 3: Physical Cash Drawer Tally */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222] space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#666]">
                  Drawer Reconciliation
                </span>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">Opening Cash:</span>
                    <span className="font-mono text-gray-900 dark:text-white">
                      {formatCurrency(currentRecord?.night_opening_balance ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">+ Cash Sales:</span>
                    <span className="font-mono text-gray-900 dark:text-white">
                      +{formatCurrency(currentRecord?.night_cash ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-[#aaa]">- Petty Expenses:</span>
                    <span className="font-mono text-rose-500">
                      -{formatCurrency(currentRecord?.night_expenses ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-gray-200 dark:border-[#262626] pt-1">
                    <span>Expected Closing:</span>
                    <span className="font-mono text-blue-600 dark:text-blue-400">
                      {formatCurrency(currentRecord?.night_expected_closing ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Actual Counted:</span>
                    <span className="font-mono text-gray-900 dark:text-white">
                      {formatCurrency(currentRecord?.night_closing_balance ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-[#262626] font-extrabold">
                    <span>Tally Diff:</span>
                    <span
                      className={`font-mono ${
                        currentRecord?.night_is_tallied
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {currentRecord?.night_is_tallied
                        ? "✅ TALLIED (₹0)"
                        : `${(currentRecord?.night_difference ?? 0) > 0 ? "+" : ""}${formatCurrency(
                            currentRecord?.night_difference ?? 0
                          )}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes if any */}
            {currentRecord?.night_notes && (
              <div className="mt-3 p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 text-xs">
                <span className="font-bold text-[#D4541A]">Staff Notes / Expense Detail:</span>{" "}
                <span className="text-gray-700 dark:text-[#ccc]">{currentRecord.night_notes}</span>
              </div>
            )}
          </div>

          {/* Morning Handover Review Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center justify-between">
              <span>Morning Shift Handover Verification</span>
              {currentRecord?.day_submitted_at ? (
                <span className="text-xs text-gray-400 font-mono">
                  Confirmed by {currentRecord.day_submitted_by_name || "Staff"} at{" "}
                  {new Date(currentRecord.day_submitted_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              ) : (
                <span className="text-xs text-amber-500 font-semibold">Pending Morning Handover</span>
              )}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222]">
                <span className="text-gray-400 block mb-1">Previous Night Closing Cash</span>
                <span className="text-sm font-mono font-bold text-gray-900 dark:text-white">
                  {formatCurrency(previousNightClosing ?? 0)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222]">
                <span className="text-gray-400 block mb-1">Morning Count by Staff</span>
                <span className="text-sm font-mono font-bold text-[#D4541A]">
                  {currentRecord?.day_submitted_at
                    ? formatCurrency(currentRecord.day_opening_balance ?? 0)
                    : "Not entered"}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222]">
                <span className="text-gray-400 block mb-1">Handover Difference</span>
                <span
                  className={`text-sm font-mono font-extrabold ${
                    currentRecord?.day_is_tallied
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {currentRecord?.day_submitted_at
                    ? currentRecord.day_is_tallied
                      ? "✅ Tallied (₹0)"
                      : `${(currentRecord.day_difference ?? 0) > 0 ? "+" : ""}${formatCurrency(
                          currentRecord.day_difference ?? 0
                        )}`
                    : "—"}
                </span>
              </div>
            </div>

            {currentRecord?.day_notes && (
              <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-[#161616] text-xs text-gray-600 dark:text-[#aaa]">
                <span className="font-semibold text-gray-900 dark:text-white">Morning Notes:</span>{" "}
                {currentRecord.day_notes}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAFF VIEW: NIGHT SHIFT CLOSING (BLIND COUNT, ZERO AUTOFILLS) */}
      {/* ========================================================================= */}
      {!isOwner && activeTab === "night" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form onSubmit={handleNightSubmit} className="lg:col-span-7 space-y-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-4">
              <div className="pb-2 border-b border-gray-100 dark:border-[#1A1A1A]">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                  Night Shift Closing ({selectedDate})
                </h2>
                <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                  Count the physical drawer and check UPI statement. Enter genuine counted amounts.
                </p>
              </div>

              {/* UPI & Cash */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 dark:text-[#ccc] mb-0.5">
                    UPI Receipts (₹)
                  </label>
                  <span className="block text-[10px] text-gray-400 mb-1">
                    From QR / Bank statement
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={nightUpi}
                    onChange={(e) => setNightUpi(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 dark:text-[#ccc] mb-0.5">
                    Cash Collected (₹)
                  </label>
                  <span className="block text-[10px] text-gray-400 mb-1">
                    Cash received from sales
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={nightCash}
                    onChange={(e) => setNightCash(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                  />
                </div>
              </div>

              {/* Opening Cash, Expenses, Closing Cash */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 dark:text-[#ccc] mb-0.5">
                    Opening Cash (₹)
                  </label>
                  <span className="block text-[10px] text-gray-400 mb-1 truncate">
                    Drawer at start
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={nightOpening}
                    onChange={(e) => setNightOpening(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 dark:text-[#ccc] mb-0.5">
                    Petty Expenses (₹)
                  </label>
                  <span className="block text-[10px] text-gray-400 mb-1 truncate">
                    Paid from drawer
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nightExpenses}
                    onChange={(e) => setNightExpenses(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#D4541A] mb-0.5">
                    Closing Cash (₹)
                  </label>
                  <span className="block text-[10px] text-[#D4541A] mb-1 truncate">
                    Physical count now
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={nightClosing}
                    onChange={(e) => setNightClosing(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#D4541A] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm font-bold focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                  />
                </div>
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Notes (e.g. ₹200 snacks, ₹150 cleaning supplies)"
                  value={nightNotes}
                  onChange={(e) => setNightNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                />
              </div>

              <button
                type="submit"
                disabled={submittingNight || loading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#D4541A] text-white font-bold text-xs tracking-wide hover:bg-[#b84414] active:scale-[0.99] transition disabled:opacity-50"
              >
                {submittingNight ? "Saving & Verifying..." : "Save & Tally Shift"}
              </button>
            </div>
          </form>

          {/* Right Live Math Box */}
          <div className="lg:col-span-5 space-y-3">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-gray-700 dark:text-[#ccc]">
                <span>Tally Formula</span>
                <span className="font-mono text-gray-400 text-[10px]">
                  Opening + Cash - Exp = Closing
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-gray-600 dark:text-[#aaa] bg-gray-50 dark:bg-[#161616] p-3 rounded-xl border border-gray-200 dark:border-[#222]">
                <div className="flex justify-between">
                  <span>Opening Cash</span>
                  <span className="font-mono text-gray-900 dark:text-white">
                    {formatCurrency(numNightOpening)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>+ Cash Collected</span>
                  <span className="font-mono text-gray-900 dark:text-white">
                    +{formatCurrency(numNightCash)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>- Petty Expenses</span>
                  <span className="font-mono text-rose-500">
                    -{formatCurrency(numNightExpenses)}
                  </span>
                </div>
                <div className="flex justify-between font-bold border-t border-gray-200 dark:border-[#222] pt-1.5 text-gray-900 dark:text-white">
                  <span>Expected Closing Cash</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">
                    {formatCurrency(liveExpectedClosing)}
                  </span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Actual Counted Cash</span>
                  <span className="font-mono text-[#D4541A]">
                    {formatCurrency(numNightClosing)}
                  </span>
                </div>
              </div>

              {/* Status Pill */}
              <div
                className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
                  !nightClosing.trim()
                    ? "bg-gray-50 dark:bg-[#161616] border-gray-200 dark:border-[#222] text-gray-400"
                    : liveNightTallied
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                }`}
              >
                <span>Status:</span>
                <span>
                  {!nightClosing.trim()
                    ? "Enter Closing Cash"
                    : liveNightTallied
                    ? "TALLIED (Diff ₹0)"
                    : `DISCREPANCY: ${liveNightDiff > 0 ? "+" : ""}${formatCurrency(liveNightDiff)}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAFF VIEW: DAY SHIFT HANDOVER */}
      {/* ========================================================================= */}
      {!isOwner && activeTab === "day" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form onSubmit={handleDaySubmit} className="lg:col-span-7 space-y-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-4">
              <div className="pb-2 border-b border-gray-100 dark:border-[#1A1A1A]">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                  Day Handover ({selectedDate})
                </h2>
                <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                  Morning staff: physically count the cash drawer upon opening and enter the amount.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-[#ccc] mb-1.5">
                  Actual Physical Cash Counted in Drawer (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  value={dayOpening}
                  onChange={(e) => setDayOpening(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-[#D4541A] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm font-bold focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                />
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={dayNotes}
                  onChange={(e) => setDayNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#D4541A]"
                />
              </div>

              <button
                type="submit"
                disabled={submittingDay || loading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#D4541A] text-white font-bold text-xs tracking-wide hover:bg-[#b84414] active:scale-[0.99] transition disabled:opacity-50"
              >
                {submittingDay ? "Verifying..." : "Confirm Day Handover"}
              </button>
            </div>
          </form>

          {/* Right Live Handover Verification */}
          <div className="lg:col-span-5 space-y-3">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-gray-700 dark:text-[#ccc]">
                <span>Handover Check</span>
                <span className="font-mono text-gray-400 text-[10px]">Prev Close = Day Open</span>
              </div>

              <div className="space-y-1.5 text-xs text-gray-600 dark:text-[#aaa] bg-gray-50 dark:bg-[#161616] p-3 rounded-xl border border-gray-200 dark:border-[#222]">
                <div className="flex justify-between">
                  <span>Previous Night Closing</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(prevClosingForDay)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Morning Drawer Count</span>
                  <span className="font-mono font-bold text-[#D4541A]">
                    {formatCurrency(numDayOpening)}
                  </span>
                </div>
              </div>

              {/* Handover Status Banner */}
              <div
                className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
                  !dayOpening.trim()
                    ? "bg-gray-50 dark:bg-[#161616] border-gray-200 dark:border-[#222] text-gray-400"
                    : liveDayTallied
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                }`}
              >
                <span>Status:</span>
                <span>
                  {!dayOpening.trim()
                    ? "Enter Drawer Count"
                    : liveDayTallied
                    ? "TALLIED"
                    : `DISCREPANCY: ${liveDayDiff > 0 ? "+" : ""}${formatCurrency(liveDayDiff)}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HISTORY LEDGER (FOR OWNER AUDIT) */}
      {/* ========================================================================= */}
      {activeTab === "history" && (
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm overflow-hidden space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                Multi-Day Shift History Ledger
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-[#888]">
                Audit log of all submitted shift accounts and handover verification.
              </p>
            </div>
            <span className="text-xs text-gray-400 font-mono">
              {records.length} shifts logged
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-[#161616] uppercase font-bold text-gray-400 dark:text-[#777] border-b border-gray-200 dark:border-[#222]">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Total Sales</th>
                  <th className="px-3 py-2.5">Opening Cash</th>
                  <th className="px-3 py-2.5">Cash Sales</th>
                  <th className="px-3 py-2.5">UPI Sales</th>
                  <th className="px-3 py-2.5">Expenses</th>
                  <th className="px-3 py-2.5">Closing Cash</th>
                  <th className="px-3 py-2.5">Night Tally</th>
                  <th className="px-3 py-2.5">Day Handover</th>
                  <th className="px-3 py-2.5">Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1A1A1A]">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-gray-400">
                      No shift records found.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr
                      key={r.id || r.business_date}
                      className="hover:bg-gray-50 dark:hover:bg-[#161616]/50 transition cursor-pointer"
                      onClick={() => {
                        setSelectedDate(r.business_date);
                        setActiveTab(isOwner ? "audit" : "night");
                      }}
                      title="Click to view full shift reconciliation"
                    >
                      <td className="px-3 py-2.5 font-bold font-mono text-gray-900 dark:text-white flex items-center gap-1.5">
                        {r.business_date}
                        <ArrowRight className="h-3 w-3 text-gray-400 opacity-60" />
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold text-[#D4541A]">
                        {formatCurrency(r.night_total_earnings ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-500">
                        {formatCurrency(r.night_opening_balance ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-[#ccc]">
                        {formatCurrency(r.night_cash ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-[#ccc]">
                        {formatCurrency(r.night_upi ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-rose-500">
                        {formatCurrency(r.night_expenses ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold text-gray-900 dark:text-white">
                        {formatCurrency(r.night_closing_balance ?? 0)}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.night_submitted_at ? (
                          r.night_is_tallied ? (
                            <span className="text-emerald-600 font-bold">Tallied</span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              {r.night_difference > 0 ? "+" : ""}
                              {formatCurrency(r.night_difference)}
                            </span>
                          )
                        ) : (
                          <span className="text-gray-400">Pending</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.day_submitted_at ? (
                          r.day_is_tallied ? (
                            <span className="text-emerald-600 font-bold">Tallied</span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              {(r.day_difference ?? 0) > 0 ? "+" : ""}
                              {formatCurrency(r.day_difference ?? 0)}
                            </span>
                          )
                        ) : (
                          <span className="text-gray-400">Pending</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">
                        {r.night_submitted_by_name || r.day_submitted_by_name || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
