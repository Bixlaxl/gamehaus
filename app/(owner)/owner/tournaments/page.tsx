"use client";

import { useState, useEffect } from "react";
import { 
  Trophy, Users, DollarSign, Search, Plus, Trash2, MessageCircle, 
  CheckCircle2, RefreshCw, X, AlertCircle, Sparkles, CreditCard, Clock
} from "lucide-react";
import { toast } from "sonner";

interface Participant {
  id: string;
  name: string;
  phone: string;
  amount: number;
  status: "paid" | "unpaid";
  payment_id: string | null;
  payment_method: string;
  pass_id?: string;
  created_at: string;
}

export default function OwnerTournamentsPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">("all");
  
  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newStatus, setNewStatus] = useState<"paid" | "unpaid">("paid");
  const [newMethod, setNewMethod] = useState("cash");
  const [submitting, setSubmitting] = useState(false);

  const totalSlots = 32;

  async function fetchParticipants() {
    setLoading(true);
    try {
      const res = await fetch("/api/tournament/registrations");
      const data = await res.json();
      if (data.success) {
        setParticipants(data.registrations || []);
      }
    } catch {
      toast.error("Failed to load tournament participants");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchParticipants();
  }, []);

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Please enter participant name");
      return;
    }
    const cleanPhone = newPhone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      toast.error("Please enter a valid 10-digit mobile number");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tournament/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          phone: cleanPhone,
          payment_method: newMethod,
          status: newStatus,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(`Participant added as ${newStatus.toUpperCase()}!`);
        setShowAddModal(false);
        setNewName("");
        setNewPhone("");
        setNewStatus("paid");
        setNewMethod("cash");
        fetchParticipants();
      } else {
        toast.error(data.error || "Failed to add participant");
      }
    } catch {
      toast.error("Failed to add participant");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePaidStatus = async (id: string, currentStatus: "paid" | "unpaid") => {
    const targetStatus = currentStatus === "paid" ? "unpaid" : "paid";
    try {
      const res = await fetch("/api/tournament/registrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: targetStatus, payment_method: "cash" }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Marked as ${targetStatus.toUpperCase()}`);
        fetchParticipants();
      } else {
        toast.error("Failed to update status");
      }
    } catch {
      toast.error("Error updating participant status");
    }
  };

  const handleDeleteParticipant = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove ${name} from the tournament?`)) return;

    try {
      const res = await fetch(`/api/tournament/registrations?id=${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Participant removed");
        fetchParticipants();
      } else {
        toast.error(data.error || "Failed to remove participant");
      }
    } catch {
      toast.error("Failed to remove participant");
    }
  };

  const filtered = participants.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search) ||
      (p.pass_id && p.pass_id.toLowerCase().includes(search.toLowerCase()));

    if (statusFilter === "all") return matchesSearch;
    return matchesSearch && p.status === statusFilter;
  });

  const spotsClaimed = participants.length;
  const spotsRemaining = Math.max(0, totalSlots - spotsClaimed);
  const paidCount = participants.filter((p) => p.status === "paid").length;
  const unpaidCount = participants.filter((p) => p.status === "unpaid").length;
  const collectedRevenue = paidCount * 400;
  const pendingRevenue = unpaidCount * 400;

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              8-Ball Pool Tournament
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#E2652E]/10 text-[#E2652E] border border-[#E2652E]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E2652E] animate-pulse" />
              {spotsRemaining === 0 ? "SLOTS FULL" : "REGISTRATION OPEN"}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage participants, toggle paid/unpaid status, and register walk-ins
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchParticipants}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-[#262626] bg-white dark:bg-[#141414] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1E1E1E] transition-colors"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E2652E] hover:bg-[#CE5A26] text-white font-semibold text-sm shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Participant
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {/* Total Slots */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#222222] shadow-sm">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Slots</span>
            <Users className="w-4 h-4 text-[#C9A24A]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-900 dark:text-white font-mono">
              {spotsClaimed}
            </span>
            <span className="text-sm text-gray-500 font-mono">/ {totalSlots}</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-[#222] h-2 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-[#C9A24A] h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (spotsClaimed / totalSlots) * 100)}%` }}
            />
          </div>
        </div>

        {/* Paid Entries */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#222222] shadow-sm">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Paid Entries</span>
            <CheckCircle2 className="w-4 h-4 text-[#1FAE7A]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#1FAE7A] font-mono">
              {paidCount}
            </span>
            <span className="text-xs text-gray-500 font-mono">players</span>
          </div>
          <p className="text-xs text-gray-500 mt-2 font-mono">
            ₹{collectedRevenue.toLocaleString("en-IN")} collected
          </p>
        </div>

        {/* Unpaid / Pending */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#222222] shadow-sm">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Unpaid / Reserved</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-500 font-mono">
              {unpaidCount}
            </span>
            <span className="text-xs text-gray-500 font-mono">players</span>
          </div>
          <p className="text-xs text-gray-500 mt-2 font-mono">
            ₹{pendingRevenue.toLocaleString("en-IN")} pending at desk
          </p>
        </div>

        {/* Spots Remaining */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#222222] shadow-sm">
          <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Available Spots</span>
            <Trophy className="w-4 h-4 text-[#E2652E]" />
          </div>
          <div className="text-3xl font-extrabold text-gray-900 dark:text-white font-mono">
            {spotsRemaining}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {spotsRemaining === 0 ? "Slots full" : `${spotsRemaining} slots left to claim`}
          </p>
        </div>
      </div>

      {/* Main Table Section */}
      <div className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#222222] rounded-2xl overflow-hidden shadow-sm">
        {/* Table Search & Filter Header */}
        <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-[#222222] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by player, phone, or pass ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#E2652E]"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Status Filter Tabs */}
            <div className="inline-flex rounded-xl bg-gray-100 dark:bg-[#1C1C1C] p-1 text-xs">
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  statusFilter === "all"
                    ? "bg-white dark:bg-[#2A2A2A] text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                All ({participants.length})
              </button>
              <button
                onClick={() => setStatusFilter("paid")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  statusFilter === "paid"
                    ? "bg-white dark:bg-[#2A2A2A] text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                Paid ({paidCount})
              </button>
              <button
                onClick={() => setStatusFilter("unpaid")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  statusFilter === "unpaid"
                    ? "bg-white dark:bg-[#2A2A2A] text-amber-600 dark:text-amber-400 shadow-sm"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                Unpaid ({unpaidCount})
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-[#222222] bg-gray-50/50 dark:bg-[#181818] text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="py-3.5 px-4 sm:px-6">#</th>
                <th className="py-3.5 px-4 sm:px-6">Participant</th>
                <th className="py-3.5 px-4 sm:px-6">Pass ID</th>
                <th className="py-3.5 px-4 sm:px-6">Payment Status</th>
                <th className="py-3.5 px-4 sm:px-6">Method</th>
                <th className="py-3.5 px-4 sm:px-6">Registered At</th>
                <th className="py-3.5 px-4 sm:px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-[#222222] text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#E2652E]" />
                    Loading participants...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500">
                    No participants found. Click "+ Add Participant" to register walk-ins or reserve spots.
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-[#1A1A1A] transition-colors">
                    <td className="py-4 px-4 sm:px-6 font-mono text-xs text-gray-400">
                      {idx + 1}
                    </td>
                    <td className="py-4 px-4 sm:px-6">
                      <div className="font-semibold text-gray-900 dark:text-white">{p.name}</div>
                      <div className="font-mono text-xs text-gray-500">+91 {p.phone}</div>
                    </td>
                    <td className="py-4 px-4 sm:px-6 font-mono text-xs font-bold text-[#C9A24A]">
                      {p.pass_id || "—"}
                    </td>
                    <td className="py-4 px-4 sm:px-6">
                      {p.status === "paid" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                          <CheckCircle2 className="w-3 h-3" />
                          Paid (₹400)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
                          <Clock className="w-3 h-3" />
                          Unpaid (Pending)
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 sm:px-6 text-xs text-gray-600 dark:text-gray-300 capitalize">
                      {p.payment_method}
                    </td>
                    <td className="py-4 px-4 sm:px-6 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(p.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-4 px-4 sm:px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* 1-Click Status Toggle */}
                        {p.status === "unpaid" ? (
                          <button
                            onClick={() => handleTogglePaidStatus(p.id, p.status)}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                            title="Mark as Paid"
                          >
                            Mark Paid
                          </button>
                        ) : (
                          <button
                            onClick={() => handleTogglePaidStatus(p.id, p.status)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                            title="Mark as Unpaid"
                          >
                            Mark Unpaid
                          </button>
                        )}

                        <button
                          onClick={() => {
                            const msg = encodeURIComponent(
                              `Hi ${p.name}! ${
                                p.status === "paid"
                                  ? `Your registration for the Gamehaus 8-Ball Tournament is confirmed!\nPass ID: ${p.pass_id || "GH-POOL"}`
                                  : `You have a reserved spot for the Gamehaus 8-Ball Tournament. Please complete your entry fee payment at the front desk.`
                              }`
                            );
                            window.open(`https://wa.me/91${p.phone}?text=${msg}`, "_blank");
                          }}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                          title="WhatsApp Participant"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDeleteParticipant(p.id, p.name)}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Remove Participant"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Participant Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-[#141414] border border-gray-200 dark:border-[#262626] rounded-2xl p-6 shadow-2xl relative">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 p-1 rounded-full text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-[#E2652E]" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Add Tournament Participant
              </h2>
            </div>
            <p className="text-xs text-gray-500 mb-5">
              Manually register a participant, reserve an unpaid spot, or record a cash payment.
            </p>

            <form onSubmit={handleAddParticipant} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                  PLAYER FULL NAME *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Vikram Sharma"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#E2652E]"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                  MOBILE NUMBER *
                </label>
                <input
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#E2652E] font-mono"
                  maxLength={10}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                    PAYMENT STATUS
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as "paid" | "unpaid")}
                    className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#E2652E]"
                  >
                    <option value="paid">Paid (₹400 Collected)</option>
                    <option value="unpaid">Unpaid / Reserved</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                    METHOD
                  </label>
                  <select
                    value={newMethod}
                    onChange={(e) => setNewMethod(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#E2652E]"
                  >
                    <option value="cash">Cash</option>
                    <option value="upi">UPI Direct / QR</option>
                    <option value="razorpay">Razorpay Online</option>
                    <option value="waived">Waived / VIP</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-[#262626] text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#1E1E1E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-[#E2652E] hover:bg-[#CE5A26] text-xs font-bold text-white shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {submitting ? "Adding..." : "Confirm & Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
