"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const INTERVAL_MS = 120_000;

export function DashboardRefresh() {
  const router  = useRouter();
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [spinning, setSpinning]           = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function refresh() {
    setSpinning(true);
    router.refresh();
    setLastRefreshed(new Date());
    setTimeout(() => setSpinning(false), 600);
  }

  useEffect(() => {
    timerRef.current = setInterval(refresh, INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span>Updated {fmt}</span>
      <button
        onClick={refresh}
        className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-gray-100 transition-colors"
        title="Refresh now"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
