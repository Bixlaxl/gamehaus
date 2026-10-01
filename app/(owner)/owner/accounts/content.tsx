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
  ArrowRight,
  TrendingUp,
  Wallet,
  Receipt,
  RotateCcw,
  Sparkles,
  History,
  Building2,
  Check,
  AlertCircle
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
}

export function OwnerAccountsContent({
  locations,
  initialDate,
  userName,
}: OwnerAccountsContentProps) {
  const [selectedLocId, setSelectedLocId] = useState<string>(locations[0]?.id || "");
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [activeTab, setActiveTab] = useState<"night" | "day" | "history">("night");

  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<DailyAccountRecord[]>([]);
  const [posHints, setPosHints] = useState<{
    upi_hint: number;
    cash_hint: number;
    total_hint: number;
  } | null>(null);
  const [previousNightClosing, setPreviousNightClosing] = useState<number | null>(null);

  // Night shift inputs
  const [nightUpi, setNightUpi] = useState<string>("");
  const [nightCash, setNightCash] = useState<string>("");
  const [nightOpening, setNightOpening] = useState<string>("");
  const [nightExpenses, setNightExpenses] = useState<string>("");
  const [nightClosing, setNightClosing] = useState<string>("");
  const [nightNotes, setNightNotes] = useState<string>("");
  const [submittingNight, setSubmittingNight] = useState(false);

  // Day shift inputs
  const [dayOpening, setDayOpening] = useState<string>("");
  const [dayNotes, setDayNotes] = useState<string>("");
  const [submittingDay, setSubmittingDay] = useState(false);

  // Fetch account records & hints when location or date changes
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

        // If today's record already exists, pre-fill form
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
          }
          if (currentRec.day_submitted_at) {
            setDayOpening(String(currentRec.day_opening_balance ?? ""));
            setDayNotes(currentRec.day_notes || "");
          }
        } else {
          // Reset form fields
          setNightUpi("");
          setNightCash("");
          setNightOpening(json.data.previous_night_closing != null ? String(json.data.previous_night_closing) : "");
          setNightExpenses("");
          setNightClosing("");
          setNightNotes("");
          setDayOpening(json.data.previous_night_closing != null ? String(json.data.previous_night_closing) : "");
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

  // Derived current record
  const currentRecord = useMemo(() => {
    return records.find((r) => r.business_date === selectedDate);
  }, [records, selectedDate]);

  // Real-time Night Math
  const numNightUpi = parseFloat(nightUpi) || 0;
  const numNightCash = parseFloat(nightCash) || 0;
  const numNightOpening = parseFloat(nightOpening) || 0;
  const numNightExpenses = parseFloat(nightExpenses) || 0;
  const numNightClosing = parseFloat(nightClosing) || 0;

  const liveNightEarnings = numNightUpi + numNightCash;
  const liveExpectedClosing = numNightOpening + numNightCash - numNightExpenses;
  const liveNightDiff = Math.round((numNightClosing - liveExpectedClosing) * 100) / 100;
  const liveNightTallied = Math.abs(liveNightDiff) < 0.01 && (nightClosing.trim() !== "");

  // Real-time Day Handover Math
  const numDayOpening = parseFloat(dayOpening) || 0;
  const prevClosingForDay = previousNightClosing ?? 0;
  const liveDayDiff = Math.round((numDayOpening - prevClosingForDay) * 100) / 100;
  const liveDayTallied = Math.abs(liveDayDiff) < 0.01 && (dayOpening.trim() !== "");

  // Submit Night Shift
  async function handleNightSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nightClosing.trim()) {
      toast.error("Please enter the physical closing cash balance.");
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
          toast.success("Night shift accounts verified & tallied!");
        } else {
          toast.warning(
            `Night shift saved with discrepancy of ${formatCurrency(Math.abs(json.data.difference))}`
          );
        }
        await loadData();
      } else {
        toast.error(json.error?.message || "Failed to save night shift entry");
      }
    } catch {
      toast.error("Network error saving entry");
    } finally {
      setSubmittingNight(false);
    }
  }

  // Submit Day Shift Handover
  async function handleDaySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dayOpening.trim()) {
      toast.error("Please enter the drawer opening cash balance.");
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
          toast.success("Day shift drawer handover tallied with previous night closing!");
        } else {
          toast.warning(
            `Drawer handover saved with discrepancy of ${formatCurrency(Math.abs(json.data.difference))}`
          );
        }
        await loadData();
      } else {
        toast.error(json.error?.message || "Failed to save day handover");
      }
    } catch {
      toast.error("Network error saving day handover");
    } finally {
      setSubmittingDay(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Header & Selectors */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-200 dark:border-[#1E1E1E]">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="h-7 w-7 text-[#D4541A]" />
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900 dark:text-white">
              Shift Accounts & Cash Reconciliation
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-[#888] mt-1">
            Dual-formula cash verification, drawer handover balance check, and shift reconciliation.
          </p>
        </div>

        {/* Location & Date Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-[#161616] px-3 py-1.5 rounded-xl border border-gray-200 dark:border-[#222]">
            <Building2 className="h-4 w-4 text-gray-400" />
            <select
              value={selectedLocId}
              onChange={(e) => setSelectedLocId(e.target.value)}
              className="bg-transparent text-sm font-semibold text-gray-800 dark:text-white focus:outline-none"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id} className="dark:bg-[#161616] text-black dark:text-white">
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-gray-100 dark:bg-[#161616] px-3 py-1.5 rounded-xl border border-gray-200 dark:border-[#222]">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-semibold text-gray-800 dark:text-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDate(initialDate)}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-gray-100 hover:bg-gray-200 dark:bg-[#161616] dark:hover:bg-[#222] text-gray-700 dark:text-[#aaa] transition"
            >
              Today
            </button>
            <button
              onClick={() => setSelectedDate(shiftDayStr(initialDate, -1))}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-gray-100 hover:bg-gray-200 dark:bg-[#161616] dark:hover:bg-[#222] text-gray-700 dark:text-[#aaa] transition"
            >
              Yesterday
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards: Night Status, Day Handover Status, Total Earnings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Night Tally Status */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#777]">
              Night Shift Tally
            </span>
            <span className="text-xs font-mono text-gray-400">
              Opening + Cash - Expenses = Closing
            </span>
          </div>
          <div className="my-3">
            {currentRecord?.night_submitted_at ? (
              currentRecord.night_is_tallied ? (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6 shrink-0" />
                  <div>
                    <span className="text-xl font-black">Tallied</span>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 font-medium">
                      Exact match (Diff ₹0)
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-6 w-6 shrink-0" />
                  <div>
                    <span className="text-xl font-black">Discrepancy</span>
                    <p className="text-xs font-semibold">
                      {currentRecord.night_difference > 0 ? "+" : ""}
                      {formatCurrency(currentRecord.night_difference)}
                    </p>
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 text-gray-400 dark:text-[#666]">
                <RotateCcw className="h-5 w-5" />
                <div>
                  <span className="text-lg font-bold">Pending Night Close</span>
                  <p className="text-xs">Staff has not finalized night shift</p>
                </div>
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-[#777] border-t border-gray-100 dark:border-[#1A1A1A] pt-2 flex items-center justify-between">
            <span>Closing in Drawer:</span>
            <span className="font-mono font-bold text-gray-900 dark:text-white">
              {formatCurrency(currentRecord?.night_closing_balance ?? numNightClosing)}
            </span>
          </div>
        </div>

        {/* Card 2: Day Shift Handover Status */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#777]">
              Day Shift Handover
            </span>
            <span className="text-xs font-mono text-gray-400">
              Prev Night Closing = Day Opening
            </span>
          </div>
          <div className="my-3">
            {currentRecord?.day_submitted_at ? (
              currentRecord.day_is_tallied ? (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6 shrink-0" />
                  <div>
                    <span className="text-xl font-black">Tallied Handover</span>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 font-medium">
                      Exact match with previous night
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-6 w-6 shrink-0" />
                  <div>
                    <span className="text-xl font-black">Handover Discrepancy</span>
                    <p className="text-xs font-semibold">
                      {(currentRecord.day_difference ?? 0) > 0 ? "+" : ""}
                      {formatCurrency(currentRecord.day_difference ?? 0)}
                    </p>
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 text-gray-400 dark:text-[#666]">
                <RotateCcw className="h-5 w-5" />
                <div>
                  <span className="text-lg font-bold">Pending Day Handover</span>
                  <p className="text-xs">Count drawer physical cash</p>
                </div>
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-[#777] border-t border-gray-100 dark:border-[#1A1A1A] pt-2 flex items-center justify-between">
            <span>Previous Night Closing:</span>
            <span className="font-mono font-bold text-gray-900 dark:text-white">
              {formatCurrency(previousNightClosing ?? 0)}
            </span>
          </div>
        </div>

        {/* Card 3: Total Earnings Summary */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#777]">
              Day Total Earnings
            </span>
            <span className="text-xs font-mono text-gray-400">UPI + Cash</span>
          </div>
          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                {formatCurrency(
                  currentRecord?.night_total_earnings ?? liveNightEarnings
                )}
              </span>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                (UPI: {formatCurrency(currentRecord?.night_upi ?? numNightUpi)} | Cash: {formatCurrency(currentRecord?.night_cash ?? numNightCash)})
              </span>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-[#777] border-t border-gray-100 dark:border-[#1A1A1A] pt-2 flex items-center justify-between">
            <span>POS Recorded Hint:</span>
            <span className="font-mono text-gray-700 dark:text-[#aaa]">
              {posHints ? `${formatCurrency(posHints.total_hint)} (UPI: ${formatCurrency(posHints.upi_hint)}, Cash: ${formatCurrency(posHints.cash_hint)})` : "No POS data"}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-[#1E1E1E]">
        <button
          onClick={() => setActiveTab("night")}
          className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${
            activeTab === "night"
              ? "border-[#D4541A] text-[#D4541A]"
              : "border-transparent text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <Receipt className="h-4 w-4" />
          Night Shift Closing
        </button>
        <button
          onClick={() => setActiveTab("day")}
          className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${
            activeTab === "day"
              ? "border-[#D4541A] text-[#D4541A]"
              : "border-transparent text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <Wallet className="h-4 w-4" />
          Day Shift Handover
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-all ${
            activeTab === "history"
              ? "border-[#D4541A] text-[#D4541A]"
              : "border-transparent text-gray-500 dark:text-[#777] hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <History className="h-4 w-4" />
          Reconciliation History ({records.length})
        </button>
      </div>

      {/* Tab 1: Night Shift Entry Form */}
      {activeTab === "night" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleNightSubmit} className="lg:col-span-7 space-y-4">
            <div className="p-6 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#1A1A1A]">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">
                    Night Shift Entry ({selectedDate})
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-[#888]">
                    Record shift revenue, opening float, petty cash expenses, and closing drawer balance.
                  </p>
                </div>
                {posHints && (
                  <button
                    type="button"
                    onClick={() => {
                      setNightUpi(String(posHints.upi_hint));
                      setNightCash(String(posHints.cash_hint));
                      toast.info("Auto-filled UPI & Cash from POS records!");
                    }}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-orange-500/10 text-[#D4541A] font-semibold hover:bg-orange-500/20 transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Auto-fill from POS
                  </button>
                )}
              </div>

              {/* Earnings Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-[#ccc]">
                      UPI Payments (₹)
                    </label>
                    {posHints && (
                      <span className="text-[10px] text-gray-400">
                        POS: {formatCurrency(posHints.upi_hint)}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nightUpi}
                    onChange={(e) => setNightUpi(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-[#ccc]">
                      Cash Payments (₹)
                    </label>
                    {posHints && (
                      <span className="text-[10px] text-gray-400">
                        POS: {formatCurrency(posHints.cash_hint)}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nightCash}
                    onChange={(e) => setNightCash(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                  />
                </div>
              </div>

              {/* Float & Expenses */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-[#ccc]">
                      Opening Float (₹)
                    </label>
                    {previousNightClosing != null && (
                      <button
                        type="button"
                        onClick={() => setNightOpening(String(previousNightClosing))}
                        className="text-[10px] text-[#D4541A] hover:underline"
                        title="Set from previous night's closing"
                      >
                        Prev: {formatCurrency(previousNightClosing)}
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nightOpening}
                    onChange={(e) => setNightOpening(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-[#ccc]">
                      Petty Expenses (₹)
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nightExpenses}
                    onChange={(e) => setNightExpenses(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-900 dark:text-white">
                      Physical Closing (₹)
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={nightClosing}
                    onChange={(e) => setNightClosing(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[#D4541A] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-[#ccc] mb-1.5">
                  Shift Notes / Explanations
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Paid ₹300 for cleaning supplies; ₹50 tip discrepancy..."
                  value={nightNotes}
                  onChange={(e) => setNightNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                />
              </div>

              <button
                type="submit"
                disabled={submittingNight || loading}
                className="w-full py-3 px-4 rounded-xl bg-[#D4541A] text-white font-bold text-sm tracking-wide hover:bg-[#b84414] active:scale-[0.99] transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submittingNight ? "Verifying & Saving..." : "Save & Verify Night Shift Accounts"}
              </button>
            </div>
          </form>

          {/* Right Live Math & Verification Card */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-5">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#D4541A]" />
                Live Reconciliation Formula
              </h3>

              {/* Total Earnings breakdown */}
              <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222] space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#777]">
                  1. Shift Revenue
                </span>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-[#aaa]">UPI Collection</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(numNightUpi)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-[#aaa]">Cash Collection</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(numNightCash)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-bold border-t border-gray-200 dark:border-[#222] pt-2 text-gray-900 dark:text-white">
                  <span>Total Earnings (UPI + Cash)</span>
                  <span className="font-mono text-[#D4541A]">
                    {formatCurrency(liveNightEarnings)}
                  </span>
                </div>
              </div>

              {/* Expected Closing Math */}
              <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222] space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#777]">
                  2. Cash Drawer Formula
                </span>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-[#aaa]">(+) Opening Balance</span>
                  <span className="font-mono text-gray-900 dark:text-white">
                    {formatCurrency(numNightOpening)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-[#aaa]">(+) Cash Collected</span>
                  <span className="font-mono text-gray-900 dark:text-white">
                    {formatCurrency(numNightCash)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-[#aaa]">(-) Petty Expenses</span>
                  <span className="font-mono text-gray-900 dark:text-white">
                    {formatCurrency(numNightExpenses)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-bold border-t border-gray-200 dark:border-[#222] pt-2 text-gray-900 dark:text-white">
                  <span>Expected Drawer Balance</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">
                    {formatCurrency(liveExpectedClosing)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-bold text-gray-900 dark:text-white">
                  <span>Actual Physical Count</span>
                  <span className="font-mono text-gray-900 dark:text-white">
                    {formatCurrency(numNightClosing)}
                  </span>
                </div>
              </div>

              {/* Live Tally Result Indicator */}
              <div
                className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
                  !nightClosing.trim()
                    ? "bg-gray-50 dark:bg-[#161616] border-gray-200 dark:border-[#222] text-gray-500"
                    : liveNightTallied
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                }`}
              >
                {!nightClosing.trim() ? (
                  <>
                    <RotateCcw className="h-5 w-5 shrink-0" />
                    <div>
                      <span className="font-bold text-sm">Enter Physical Closing</span>
                      <p className="text-xs text-gray-500">
                        Formula will tally when closing cash is entered.
                      </p>
                    </div>
                  </>
                ) : liveNightTallied ? (
                  <>
                    <CheckCircle2 className="h-6 w-6 shrink-0" />
                    <div>
                      <span className="font-black text-base">TALLIED</span>
                      <p className="text-xs font-semibold">
                        Drawer balance perfectly matches Opening + Cash - Expenses.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-6 w-6 shrink-0" />
                    <div>
                      <span className="font-black text-base">DISCREPANCY DETECTED</span>
                      <p className="text-xs font-semibold">
                        Difference: {liveNightDiff > 0 ? "+" : ""}{formatCurrency(liveNightDiff)} (
                        {liveNightDiff > 0 ? "Excess Cash in Drawer" : "Shortage in Drawer"})
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Day Shift Handover Form */}
      {activeTab === "day" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleDaySubmit} className="lg:col-span-7 space-y-4">
            <div className="p-6 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-5">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">
                  Day Shift Handover ({selectedDate})
                </h2>
                <p className="text-xs text-gray-500 dark:text-[#888] mt-1">
                  Morning staff counts physical cash in the drawer. It must equal the closing balance left by the previous night shift.
                </p>
              </div>

              {/* Comparison Preview Box */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222] flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#777]">
                    Previous Night Closing
                  </span>
                  <div className="font-mono text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                    {formatCurrency(previousNightClosing ?? 0)}
                  </div>
                  <span className="text-[10px] text-gray-400">
                    From date: {shiftDayStr(selectedDate, -1)}
                  </span>
                </div>
                {previousNightClosing != null && (
                  <button
                    type="button"
                    onClick={() => setDayOpening(String(previousNightClosing))}
                    className="text-xs px-3 py-1.5 rounded-lg bg-orange-500/10 text-[#D4541A] font-semibold hover:bg-orange-500/20 transition flex items-center gap-1"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Copy as Opening
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-900 dark:text-white mb-1.5">
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
                  className="w-full px-3.5 py-3 rounded-xl border-2 border-[#D4541A] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white font-mono text-base font-bold focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-[#ccc] mb-1.5">
                  Handover Notes / Discrepancy Reason
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Counted by Rahul; verified cash notes in register..."
                  value={dayNotes}
                  onChange={(e) => setDayNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-gray-50 dark:bg-[#161616] text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4541A]"
                />
              </div>

              <button
                type="submit"
                disabled={submittingDay || loading}
                className="w-full py-3 px-4 rounded-xl bg-[#D4541A] text-white font-bold text-sm tracking-wide hover:bg-[#b84414] active:scale-[0.99] transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submittingDay ? "Checking Handover..." : "Confirm & Save Day Shift Handover"}
              </button>
            </div>
          </form>

          {/* Right Live Handover Verification */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm space-y-5">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[#D4541A]" />
                Day Shift Handover Verification
              </h3>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm p-3 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222]">
                  <span className="text-gray-600 dark:text-[#aaa]">Previous Night Closing</span>
                  <span className="font-mono font-bold text-gray-900 dark:text-white">
                    {formatCurrency(prevClosingForDay)}
                  </span>
                </div>

                <div className="flex items-center justify-center text-gray-400">
                  <ArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                </div>

                <div className="flex items-center justify-between text-sm p-3 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#222]">
                  <span className="text-gray-600 dark:text-[#aaa]">New Day Physical Count</span>
                  <span className="font-mono font-bold text-[#D4541A]">
                    {formatCurrency(numDayOpening)}
                  </span>
                </div>
              </div>

              {/* Handover Status Banner */}
              <div
                className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
                  !dayOpening.trim()
                    ? "bg-gray-50 dark:bg-[#161616] border-gray-200 dark:border-[#222] text-gray-500"
                    : liveDayTallied
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                }`}
              >
                {!dayOpening.trim() ? (
                  <>
                    <RotateCcw className="h-5 w-5 shrink-0" />
                    <div>
                      <span className="font-bold text-sm">Enter Drawer Count</span>
                      <p className="text-xs text-gray-500">
                        Counts will compare against the previous night&apos;s recorded closing balance.
                      </p>
                    </div>
                  </>
                ) : liveDayTallied ? (
                  <>
                    <CheckCircle2 className="h-6 w-6 shrink-0" />
                    <div>
                      <span className="font-black text-base">TALLIED HANDOVER</span>
                      <p className="text-xs font-semibold">
                        Physical cash perfectly matches previous night closing float.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-6 w-6 shrink-0" />
                    <div>
                      <span className="font-black text-base">HANDOVER DISCREPANCY</span>
                      <p className="text-xs font-semibold">
                        Difference: {liveDayDiff > 0 ? "+" : ""}{formatCurrency(liveDayDiff)}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: History & Audit Ledger */}
      {activeTab === "history" && (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#111] border border-gray-200 dark:border-[#1E1E1E] shadow-sm overflow-hidden space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Shift Reconciliation Audit Ledger
            </h2>
            <span className="text-xs text-gray-500 font-mono">
              {records.length} records recorded
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-[#161616] text-xs uppercase font-bold text-gray-500 dark:text-[#777] border-b border-gray-200 dark:border-[#222]">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">UPI</th>
                  <th className="px-4 py-3">Cash</th>
                  <th className="px-4 py-3">Total Earnings</th>
                  <th className="px-4 py-3">Opening Float</th>
                  <th className="px-4 py-3">Expenses</th>
                  <th className="px-4 py-3">Closing</th>
                  <th className="px-4 py-3">Night Tally</th>
                  <th className="px-4 py-3">Day Handover</th>
                  <th className="px-4 py-3">Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#1A1A1A]">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                      No shift account records found for this location yet.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr
                      key={r.id || r.business_date}
                      className="hover:bg-gray-50 dark:hover:bg-[#161616]/50 transition cursor-pointer"
                      onClick={() => {
                        setSelectedDate(r.business_date);
                        setActiveTab("night");
                      }}
                    >
                      <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white font-mono">
                        {r.business_date}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600 dark:text-[#aaa]">
                        {formatCurrency(r.night_upi ?? 0)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600 dark:text-[#aaa]">
                        {formatCurrency(r.night_cash ?? 0)}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[#D4541A]">
                        {formatCurrency(r.night_total_earnings ?? 0)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600 dark:text-[#aaa]">
                        {formatCurrency(r.night_opening_balance ?? 0)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600 dark:text-[#aaa]">
                        {formatCurrency(r.night_expenses ?? 0)}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                        {formatCurrency(r.night_closing_balance ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        {r.night_submitted_at ? (
                          r.night_is_tallied ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Tallied
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
                              <AlertCircle className="h-3 w-3" />
                              {r.night_difference > 0 ? "+" : ""}{formatCurrency(r.night_difference)}
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] text-gray-400">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.day_submitted_at ? (
                          r.day_is_tallied ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Tallied
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
                              <AlertCircle className="h-3 w-3" />
                              {(r.day_difference ?? 0) > 0 ? "+" : ""}{formatCurrency(r.day_difference ?? 0)}
                            </span>
                          )
                        ) : (
                          <span className="text-[11px] text-gray-400">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-[#888]">
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
