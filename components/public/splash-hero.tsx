"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Clock, ChevronRight, Lock, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

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
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  function onImageReady() {
    setPhase("enter");
    setTimeout(() => setPhase("hold"),  500);
    setTimeout(() => setPhase("exit"),  2300);
    setTimeout(() => setPhase("gone"),  3300);
  }

  const isDark = !mounted ? false : resolvedTheme === "dark";

  const bg        = isDark ? "#0A0A0A" : "#F5F3EE";
  const cardBg    = isDark ? "#111111" : "#FFFFFF";
  const cardBorder= isDark ? "#1E1E1E" : "#E8E4DC";
  const textPri   = isDark ? "#FFFFFF" : "#1A1A1A";
  const textSec   = isDark ? "#666666" : "#888888";
  const textMuted = isDark ? "#444444" : "#AAAAAA";

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
              ? "transform 950ms cubic-bezier(0.76, 0, 0.24, 1)"
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
              className="rounded-full"
              onLoad={onImageReady}
            />
          </div>

          <div
            className="mt-5 text-center"
            style={{
              opacity:   phase === "hold" ? 1 : 0,
              transform: phase === "hold" ? "translateY(0)" : "translateY(10px)",
              transition: "opacity 500ms ease-in-out, transform 500ms ease-out",
            }}
          >
            <p className="text-[#DDDDDD] text-sm font-bold tracking-[0.3em] uppercase">
              Snookers &amp; Gaming
            </p>
            <p className="text-[#AAAAAA] text-xs font-bold tracking-[0.2em] uppercase mt-1">
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
          className="flex items-center justify-between px-5 pt-5 pb-2 max-w-5xl mx-auto"
          style={{
            opacity:   phase === "gone" ? 1 : 0,
            transform: phase === "gone" ? "translateY(0)" : "translateY(-12px)",
            transition: "opacity 500ms ease-out, transform 500ms ease-out",
          }}
        >
          <div className="w-11 h-11 rounded-full overflow-hidden shrink-0">
            <Image src="/image.png" alt="Gamehaus" width={44} height={44} className="object-cover" />
          </div>

          <div className="flex items-center gap-3">
            {mounted && (
              <button
                onClick={() => setTheme(isDark ? "light" : "dark")}
                className="flex items-center justify-center w-8 h-8 rounded-full transition-colors"
                style={{
                  background: isDark ? "#1A1A1A" : "#E8E4DC",
                  color: isDark ? "#888" : "#666",
                }}
                aria-label="Toggle theme"
              >
                {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
            )}
            <Link
              href="/login"
              className="flex items-center gap-1.5 text-xs transition-colors"
              style={{ color: textMuted }}
            >
              <Lock className="h-3 w-3" />
              Admin
            </Link>
          </div>
        </header>

        {/* Hero */}
        <div
          className="px-5 pt-10 pb-10 max-w-5xl mx-auto"
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
        <div className="px-4 pb-16 max-w-5xl mx-auto">
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
              const accent = i === 0 ? "#D4541A" : "#1E6B4A";
              const delay  = 180 + i * 120;

              return (
                <Link key={loc.id} href={`/${loc.slug}`} className="block group">
                  <div
                    className="relative rounded-2xl overflow-hidden border h-full flex flex-col transition-shadow group-hover:shadow-lg"
                    style={{
                      background:  cardBg,
                      borderColor: cardBorder,
                      boxShadow: isDark ? "0 4px 40px rgba(0,0,0,0.5)" : "0 4px 24px rgba(0,0,0,0.08)",
                      opacity:   phase === "gone" ? 1 : 0,
                      transform: phase === "gone" ? "translateY(0)" : "translateY(32px)",
                      transition: `opacity 600ms ${delay}ms ease-out, transform 600ms ${delay}ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms`,
                    }}
                  >
                    <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: accent }} />

                    <div className="p-5 md:p-6 flex flex-col flex-1">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <h2 className="text-xl md:text-2xl font-bold leading-tight" style={{ color: textPri }}>
                          {loc.name}
                        </h2>
                        <span
                          className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{
                            background: open ? "rgba(16,185,129,0.12)" : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                            color:      open ? "#10B981" : textMuted,
                          }}
                        >
                          {open ? "Open" : "Closed"}
                        </span>
                      </div>

                      <div className="space-y-2 mb-6 flex-1">
                        <div className="flex items-center gap-2 text-sm" style={{ color: textSec }}>
                          <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                          <span>{loc.address}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm" style={{ color: textSec }}>
                          <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                          <span>{formatTime(loc.opening_time)} – {formatTime(loc.closing_time)}</span>
                        </div>
                      </div>

                      <div
                        className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-white text-sm transition-opacity group-hover:opacity-90 active:scale-95"
                        style={{ background: "#111111" }}
                      >
                        Book a Table
                        <ChevronRight className="h-4 w-4" />
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
