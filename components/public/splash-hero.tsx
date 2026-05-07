"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Clock, ChevronRight, Lock } from "lucide-react";

interface Location {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  opening_time: string;
  closing_time: string;
  slug: string;
}

interface SplashHeroProps {
  locations: Location[];
}

function isOpenNow(opening: string, closing: string): boolean {
  const now = new Date();
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  return nowMins >= openMins && nowMins < closeMins;
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""} ${ampm}`;
}

export function SplashHero({ locations }: SplashHeroProps) {
  const [phase, setPhase] = useState<"splash" | "out" | "done">("splash");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("out"), 2200);
    const t2 = setTimeout(() => setPhase("done"), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="relative min-h-screen bg-[#0A0A0A] overflow-hidden">
      {/* Splash screen */}
      {phase !== "done" && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0A0A0A]"
          style={{
            transition: "opacity 700ms ease-in-out",
            opacity: phase === "out" ? 0 : 1,
            pointerEvents: phase === "out" ? "none" : "auto",
          }}
        >
          {/* Radial glow behind logo */}
          <div
            className="absolute"
            style={{
              width: 400,
              height: 400,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(212,84,26,0.15) 0%, transparent 70%)",
            }}
          />
          <div
            style={{
              animation: "splashIn 0.7s cubic-bezier(0.22,1,0.36,1) forwards",
              opacity: 0,
            }}
          >
            <Image
              src="/image.png"
              alt="Gamehaus"
              width={220}
              height={220}
              priority
              className="rounded-full"
            />
          </div>
          <p
            className="mt-6 text-[#888] text-sm tracking-[0.25em] uppercase"
            style={{
              animation: "splashIn 0.7s 0.3s cubic-bezier(0.22,1,0.36,1) forwards",
              opacity: 0,
            }}
          >
            Snookers &amp; Gaming
          </p>
        </div>
      )}

      {/* Main content */}
      <div
        style={{
          transition: "opacity 700ms ease-in-out, transform 700ms ease-in-out",
          opacity: phase === "done" ? 1 : 0,
          transform: phase === "done" ? "translateY(0)" : "translateY(24px)",
        }}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 pt-6 pb-2 max-w-5xl mx-auto">
          <Image src="/image.png" alt="Gamehaus" width={44} height={44} className="rounded-full" />
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-xs text-[#555] hover:text-white transition-colors"
          >
            <Lock className="h-3 w-3" />
            Admin
          </Link>
        </header>

        {/* Hero text */}
        <div className="px-5 pt-10 pb-10 max-w-5xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-bold text-white leading-tight">
            Book Your<br />
            <span style={{ color: "#D4541A" }}>Table.</span>
          </h1>
          <p className="mt-3 text-[#666] text-base md:text-lg max-w-md">
            Premium snooker &amp; gaming — walk in or reserve your spot online.
          </p>
        </div>

        {/* Locations */}
        <div className="px-4 pb-16 max-w-5xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-[#444] uppercase px-1 mb-5">
            Choose a location
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {locations.map((loc, i) => {
              const open = isOpenNow(loc.opening_time, loc.closing_time);
              const accent = i === 0 ? "#D4541A" : "#1E6B4A";
              return (
                <Link key={loc.id} href={`/${loc.slug}`} className="block group">
                  <div
                    className="relative rounded-2xl overflow-hidden border border-[#1E1E1E] bg-[#111] h-full flex flex-col"
                    style={{ boxShadow: "0 4px 40px rgba(0,0,0,0.4)" }}
                  >
                    {/* Accent stripe */}
                    <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: accent }} />

                    <div className="p-5 md:p-6 flex flex-col flex-1">
                      {/* Name + status */}
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <h2 className="text-xl md:text-2xl font-bold text-white leading-tight">
                          {loc.name}
                        </h2>
                        <span
                          className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{
                            background: open ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)",
                            color: open ? "#10B981" : "#555",
                          }}
                        >
                          {open ? "Open" : "Closed"}
                        </span>
                      </div>

                      {/* Info rows */}
                      <div className="space-y-2 mb-6 flex-1">
                        <div className="flex items-center gap-2 text-[#666] text-sm">
                          <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                          <span className="truncate">{loc.address}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[#666] text-sm">
                          <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                          <span>{formatTime(loc.opening_time)} – {formatTime(loc.closing_time)}</span>
                        </div>
                      </div>

                      {/* CTA */}
                      <div
                        className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-white text-sm transition-all group-hover:opacity-90 active:scale-95"
                        style={{ background: accent }}
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

      <style jsx global>{`
        @keyframes splashIn {
          from { opacity: 0; transform: scale(0.88); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
