"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CalendarClock, AlertCircle } from "lucide-react";

interface RescheduleBookingModalProps {
  booking: {
    id: string;
    scheduled_start: string;
    scheduled_end: string;
    order?: {
      customer_name?: string;
      customer_phone?: string | null;
      type?: string;
    } | null;
    order_item?: {
      table?: {
        name?: string;
      } | null;
    } | null;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function RescheduleBookingModal({
  booking,
  onClose,
  onSuccess,
}: RescheduleBookingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse start/end dates
  const originalStart = new Date(booking.scheduled_start);
  const originalEnd = new Date(booking.scheduled_end);
  const durationMs = originalEnd.getTime() - originalStart.getTime();

  // Local state for date and start time (defaulted to original values in local timezone)
  const pad = (n: number) => String(n).padStart(2, "0");
  const initDate = `${originalStart.getFullYear()}-${pad(originalStart.getMonth() + 1)}-${pad(originalStart.getDate())}`;
  const initTime = `${pad(originalStart.getHours())}:${pad(originalStart.getMinutes())}`;

  const [targetDate, setTargetDate] = useState(initDate);
  const [targetTime, setTargetTime] = useState(initTime);

  // Quick shift forward handler (calls the shift_mins API)
  async function handleQuickShift(mins: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_mins: mins }),
      });

      const body = await res.json();
      if (!body.success) {
        throw new Error(body.error || "Reschedule conflicted or failed");
      }

      toast.success(`Booking shifted forward by ${mins} minutes`);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to shift booking");
      toast.error(err.message || "Failed to shift booking");
    } finally {
      setLoading(false);
    }
  }

  // Explicit date/time reschedule handler
  async function handleCustomReschedule() {
    if (!targetDate || !targetTime) {
      setError("Please select both a date and a time");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Build final start and end timestamps in local timezone
      const startParts = targetTime.split(":");
      const targetStartObj = new Date(targetDate);
      targetStartObj.setHours(Number(startParts[0]), Number(startParts[1]), 0, 0);

      const targetEndObj = new Date(targetStartObj.getTime() + durationMs);

      const res = await fetch(`/api/bookings/${booking.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_start: targetStartObj.toISOString(),
          new_end: targetEndObj.toISOString(),
        }),
      });

      const body = await res.json();
      if (!body.success) {
        throw new Error(body.error || "Reschedule conflicted or failed");
      }

      toast.success("Booking rescheduled successfully");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to reschedule booking");
      toast.error(err.message || "Failed to reschedule booking");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#262626] rounded-3xl p-6 shadow-2xl">
        <DialogHeader className="pb-3 border-b border-gray-100 dark:border-[#222]">
          <DialogTitle className="flex items-center gap-2 text-gray-900 dark:text-white font-black text-lg">
            <CalendarClock className="h-5 w-5 text-[#f59e0b]" />
            Reschedule Booking
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-5">
          {/* Guest Card */}
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-[#181818] border border-gray-100 dark:border-[#242424] space-y-2">
            <div className="flex justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Guest</span>
              <span className="text-sm font-black text-gray-900 dark:text-white">
                {booking.order?.customer_name || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Table</span>
              <span className="text-sm font-black text-[#D4541A] uppercase tracking-wide">
                {booking.order_item?.table?.name || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Original Time</span>
              <span className="text-xs font-mono font-bold text-gray-700 dark:text-[#ccc]">
                {originalStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{" "}
                {originalStart.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
              </span>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="space-y-2">
            <Label className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">
              Quick Shift Forward
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {[15, 30, 60, 120].map((mins) => (
                <Button
                  key={mins}
                  variant="outline"
                  onClick={() => handleQuickShift(mins)}
                  disabled={loading}
                  className="py-2.5 rounded-xl font-bold border-gray-200 dark:border-[#2A2A2A] hover:bg-gray-100 dark:hover:bg-[#161616]"
                >
                  +{mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Date/Time pickers */}
          <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-[#222]">
            <Label className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">
              Or Custom Date & Time
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-date" className="text-xs font-bold text-gray-400">Date</Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  disabled={loading}
                  className="rounded-xl border-gray-200 dark:border-[#2A2A2A]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-time" className="text-xs font-bold text-gray-400">Start Time</Label>
                <Input
                  id="reschedule-time"
                  type="time"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                  disabled={loading}
                  className="rounded-xl border-gray-200 dark:border-[#2A2A2A]"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/40 text-xs font-semibold flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-gray-100 dark:border-[#222] gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl font-bold"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCustomReschedule}
            disabled={loading}
            className="bg-[#f59e0b] hover:bg-[#d97706] text-white rounded-xl font-bold px-5"
          >
            {loading ? "Rescheduling..." : "Confirm Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
