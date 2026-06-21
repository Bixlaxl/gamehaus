"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Clock, ChevronRight, Lock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface Location {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  opening_time: string;
  closing_time: string;
  slug: string;
  image_urls: string[];
}

interface Coupon {
  id: string;
  location_id: string | null;
  code: string;
  discount_type: "percent" | "flat";
  discount_value: number;
  valid_from: string;
  valid_until: string;
}

type Phase = "loading" | "enter" | "hold" | "exit" | "gone";

function isOpenNow(opening: string, closing: string): boolean {
  const now = new Date();
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  if (closeMins < openMins) return nowMins >= openMins || nowMins < closeMins;
  return nowMins >= openMins && nowMins < closeMins;
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""} ${ampm}`;
}

function LocationSlideshow({ image_urls, alt, accent }: { image_urls: string[]; alt: string; accent: string }) {
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    if (!image_urls || image_urls.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIdx((prev) => (prev + 1) % image_urls.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [image_urls]);

  if (!image_urls || image_urls.length === 0) {
    return (
      <div 
        className="w-full h-full flex flex-col items-center justify-center gap-2"
        style={{
          background: `linear-gradient(135deg, ${accent}15, ${accent}25)`
        }}
      >
        <span className="text-4xl">🎱🎮</span>
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Gamehaus</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#121212]">
      {image_urls.map((url, index) => {
        const isActive = index === currentIdx;
        return (
          <div
            key={url}
            className="absolute inset-0 w-full h-full transition-opacity duration-1000"
            style={{
              opacity: isActive ? 1 : 0,
              zIndex: isActive ? 1 : 0,
            }}
          >
            {/* Blurred background image to fill empty space for non-standard aspect ratios */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-30 pointer-events-none"
            />
            {/* Sharp centered foreground image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${alt} - image ${index + 1}`}
              className="relative w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
            />
          </div>
        );
      })}
    </div>
  );
}

export function SplashHero({ locations, coupons = [] }: { locations: Location[]; coupons?: Coupon[] }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [adminLoading, setAdminLoading] = useState(false);
  const router = useRouter();

  // Prefetch the location browse routes (RSC + JS chunks) so first tap is instant.
  // The location page server-fetches today's slot data into the RSC payload,
  // so router.prefetch covers both the JS chunks and the initial slot data.
  useEffect(() => {
    for (const loc of locations) router.prefetch(`/${loc.slug}`);
    router.prefetch("/login");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onImageReady() {
    setPhase("enter");
    setTimeout(() => setPhase("hold"),  200);
    setTimeout(() => setPhase("exit"),  1400);
    setTimeout(() => setPhase("gone"),  2100);
  }

  const bg        = "#F5F3EE";
  const textPri   = "#1A1A1A";
  const textSec   = "#888888";
  const textMuted = "#AAAAAA";

  return (
    <div className="relative min-h-screen transition-colors duration-300" style={{ background: bg }}>

      {/* ── Curtain splash ─────────────────────────────────────── */}
      {phase !== "gone" && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{
            background: "#0A0A0A",
            transform: phase === "exit" ? "translateY(-100%)" : "translateY(0)",
            transition: phase === "exit"
              ? "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)"
              : "none",
          }}
        >
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 400, height: 400,
              background: "radial-gradient(circle, rgba(212,84,26,0.2) 0%, transparent 65%)",
              opacity: phase === "hold" ? 1 : 0,
              transition: "opacity 700ms ease-in-out",
            }}
          />

          <div
            style={{
              opacity:   phase === "loading" ? 0 : 1,
              transform: phase === "loading" ? "scale(0.78)" : "scale(1)",
              transition: phase === "enter"
                ? "opacity 500ms ease-out, transform 650ms cubic-bezier(0.22,1,0.36,1)"
                : "none",
            }}
          >
            <Image
              src="/image.png"
              alt="Gamehaus"
              width={190}
              height={190}
              priority
              className="rounded-full w-36 h-36 sm:w-[190px] sm:h-[190px]"
              onLoad={onImageReady}
            />
          </div>

          <div
            className="mt-4 sm:mt-5 text-center px-6"
            style={{
              opacity:   phase === "hold" ? 1 : 0,
              transform: phase === "hold" ? "translateY(0)" : "translateY(10px)",
              transition: "opacity 500ms ease-in-out, transform 500ms ease-out",
            }}
          >
            <p className="text-[#DDDDDD] text-sm font-bold tracking-[0.2em] sm:tracking-[0.3em] uppercase">
              Snookers &amp; Gaming
            </p>
            <p className="text-[#AAAAAA] text-xs font-bold tracking-[0.15em] sm:tracking-[0.2em] uppercase mt-1">
              by Nerf Turf
            </p>
          </div>

          <div
            className="absolute bottom-0 left-0 right-0"
            style={{ height: 3, background: "linear-gradient(90deg, transparent, #D4541A 20%, #FF7A45 50%, #D4541A 80%, transparent)" }}
          />
          <div
            className="absolute bottom-[3px] left-0 h-[1px]"
            style={{
              background: "rgba(212,84,26,0.3)",
              width: phase === "hold" ? "100%" : "0%",
              transition: "width 1.2s ease-out",
            }}
          />
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────── */}
      <div>
        {/* Header */}
        <header
          className="flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-2 max-w-5xl mx-auto"
        >
          <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full overflow-hidden shrink-0">
            <Image src="/image.png" alt="Gamehaus" width={80} height={80} className="object-cover w-full h-full" />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { setAdminLoading(true); router.push("/login"); }}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors
                bg-[#111111] text-white border-[#111111] hover:bg-white hover:text-[#111111]
                dark:bg-white dark:text-[#111111] dark:border-white dark:hover:bg-[#111111] dark:hover:text-white"
            >
              {adminLoading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Lock className="h-3 w-3" />}
              Admin
            </button>
          </div>
        </header>

        {/* Hero */}
        <div
          className="px-4 sm:px-5 pt-8 sm:pt-10 pb-8 sm:pb-10 max-w-5xl mx-auto"
        >
          <h1 className="text-4xl md:text-6xl font-bold leading-tight" style={{ color: textPri }}>
            Book Your<br />
            <span style={{ color: "#D4541A" }}>Table.</span>
          </h1>
          <p className="mt-3 text-base md:text-lg max-w-md" style={{ color: textSec }}>
            Premium snooker &amp; gaming — walk in or reserve your spot online.
          </p>
        </div>

        {/* Locations */}
        <div className="px-4 pb-20 max-w-5xl mx-auto">
          <p
            className="text-xs font-semibold tracking-widest uppercase px-1 mb-5"
            style={{ color: textMuted }}
          >
            Choose a location
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {locations.map((loc, i) => {
              const open   = isOpenNow(loc.opening_time, loc.closing_time);
              const accent = i === 0 ? "#D4541A" : "#C4893A";
              const delay  = 180 + i * 120;

              return (
                <Link
                  key={loc.id}
                  href={`/${loc.slug}`}
                  prefetch
                  onMouseEnter={() => router.prefetch(`/${loc.slug}`)}
                  onTouchStart={() => router.prefetch(`/${loc.slug}`)}
                  className="block group active:scale-[0.985] transition-transform duration-150"
                >
                  <div>
                    <div
                      className="relative rounded-2xl overflow-hidden border transition-all duration-200
                        bg-white border-[#E8E3D9]
                        hover:border-[#D4541A]/40 hover:shadow-[0_4px_24px_rgba(212,84,26,0.10)]
                        dark:bg-[#141414] dark:border-[#272727]
                        dark:hover:border-[#D4541A]/30 dark:hover:bg-[#1A1A1A]"
                    >
                      {/* top accent bar */}
                      <div className="absolute top-0 left-0 right-0 h-[2.5px] z-10" style={{ background: accent }} />

                      {/* Image Area */}
                      <div className="relative h-48 sm:h-56 w-full overflow-hidden bg-gray-100 dark:bg-gray-900 border-b border-[#E8E3D9]/60 dark:border-[#272727]/60">
                        <LocationSlideshow image_urls={loc.image_urls} alt={loc.name} accent={accent} />
                        
                        {/* Floating open/closed badge */}
                        <div className="absolute top-4 right-4 z-20">
                          <span className={open
                            ? "text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/90 text-white backdrop-blur-sm shadow-sm"
                            : "text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-950/85 text-gray-200 backdrop-blur-sm shadow-sm"
                          }>
                            {open ? "Open Now" : "Closed"}
                          </span>
                        </div>
                      </div>

                      {/* Text Content Area */}
                      <div className="p-5 md:p-6 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white group-hover:text-[#D4541A] transition-colors duration-150">
                            {loc.name}
                          </h2>
                          <ChevronRight
                            className="h-5 w-5 transition-transform duration-150 group-hover:translate-x-0.5 text-gray-400 dark:text-[#555]"
                            style={{ color: accent + "80" }}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-[#888]">
                            <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                            <span className="truncate">{loc.address}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-[#888]">
                            <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                            <span>{formatTime(loc.opening_time)} – {formatTime(loc.closing_time)}</span>
                          </div>
                        </div>

                        {/* Active deal badge */}
                        {(() => {
                          const locCoupons = coupons.filter(c => c.location_id === loc.id);
                          const globCoupons = coupons.filter(c => c.location_id === null);
                          const activeCoupon = locCoupons.length > 0 ? locCoupons[0] : (globCoupons.length > 0 ? globCoupons[0] : null);
                          if (!activeCoupon) return null;
                          
                          const discountText = activeCoupon.discount_type === "percent"
                            ? `${activeCoupon.discount_value}% OFF`
                            : `₹${activeCoupon.discount_value} OFF`;

                          return (
                            <div className="mt-3 flex items-center justify-between bg-gradient-to-r from-orange-500/[0.07] to-amber-500/[0.03] border border-dashed border-[#D4541A]/30 rounded-xl p-3 relative overflow-hidden group/deal">
                              {/* Glowing hover state */}
                              <div className="absolute inset-0 bg-[#D4541A]/[0.02] opacity-0 group-hover/deal:opacity-100 transition-opacity duration-300" />
                              
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-lg animate-bounce" style={{ animationDuration: '2.5s' }}>🏷️</span>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-extrabold tracking-wider uppercase text-[#D4541A]">
                                    Special Online Deal
                                  </p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium truncate mt-0.5">
                                    Pay full online to save instantly
                                  </p>
                                </div>
                              </div>
                              
                              <div className="bg-[#D4541A] text-white font-black text-[10px] px-2.5 py-1.5 rounded-lg tracking-wider shrink-0 shadow-md shadow-orange-500/10 uppercase">
                                {discountText}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
