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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AlertCircle, Trash2, MessageSquare } from "lucide-react";

interface CancelBookingModalProps {
  booking: {
    id: string;
    scheduled_start: string;
    scheduled_end: string;
    order?: {
      customer_name?: string;
      customer_phone?: string | null;
      advance_paid?: number;
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

export function CancelBookingModal({
  booking,
  onClose,
  onSuccess,
}: CancelBookingModalProps) {
  const [reason, setReason] = useState("Customer called to cancel");
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [loading, setLoading] = useState(false);

  const startFormatted = new Date(booking.scheduled_start).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const endFormatted = new Date(booking.scheduled_end).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const dateFormatted = new Date(booking.scheduled_start).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const advancePaid = Number(booking.order?.advance_paid || 0);

  async function handleConfirm() {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/bookings/${booking.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          send_whatsapp: sendWhatsApp,
        }),
      });

      const body = await res.json();
      if (!body.success) {
        throw new Error(body.error || "Failed to cancel booking");
      }

      toast.success("Booking cancelled and slot released");
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel booking");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#262626] rounded-3xl p-6 shadow-2xl">
        <DialogHeader className="pb-3 border-b border-gray-100 dark:border-[#222]">
          <DialogTitle className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2.5">
            <Trash2 className="h-6 w-6 text-red-500" />
            <span>Cancel Booking</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Booking Summary Box */}
          <div className="bg-gray-50 dark:bg-[#1a1a1a] rounded-2xl p-4 border border-gray-200 dark:border-[#333] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Customer</span>
              <span className="text-xs font-black px-2.5 py-0.5 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 uppercase">
                {booking.order?.type || "Booking"}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-black text-gray-900 dark:text-white">
                {booking.order?.customer_name || "—"}
              </span>
              <span className="font-mono text-sm font-semibold text-gray-600 dark:text-gray-400">
                {booking.order?.customer_phone || "No phone"}
              </span>
            </div>

            <div className="pt-2 border-t border-gray-200/60 dark:border-[#282828] flex items-center justify-between text-sm">
              <span className="font-bold text-gray-700 dark:text-gray-300">
                {booking.order_item?.table?.name || "Table Slot"}
              </span>
              <span className="font-mono font-bold text-[#D4541A]">
                {startFormatted} – {endFormatted} ({dateFormatted})
              </span>
            </div>
          </div>

          {/* Advance Paid Alert (Non-refundable) */}
          {advancePaid > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <p className="font-bold text-amber-900 dark:text-amber-300">
                  Advance Paid: ₹{advancePaid}
                </p>
                <p className="text-amber-700 dark:text-amber-400/90 leading-relaxed">
                  Manual cancellation will not initiate automated gateway refund. Advance is retained per venue policy.
                </p>
              </div>
            </div>
          )}

          {/* Reason Selector */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-gray-700 dark:text-gray-300">
              Cancellation Reason
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-12 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Customer called to cancel">Customer called to cancel</SelectItem>
                <SelectItem value="Customer requested reschedule / change">Customer requested reschedule / change</SelectItem>
                <SelectItem value="Mistake / duplicate entry by staff">Mistake / duplicate entry by staff</SelectItem>
                <SelectItem value="Customer no-show / cancelled on arrival">Customer no-show / cancelled on arrival</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* WhatsApp Notification Toggle */}
          {booking.order?.customer_phone && (
            <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-[#181818] border border-gray-200 dark:border-[#2a2a2a] rounded-2xl cursor-pointer hover:bg-gray-100 dark:hover:bg-[#202020] transition-colors">
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                className="h-4 w-4 rounded text-[#D4541A] focus:ring-[#D4541A]"
              />
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  Send cancellation confirmation on WhatsApp
                </span>
              </div>
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-gray-100 dark:border-[#222]">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="h-12 px-6 rounded-2xl font-bold"
          >
            Keep Booking
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
            className="h-12 px-6 rounded-2xl font-black bg-red-600 hover:bg-red-700 text-white"
          >
            {loading ? "Cancelling..." : "Confirm Cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
