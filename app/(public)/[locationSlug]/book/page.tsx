"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import { useTheme } from "next-themes";
import Script from "next/script";
import { NameMismatchModal } from "@/components/pos/name-mismatch-modal";
import {
  ArrowLeft, Trash2, ShoppingCart, User, Phone,
  CreditCard, Tag, ChevronRight, Clock, Calendar, Star, CalendarX,
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
  const [validatedMembership, setValidatedMembership] = useState<any | null>(null);
  const [dismissedMembership, setDismissedMembership] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [redeemHoursInput, setRedeemHoursInput] = useState<number>(0);
  const [showValidationPopup, setShowValidationPopup] = useState(false);
  // When the typed name doesn't match the name stored against this phone,
  // we show the same Use existing / Update name choice the staff sees.
  const [nameMismatchOnline, setNameMismatchOnline] = useState<{ stored: string; entered: string } | null>(null);
  const [lookingUp, setLookingUp]     = useState(false);
  const [redeemInput, setRedeemInput] = useState("0");
  const [now, setNow]                 = useState(() => new Date());
  const [couponState, setCouponState] = useState<CouponState>({ status: "idle" });
  const [publicCoupons, setPublicCoupons] = useState<any[]>([]);
  const [publicCouponRemoved, setPublicCouponRemoved] = useState(false);
  const [showPrivateInput, setShowPrivateInput] = useState(false);
  const [checkoutAddons, setCheckoutAddons] = useState<any[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});
  // Owner-configurable booking knobs. Defaults match the pre-settings world
  // (₹100/table advance, 3hr/1hr cancellation tiers) so the page renders
  // sensibly even before /api/settings resolves.
  const [advancePerTable, setAdvancePerTable] = useState(100);
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
      .then((r) => r.json() as Promise<{ success: boolean; data?: { booking?: { advance_amount_per_table?: number; cancellation_full?: typeof cancellationTiers.full; cancellation_advance?: typeof cancellationTiers.advance } } }>)
      .then((body) => {
        if (abort || !body.success || !body.data?.booking) return;
        if (typeof body.data.booking.advance_amount_per_table === "number") {
          setAdvancePerTable(body.data.booking.advance_amount_per_table);
        }
        setCancellationTiers({
          full:    body.data.booking.cancellation_full    ?? cancellationTiers.full,
          advance: body.data.booking.cancellation_advance ?? cancellationTiers.advance,
        });
      })
      .catch(() => {});
    return () => { abort = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lookupTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const couponTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const activePublicCoupon = publicCoupons.length > 0 ? publicCoupons[0] : null;

  useEffect(() => {
    if (activePublicCoupon && paymentMode === "full" && !publicCouponRemoved && !showPrivateInput) {
      setCoupon(activePublicCoupon.code);
    } else if (paymentMode !== "full" || publicCouponRemoved || showPrivateInput) {
      if (activePublicCoupon && coupon === activePublicCoupon.code) {
        setCoupon("");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePublicCoupon, paymentMode, publicCouponRemoved, showPrivateInput]);

  useEffect(() => { setMounted(true); }, []);

  // Live tick so expired-slot warning appears even if user leaves page open
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-switch to full pay when subtotal is at or below the advance threshold
  // so the customer never gets stuck on an invalid payment mode.
  useEffect(() => {
    const advanceAmt = advancePerTable * cart.items.length;
    const currentSubtotal = cart.items.reduce((s, i) => s + i.amount, 0);
    if ((cart.items.length > 0 && currentSubtotal <= advanceAmt) || validatedMembership) {
      setPaymentMode("full");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancePerTable, cart.items, validatedMembership]);

  // Any cart item whose start time has already passed by the time the user reaches checkout
  const expiredItems = cart.items.filter(i => new Date(i.scheduledStart) <= now);
  const hasExpired   = expiredItems.length > 0;

  const subtotalForCoupon = cart.items.reduce((s, i) => s + i.amount, 0);

  // Debounced live coupon validation — fires whenever the customer changes the
  // code OR the cart subtotal changes (so the displayed discount stays accurate).
  useEffect(() => {
    if (couponTimer.current) clearTimeout(couponTimer.current);
    const trimmed = coupon.trim();
    if (!trimmed) {
      setCouponState({ status: "idle" });
      return;
    }
    if (paymentMode !== "full") {
      // Coupons only apply to full-payment orders
      setCouponState({ status: "idle" });
      return;
    }
    setCouponState({ status: "checking" });
    couponTimer.current = setTimeout(async () => {
      const url = `/api/coupons/validate?code=${encodeURIComponent(trimmed)}&location_id=${encodeURIComponent(cart.locationId ?? "")}&amount=${subtotalForCoupon}`;
      try {
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
    }, 400);
    return () => { if (couponTimer.current) clearTimeout(couponTimer.current); };
  }, [coupon, cart.locationId, subtotalForCoupon, paymentMode]);

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
  // When total cost is at or below the advance fee, there's nothing to reserve.
  // Force full pay and hide the advance option entirely.
  const forceFullPay  = (cart.items.length > 0 && subtotal <= advanceAmount) || !!validatedMembership;
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

  const boundMembershipForCart = useMemo(() => {
    if (!customer?.active_memberships) return null;
    return customer.active_memberships.find(m => {
      const hasFreeHours = Number(m.plan?.free_hrs || 0) > 0;
      const boundItemInCart = cart.items.find(item => isTableCoveredByMembership(m, item));
      if (!boundItemInCart) return false;
      const tableType = boundItemInCart.tableType || "";
      const remainingFreeHrs = getMembershipFreeHrs(m, tableType);
      return hasFreeHours && remainingFreeHrs > 0;
    });
  }, [customer, cart.items]);

  useEffect(() => {
    if (boundMembershipForCart && !validatedMembership && !dismissedMembership) {
      setShowValidationPopup(true);
    } else {
      setShowValidationPopup(false);
    }
  }, [boundMembershipForCart, validatedMembership, dismissedMembership]);

  useEffect(() => {
    setValidatedMembership(null);
    setDismissedMembership(false);
    setValidationError(null);
    setMembershipIdInput("");
    setRedeemHoursInput(0);
    setShowValidationPopup(false);
  }, [phone]);

  function handleValidateMembership() {
    if (!customer?.active_memberships) return;
    const input = membershipIdInput.trim().toUpperCase();
    
    const matched = customer.active_memberships.find(m => {
      const hasFreeHours = Number(m.plan?.free_hrs || 0) > 0;
      const boundItemInCart = cart.items.find(item => isTableCoveredByMembership(m, item));
      if (!boundItemInCart) return false;
      const tableType = boundItemInCart.tableType || "";
      const remainingFreeHrs = getMembershipFreeHrs(m, tableType);
      
      const target = (m.short_id || "").trim().toUpperCase();
      return hasFreeHours && remainingFreeHrs > 0 && input && target && input === target;
    });

    if (matched) {
      setValidatedMembership(matched);
      setValidationError(null);
      setShowValidationPopup(false);
      
      const boundItem = cart.items.find(item => isTableCoveredByMembership(matched, item));
      if (boundItem) {
        const tableType = boundItem.tableType || "";
        const availableFreeHrs = getMembershipFreeHrs(matched, tableType);
        const durationHrs = boundItem.durationMins / 60;
        setRedeemHoursInput(Math.min(durationHrs, availableFreeHrs));
      }
    } else {
      setValidationError("Incorrect Membership ID. Please try again or close this window.");
      setMembershipIdInput("");
    }
  }

  const hasBoundAssetInCart = !!(
    customer &&
    cart.items.some(item => {
      if (validatedMembership) {
        return isTableCoveredByMembership(validatedMembership, item);
      }
      return (customer.active_memberships || []).some(m => isTableCoveredByMembership(m, item));
    })
  );

  const hasGlobalDiscount = !!(customer && customer.membership_discount_pct > 0);

  const isMembershipValid = !!(
    customer &&
    (validatedMembership || hasGlobalDiscount)
  );

  let freeHoursDiscount = 0;
  let clientUpdatedLedger: Record<string, number> = {};
  if (customer && validatedMembership) {
    cart.items.forEach(i => {
      const tt = i.tableType || "";
      clientUpdatedLedger[tt] = getMembershipFreeHrs(validatedMembership, tt);
    });
  }
  const appliedLedgerDeductions: Record<string, number> = {};

  if (isMembershipValid && customer && validatedMembership) {
    for (const item of cart.items) {
      const isBound = isTableCoveredByMembership(validatedMembership, item);
      if (!isBound) continue;
      
      const durationHrs = item.durationMins / 60;
      const tableType = item.tableType || "";
      const remainingFreeHrs = Number(clientUpdatedLedger[tableType]) || 0;
      
      if (remainingFreeHrs > 0) {
        const hoursToRedeem = Math.min(redeemHoursInput > 0 ? redeemHoursInput : durationHrs, durationHrs, remainingFreeHrs);
        const discountForThisItem = hoursToRedeem * item.ratePerHour;
        freeHoursDiscount += discountForThisItem;
        
        clientUpdatedLedger[tableType] = Math.max(0, remainingFreeHrs - hoursToRedeem);
        appliedLedgerDeductions[tableType] = (appliedLedgerDeductions[tableType] || 0) + hoursToRedeem;
      }
    }
  }

  const maxRedeemableHrs = useMemo(() => {
    if (!validatedMembership) return 0;
    const boundItem = cart.items.find(item => isTableCoveredByMembership(validatedMembership, item));
    if (!boundItem) return 0;
    const tableType = boundItem.tableType || "";
    const availableFreeHrs = getMembershipFreeHrs(validatedMembership, tableType);
    const durationHrs = boundItem.durationMins / 60;
    return Math.min(durationHrs, availableFreeHrs);
  }, [validatedMembership, cart.items]);


  const hoursOptions = useMemo(() => {
    const opts = [];
    for (let h = 0.5; h <= maxRedeemableHrs; h += 0.5) {
      opts.push(h);
    }
    return opts;
  }, [maxRedeemableHrs]);

  // Member % discount base = subtotal - coupon only (mirrors orders/route.ts server logic).
  // Free hours are a SEPARATE deduction stacked on top. The public discount (coupon)
  // cannot reduce the member's base — only coupon reduces it for the % calculation.
  // At finalize, member % is re-applied live to cover extensions + extras too.
  const membershipPctDiscount = isMembershipValid && customer?.membership_discount_pct
    ? Math.round(Math.max(0, baseAfterCoupon - freeHoursDiscount) * customer.membership_discount_pct / 100 * 100) / 100
    : 0;
  const totalMembershipDiscount = freeHoursDiscount + membershipPctDiscount;
  const baseAfterMembership = Math.max(0, baseAfterCoupon - totalMembershipDiscount);

  const redeemPoints  = Math.max(0, parseInt(redeemInput) || 0);
  const maxRedeem     = Math.min(customer?.points_balance ?? 0, Math.floor(baseAfterMembership));
  // Minimum 100 points required to redeem; any input below 100 is treated as 0
  const clampedRedeem = (redeemPoints >= 100) ? Math.min(redeemPoints, maxRedeem) : 0;
  const amountToPay   = Math.max(0, baseAfterMembership - clampedRedeem);

  function triggerLookup(currentPhone: string, currentName: string) {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    setCustomer(null);
    setMembershipIdInput("");
    setRedeemInput("0");
    setNameMismatchOnline(null);
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
          name_mismatch?: boolean;
          stored_name?: string | null;
        };
        setCustomer(data.customer);
        // Same number, different name → surface the popup so the customer
        // can pick whether to use the previously-registered name or update
        // their profile to the newly entered one.
        if (data.name_mismatch && data.stored_name) {
          setNameMismatchOnline({ stored: data.stored_name, entered: currentName.trim() });
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
        membership_id:   isMembershipValid ? (validatedMembership?.id ?? customer.membership_id) : undefined,
        points_redeemed: clampedRedeem,
        payment_mode:    paymentMode,
        items: cart.items.map(i => {
          const isBound = validatedMembership?.bound_table_ids?.includes(i.tableId);
          return {
            table_id:               i.tableId,
            scheduled_start:        i.scheduledStart,
            scheduled_end:          i.scheduledEnd,
            scheduled_duration_mins: i.durationMins,
            rate_per_hour:          i.ratePerHour,
            num_people:             i.numPeople,
            free_hours_to_redeem:   isBound ? redeemHoursInput : undefined,
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
      setError(rpBody.error);
      setLoading(false);
      submitting.current = false;
      return;
    }

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
          cart.clearCart();
          router.push(`/booking/${order_id}?payment_id=${response.razorpay_payment_id}`);
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
      {nameMismatchOnline && (
        <NameMismatchModal
          existingName={nameMismatchOnline.stored}
          enteredName={nameMismatchOnline.entered}
          phone={phone}
          onCancel={() => setNameMismatchOnline(null)}
          onUseExisting={() => {
            // Drop their typed name in favour of the previously-registered one
            // and re-run the lookup so the points / membership badges appear
            // (the lookup currently returned found:false because of the mismatch).
            setName(nameMismatchOnline.stored);
            setNameMismatchOnline(null);
            triggerLookup(phone, nameMismatchOnline.stored);
          }}
          onUpdateName={() => {
            // Keep the typed name. /api/orders' upsert into customer_profiles
            // will overwrite the stored name on submit, so the owner panel
            // reflects the new name on next refresh.
            setNameMismatchOnline(null);
          }}
        />
      )}
      {showValidationPopup && boundMembershipForCart && (
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
                <h3 className="text-lg font-bold text-gray-900 dark:text-white" style={{ color: textPri }}>Redeem Free Hours</h3>
                <p className="text-xs text-gray-500" style={{ color: textSec }}>Membership plan detected for your number</p>
              </div>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: textSec }}>
              You have an active <span className="font-semibold text-purple-600 dark:text-purple-400" style={{ color: "#A855F7" }}>{boundMembershipForCart.plan?.name}</span> plan with remaining free hours on this table asset. Enter your Membership ID to unlock and redeem your free credits.
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
          className="sticky top-0 z-40 backdrop-blur-md border-b"
          style={{ background: hdrBg, borderColor: border }}
        >
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
            <Link
              href={`/${slug}`}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: chipBg, color: textSec }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="font-bold text-base" style={{ color: textPri }}>Checkout</h1>
            <div className="ml-auto flex items-center gap-1.5 text-sm font-semibold" style={{ color: textSec }}>
              <ShoppingCart className="h-4 w-4" />
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
                      {customer.points_balance} points available (₹{customer.points_balance} off)
                    </span>
                  </div>
                )}
                {/* Redeem input — only shown when customer has ≥ 100 points */}
                {!lookingUp && customer && customer.points_balance >= 100 && (
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
                      Min. 100 pts to redeem
                      {redeemPoints > 0 && redeemPoints < 100 && (
                        <span style={{ color: "#EF4444" }}> — enter 100 or more</span>
                      )}
                    </p>
                  </div>
                )}
                {/* Membership validation */}
                {!lookingUp && customer && validatedMembership && (
                  <div className="mt-4 space-y-4 p-5 rounded-xl border" style={{ background: inputBg, borderColor: "#10B981" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                          Membership Applied ({validatedMembership.short_id})
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setValidatedMembership(null);
                          setRedeemHoursInput(0);
                        }}
                        className="text-xs font-semibold text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Plan: <span className="font-semibold text-gray-900 dark:text-white">{validatedMembership.plan?.name}</span>
                      </p>
                      {validatedMembership.plan?.discount_pct > 0 && (
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          Perks: <span className="font-semibold text-purple-600 dark:text-purple-400">{validatedMembership.plan.discount_pct}% Off</span> on remaining charges.
                        </p>
                      )}
                    </div>

                    {maxRedeemableHrs > 0 && (
                      <div className="space-y-2 border-t pt-3" style={{ borderColor: border }}>
                        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: textMut }}>
                          Select Free Hours to Redeem
                        </label>
                        <div className="flex flex-col gap-2">
                          <select
                            value={redeemHoursInput}
                            onChange={(e) => setRedeemHoursInput(parseFloat(e.target.value))}
                            className="w-full px-3 py-2 rounded-xl text-sm font-semibold outline-none"
                            style={{ background: surface, border: `1.5px solid ${inputBdr}`, color: textPri }}
                          >
                            <option value={0}>0 hours (Do not redeem)</option>
                            {hoursOptions.map((h: number) => (
                              <option key={h} value={h}>
                                {h} {h === 1 ? "hour" : "hours"}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-500">
                            Available free hours: {maxRedeemableHrs} hrs max
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!lookingUp && customer && hasGlobalDiscount && !validatedMembership && (
                  <div className="mt-4 p-4 rounded-xl border" style={{ background: inputBg, borderColor: "#10B981" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                        Automated Discount Applied
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {customer.membership_discount_pct}% Off global percentage discount applied automatically matching your phone number.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Section>


          {/* Payment mode */}
          <Section surface={surface} border={border} dark={dark}>
            <SectionHeader title="Payment" border={border} textMut={textMut} />
            <div className="p-5 space-y-4">
              {/* Payment mode toggle — advance hidden when total ≤ advance threshold */}
              {forceFullPay ? (
                <div>
                  <div
                    className="p-4 rounded-xl border"
                    style={{ background: "rgba(212,84,26,0.08)", borderColor: "#D4541A", boxShadow: "0 0 0 1px #D4541A" }}
                  >
                    <CreditCard className="h-4 w-4 mb-2" style={{ color: "#D4541A" }} />
                    <p className="font-semibold text-sm" style={{ color: textPri }}>Pay in full</p>
                    <p className="text-xs mt-0.5" style={{ color: textSec }}>{formatCurrency(subtotal)}</p>
                  </div>
                  <p className="text-xs mt-2 px-1" style={{ color: textMut }}>
                    {validatedMembership
                      ? "Reserve option disabled when membership is applied — paying in full applies your membership credits directly."
                      : `Reserve option unavailable — booking total (${formatCurrency(subtotal)}) is at or below the advance threshold (${formatCurrency(advanceAmount)}).`}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {(["advance", "full"] as const).map(mode => {
                    const active = paymentMode === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => setPaymentMode(mode)}
                        className="p-4 rounded-xl border text-left transition-all"
                        style={{
                          background: active ? "rgba(212,84,26,0.08)" : inputBg,
                          borderColor: active ? "#D4541A" : inputBdr,
                          boxShadow: active ? "0 0 0 1px #D4541A" : "none",
                        }}
                      >
                        <CreditCard className="h-4 w-4 mb-2" style={{ color: active ? "#D4541A" : textMut }} />
                        <p className="font-semibold text-sm" style={{ color: textPri }}>
                          {mode === "advance"
                            ? `Reserve — ₹${advanceAmount}`
                            : "Pay in full"}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: textSec }}>
                          {mode === "advance"
                            ? cart.items.length > 1
                              ? `₹${advancePerTable}/table · rest at venue`
                              : "Rest at venue"
                            : formatCurrency(subtotal)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Non-refundable notice — only for advance/reserve mode */}
              {paymentMode === "advance" && (
                <div
                  className="rounded-xl px-4 py-3"
                  style={{ background: "rgba(239,68,68,0.07)", border: `1px solid rgba(239,68,68,0.25)` }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "#EF4444" }}>
                    Non-refundable
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: dark ? "#aaa" : "#777" }}>
                    Reservations are strictly non-refundable. The advance amount will not be returned under any circumstances.
                  </p>
                </div>
              )}

              {/* Cancellation policy — only for full payment mode */}
              {paymentMode === "full" && (() => {
                const tiers = cancellationTiers.full
                  .slice()
                  .sort((a, b) => b.hours_before - a.hours_before);
                if (tiers.length === 0) return null;
                return (
                  <div
                    className="rounded-xl px-4 py-3"
                    style={{ background: inputBg, border: `1px dashed ${inputBdr}` }}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: textMut }}>
                      Cancellation policy
                    </p>
                    <ul className="space-y-1">
                      {tiers.map((t, i) => (
                        <li key={i} className="flex justify-between text-xs">
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

              {paymentMode === "full" && (
                <div className="space-y-3">
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-1" style={{ color: textMut }}>
                    <Tag className="h-3 w-3" /> Coupon
                  </label>
                  
                  {activePublicCoupon && !publicCouponRemoved && !showPrivateInput ? (
                    <div className="rounded-xl p-4 border flex items-center justify-between transition-all"
                      style={{
                        background: "rgba(16,185,129,0.06)",
                        borderColor: "rgba(16,185,129,0.3)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4" style={{ color: "#10B981" }} />
                        <div>
                          <p className="font-semibold text-sm" style={{ color: textPri }}>
                            Deal applied: {activePublicCoupon.discount_type === "percent"
                              ? `${activePublicCoupon.discount_value}% off`
                              : `₹${activePublicCoupon.discount_value} off`} ✓
                          </p>
                          <p className="text-xs" style={{ color: textSec }}>
                            Online full prepay booking discount
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setPublicCouponRemoved(true);
                          setCoupon("");
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:bg-red-500/10 text-red-500 border border-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activePublicCoupon && !showPrivateInput ? (
                        <button
                          onClick={() => setShowPrivateInput(true)}
                          className="text-xs font-semibold hover:opacity-85 transition-opacity"
                          style={{ color: "#D4541A" }}
                        >
                          Have a private code?
                        </button>
                      ) : (
                        <>
                          <input
                            value={coupon}
                            onChange={e => setCoupon(e.target.value.toUpperCase())}
                            placeholder="PROMO10"
                            className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none tracking-widest"
                            style={{
                              background: inputBg,
                              border: `1.5px solid ${
                                couponState.status === "valid"   ? "#10B981" :
                                couponState.status === "invalid" ? "#EF4444" :
                                inputBdr
                              }`,
                              color: textPri,
                            }}
                            onFocus={e => {
                              if (couponState.status === "idle" || couponState.status === "checking") {
                                e.currentTarget.style.borderColor = "#D4541A";
                              }
                            }}
                            onBlur={e => {
                              if (couponState.status === "idle" || couponState.status === "checking") {
                                e.currentTarget.style.borderColor = inputBdr;
                              }
                            }}
                          />
                          {activePublicCoupon && (
                            <button
                              onClick={() => {
                                setShowPrivateInput(false);
                                setPublicCouponRemoved(false);
                              }}
                              className="text-xs font-semibold hover:opacity-85 transition-opacity block mt-1"
                              style={{ color: textSec }}
                            >
                              ← Back to public deal
                            </button>
                          )}
                          {couponState.status === "checking" && (
                            <p className="text-xs mt-1.5" style={{ color: textMut }}>Checking…</p>
                          )}
                          {couponState.status === "valid" && (
                            <p className="text-xs font-semibold mt-1.5" style={{ color: "#10B981" }}>
                              ✓ Applied — {couponState.discount_type === "percent"
                                ? `${couponState.discount_value}% off`
                                : `${formatCurrency(couponState.discount_value)} off`}
                              {" "}({formatCurrency(couponState.discount_amount)} saved)
                            </p>
                          )}
                          {couponState.status === "invalid" && (
                            <p className="text-xs font-semibold mt-1.5" style={{ color: "#EF4444" }}>
                              ✗ {couponState.reason}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* Summary */}
          <Section surface={surface} border={border} dark={dark}>
            <SectionHeader title="Summary" border={border} textMut={textMut} />
            <div className="p-5 space-y-3">
              <div className="flex justify-between text-sm" style={{ color: textSec }}>
                <span>Subtotal ({cart.items.length} {cart.items.length === 1 ? "table" : "tables"})</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {paymentMode === "advance" && (
                <div className="flex justify-between text-sm" style={{ color: textSec }}>
                  <span>Pay at venue</span>
                  <span>{formatCurrency(subtotal - baseAmount)}</span>
                </div>
              )}
              {effectiveDiscount > 0 && couponState.status === "valid" && (
                <div className="flex justify-between text-sm" style={{ color: "#10B981" }}>
                  <span>Coupon ({couponState.code})</span>
                  <span>-{formatCurrency(effectiveDiscount)}</span>
                </div>
              )}
              {isMembershipValid && totalMembershipDiscount > 0 && (
                <div className="space-y-1.5">
                  {freeHoursDiscount > 0 && (
                    <div className="flex justify-between text-sm" style={{ color: "#10B981" }}>
                      <span>Free Hours Discount</span>
                      <span>-{formatCurrency(freeHoursDiscount)}</span>
                    </div>
                  )}
                  {membershipPctDiscount > 0 && (
                    <div className="flex justify-between text-sm" style={{ color: "#10B981" }}>
                      <span>Membership ({customer.membership_discount_pct}% Off)</span>
                      <span>-{formatCurrency(membershipPctDiscount)}</span>
                    </div>
                  )}
                  <div className="pl-3 border-l-2 py-0.5 space-y-0.5" style={{ borderColor: "#10B981" }}>
                    {Object.entries(appliedLedgerDeductions).map(([type, hrs]) => {
                      const rem = clientUpdatedLedger[type] !== undefined ? clientUpdatedLedger[type] : 0;
                      const matchingItem = cart.items.find(i => (i.tableType || "") === type);
                      const displayName = matchingItem ? matchingItem.tableName : (type === "snooker" || type === "standard" ? "Standard Table" : type.toUpperCase());
                      return (
                        <p key={type} className="text-xs font-semibold" style={{ color: "#10B981" }}>
                          Redeemed {hrs} {hrs === 1 ? 'hr' : 'hrs'} for {displayName} ({rem} hrs remaining)
                        </p>
                      );
                    })}
                  </div>
                </div>
              )}
              {clampedRedeem > 0 && (
                <div className="flex justify-between text-sm" style={{ color: "#F59E0B" }}>
                  <span>Points redeemed ({clampedRedeem} pts)</span>
                  <span>-{formatCurrency(clampedRedeem)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t" style={{ borderColor: border, color: textPri }}>
                <span>Pay now</span>
                <span style={{ color: "#D4541A" }}>{formatCurrency(amountToPay)}</span>
              </div>
              {paymentMode === "advance" && (
                <p className="text-xs pt-1" style={{ color: textMut }}>
                  Advance is non-refundable. Pay the remaining amount at the venue.
                </p>
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
            disabled={loading || cart.items.length === 0 || hasExpired}
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
