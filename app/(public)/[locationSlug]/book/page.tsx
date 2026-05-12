"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import { useTheme } from "next-themes";
import Script from "next/script";
import {
  ArrowLeft, Trash2, ShoppingCart, User, Phone,
  CreditCard, Tag, ChevronRight, Clock, Calendar, Star,
} from "lucide-react";

interface CustomerLookup {
  name: string | null;
  points_balance: number;
  visit_count: number;
}

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
  const [lookingUp, setLookingUp]     = useState(false);
  const [redeemInput, setRedeemInput] = useState("0");
  const lookupTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitting   = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  const dark    = !mounted ? false : resolvedTheme === "dark";
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

  const subtotal      = cart.items.reduce((s, i) => s + i.amount, 0);
  const baseAmount    = paymentMode === "advance" ? 100 * cart.items.length : subtotal;
  const redeemPoints  = Math.max(0, parseInt(redeemInput) || 0);
  const maxRedeem     = Math.min(customer?.points_balance ?? 0, Math.floor(baseAmount));
  const clampedRedeem = Math.min(redeemPoints, maxRedeem);
  const amountToPay   = Math.max(0, baseAmount - clampedRedeem);

  function handlePhoneChange(val: string) {
    setPhone(val);
    setCustomer(null);
    setRedeemInput("0");
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (val.trim().length >= 6) {
      setLookingUp(true);
      lookupTimer.current = setTimeout(async () => {
        const res = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(val.trim())}`);
        const data = await res.json() as { found: boolean; customer: CustomerLookup | null };
        setCustomer(data.customer);
        if (data.found && data.customer?.name && !name.trim()) {
          setName(data.customer.name);
        }
        setLookingUp(false);
      }, 600);
    } else {
      setLookingUp(false);
    }
  }

  async function checkout() {
    if (submitting.current) return;
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone are required");
      return;
    }
    if (cart.items.length === 0) {
      setError("Cart is empty");
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
        points_redeemed: clampedRedeem,
        items: cart.items.map(i => ({
          table_id:               i.tableId,
          scheduled_start:        i.scheduledStart,
          scheduled_end:          i.scheduledEnd,
          scheduled_duration_mins: i.durationMins,
          rate_per_hour:          i.ratePerHour,
        })),
        coupon_code: coupon.trim() || undefined,
      }),
    });

    const orderBody = await orderRes.json() as
      | { success: true; data: { order_id: string } }
      | { success: false; error: string };

    if (!orderBody.success) {
      setError(orderBody.error);
      setLoading(false);
      return;
    }

    const { order_id } = orderBody.data;

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

    const options: RazorpayOptions = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
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
    setLoading(false);
    submitting.current = false;
  }

  async function demoPay() {
    if (submitting.current) return;
    if (!name.trim() || !phone.trim()) { setError("Name and phone are required"); return; }
    if (cart.items.length === 0) { setError("Cart is empty"); return; }
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
        points_redeemed: clampedRedeem,
        items: cart.items.map(i => ({
          table_id:                i.tableId,
          scheduled_start:         i.scheduledStart,
          scheduled_end:           i.scheduledEnd,
          scheduled_duration_mins: i.durationMins,
          rate_per_hour:           i.ratePerHour,
        })),
      }),
    });

    const orderBody = await orderRes.json() as
      | { success: true;  data: { order_id: string } }
      | { success: false; error: string };

    if (!orderBody.success) { setError(orderBody.error); setLoading(false); submitting.current = false; return; }

    const { order_id } = orderBody.data;

    const confirmRes = await fetch("/api/payments/demo-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id, amount: amountToPay, points_redeemed: clampedRedeem }),
    });

    const confirmBody = await confirmRes.json() as { success: boolean; error?: string };
    if (!confirmBody.success) { setError(confirmBody.error ?? "Demo confirm failed"); setLoading(false); submitting.current = false; return; }

    cart.clearCart();
    router.push(`/booking/${order_id}?demo=1`);
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
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
              cart.items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-4 px-5 py-4 border-b last:border-0"
                  style={{ borderColor: border }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ background: inputBg }}
                  >
                    {TYPE_EMOJI[item.tableType] ?? "🎯"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold capitalize" style={{ color: textPri }}>{item.tableName}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      <span className="flex items-center gap-1 text-xs" style={{ color: textSec }}>
                        <Calendar className="h-3 w-3" />
                        {fmtDate(item.scheduledStart)}
                      </span>
                      <span className="flex items-center gap-1 text-xs" style={{ color: textSec }}>
                        <Clock className="h-3 w-3" />
                        {fmtTime(item.scheduledStart)} – {fmtTime(item.scheduledEnd)}
                      </span>
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
              ))
            )}
          </Section>

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
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
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
                  value={phone}
                  onChange={e => handlePhoneChange(e.target.value)}
                  placeholder="+91 98765 43210"
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
                {!lookingUp && customer && customer.points_balance > 0 && (
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
                        onBlur={e => (e.currentTarget.style.borderColor = inputBdr)}
                      />
                      <span className="text-sm" style={{ color: textSec }}>/ {maxRedeem} pts max</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Payment mode */}
          <Section surface={surface} border={border} dark={dark}>
            <SectionHeader title="Payment" border={border} textMut={textMut} />
            <div className="p-5 space-y-4">
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
                        {mode === "advance" ? "Reserve — ₹100" : "Pay in full"}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: textSec }}>
                        {mode === "advance" ? "Rest at venue" : formatCurrency(subtotal)}
                      </p>
                    </button>
                  );
                })}
              </div>

              {paymentMode === "full" && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                    <Tag className="h-3 w-3" /> Coupon (optional)
                  </label>
                  <input
                    value={coupon}
                    onChange={e => setCoupon(e.target.value.toUpperCase())}
                    placeholder="PROMO10"
                    className="w-full px-4 py-3 rounded-xl text-sm font-medium outline-none tracking-widest"
                    style={{
                      background: inputBg,
                      border: `1.5px solid ${inputBdr}`,
                      color: textPri,
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#D4541A")}
                    onBlur={e => (e.currentTarget.style.borderColor = inputBdr)}
                  />
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

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", border: "1.5px solid rgba(239,68,68,0.3)" }}>
              {error}
            </div>
          )}

          <button
            onClick={checkout}
            disabled={loading || cart.items.length === 0}
            className="w-full py-4 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40"
            style={{
              background: "#D4541A",
              boxShadow: cart.items.length > 0 ? "0 8px 28px rgba(212,84,26,0.35)" : "none",
            }}
          >
            {loading ? "Processing..." : (
              <>Pay {formatCurrency(amountToPay)} <ChevronRight className="h-5 w-5" /></>
            )}
          </button>

          <button
            onClick={demoPay}
            disabled={loading || cart.items.length === 0}
            className="w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 border"
            style={{ color: textSec, borderColor: border, background: "transparent" }}
          >
            Demo Pay (skip Razorpay)
          </button>

          <p className="text-center text-xs pb-6" style={{ color: textMut }}>
            Secured by Razorpay · UPI, Cards, Netbanking accepted
          </p>
        </div>
      </div>
    </>
  );
}
