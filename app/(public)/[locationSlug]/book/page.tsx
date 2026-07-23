"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import { useTheme } from "next-themes";
import type { AppSettings } from "@/lib/settings";
import Script from "next/script";
import {
  ArrowLeft, Trash2, ShoppingCart, User, Phone,
  CreditCard, Tag, ChevronRight, Clock, Calendar, Star, CalendarX,
  ShieldCheck, Shield, Check, Ban,
} from "lucide-react";

interface CustomerLookup {
  name: string | null;
  points_balance: number;
  visit_count: number;
  membership_discount_pct: number;
  membership_id: string | null;
  bound_table_ids: string[];
  free_hours_ledger: Record<string, number>;
  active_memberships?: Array<{
    id: string;
    short_id: string;
    bound_table_ids: string[];
    free_hours_ledger: Record<string, number>;
    plan: { name: string; discount_pct: number; free_hrs: number } | null;
  }>;
}

type CouponState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid"; code: string; discount_amount: number; discount_type: "percent" | "flat"; discount_value: number }
  | { status: "invalid"; reason: string };

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open: () => void };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  theme: { color: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

const TYPE_EMOJI: Record<string, string> = {
  snooker: "🎱",
  pool: "🎱",
  ps5: "🎮",
};

function Section({
  children, surface, border, dark,
}: {
  children: React.ReactNode;
  surface: string;
  border: string;
  dark: boolean;
}) {
  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: surface, borderColor: border, boxShadow: dark ? "0 2px 20px rgba(0,0,0,0.4)" : "0 2px 12px rgba(0,0,0,0.06)" }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, border, textMut }: { title: string; border: string; textMut: string }) {
  return (
    <div className="px-5 py-3.5 border-b" style={{ borderColor: border }}>
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: textMut }}>{title}</p>
    </div>
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export default function CheckoutPage() {
  const router   = useRouter();
  const params   = useParams();
  const slug     = params?.locationSlug as string ?? "";
  const cart     = useCartStore();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [name, setName]               = useState("");
  const [phone, setPhone]             = useState("");
  const [paymentMode, setPaymentMode] = useState<"advance" | "full">("advance");
  const [coupon, setCoupon]           = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [customer, setCustomer]       = useState<CustomerLookup | null>(null);
  const [membershipIdInput, setMembershipIdInput] = useState("");
  const [validatedMemberships, setValidatedMemberships] = useState<any[]>([]);
  const [dismissedMembership, setDismissedMembership] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [redeemHoursInput, setRedeemHoursInput] = useState<number>(0);
  const [itemRedeemHours, setItemRedeemHours] = useState<Record<string, number>>({});
  const [showValidationPopup, setShowValidationPopup] = useState(false);
  const [isNameMismatched, setIsNameMismatched] = useState(false);
  const [lookingUp, setLookingUp]     = useState(false);
  const [redeemInput, setRedeemInput] = useState("0");
  const [now, setNow]                 = useState(() => new Date());
  const [couponState, setCouponState] = useState<CouponState>({ status: "idle" });
  const [publicCoupons, setPublicCoupons] = useState<any[]>([]);
  const [checkoutAddons, setCheckoutAddons] = useState<any[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});
  // Owner-configurable booking knobs. Defaults match the pre-settings world
  // (₹100/table advance, 3hr/1hr cancellation tiers) so the page renders
  // sensibly even before /api/settings resolves.
  const [advancePerTable, setAdvancePerTable] = useState(100);
  const [earnRate, setEarnRate] = useState(100);
  const [redeemRate, setRedeemRate] = useState(1);
  const [minPointsToRedeem, setMinPointsToRedeem] = useState(100);
  const [cancellationTiers, setCancellationTiers] = useState<{
    full:    { hours_before: number; refund_pct: number }[];
    advance: { hours_before: number; refund_pct: number }[];
  }>({
    full:    [{ hours_before: 3, refund_pct: 100 }, { hours_before: 1, refund_pct: 50 }],
    advance: [{ hours_before: 3, refund_pct: 100 }, { hours_before: 1, refund_pct: 0  }],
  });
  useEffect(() => {
    let abort = false;
    fetch("/api/settings")
      .then((r) => r.json() as Promise<{ success: boolean; data?: AppSettings }>)
      .then((body) => {
        if (abort || !body.success || !body.data) return;
        if (body.data.booking) {
          if (typeof body.data.booking.advance_amount_per_table === "number") {
            setAdvancePerTable(body.data.booking.advance_amount_per_table);
          }
          setCancellationTiers({
            full:    body.data.booking.cancellation_full    ?? cancellationTiers.full,
            advance: body.data.booking.cancellation_advance ?? cancellationTiers.advance,
          });
        }
        if (body.data.loyalty) {
          if (typeof body.data.loyalty.earn_rupees_per_point === "number") {
            setEarnRate(body.data.loyalty.earn_rupees_per_point);
          }
          if (typeof body.data.loyalty.redeem_rupees_per_point === "number") {
            setRedeemRate(body.data.loyalty.redeem_rupees_per_point);
          }
          if (typeof body.data.loyalty.min_points_to_redeem === "number") {
            setMinPointsToRedeem(body.data.loyalty.min_points_to_redeem);
          }
        }
      })
      .catch(() => {});
    return () => { abort = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lookupTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitting   = useRef(false);

  useEffect(() => {
    if (!cart.locationId) return;
    let abort = false;
    fetch(`/api/coupons/active?location_id=${encodeURIComponent(cart.locationId)}`)
      .then((res) => res.json())
      .then((body: any) => {
        if (abort) return;
        if (body.success && Array.isArray(body.data)) {
          setPublicCoupons(body.data);
        }
      })
      .catch(() => {});
    return () => { abort = true; };
  }, [cart.locationId]);

  useEffect(() => {
    if (!cart.locationId) return;
    let abort = false;
    fetch(`/api/inventory/checkout-addons?location_id=${encodeURIComponent(cart.locationId)}`)
      .then((res) => res.json())
      .then((body: any) => {
        if (abort) return;
        if (body.success && Array.isArray(body.data)) {
          setCheckoutAddons(body.data);
        }
      })
      .catch(() => {});
    return () => { abort = true; };
  }, [cart.locationId]);

  useEffect(() => { setMounted(true); }, []);

  // Live tick so expired-slot warning appears even if user leaves page open
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Determine if any booking on a specific table is for more than 1 Hour 45 Minutes (2 Hours and above)
  const hasLongBooking = useMemo(() => {
    const tableDurations: Record<string, number> = {};
    for (const item of cart.items) {
      let mins = Number(item.durationMins);
      if (!mins || isNaN(mins) || mins <= 0) {
        if (item.scheduledStart && item.scheduledEnd) {
          const startMs = new Date(item.scheduledStart).getTime();
          const endMs = new Date(item.scheduledEnd).getTime();
          mins = (endMs - startMs) / (60 * 1000);
        } else {
          mins = 0;
        }
      }
      const tid = item.tableId || "default";
      tableDurations[tid] = (tableDurations[tid] || 0) + mins;
    }
    return Object.values(tableDurations).some((mins) => mins > 105);
  }, [cart.items]);

  // Determine if any booking in the cart is on a Saturday (6) or Sunday (0)
  const isWeekendBooking = useMemo(() => {
    return cart.items.some((item) => {
      if (!item.scheduledStart) return false;
      const d = new Date(item.scheduledStart);
      const day = d.getDay();
      return day === 0 || day === 6;
    });
  }, [cart.items]);

  // Auto-switch to full pay when subtotal is at or below the advance threshold,
  // membership is applied, booking duration exceeds 1h45m, or booking is on a weekend.
  useEffect(() => {
    const advanceAmt = advancePerTable * cart.items.length;
    const currentSubtotal = cart.items.reduce((s, i) => s + i.amount, 0);
    if ((cart.items.length > 0 && currentSubtotal <= advanceAmt) || validatedMemberships.length > 0 || hasLongBooking || isWeekendBooking) {
      setPaymentMode("full");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancePerTable, cart.items, validatedMemberships, hasLongBooking, isWeekendBooking]);

  // Any cart item whose start time has already passed by the time the user reaches checkout
  const expiredItems = cart.items.filter(i => new Date(i.scheduledStart) <= now);
  const hasExpired   = expiredItems.length > 0;

  const subtotalForCoupon = cart.items.reduce((s, i) => s + i.amount, 0);

  // Manual coupon application handler triggered only by the Apply button
  async function handleApplyCoupon(codeOverride?: string) {
    const codeToApply = (codeOverride ?? coupon).trim().toUpperCase();
    if (!codeToApply) {
      setCouponState({ status: "invalid", reason: "Please enter a coupon code" });
      return;
    }
    if (paymentMode !== "full") {
      setCouponState({ status: "invalid", reason: "Coupons are only available for Pay in Full bookings" });
      return;
    }
    setCouponState({ status: "checking" });
    try {
      const url = `/api/coupons/validate?code=${encodeURIComponent(codeToApply)}&location_id=${encodeURIComponent(cart.locationId ?? "")}&amount=${subtotalForCoupon}`;
      const res = await fetch(url);
      const body = await res.json() as
        | { success: true; data: { valid: true; code: string; discount_amount: number; discount_type: "percent" | "flat"; discount_value: number } }
        | { success: true; data: { valid: false; reason: string } }
        | { success: false; error: string };

      if (!body.success) {
        setCouponState({ status: "invalid", reason: body.error });
        return;
      }
      if (body.data.valid) {
        setCoupon(body.data.code);
        setCouponState({
          status:          "valid",
          code:            body.data.code,
          discount_amount: body.data.discount_amount,
          discount_type:   body.data.discount_type,
          discount_value:  body.data.discount_value,
        });
      } else {
        setCouponState({ status: "invalid", reason: body.data.reason });
      }
    } catch {
      setCouponState({ status: "invalid", reason: "Couldn't check this code right now" });
    }
  }

  function handleRemoveCoupon() {
    setCoupon("");
    setCouponState({ status: "idle" });
  }

  const couponDiscount = couponState.status === "valid" ? couponState.discount_amount : 0;

  const dark    = false;
  const bg      = dark ? "#0A0A0A" : "#F7F5F2";
  const surface = dark ? "#111"    : "#FFFFFF";
  const border  = dark ? "#222"    : "#EBEBEB";
  const hdrBg   = dark ? "rgba(10,10,10,0.9)" : "rgba(247,245,242,0.92)";
  const textPri = dark ? "#FFF"    : "#111";
  const textSec = dark ? "#888"    : "#666";
  const textMut = dark ? "#555"    : "#AAA";
  const inputBg = dark ? "#1A1A1A" : "#F5F3EF";
  const inputBdr= dark ? "#2A2A2A" : "#DDD";
  const chipBg  = dark ? "#1A1A1A" : "#EFEFEF";

  const extrasTotal   = useMemo(() => {
    let total = 0;
    for (const item of checkoutAddons) {
      const qty = selectedExtras[item.id] || 0;
      if (qty > 0) total += item.selling_price * qty;
    }
    return total;
  }, [checkoutAddons, selectedExtras]);

  const tableSubtotal = cart.items.reduce((s, i) => s + i.amount, 0);
  const subtotal      = tableSubtotal + extrasTotal;
  const advanceAmount = advancePerTable * cart.items.length;
  // When total cost is at or below advance fee, membership is applied, booking is > 1h 45m, or on weekend.
  // Force full pay and disable the advance option entirely.
  const forceFullPay  = (cart.items.length > 0 && subtotal <= advanceAmount) || validatedMemberships.length > 0 || hasLongBooking || isWeekendBooking;
  const baseAmount    = paymentMode === "advance" ? advanceAmount : subtotal;
  // Coupon discount only applies to "full" mode (UI hides input in advance mode anyway)
  const effectiveDiscount = paymentMode === "full" ? couponDiscount : 0;
  const baseAfterCoupon   = Math.max(0, baseAmount - effectiveDiscount);

  const isTableCoveredByMembership = (m: any, item: any) => {
    if (!m) return false;
    return !m.bound_table_ids || m.bound_table_ids.length === 0 || m.bound_table_ids.includes(item.tableId);
  };

  const getMembershipFreeHrs = (m: any, tableType: string) => {
    if (!m) return 0;
    if (m.free_hours_ledger && typeof m.free_hours_ledger[tableType] === "number") {
      return Number(m.free_hours_ledger[tableType]);
    }
    return Number(m.plan?.free_hrs || 0);
  };

  const claimableMemberships = useMemo(() => {
    if (!customer?.active_memberships) return [];
    return customer.active_memberships.filter(m => {
      const boundItemInCart = cart.items.find(item => isTableCoveredByMembership(m, item));
      if (!boundItemInCart) return false;
      const tableType = boundItemInCart.tableType || "";
      const remainingFreeHrs = getMembershipFreeHrs(m, tableType);
      const planPct = Number(m.plan?.discount_pct || 0);
      return remainingFreeHrs > 0 || planPct > 0;
    });
  }, [customer, cart.items]);

  const unvalidatedClaimableMembership = useMemo(() => {
    if (dismissedMembership) return null;
    if (validatedMemberships.length > 0) return null;
    return claimableMemberships[0] || null;
  }, [claimableMemberships, validatedMemberships, dismissedMembership]);

  useEffect(() => {
    if (unvalidatedClaimableMembership) {
      setShowValidationPopup(true);
    } else {
      setShowValidationPopup(false);
    }
  }, [unvalidatedClaimableMembership]);

  useEffect(() => {
    setValidatedMemberships([]);
    setDismissedMembership(false);
    setValidationError(null);
    setMembershipIdInput("");
    setRedeemHoursInput(0);
    setShowValidationPopup(false);
  }, [phone]);

  function handleValidateMembership() {
    if (!customer?.active_memberships) return;
    const input = membershipIdInput.trim().toUpperCase();
    
    const matched = customer.active_memberships.some(m => {
      const target = (m.short_id || "").trim().toUpperCase();
      return input && target && input === target;
    });

    if (matched) {
      setValidatedMemberships(customer.active_memberships);
      setValidationError(null);
      setMembershipIdInput("");
      setShowValidationPopup(false);
    } else {
      setValidationError("Incorrect Membership ID. Please try again or close this window.");
      setMembershipIdInput("");
    }
  }

  const hasBoundAssetInCart = !!(
    customer &&
    cart.items.some(item => {
      if (validatedMemberships.length > 0) {
        return validatedMemberships.some(vm => isTableCoveredByMembership(vm, item));
      }
      return (customer.active_memberships || []).some(m => isTableCoveredByMembership(m, item));
    })
  );

  const isMembershipValid = !!(
    customer && validatedMemberships.length > 0
  );

  const getItemKey = (item: any) => `${item.tableId}_${item.scheduledStart}`;

  let freeHoursDiscount = 0;
  const itemFreeHoursDeductions: Array<{ itemKey: string; tableName: string; tableId: string; scheduledStart: string; hrs: number; remainingHrs: number; ratePerHour: number }> = [];

  if (isMembershipValid) {
    const currentLedgers = new Map<string, Record<string, number>>();
    validatedMemberships.forEach(vm => {
      const ledgerObj: Record<string, number> = { ...(vm.free_hours_ledger || {}) };
      const defaultHrs = Number(vm.plan?.free_hrs || 0);
      ["snooker", "pool", "ps5", "foosball", "simulator", "standard"].forEach(t => {
        if (ledgerObj[t] === undefined) ledgerObj[t] = defaultHrs;
      });
      currentLedgers.set(vm.id, ledgerObj);
    });

    for (const item of cart.items) {
      const coveringVm = validatedMemberships.find(vm => {
        const covered = isTableCoveredByMembership(vm, item);
        const ledger = currentLedgers.get(vm.id);
        const tableType = item.tableType || "";
        const remHrs = ledger ? (Number(ledger[tableType]) || 0) : 0;
        console.log(`[Discount Check] Item: ${item.tableName} (${item.tableType}), VM: ${vm.plan?.name} (ID: ${vm.id}), Covered: ${covered}, LedgerHrs: ${remHrs}`);
        if (!covered) return false;
        return remHrs > 0;
      });
      console.log(`[Discount Selected] Item: ${item.tableName}, Matched VM: ${coveringVm?.plan?.name || 'none'}`);
      if (!coveringVm) continue;
      
      const ledger = currentLedgers.get(coveringVm.id);
      if (!ledger) continue;

      const durationHrs = item.durationMins / 60;
      const tableType = item.tableType || "";
      const remainingFreeHrs = Number(ledger[tableType]) || 0;
      
      if (remainingFreeHrs > 0) {
        const sessionMax = Math.min(durationHrs, remainingFreeHrs);
        const key = getItemKey(item);
        const selectedVal = itemRedeemHours[key];
        const hoursToRedeem = selectedVal !== undefined ? Math.min(selectedVal, sessionMax) : sessionMax;
        
        const discountForThisItem = hoursToRedeem * item.ratePerHour;
        freeHoursDiscount += discountForThisItem;
        
        const nextRem = Math.max(0, remainingFreeHrs - hoursToRedeem);
        ledger[tableType] = nextRem;
        
        if (hoursToRedeem > 0) {
          itemFreeHoursDeductions.push({
            itemKey: key,
            tableName: item.tableName,
            tableId: item.tableId,
            scheduledStart: item.scheduledStart,
            hrs: hoursToRedeem,
            remainingHrs: nextRem,
            ratePerHour: item.ratePerHour,
          });
        }
      }
    }
  }

  const maxRedeemableHrs = useMemo(() => {
    if (!validatedMemberships.length) return 0;
    let maxHrsInCart = 0;
    for (const item of cart.items) {
      const coveringVm = validatedMemberships.find(vm => {
        if (!isTableCoveredByMembership(vm, item)) return false;
        const tableType = item.tableType || "";
        return getMembershipFreeHrs(vm, tableType) > 0;
      });
      if (!coveringVm) continue;
      const tableType = item.tableType || "";
      const availableFreeHrs = getMembershipFreeHrs(coveringVm, tableType);
      const durationHrs = item.durationMins / 60;
      const sessionAvailable = Math.min(durationHrs, availableFreeHrs);
      if (sessionAvailable > maxHrsInCart) {
        maxHrsInCart = sessionAvailable;
      }
    }
    return maxHrsInCart;
  }, [validatedMemberships, cart.items]);

  const hoursOptions = useMemo(() => {
    const opts = [];
    for (let h = 0.5; h <= maxRedeemableHrs; h += 0.5) {
      opts.push(h);
    }
    return opts;
  }, [maxRedeemableHrs]);

  const maxValidatedPct = useMemo(() => {
    if (!validatedMemberships.length) return 0;
    return validatedMemberships.reduce((max, m) => {
      const pct = Number(m.plan?.discount_pct || 0);
      return pct > max ? pct : max;
    }, 0);
  }, [validatedMemberships]);

  const isAdvance = paymentMode === "advance";

  // 1. Calculate coupon and membership discounts on the FULL subtotal
  const fullBaseAfterCoupon = Math.max(0, subtotal - (isAdvance ? 0 : couponDiscount));
  const fullMembershipPctDiscount = !isAdvance && isMembershipValid && maxValidatedPct > 0
    ? Math.round(Math.max(0, fullBaseAfterCoupon - freeHoursDiscount) * maxValidatedPct / 100 * 100) / 100
    : 0;
  const fullTotalMembershipDiscount = isAdvance ? 0 : (freeHoursDiscount + fullMembershipPctDiscount);
  const fullBillAfterMembership = Math.max(0, fullBaseAfterCoupon - fullTotalMembershipDiscount);

  // Expose these for UI rendering block below
  const membershipPctDiscount = fullMembershipPctDiscount;
  const totalMembershipDiscount = fullTotalMembershipDiscount;

  const redeemPoints  = Math.max(0, parseInt(redeemInput) || 0);
  const maxPointsByBill = Math.floor(fullBillAfterMembership / redeemRate);
  const maxRedeem     = Math.min(customer?.points_balance ?? 0, maxPointsByBill);
  // Minimum points balance to qualify for redemption is dynamically configured — disabled for advance bookings
  const clampedRedeem = (!isAdvance && (customer?.points_balance ?? 0) >= minPointsToRedeem) ? Math.min(redeemPoints, maxRedeem) : 0;
  
  const fullRemaining = Math.max(0, fullBillAfterMembership - (clampedRedeem * redeemRate));
  const amountToPay   = isAdvance ? Math.min(advanceAmount, fullRemaining) : fullRemaining;

  function triggerLookup(currentPhone: string, currentName: string) {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    setCustomer(null);
    setMembershipIdInput("");
    setRedeemInput("0");
    setIsNameMismatched(false);
    setError(null);
    // Both a valid Indian mobile number and name are required for lookup on the public site
    const isValidIndianPhone = /^[6-9]\d{9}$/.test(currentPhone.trim());
    if (isValidIndianPhone && currentName.trim().length >= 2) {
      setLookingUp(true);
      lookupTimer.current = setTimeout(async () => {
        const url = `/api/customers/lookup?phone=${encodeURIComponent(currentPhone.trim())}&name=${encodeURIComponent(currentName.trim())}`;
        const res  = await fetch(url);
        const data = await res.json() as {
          found: boolean;
          customer: CustomerLookup | null;
          error?: string;
        };
        
        if (data.error === "mismatch") {
          setIsNameMismatched(true);
          setCustomer(null);
          setValidatedMemberships([]);
          setDismissedMembership(true);
          setShowValidationPopup(false);
          setError("The name and phone number combination entered does not match our records. Please verify your details or contact support.");
        } else {
          setIsNameMismatched(false);
          setCustomer(data.customer);
          setError(null);
        }
        setLookingUp(false);
      }, 600);
    } else {
      setLookingUp(false);
    }
  }

  function handlePhoneChange(val: string) {
    // Digits only, max 10
    const cleaned = val.replace(/\D/g, "").slice(0, 10);
    setPhone(cleaned);
    triggerLookup(cleaned, name);
  }

  function handleNameChange(val: string) {
    // Letters and spaces only
    const cleaned = val.replace(/[^a-zA-Z\s]/g, "");
    setName(cleaned);
    triggerLookup(phone, cleaned);
  }

  function removeExpiredFromCart() {
    for (const i of expiredItems) cart.removeItem(i.tableId, i.scheduledStart);
    setError(null);
  }

  async function checkout() {
    if (submitting.current) return;
    if (hasExpired) {
      setError("Some selected slots have already started. Please remove them and pick fresh slots.");
      return;
    }
    if (!name.trim() || name.trim().length < 2) {
      setError("Please enter a valid name");
      return;
    }
    if (phone.length !== 10) {
      setError("Phone must be exactly 10 digits");
      return;
    }
    if (isNameMismatched) {
      setError("The name and phone number combination entered does not match our records. Please verify your details or contact support.");
      return;
    }
    if (cart.items.length === 0) {
      setError("Cart is empty");
      return;
    }
    if (coupon.trim() && couponState.status !== "valid" && paymentMode === "full") {
      setError(couponState.status === "invalid" ? couponState.reason : "Please wait — checking your coupon");
      return;
    }
    submitting.current = true;
    setLoading(true);
    setError(null);

    const orderRes = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_id:     cart.locationId,
        type:            "online",
        customer_name:   name.trim(),
        customer_phone:  phone.trim(),
        membership_id:   isMembershipValid && validatedMemberships.length > 0 ? validatedMemberships[0].id : undefined,
        points_redeemed: clampedRedeem,
        payment_mode:    paymentMode,
        items: cart.items.map(i => {
          const coveringVm = validatedMemberships.find(vm => {
            if (!isTableCoveredByMembership(vm, i)) return false;
            const tableType = i.tableType || "";
            return getMembershipFreeHrs(vm, tableType) > 0;
          });
          return {
            table_id:               i.tableId,
            scheduled_start:        i.scheduledStart,
            scheduled_end:          i.scheduledEnd,
            scheduled_duration_mins: i.durationMins,
            rate_per_hour:          i.ratePerHour,
            num_people:             i.numPeople,
            free_hours_to_redeem:   coveringVm ? (itemFreeHoursDeductions.find(d => d.itemKey === getItemKey(i))?.hrs ?? 0) : undefined,
            membership_id:          coveringVm?.id ?? undefined,
            selected_mode_name:     i.selectedModeName ?? undefined,
          };
        }),
        extras: Object.entries(selectedExtras)
          .filter(([_, qty]) => qty > 0)
          .map(([invId, qty]) => ({ inventory_item_id: invId, quantity: qty })),
        coupon_code: (paymentMode === "full" && couponState.status === "valid") ? couponState.code : undefined,
      }),
    });

    const orderBody = await orderRes.json() as
      | { success: true; data: { order_id: string } }
      | { success: false; error: string };

    if (!orderBody.success) {
      setError(orderBody.error);
      setLoading(false);
      submitting.current = false;
      return;
    }

    const { order_id } = orderBody.data;

    if (amountToPay === 0) {
      try {
        const finRes = await fetch(`/api/orders/${order_id}/confirm-online`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coupon_code: (paymentMode === "full" && couponState.status === "valid") ? couponState.code : undefined,
            customer_phone: phone.trim(),
          }),
        });
        const finBody = await finRes.json();
        if (!finBody.success) {
          setError(finBody.error || "Failed to confirm booking");
          setLoading(false);
          submitting.current = false;
          return;
        }
        cart.clearCart();
        router.push(`/booking/${order_id}`);
      } catch (err: any) {
        setError(err?.message || "Failed to complete checkout. Please try again.");
        setLoading(false);
        submitting.current = false;
      }
      return;
    }

    // Warm up the confirmation page while Razorpay does its thing. By the
    // time the customer actually completes payment (anywhere from 5 to
    // 30+ seconds), both the JS chunk and the RSC payload for the
    // /booking/[id] route are already cached — so the post-payment
    // navigation feels instant instead of triggering a fresh server fetch.
    router.prefetch(`/booking/${order_id}`);

    const rpRes = await fetch("/api/payments/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountToPay * 100,
        currency: "INR",
        receipt: order_id,
        order_id,
      }),
    });

    const rpBody = await rpRes.json() as
      | { success: true; data: { razorpay_order_id: string; amount: number } }
      | { success: false; error: string };

    if (!rpBody.success) {
      // Cancel the DB order immediately so the slot is freed for other customers
      fetch(`/api/orders/${order_id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergency: true }),
      }).catch(() => {/* best-effort, ignore errors */});
      setError(rpBody.error);
      setLoading(false);
      submitting.current = false;
      return;
    }

    let paymentSuccess = false;
    try {
      if (typeof window === "undefined" || !window.Razorpay) {
        throw new Error("Payment gateway script is still loading. Please wait a few seconds and try again.");
      }
      if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
        throw new Error("Razorpay Client Key (NEXT_PUBLIC_RAZORPAY_KEY_ID) is not configured.");
      }

      const options: RazorpayOptions = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: rpBody.data.amount,
        currency: "INR",
        order_id: rpBody.data.razorpay_order_id,
        name: "Gamehaus",
        description: paymentMode === "advance" ? "Advance booking" : "Full payment",
        prefill: { name: name.trim(), contact: phone.trim() },
        theme: { color: "#D4541A" },
        handler: async (response) => {
          paymentSuccess = true;
          cart.clearCart();
          router.push(`/booking/${order_id}?payment_id=${response.razorpay_payment_id}`);
        },
        modal: {
          ondismiss: () => {
            if (paymentSuccess) return;
            setError("Payment window was closed. You can try again within 10 minutes.");
            setLoading(false);
            submitting.current = false;
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err: any) {
      console.error("[Razorpay Checkout Error]", err);
      setError(err?.message || "Failed to open payment gateway. Please try again.");
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  }



  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      {showValidationPopup && unvalidatedClaimableMembership && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div
            className="w-full max-w-md rounded-2xl p-6 border shadow-2xl space-y-4"
            style={{
              background: dark ? "rgba(17,17,17,0.9)" : "rgba(255,255,255,0.95)",
              borderColor: border,
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-purple-100 dark:bg-purple-950/50">
                <Star className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white" style={{ color: textPri }}>Claim Membership Benefits</h3>
                <p className="text-xs text-gray-500" style={{ color: textSec }}>Membership plan detected for your number</p>
              </div>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: textSec }}>
              You have an active <span className="font-semibold text-purple-600 dark:text-purple-400" style={{ color: "#A855F7" }}>{unvalidatedClaimableMembership.plan?.name}</span> plan with membership benefits on this asset. Enter your Membership ID to unlock and apply your offer.
            </p>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="Enter Membership ID (e.g. SNK782)"
                value={membershipIdInput}
                onChange={(e) => {
                  setMembershipIdInput(e.target.value);
                  setValidationError(null);
                }}
                className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-all uppercase tracking-wider"
                style={{
                  background: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.02)",
                  border: `1.5px solid ${validationError ? "#EF4444" : "#D4541A"}`,
                  color: textPri,
                }}
                autoFocus
              />
              {validationError && (
                <p className="text-xs font-semibold text-red-500">{validationError}</p>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDismissedMembership(true);
                  setShowValidationPopup(false);
                }}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-gray-700 dark:text-[#ccc] bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 transition-all active:scale-[0.98]"
              >
                No, Thanks
              </button>
              <button
                type="button"
                onClick={handleValidateMembership}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.98]"
                style={{ background: "#D4541A" }}
              >
                Validate ID
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="min-h-screen" style={{ background: bg }}>

        {/* Header */}
        <header
          className="sticky top-0 z-40 bg-[#D4541A] shadow-sm"
        >
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3 text-white">
            <Link
              href={`/${slug}`}
              className="flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity"
            >
              <ArrowLeft className="h-5 w-5 text-white" />
            </Link>
            <h1 className="font-bold text-base text-white">Checkout</h1>
            <div className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-white/90">
              <ShoppingCart className="h-4 w-4 text-white" />
              <span>{cart.items.length} {cart.items.length === 1 ? "item" : "items"}</span>
            </div>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

          {/* Expired-slot banner */}
          {hasExpired && (
            <div
              className="rounded-2xl border px-4 py-3.5 flex items-start gap-3"
              style={{
                background: "rgba(239,68,68,0.08)",
                borderColor: "rgba(239,68,68,0.35)",
                color: "#EF4444",
              }}
            >
              <Clock className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">
                  {expiredItems.length === 1
                    ? "1 slot has already started."
                    : `${expiredItems.length} slots have already started.`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: dark ? "#aaa" : "#777" }}>
                  Please remove them and pick fresh slots before checking out.
                </p>
              </div>
              <button
                onClick={removeExpiredFromCart}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-85 text-white"
                style={{ background: "#EF4444" }}
              >
                Remove expired
              </button>
            </div>
          )}

          {/* Cart items */}
          <Section surface={surface} border={border} dark={dark}>
            <SectionHeader title="Your booking" border={border} textMut={textMut} />
            {cart.items.length === 0 ? (
              <div className="px-5 py-12 text-center" style={{ color: textMut }}>
                <ShoppingCart className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Cart is empty</p>
                <Link href={`/${slug}`} className="text-sm font-semibold mt-2 inline-block" style={{ color: "#D4541A" }}>
                  Browse tables →
                </Link>
              </div>
            ) : (
              cart.items.map((item, i) => {
                const isExpired = new Date(item.scheduledStart) <= now;
                return (
                <div
                  key={i}
                  className="flex items-start gap-4 px-5 py-4 border-b last:border-0"
                  style={{
                    borderColor: border,
                    background: isExpired ? "rgba(239,68,68,0.06)" : undefined,
                    opacity: isExpired ? 0.85 : 1,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ background: inputBg }}
                  >
                    {TYPE_EMOJI[item.tableType] ?? "🎯"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold capitalize" style={{ color: textPri }}>{item.tableName}{item.selectedModeName ? ` (${item.selectedModeName})` : ""}</p>
                      {isExpired && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                          style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444" }}
                        >
                          Expired
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      <span className="flex items-center gap-1 text-xs" style={{ color: textSec }}>
                        <Calendar className="h-3 w-3" />
                        {fmtDate(item.scheduledStart)}
                      </span>
                      <span className="flex items-center gap-1 text-xs" style={{ color: textSec }}>
                        <Clock className="h-3 w-3" />
                        {fmtTime(item.scheduledStart)} – {fmtTime(item.scheduledEnd)}
                      </span>
                      {item.numPeople && (
                        <span className="text-xs font-medium" style={{ color: textSec }}>
                          · {item.numPeople} {item.tableType === "ps5" ? `controller${item.numPeople === 1 ? "" : "s"}` : "players"} · ₹{item.ratePerHour}/hr
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-bold text-sm" style={{ color: textPri }}>{formatCurrency(item.amount)}</span>
                    <button
                      onClick={() => cart.removeItem(item.tableId, item.scheduledStart)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                      style={{ background: inputBg, color: textMut }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#EF4444")}
                      onMouseLeave={e => (e.currentTarget.style.color = textMut)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                );
              })
            )}
          </Section>

          {/* Session Gear & Add-ons */}
          {checkoutAddons.length > 0 && (
            <Section surface={surface} border={border} dark={dark}>
              <SectionHeader title="Gear & Extras" border={border} textMut={textMut} />
              <div className="p-4 space-y-3">
                {checkoutAddons.map((item) => {
                  const qty = selectedExtras[item.id] || 0;
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-gray-100 bg-gray-50/60 transition-all">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500 font-medium">{formatCurrency(item.selling_price)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {qty > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedExtras(prev => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] || 0) - 1) }))}
                            className="w-7 h-7 rounded-lg bg-gray-200 text-gray-700 font-bold text-sm flex items-center justify-center hover:bg-gray-300 active:scale-95 transition-all"
                          >
                            -
                          </button>
                        )}
                        {qty > 0 && <span className="text-sm font-bold text-gray-900 w-4 text-center tabular-nums">{qty}</span>}
                        <button
                          type="button"
                          onClick={() => setSelectedExtras(prev => ({ ...prev, [item.id]: Math.min(item.stock_count, (prev[item.id] || 0) + 1) }))}
                          className="px-3 py-1.5 rounded-lg bg-[#111] text-white font-bold text-xs flex items-center gap-1 hover:bg-black active:scale-95 transition-all shadow-sm"
                        >
                          {qty === 0 ? "+ Add" : "+"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Customer details */}
          <Section surface={surface} border={border} dark={dark}>
            <SectionHeader title="Your details" border={border} textMut={textMut} />
            <div className="p-5 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                  <User className="h-3 w-3" /> Name
                </label>
                <input
                  value={name}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-colors"
                  style={{
                    background: inputBg,
                    border: `1.5px solid ${inputBdr}`,
                    color: textPri,
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "#D4541A")}
                  onBlur={e => (e.currentTarget.style.borderColor = inputBdr)}
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                  <Phone className="h-3 w-3" /> Phone
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={phone}
                  onChange={e => handlePhoneChange(e.target.value)}
                  placeholder="10-digit mobile number"
                  autoComplete="tel"
                  className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none transition-colors"
                  style={{ background: inputBg, border: `1.5px solid ${inputBdr}`, color: textPri }}
                  onFocus={e => (e.currentTarget.style.borderColor = "#D4541A")}
                  onBlur={e => (e.currentTarget.style.borderColor = inputBdr)}
                />
                {lookingUp && (
                  <p className="text-xs mt-1.5" style={{ color: textMut }}>Looking up...</p>
                )}
                {!lookingUp && customer && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                    <Star className="h-3.5 w-3.5 shrink-0" style={{ color: "#F59E0B" }} />
                    <span className="text-sm font-medium" style={{ color: "#F59E0B" }}>
                      {customer.points_balance} points available (₹{customer.points_balance * redeemRate} off)
                    </span>
                  </div>
                )}
                {/* Redeem input — only shown when customer has ≥ minPointsToRedeem points */}
                {!lookingUp && customer && paymentMode === "full" && customer.points_balance >= minPointsToRedeem && (
                  <div className="mt-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                      <Star className="h-3 w-3" /> Redeem points
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min="0"
                        max={maxRedeem}
                        value={redeemInput}
                        onChange={e => setRedeemInput(e.target.value)}
                        className="w-28 px-3 py-2 rounded-xl text-sm font-medium outline-none"
                        style={{ background: inputBg, border: `1.5px solid ${inputBdr}`, color: textPri }}
                        onFocus={e => (e.currentTarget.style.borderColor = "#F59E0B")}
                        onBlur={e  => (e.currentTarget.style.borderColor = inputBdr)}
                      />
                      <span className="text-sm" style={{ color: textSec }}>/ {maxRedeem} pts max</span>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: textMut }}>
                      Requires min. balance of {minPointsToRedeem} pts to redeem.
                    </p>
                  </div>
                )}
                {/* Membership validation card */}
                {!lookingUp && customer && validatedMemberships.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <div className="p-4 rounded-xl border space-y-3" style={{ background: inputBg, borderColor: "#10B981" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-xs font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                            Membership Applied ({validatedMemberships[0].short_id || "Active"})
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setValidatedMemberships([]);
                            setItemRedeemHours({});
                          }}
                          className="text-xs font-semibold text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="space-y-2 pt-2 border-t" style={{ borderColor: border }}>
                        {validatedMemberships.map((vm) => (
                          <div key={vm.id} className="text-xs">
                            <span className="font-semibold text-gray-900 dark:text-white">Plan: {vm.plan?.name}</span>
                            {vm.plan?.discount_pct > 0 && (
                              <span className="ml-2 text-purple-600 dark:text-purple-400 font-medium">({vm.plan.discount_pct}% Off)</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {cart.items.some(item => validatedMemberships.some(vm => isTableCoveredByMembership(vm, item))) && (
                      <div className="space-y-3 border-t pt-3" style={{ borderColor: border }}>
                        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: textMut }}>
                          Select Free Hours to Redeem for Each Session
                        </label>
                        <div className="space-y-2.5">
                          {cart.items.map(item => {
                            const coveringVm = validatedMemberships.find(vm => {
                              const covered = isTableCoveredByMembership(vm, item);
                              const tableType = item.tableType || "";
                              const freeHrs = getMembershipFreeHrs(vm, tableType);
                              console.log(`[Render Check] Item: ${item.tableName} (${item.tableType}), VM: ${vm.plan?.name} (ID: ${vm.id}), Covered: ${covered}, FreeHrs: ${freeHrs}`);
                              if (!covered) return false;
                              return freeHrs > 0;
                            });
                            console.log(`[Render Selected] Item: ${item.tableName}, Matched VM: ${coveringVm?.plan?.name || 'none'}`);
                            if (!coveringVm) return null;
                            const tableType = item.tableType || "";
                            const availableFreeHrs = getMembershipFreeHrs(coveringVm, tableType);
                            const durationHrs = item.durationMins / 60;
                            const sessionMax = Math.min(durationHrs, availableFreeHrs);
                            console.log(`[Render Final] Item: ${item.tableName}, Duration: ${durationHrs}, Available: ${availableFreeHrs}, sessionMax: ${sessionMax}`);
                            if (sessionMax <= 0) return null;
                            const key = getItemKey(item);
                            const currentVal = itemRedeemHours[key] !== undefined ? itemRedeemHours[key] : sessionMax;

                            const opts = [];
                            for (let h = 0.5; h <= sessionMax; h += 0.5) {
                              opts.push(h);
                            }

                            return (
                              <div key={key} className="p-3.5 rounded-xl border space-y-2 bg-gray-50/60 dark:bg-zinc-900/60" style={{ borderColor: inputBdr }}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-gray-900 dark:text-white">
                                    {item.tableName}
                                  </span>
                                  <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400">
                                    Max {sessionMax} {sessionMax === 1 ? "hr" : "hrs"} available
                                  </span>
                                </div>
                                <select
                                  value={currentVal}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setItemRedeemHours(prev => ({ ...prev, [key]: val }));
                                  }}
                                  className="w-full px-3 py-2 rounded-lg text-xs font-semibold outline-none bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white"
                                >
                                  <option value={0}>0 hours (Do not redeem)</option>
                                  {opts.map((h: number) => (
                                    <option key={h} value={h}>
                                      {h} {h === 1 ? "hour" : "hours"}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {claimableMemberships.some(m => !validatedMemberships.some(vm => vm.id === m.id)) && (
                      <button
                        onClick={() => {
                          setDismissedMembership(false);
                          setShowValidationPopup(true);
                        }}
                        className="w-full py-2.5 rounded-xl border border-dashed text-xs font-bold text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                      >
                        + Claim Another Membership ID
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Section>


          {/* Choose payment option */}
          <Section surface={surface} border={border} dark={dark}>
            <div className="p-5 space-y-4">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white" style={{ color: textPri }}>
                  Choose payment option
                </h2>
                <p className="text-xs text-gray-500 mt-0.5" style={{ color: textSec }}>
                  Pick the option that works best for you.
                </p>
              </div>

              <div className={`grid grid-cols-1 ${forceFullPay ? "" : "md:grid-cols-2"} gap-4`}>
                {/* Card 1: Reserve with Advance (hidden when forceFullPay is true) */}
                {!forceFullPay && (() => {
                  const isSelected = paymentMode === "advance";
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMode("advance");
                      }}
                      className="rounded-2xl p-4 border-2 flex flex-col justify-between text-left cursor-pointer transition-all select-none w-full"
                      style={{
                        background: isSelected ? "rgba(212,84,26,0.03)" : surface,
                        borderColor: isSelected ? "#D4541A" : border,
                        boxShadow: isSelected ? "0 4px 20px rgba(212,84,26,0.08)" : "none",
                      }}
                    >
                      <div className="w-full">
                        {/* Top Row */}
                        <div className="flex justify-between items-center w-full">
                          <div className="w-9 h-9 rounded-full bg-[#FFF5F2] flex items-center justify-center">
                            <CreditCard className="h-4 w-4" style={{ color: "#D4541A" }} />
                          </div>
                          {/* Radio indicator */}
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                            isSelected ? "border-[#D4541A] bg-[#D4541A] text-white" : "border-gray-300 bg-white"
                          }`}>
                            {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                          </div>
                        </div>

                        {/* Titles */}
                        <h3 className="font-bold text-sm text-gray-900 dark:text-white mt-4" style={{ color: textPri }}>
                          Reserve with Advance
                        </h3>
                        <p className="text-xs text-gray-500 mt-1 font-medium" style={{ color: textSec }}>
                          Pay {formatCurrency(advanceAmount)} now, rest at venue
                        </p>

                        {/* Detail list */}
                        <div className="space-y-2 mt-4">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-[#D4541A]" />
                            <span className="text-[11px] font-bold text-[#D4541A]">
                              Table held for 10 minutes
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Shield className="h-3.5 w-3.5 text-gray-400" />
                            <span className="text-[11px] font-semibold text-gray-500" style={{ color: textSec }}>
                              Advance is non-refundable
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Ban className="h-3.5 w-3.5 text-[#D4541A]" />
                            <span className="text-[11px] font-bold text-[#D4541A]">
                              Coupons not applicable
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Bottom pay container */}
                      <div className="w-full bg-gray-50 dark:bg-gray-900/60 rounded-xl p-3 flex justify-between items-center mt-5 border border-gray-100 dark:border-gray-800">
                        <span className="text-xs text-gray-500 font-semibold" style={{ color: textSec }}>Pay now</span>
                        <span className="text-sm font-extrabold text-[#D4541A]">{formatCurrency(advanceAmount)}</span>
                      </div>
                    </button>
                  );
                })()}

                {/* Card 2: Pay in Full */}
                {(() => {
                  const isSelected = paymentMode === "full" || forceFullPay;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMode("full");
                      }}
                      className="rounded-2xl p-4 border-2 flex flex-col justify-between text-left cursor-pointer transition-all select-none w-full relative"
                      style={{
                        background: isSelected ? "rgba(212,84,26,0.03)" : surface,
                        borderColor: isSelected ? "#D4541A" : border,
                        boxShadow: isSelected ? "0 4px 20px rgba(212,84,26,0.08)" : "none",
                      }}
                    >
                      <div className="w-full">
                        {/* Top Row */}
                        <div className="flex justify-between items-center w-full">
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-full bg-[#FFF5F2] flex items-center justify-center">
                              <CreditCard className="h-4 w-4" style={{ color: "#D4541A" }} />
                            </div>
                            {/* Recommended Badge */}
                            <div className="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider bg-[#D4541A] text-white flex items-center gap-0.5">
                              <Star className="h-2.5 w-2.5 fill-current" /> RECOMMENDED
                            </div>
                          </div>
                          {/* Radio indicator */}
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                            isSelected ? "border-[#D4541A] bg-[#D4541A] text-white" : "border-gray-300 bg-white"
                          }`}>
                            {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                          </div>
                        </div>

                        {/* Titles */}
                        <h3 className="font-bold text-sm text-gray-900 dark:text-white mt-4" style={{ color: textPri }}>
                          Pay in Full
                        </h3>
                        <p className="text-xs text-gray-500 mt-1 font-medium" style={{ color: textSec }}>
                          Pay {formatCurrency(subtotal)} now
                        </p>

                        {/* Detail list */}
                        <div className="space-y-2 mt-4">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-[11px] font-bold text-green-600">
                              Table held for 20 minutes
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-[11px] font-bold text-green-600">
                              Coupons accepted
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-[11px] font-bold text-green-600">
                              Better cancellation policy
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Bottom pay container */}
                      <div className="w-full bg-gray-50 dark:bg-gray-900/60 rounded-xl p-3 flex justify-between items-center mt-5 border border-gray-100 dark:border-gray-800">
                        <span className="text-xs text-gray-500 font-semibold" style={{ color: textSec }}>Pay now</span>
                        <span className="text-sm font-extrabold text-[#D4541A]">{formatCurrency(subtotal)}</span>
                      </div>
                    </button>
                  );
                })()}
              </div>

              {forceFullPay && (
                <p className="text-xs text-gray-500 mt-1 px-1" style={{ color: textMut }}>
                  {validatedMemberships.length > 0
                    ? "Reserve option disabled when membership is applied — paying in full applies your membership credits directly."
                    : isWeekendBooking
                    ? "Reserve option disabled for Saturday and Sunday bookings — full payment required."
                    : hasLongBooking
                    ? "Reserve option disabled for bookings 2 Hours and above on a table — full payment required."
                    : `Reserve option unavailable — booking total (${formatCurrency(subtotal)}) is at or below the advance threshold (${formatCurrency(advanceAmount)}).`}
                </p>
              )}
            </div>
          </Section>

          {/* Arriving late? warning box */}
          <div
            className="rounded-2xl p-4 flex items-start gap-3 border"
            style={{
              background: "rgba(212,84,26,0.02)",
              borderColor: "rgba(212,84,26,0.15)",
            }}
          >
            <div className="w-9 h-9 rounded-full bg-[#FFF5F2] flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 text-[#D4541A]" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-gray-900 dark:text-white" style={{ color: textPri }}>
                Arriving late?
              </h4>
              <p className="text-xs mt-1 text-gray-600 dark:text-gray-400 leading-relaxed" style={{ color: textSec }}>
                Fully prepaid bookings are held for <span className="font-semibold text-[#D4541A]">20 minutes</span>. Advance bookings are held for <span className="font-semibold text-[#D4541A]">10 minutes</span> from the scheduled start time.
              </p>
            </div>
          </div>

          {/* Cancellation policy description */}
          {paymentMode === "full" && (() => {
            const tiers = cancellationTiers.full
              .slice()
              .sort((a, b) => b.hours_before - a.hours_before);
            if (tiers.length === 0) return null;
            return (
              <div
                className="rounded-2xl px-4 py-3 border border-dashed"
                style={{ background: surface, borderColor: border }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: textMut }}>
                  Cancellation policy
                </p>
                <ul className="space-y-1">
                  {tiers.map((t, idx) => (
                    <li key={idx} className="flex justify-between text-xs">
                      <span style={{ color: textSec }}>
                        {t.hours_before === 0
                          ? "Less than 1 hour before"
                          : `${t.hours_before}+ hours before`}
                      </span>
                      <span className="font-bold" style={{ color: t.refund_pct > 0 ? "#10B981" : textMut }}>
                        {t.refund_pct}% refund
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Unified Summary Section */}
          <Section surface={surface} border={border} dark={dark}>
            <SectionHeader title="Summary" border={border} textMut={textMut} />
            <div className="p-5 space-y-4">
              {/* Itemized list */}
              <div className="space-y-3">
                {cart.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm text-gray-600 dark:text-gray-400" style={{ color: textSec }}>
                    <span>
                      {item.tableName} ({fmtTime(item.scheduledStart)} – {fmtTime(item.scheduledEnd)})
                    </span>
                    <span className="font-semibold">{formatCurrency(item.amount)}</span>
                  </div>
                ))}

                {/* Extras/Add-ons */}
                {checkoutAddons.map((item) => {
                  const qty = selectedExtras[item.id] || 0;
                  if (qty === 0) return null;
                  return (
                    <div key={item.id} className="flex justify-between text-sm text-gray-600 dark:text-gray-400" style={{ color: textSec }}>
                      <span>
                        {item.name} (x{qty})
                      </span>
                      <span className="font-semibold">{formatCurrency(item.selling_price * qty)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Discounts & Adjustments */}
              {(effectiveDiscount > 0 || totalMembershipDiscount > 0 || clampedRedeem > 0) && (
                <div className="space-y-2 pt-3 border-t border-dashed" style={{ borderColor: border }}>
                  {effectiveDiscount > 0 && couponState.status === "valid" && (
                    <div className="flex justify-between text-sm text-green-600 font-semibold">
                      <span>Coupon ({couponState.code})</span>
                      <span>-{formatCurrency(effectiveDiscount)}</span>
                    </div>
                  )}

                  {isMembershipValid && totalMembershipDiscount > 0 && (
                    <>
                      {freeHoursDiscount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-semibold">
                          <span>Free Hours Discount</span>
                          <span>-{formatCurrency(freeHoursDiscount)}</span>
                        </div>
                      )}
                      {membershipPctDiscount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-semibold">
                          <span>Membership ({customer.membership_discount_pct}% Off)</span>
                          <span>-{formatCurrency(membershipPctDiscount)}</span>
                        </div>
                      )}
                      {/* Detailed deductions per item */}
                      <div className="pl-3 border-l-2 py-0.5 space-y-0.5" style={{ borderColor: "#10B981" }}>
                        {itemFreeHoursDeductions.map((d) => (
                          <p key={d.itemKey} className="text-xs text-green-600 font-semibold">
                            Redeemed {d.hrs} {d.hrs === 1 ? 'hr' : 'hrs'} for {d.tableName} ({d.remainingHrs} hrs remaining)
                          </p>
                        ))}
                      </div>
                    </>
                  )}

                  {clampedRedeem > 0 && (
                    <div className="flex justify-between text-sm text-[#F59E0B] font-semibold">
                      <span>Points redeemed ({clampedRedeem} pts)</span>
                      <span>-{formatCurrency(clampedRedeem)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Total Row */}
              <div className="flex justify-between items-center font-bold text-base pt-3 border-t" style={{ borderColor: border, color: textPri }}>
                <span>Total</span>
                <span className="text-lg" style={{ color: "#D4541A" }}>{formatCurrency(amountToPay)}</span>
              </div>

              {/* Coupons Input (only for Full pre-payment) */}
              {paymentMode === "full" && (
                <div className="pt-4 border-t border-dashed space-y-3" style={{ borderColor: border }}>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider" style={{ color: textSec }}>
                    <Tag className="h-3.5 w-3.5 text-gray-400" />
                    Coupon code <span className="text-[10px] text-gray-400 font-normal lowercase tracking-normal">(Pay in Full bookings only)</span>
                  </label>

                  {couponState.status === "valid" ? (
                    <div
                      className="rounded-xl p-3 border flex items-center justify-between transition-all"
                      style={{
                        background: "rgba(16,185,129,0.04)",
                        borderColor: "rgba(16,185,129,0.3)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-emerald-600" />
                        <div>
                          <p className="font-bold text-xs text-emerald-700 dark:text-emerald-400">
                            ✓ Code Applied: {couponState.code}
                          </p>
                          <p className="text-[11px] text-emerald-600 font-medium">
                            {couponState.discount_type === "percent"
                              ? `${couponState.discount_value}% off`
                              : `${formatCurrency(couponState.discount_value)} off`}
                            {" "}({formatCurrency(couponState.discount_amount)} saved)
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-500 border border-red-500/20 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={coupon}
                          onChange={(e) => {
                            setCoupon(e.target.value.toUpperCase());
                            if (couponState.status !== "idle") {
                              setCouponState({ status: "idle" });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleApplyCoupon();
                            }
                          }}
                          placeholder="Enter coupon code"
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold outline-none transition-colors border"
                          style={{
                            background: inputBg,
                            borderColor: couponState.status === "invalid" ? "#EF4444" : inputBdr,
                            color: textPri,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleApplyCoupon()}
                          disabled={couponState.status === "checking" || !coupon.trim()}
                          className="px-5 py-2.5 rounded-xl border font-bold text-xs transition-all bg-[#FFF5F2] border-[#FDDCD0] text-[#D4541A] hover:bg-[#FFEBE5] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        >
                          {couponState.status === "checking" ? "Checking…" : "Apply"}
                        </button>
                      </div>

                      {couponState.status === "invalid" && (
                        <p className="text-xs font-semibold text-red-500">
                          ✗ {couponState.reason}
                        </p>
                      )}

                      {publicCoupons.length > 0 && (
                        <div className="pt-1 space-y-1.5">
                          <p className="text-[11px] font-semibold text-gray-500">Available deals:</p>
                          <div className="flex flex-wrap gap-2">
                            {publicCoupons.map((c: any) => (
                              <div
                                key={c.id}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 text-xs"
                              >
                                <Tag className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="font-bold text-emerald-900 dark:text-emerald-200">{c.code}</span>
                                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                  ({c.discount_type === "percent" ? `${c.discount_value}% OFF` : `₹${c.discount_value} OFF`})
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCoupon(c.code);
                                    handleApplyCoupon(c.code);
                                  }}
                                  className="ml-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[11px] hover:bg-emerald-700 transition-colors shadow-xs"
                                >
                                  Apply
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {error && (() => {
            // The "slot just got taken" error isn't the customer's fault — show
            // it as a warm warning with an explicit way back to the slot picker,
            // not a harsh validation error.
            const isSlotTaken = /just booked|just got booked|just taken/i.test(error);
            if (isSlotTaken) {
              return (
                <div
                  className="rounded-2xl p-4 flex items-start gap-3"
                  style={{
                    background: "rgba(245,158,11,0.1)",
                    border:     "1.5px solid rgba(245,158,11,0.35)",
                    color:      textPri,
                  }}
                >
                  <div
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(245,158,11,0.2)" }}
                  >
                    <CalendarX className="h-5 w-5" style={{ color: "#f59e0b" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-snug" style={{ color: textPri }}>
                      Sorry, that slot just got booked
                    </p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: textSec }}>
                      Someone grabbed it a moment ago. Head back, remove it from your cart, and pick a fresh time slot.
                    </p>
                    <Link
                      href={`/${slug}`}
                      className="inline-flex items-center gap-1 text-xs font-bold mt-2.5 transition-opacity hover:opacity-80"
                      style={{ color: "#f59e0b" }}
                    >
                      ← Back to time slots
                    </Link>
                  </div>
                </div>
              );
            }
            return (
              <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1.5px solid rgba(239,68,68,0.3)" }}>
                {error}
              </div>
            );
          })()}

          <button
            onClick={checkout}
            disabled={loading || cart.items.length === 0 || hasExpired || isNameMismatched}
            className="w-full py-4 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40"
            style={{
              background: amountToPay === 0 ? "linear-gradient(135deg, #10B981 0%, #059669 100%)" : "#D4541A",
              boxShadow: cart.items.length > 0 && !hasExpired 
                ? (amountToPay === 0 ? "0 8px 28px rgba(16,185,129,0.35)" : "0 8px 28px rgba(212,84,26,0.35)") 
                : "none",
            }}
          >
            {loading ? "Processing…" : hasExpired ? "Remove expired slots to continue" : amountToPay === 0 ? (
              <>⚡ Confirm Booking with Free Hours <ChevronRight className="h-5 w-5" /></>
            ) : (
              <>Pay {formatCurrency(amountToPay)} <ChevronRight className="h-5 w-5" /></>
            )}
          </button>



          <p className="text-center text-xs pb-6" style={{ color: textMut }}>
            {amountToPay === 0 ? "Verified by Gamehaus Membership System" : "Secured by Razorpay · UPI, Cards, Netbanking accepted"}
          </p>
        </div>
      </div>
    </>
  );
}
