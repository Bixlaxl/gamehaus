"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, ShieldCheck, Trophy, Calendar, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Ticket = {
  passId: string;
  playerName: string;
  playerPhone: string;
  paymentId: string;
  amountPaid: number;
  registeredAt: string;
};

export default function TournamentRegisterPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);

  // Dynamically load Razorpay SDK
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
  }, []);

  const handlePayment = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      toast.error("Please enter a valid 10-digit mobile number");
      return;
    }

    setLoading(true);

    try {
      // ── Step 1: Create Razorpay order (server-side) ──────────────────────
      const orderRes = await fetch("/api/tournament/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: cleanPhone }),
      });

      const orderData = await orderRes.json();
      if (!orderData.success) {
        toast.error(orderData.error || "Failed to create payment order");
        setLoading(false);
        return;
      }

      // ── Step 2: Confirm registration on server (verifies signature + amount) 
      const confirmRegistration = async (
        razorpay_payment_id: string,
        razorpay_order_id: string,
        razorpay_signature: string
      ) => {
        try {
          const confirmRes = await fetch("/api/tournament/confirm-registration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_payment_id,
              razorpay_order_id,
              razorpay_signature,
              name: name.trim(),
              phone: cleanPhone,
            }),
          });

          const confirmData = await confirmRes.json();

          if (!confirmData.success) {
            toast.error(confirmData.error || "Registration confirmation failed. Please contact support.");
            setLoading(false);
            return;
          }

          // Server returned a verified, server-generated pass ID
          setTicket({
            passId: confirmData.passId,
            playerName: confirmData.playerName,
            playerPhone: confirmData.playerPhone,
            paymentId: confirmData.paymentId,
            amountPaid: confirmData.amountPaid,
            registeredAt: confirmData.registeredAt,
          });
          toast.success("Tournament Registration Confirmed!");
        } catch (err: any) {
          toast.error("Network error during confirmation. Payment may still have been captured — contact support with your phone number.");
        } finally {
          setLoading(false);
        }
      };

      // ── Step 3: Open Razorpay checkout ──────────────────────────────────
      if (typeof window !== "undefined" && (window as any).Razorpay) {
        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency || "INR",
          name: "Gamehaus Snooker Club",
          description: "8-Ball Pool Tournament Registration",
          order_id: orderData.orderId,
          handler: function (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) {
            confirmRegistration(
              response.razorpay_payment_id,
              response.razorpay_order_id,
              response.razorpay_signature
            );
          },
          prefill: {
            name: name.trim(),
            contact: cleanPhone,
          },
          theme: { color: "#E2652E" },
          modal: {
            ondismiss: () => {
              setLoading(false);
              toast.info("Payment cancelled");
            },
          },
        };

        const rzp = new (window as any).Razorpay(options);
        rzp.on("payment.failed", (resp: any) => {
          toast.error(`Payment failed: ${resp.error?.description || "Unknown error"}`);
          setLoading(false);
        });
        rzp.open();
      } else {
        // Dev fallback
        toast.info("Simulating payment in dev mode...");
        setTimeout(async () => {
          await confirmRegistration(
            `pay_test_${Date.now()}`,
            orderData.orderId,
            "mock_signature_dev"
          );
        }, 800);
      }
    } catch (err: any) {
      toast.error("Registration error: " + err.message);
      setLoading(false);
    }
  };

  const formattedDate = ticket
    ? new Date(ticket.registeredAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <div
      className="min-h-screen font-sans selection:bg-[#E2652E] selection:text-white"
      style={{ backgroundColor: "#17140F", color: "#F1ECDF" }}
    >
      {/* Top Navbar */}
      <header
        className="border-b border-[#F1ECDF]/10 sticky top-0 z-50 backdrop-blur-md"
        style={{ backgroundColor: "rgba(23, 20, 15, 0.95)" }}
      >
        <div className="max-w-xl mx-auto px-4 py-3 sm:py-3.5 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#A39C8C] hover:text-[#F1ECDF] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Website
          </Link>
          <div className="flex items-center gap-1.5">
            <Image
              src="/image.png"
              alt="Gamehaus"
              width={26}
              height={26}
              className="rounded-full border border-[#C9A24A]/40"
            />
            <span className="font-mono text-[11px] tracking-wider text-[#C9A24A] uppercase font-bold">
              GAMEHAUS
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-xl mx-auto px-3.5 sm:px-4 py-5 sm:py-8 pb-28">
        {ticket ? (
          /* ── Success: Tournament Pass ── */
          <div className="bg-[#201B14] border border-[#C9A24A]/40 rounded-xl sm:rounded-2xl p-5 sm:p-7 shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
            <div className="text-center mb-5">
              <div className="w-12 h-12 bg-[#1FAE7A]/15 border border-[#1FAE7A]/40 text-[#1FAE7A] rounded-full flex items-center justify-center mx-auto mb-2.5">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <span className="inline-block font-mono text-[9px] tracking-[0.12em] uppercase text-[#1FAE7A] bg-[#1FAE7A]/10 border border-[#1FAE7A]/30 px-2.5 py-0.5 rounded-full mb-1.5">
                CONFIRMED REGISTRATION
              </span>
              <h1
                className="text-2xl sm:text-3xl font-normal uppercase text-[#F1ECDF] tracking-wide"
                style={{ fontFamily: "'Bebas Neue', sans-serif" }}
              >
                TOURNAMENT PASS
              </h1>
              <p className="text-[11px] text-[#A39C8C] mt-0.5">
                Show this pass at Gamehaus front desk on event day
              </p>
            </div>

            {/* Digital Ticket Card */}
            <div className="bg-[#17140F] border border-[#F1ECDF]/10 rounded-lg p-4 mb-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#E2652E] via-[#C9A24A] to-[#E2652E]" />

              <div className="grid grid-cols-2 gap-3 border-b border-[#F1ECDF]/10 pb-3 mb-3">
                <div>
                  <div className="font-mono text-[8.5px] tracking-wider uppercase text-[#A39C8C]">PASS CODE</div>
                  <div className="font-mono text-xs sm:text-sm font-bold text-[#C9A24A]">{ticket.passId}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[8.5px] tracking-wider uppercase text-[#A39C8C]">ENTRY FEE PAID</div>
                  <div className="font-mono text-xs sm:text-sm font-bold text-[#1FAE7A]">₹{ticket.amountPaid.toFixed(2)}</div>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <div className="font-mono text-[8.5px] tracking-wider uppercase text-[#A39C8C]">PLAYER NAME</div>
                  <div className="text-sm font-semibold text-[#F1ECDF]">{ticket.playerName}</div>
                </div>
                <div>
                  <div className="font-mono text-[8.5px] tracking-wider uppercase text-[#A39C8C]">MOBILE NUMBER</div>
                  <div className="font-mono text-xs text-[#F1ECDF]">+91 {ticket.playerPhone}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-[#A39C8C]">
                  <div>📅 29–30 August</div>
                  <div>⏰ 10 AM – 2 PM</div>
                </div>
                <div className="pt-1 border-t border-[#F1ECDF]/10">
                  <div className="font-mono text-[8.5px] tracking-wider uppercase text-[#A39C8C]">PAYMENT ID</div>
                  <div className="font-mono text-[9px] text-[#A39C8C] break-all">{ticket.paymentId}</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2.5">
              <button
                onClick={() => {
                  const msg = encodeURIComponent(
                    `Hi Gamehaus! I registered for the 8-Ball Pool Tournament.\nPass ID: ${ticket.passId}\nName: ${ticket.playerName}\nPhone: +91 ${ticket.playerPhone}\nPayment ID: ${ticket.paymentId}`
                  );
                  window.open(`https://wa.me/919994166622?text=${msg}`, "_blank");
                }}
                className="w-full bg-[#1FAE7A] hover:bg-[#189668] text-white font-bold text-xs sm:text-sm py-3 px-4 rounded-lg sm:rounded-xl flex items-center justify-center gap-2 transition-all shadow-md"
              >
                Send Ticket Details to WhatsApp
              </button>
              <Link
                href="/"
                className="block text-center text-xs text-[#A39C8C] hover:text-[#F1ECDF] underline underline-offset-4 py-1"
              >
                Return to Gamehaus Home Page
              </Link>
            </div>
          </div>
        ) : (
          /* ── Registration Form ── */
          <div className="bg-[#201B14] border border-[#F1ECDF]/10 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.55)] relative">
            <div className="h-1 w-full bg-gradient-to-r from-[#E2652E] via-[#C9A24A] to-[#E2652E] rounded-t-xl absolute top-0 left-0 right-0" />

            <div className="mb-4 pt-1">
              <div className="inline-flex items-center gap-1.5 font-mono text-[9px] sm:text-[9.5px] tracking-wider text-[#C9A24A] uppercase bg-[#C9A24A]/10 border border-[#C9A24A]/30 px-2.5 py-0.5 rounded-full mb-2">
                <Trophy className="w-3 h-3" />
                OFFICIAL REGISTRATION
              </div>
              <h1
                className="text-2xl sm:text-3xl font-normal uppercase text-[#F1ECDF] leading-tight"
                style={{ fontFamily: "'Bebas Neue', sans-serif" }}
              >
                8-BALL POOL <span className="text-[#E2652E]">TOURNAMENT</span>
              </h1>
              <p className="text-xs text-[#A39C8C] mt-1 leading-snug">
                Complete your player details below to secure your slot. Payment is verified server-side.
              </p>
            </div>

            {/* Tournament Details Banner */}
            <div className="grid grid-cols-2 gap-2.5 bg-[#17140F] border border-[#F1ECDF]/10 rounded-lg p-2.5 sm:p-3 mb-4 text-xs">
              <div className="flex items-center gap-2 text-[#A39C8C]">
                <Calendar className="w-3.5 h-3.5 text-[#C9A24A] shrink-0" />
                <div>
                  <div className="text-[8.5px] uppercase font-mono">DATES</div>
                  <div className="font-semibold text-[#F1ECDF] text-xs">29–30 Aug</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[#A39C8C]">
                <Clock className="w-3.5 h-3.5 text-[#C9A24A] shrink-0" />
                <div>
                  <div className="text-[8.5px] uppercase font-mono">TIME</div>
                  <div className="font-semibold text-[#F1ECDF] text-xs">10 AM – 2 PM</div>
                </div>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handlePayment} className="space-y-3 sm:space-y-3.5">
              <div>
                <label className="block font-mono text-[9px] sm:text-[9.5px] tracking-wider uppercase text-[#A39C8C] mb-1">
                  PLAYER FULL NAME *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#241F17] border border-[#F1ECDF]/15 rounded-lg sm:rounded-xl px-3.5 py-2.5 sm:py-3 text-[#F1ECDF] placeholder-[#5C6355] text-xs sm:text-sm focus:outline-none focus:border-[#E2652E] transition-all"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-mono text-[9px] sm:text-[9.5px] tracking-wider uppercase text-[#A39C8C] mb-1">
                  MOBILE NUMBER (WHATSAPP) *
                </label>
                <input
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="w-full bg-[#241F17] border border-[#F1ECDF]/15 rounded-lg sm:rounded-xl px-3.5 py-2.5 sm:py-3 text-[#F1ECDF] placeholder-[#5C6355] text-xs sm:text-sm focus:outline-none focus:border-[#E2652E] transition-all font-mono"
                  maxLength={10}
                  required
                />
              </div>

              {/* Price Row */}
              <div className="bg-[#17140F] border border-[#F1ECDF]/10 rounded-lg p-3 sm:p-3.5 flex justify-between items-center my-2">
                <div>
                  <div className="font-mono text-[8.5px] tracking-wider text-[#A39C8C] uppercase">ENTRY FEE</div>
                  <div className="text-[11px] text-[#A39C8C]">Single Elimination · 32 players max</div>
                </div>
                <div className="text-right">
                  <div className="text-lg sm:text-xl font-bold text-[#E2652E] font-mono">₹400.00</div>
                  <div className="text-[8.5px] text-[#1FAE7A] flex items-center gap-1 justify-end">
                    <ShieldCheck className="w-3 h-3" /> Verified by Razorpay
                  </div>
                </div>
              </div>
            </form>

            <p className="text-[10.5px] text-[#A39C8C] text-center mt-3">
              Secured by Razorpay · Payment verified server-side
            </p>
          </div>
        )}
      </main>

      {/* Sticky Bottom Pay Bar */}
      {!ticket && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#F1ECDF]/10 p-2.5 sm:p-3.5 backdrop-blur-xl shadow-[0_-8px_25px_rgba(0,0,0,0.8)]"
          style={{ backgroundColor: "rgba(23, 20, 15, 0.96)" }}
        >
          <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
            <div className="hidden xs:block">
              <div className="font-mono text-[8.5px] tracking-wider text-[#A39C8C] uppercase">ENTRY FEE</div>
              <div className="text-base font-bold text-[#F1ECDF] font-mono leading-none">
                ₹400.00{" "}
                <span className="text-[9px] text-[#1FAE7A] font-sans font-normal ml-0.5">· 1 Slot</span>
              </div>
            </div>

            <button
              onClick={handlePayment}
              disabled={loading}
              type="button"
              className="w-full xs:w-auto flex-1 bg-[#E2652E] hover:bg-[#CE5A26] text-white font-bold text-xs sm:text-sm py-2.5 sm:py-3 px-5 rounded-lg sm:rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </div>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Proceed to Pay ₹400 →
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
