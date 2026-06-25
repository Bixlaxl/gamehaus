"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useState } from "react";
import { usePathname } from "next/navigation";

// Bump when the cache shape changes (query keys, response shapes) — old
// caches with this buster mismatch will be discarded.
const CACHE_BUSTER = "v1";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPanel = pathname?.startsWith("/pos") || pathname?.startsWith("/owner");
  const forcedTheme = isPanel ? undefined : "light";
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            // gcTime must be >= persister maxAge for entries to be restored
            gcTime: 24 * 60 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [persister] = useState(() => {
    if (typeof window === "undefined") return null;
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: "gamehaus-query-cache",
      // Skip persisting massive payloads — leaves smaller, faster restores.
      // Keep under ~2MB to avoid localStorage quota errors.
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    });
  });

  // First render on the server has no persister — fall back to a plain
  // QueryClientProvider via dynamic import would add weight; instead we
  // gate the persistent provider on `persister !== null`.
  if (!persister) {
    // SSR path — render children with no provider; client will hydrate.
    return (
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme={forcedTheme}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: noopPersister }}
        >
          {children}
        </PersistQueryClientProvider>
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme={forcedTheme}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: CACHE_BUSTER,
          dehydrateOptions: {
            // Persist only "safe" cached data. Skip:
            //  - Realtime-driven POS queries (must always be fresh from server)
            //  - Auth / session queries
            //  - Failed queries (don't cache errors)
            shouldDehydrateQuery: (query) => {
              if (query.state.status !== "success") return false;
              const key = String(query.queryKey[0] ?? "");
              if (key.startsWith("pos-"))      return false;
              if (key.startsWith("customer-")) return false;
              if (key.startsWith("session"))   return false;
              // Inventory + stock counts change too quickly to safely persist
              // — a stale-on-reload count is the root of the "stocks don't
              // match between owner and staff" bug.
              if (key === "inventory")               return false;
              if (key === "inventory-low-count")     return false;
              if (key === "staff-bookings")          return false;
              return true;
            },
          },
        }}
      >
        {children}
      </PersistQueryClientProvider>
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}

// No-op persister used during SSR — never reads, never writes.
const noopPersister = {
  persistClient: async () => {},
  restoreClient: async () => undefined,
  removeClient:  async () => {},
};
