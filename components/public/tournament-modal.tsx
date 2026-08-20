"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

interface TournamentModalProps {
  isOpen: boolean;
  onClose: () => void;
  claimedSlots?: number;
  delayOffset?: number;
}

function ModalContent({ onClose, claimedSlots = 0, delayOffset = 100 }: Omit<TournamentModalProps, "isOpen">) {
  const totalSlots = 32;
  const [liveCount, setLiveCount] = useState(claimedSlots);

  // Fetch live count from database to guarantee accurate sync
  useEffect(() => {
    fetch("/api/tournament/registrations")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && typeof data.count === "number") {
          setLiveCount(data.count);
        }
      })
      .catch(() => {});
  }, []);

  const targetFilled = Math.min(32, Math.max(0, liveCount || claimedSlots || 0));

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="tm-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 12, 8, 0.84)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <style>{`
        .tm-overlay {
          animation: tmOverlayFade 0.25s ease-out forwards;
        }
        @keyframes tmOverlayFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .tm-modal {
          width: 100%;
          max-width: 390px;
          max-height: 96vh;
          overflow-y: auto;
          background:
            radial-gradient(circle at 15% 0%, rgba(226, 101, 46, 0.14), transparent 42%),
            #17140F;
          border: 1px solid rgba(241, 236, 223, 0.12);
          border-radius: 14px;
          position: relative;
          box-shadow: 0 25px 70px rgba(0, 0, 0, 0.7);
          margin: auto;
          animation: tmModalPop 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes tmModalPop {
          from { opacity: 0; transform: translateY(14px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .tm-rail {
          height: 4px;
          width: 100%;
          background: linear-gradient(90deg, #E2652E, #C9A24A 55%, #E2652E);
          border-radius: 14px 14px 0 0;
        }

        .tm-inner {
          padding: 34px 16px 14px;
          text-align: left;
        }
        @media (min-width: 420px) {
          .tm-inner { padding: 38px 20px 16px; }
        }

        .tm-close {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: rgba(241, 236, 223, 0.12);
          border: 1px solid rgba(241, 236, 223, 0.22);
          color: #F1ECDF;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          transition: background 0.15s ease;
        }
        .tm-close:hover { background: rgba(241, 236, 223, 0.25); }

        .tm-register {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 100%;
          border: none;
          border-radius: 8px;
          padding: 10px 12px;
          background: #E2652E;
          color: #fff;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          margin-bottom: 6px;
          text-decoration: none;
          white-space: nowrap;
          transition: background 0.15s ease;
        }
        .tm-register:hover { background: #CE5A26; }

        .tm-skip {
          display: block;
          width: 100%;
          text-align: center;
          background: none;
          border: none;
          color: #A39C8C;
          font-size: 11px;
          cursor: pointer;
          padding: 4px 0;
        }
        .tm-skip:hover { color: #F1ECDF; }

        .pips {
          display: grid;
          grid-template-columns: repeat(16, 1fr);
          gap: 3px;
        }
        @keyframes pipFill {
          to { background: #C9A24A; border-color: #C9A24A; transform: scale(1.06); }
        }
        .pip {
          width: 100%; aspect-ratio: 1;
          border-radius: 50%;
          border: 1px solid rgba(201, 162, 74, 0.4);
          background: transparent;
        }
        .pip.filled { animation: pipFill 0.2s ease both; }
      `}</style>

      {/* Modal card */}
      <div
        className="tm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tm-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* X close button */}
        <button type="button" className="tm-close" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: "none" }}>
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="tm-rail" />
        <div className="tm-inner">

          {/* Status badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontFamily: "monospace", fontSize: 9, letterSpacing: "0.08em",
              color: "#F1ECDF", background: "rgba(201,162,74,0.1)",
              border: "1px solid rgba(201,162,74,0.4)",
              padding: "2.5px 8px", borderRadius: 999, textTransform: "uppercase"
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#1FAE7A", display: "inline-block" }} />
              Registration open · 32 slots only
            </span>
          </div>

          {/* Title */}
          <h2
            id="tm-title"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: "clamp(22px, 5.5vw, 30px)",
              lineHeight: 0.96,
              color: "#F1ECDF",
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            8-Ball Pool <span style={{ color: "#E2652E" }}>Tournament.</span>
          </h2>

          {/* Subtitle */}
          <p style={{ color: "#A39C8C", fontSize: 12, lineHeight: 1.35, marginBottom: 10 }}>
            Showcase your skills at Gamehaus and walk away with a cash prize and trophy.
          </p>

          {/* Prizes */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div style={{
              background: "linear-gradient(160deg, rgba(201,162,74,0.10), #201B14 60%)",
              border: "1px solid rgba(201,162,74,0.5)",
              borderRadius: 8, padding: "8px 10px"
            }}>
              <div style={{ fontSize: 9, color: "#C9A24A", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>🏆 Winner</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#F1ECDF", lineHeight: 1 }}>₹4,000</div>
              <div style={{ fontSize: 10, color: "#A39C8C", marginTop: 2 }}>Cash prize + trophy</div>
            </div>
            <div style={{
              background: "#201B14", border: "1px solid rgba(241,236,223,0.1)",
              borderRadius: 8, padding: "8px 10px"
            }}>
              <div style={{ fontSize: 9, color: "#A39C8C", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>🥈 Runner-up</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#F1ECDF", lineHeight: 1 }}>₹1,500</div>
              <div style={{ fontSize: 10, color: "#A39C8C", marginTop: 2 }}>Cash prize</div>
            </div>
          </div>

          {/* Info grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid rgba(241,236,223,0.1)", marginBottom: 10 }}>
            {[
              { label: "DATES", val: "29–30 Aug" },
              { label: "TIME", val: "10 AM – 2 PM" },
              { label: "FORMAT", val: "32 players, single elim." },
              { label: "ENTRY FEE", val: "₹400 / player" },
            ].map(({ label, val }) => (
              <div key={label} style={{ padding: "6px 6px 6px 0", borderBottom: "1px solid rgba(241,236,223,0.1)" }}>
                <div style={{ fontSize: 8.5, color: "#A39C8C", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 1, fontFamily: "monospace" }}>{label}</div>
                <div style={{ fontSize: 12, color: "#F1ECDF", fontWeight: 600 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Pips */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: "#A39C8C", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" }}>SPOTS CLAIMED</span>
              <span style={{ fontSize: 10, color: "#C9A24A", fontFamily: "monospace" }}>{targetFilled} / {totalSlots}</span>
            </div>
            <div className="pips">
              {Array.from({ length: totalSlots }).map((_, i) => (
                <div
                  key={i}
                  className={`pip${i < targetFilled ? " filled" : ""}`}
                  style={i < targetFilled ? { animationDelay: `${delayOffset + i * 20}ms` } : undefined}
                />
              ))}
            </div>
          </div>

          {/* CTA */}
          <Link href="/tournament/register" className="tm-register">
            Register for tournament — ₹400 →
          </Link>

          {/* Skip */}
          <button type="button" className="tm-skip" onClick={onClose}>
            ✕ Close &amp; continue to table bookings
          </button>

        </div>
      </div>
    </div>
  );
}

export function TournamentModal({ isOpen, onClose, claimedSlots, delayOffset }: TournamentModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <ModalContent onClose={onClose} claimedSlots={claimedSlots} delayOffset={delayOffset} />,
    document.body
  );
}
