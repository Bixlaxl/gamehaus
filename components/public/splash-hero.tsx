"use client";

import { useState } from "react";
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

export function SplashHero({ locations }: { locations: Location[] }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [adminLoading, setAdminLoading] = useState(false);
  const router = useRouter();

  function onImageReady() {
    setPhase("enter");
    setTimeout(() => setPhase("hold"),  300);
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
              ? "transform 1100ms cubic-bezier(0.22, 1, 0.36, 1)"
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
          style={{
            opacity:   phase === "gone" ? 1 : 0,
            transform: phase === "gone" ? "translateY(0)" : "translateY(-12px)",
            transition: "opacity 500ms ease-out, transform 500ms ease-out",
          }}
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
          style={{
            opacity:   phase === "gone" ? 1 : 0,
            transform: phase === "gone" ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 600ms 80ms ease-out, transform 600ms 80ms ease-out",
          }}
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
            style={{
              color: textMuted,
              opacity:    phase === "gone" ? 1 : 0,
              transition: "opacity 500ms 120ms ease-out",
            }}
          >
            Choose a location
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {locations.map((loc, i) => {
              const open   = isOpenNow(loc.opening_time, loc.closing_time);
              const accent = i === 0 ? "#D4541A" : "#C4893A";
              const delay  = 180 + i * 120;

              return (
                <Link key={loc.id} href={`/${loc.slug}`} className="block group active:scale-[0.985] transition-transform duration-150">
                  <div
                    style={{
                      opacity:   phase === "gone" ? 1 : 0,
                      transform: phase === "gone" ? "translateY(0)" : "translateY(32px)",
                      transition: `opacity 600ms ${delay}ms ease-out, transform 600ms ${delay}ms cubic-bezier(0.22,1,0.36,1)`,
                    }}
                  >
                    <div
                      className="relative rounded-2xl overflow-hidden border transition-all duration-200
                        bg-white border-[#E8E3D9]
                        hover:border-[#D4541A]/40 hover:shadow-[0_4px_24px_rgba(212,84,26,0.10)]
                        dark:bg-[#141414] dark:border-[#272727]
                        dark:hover:border-[#D4541A]/30 dark:hover:bg-[#1A1A1A]"
                    >
                      {/* top accent bar */}
                      <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ background: accent }} />

                      <div className="p-5 md:p-6 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <h2 className="text-xl md:text-2xl font-bold mb-3 text-gray-900 dark:text-white">
                            {loc.name}
                          </h2>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-[#666]">
                              <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                              <span className="truncate">{loc.address}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-[#666]">
                              <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                              <span>{formatTime(loc.opening_time)} – {formatTime(loc.closing_time)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-3 shrink-0">
                          <span className={open
                            ? "text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#222] text-gray-400 dark:text-[#555]"
                          }>
                            {open ? "Open" : "Closed"}
                          </span>
                          <ChevronRight
                            className="h-5 w-5 transition-transform duration-150 group-hover:translate-x-0.5"
                            style={{ color: accent + "80" }}
                          />
                        </div>
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
