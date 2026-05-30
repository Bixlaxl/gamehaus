import { toast } from "sonner";

// POS tabs are kept open all day. Supabase refresh tokens eventually rotate
// and the SSR client throws "Invalid Refresh Token", which surfaces as a 401
// on the next mutation. Without this guard, staff just sees a generic
// "Failed to stop session" with no path forward.
//
// `installPOSAuthGuard()` patches window.fetch once on mount. Any /api/*
// response with status 401 → toast + redirect to /login with ?next so the
// staff lands back where they were after re-auth.
let installed = false;
let redirecting = false;

export function installPOSAuthGuard() {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    if (res.status === 401 && !redirecting) {
      try {
        // Only redirect for our own API routes; ignore Supabase/Razorpay 401s
        const url = typeof args[0] === "string" ? args[0]
                   : args[0] instanceof Request   ? args[0].url
                   : args[0]?.toString() ?? "";
        const path = url.startsWith("/")
          ? url
          : new URL(url, window.location.origin).pathname;
        if (path.startsWith("/api/")) {
          redirecting = true;
          toast.error("Session expired — signing you back in…");
          setTimeout(() => {
            const next = encodeURIComponent(
              window.location.pathname + window.location.search
            );
            window.location.href = `/login?next=${next}`;
          }, 900);
        }
      } catch {
        /* ignore URL parse errors */
      }
    }
    return res;
  };
}
