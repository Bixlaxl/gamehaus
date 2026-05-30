"use client";

import { useEffect } from "react";

// Registers the service worker once on the client. Silent on failure —
// SW is a perf enhancement, never a correctness dependency.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator))   return;
    if (process.env.NODE_ENV !== "production") return; // skip in dev — HMR conflicts

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => { /* ignore — non-fatal */ });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);

  return null;
}
