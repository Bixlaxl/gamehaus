"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shown when the entered customer name doesn't match the existing name we
 * already have stored against that phone number. Staff (or customer on the
 * online checkout) picks: use the stored name, or overwrite it with the new
 * one they just typed.
 *
 * The phone number is treated as the customer identity — a single profile
 * row in `customer_profiles` keyed by `phone`. Whichever name flows through
 * the next walk-in / order / finalize call gets upserted into that row.
 */
interface Props {
  existingName: string;
  enteredName:  string;
  phone:        string;
  /** Use the previously stored name (current name on the form gets replaced). */
  onUseExisting: () => void;
  /** Keep the newly typed name (the upsert in the order route will replace
   *  the stored name when the order goes through). */
  onUpdateName:  () => void;
  onCancel:      () => void;
}

export function NameMismatchModal({
  existingName, enteredName, phone,
  onUseExisting, onUpdateName, onCancel,
}: Props) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-[#1F1F1F]">
          <DialogTitle className="text-base font-bold text-gray-900 dark:text-white">
            Name doesn&apos;t match
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 dark:text-[#999]">
            Phone <span className="font-mono font-bold text-gray-900 dark:text-white">{phone}</span> is
            already on file with a different name. Pick which one to use.
          </p>

          <div className="space-y-2">
            <div
              className="rounded-xl px-4 py-3 border"
              style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.25)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#10b981" }}>
                Existing
              </p>
              <p className="text-base font-bold text-gray-900 dark:text-white mt-1">
                {existingName}
              </p>
            </div>
            <div
              className="rounded-xl px-4 py-3 border"
              style={{ background: "rgba(212,84,26,0.08)", borderColor: "rgba(212,84,26,0.25)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#D4541A" }}>
                Entered
              </p>
              <p className="text-base font-bold text-gray-900 dark:text-white mt-1">
                {enteredName}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={onUseExisting}
              className="py-2.5 rounded-lg text-sm font-bold transition-colors
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-[#222]"
            >
              Use existing
            </button>
            <button
              onClick={onUpdateName}
              className="py-2.5 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: "#D4541A" }}
            >
              Update name
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
