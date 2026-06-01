// Skeleton shown the moment staff clicks "Bookings" — replaces the dead-air
// gap between the click and the SSR fetch resolving so the tab switch feels
// instant rather than laggy.
export default function Loading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-[#111] border-b border-[#1f1f1f]">
        <div className="h-3.5 w-32 rounded bg-[#1f1f1f] animate-pulse" />
        <div className="h-3 w-24 rounded bg-[#1f1f1f] animate-pulse" />
      </header>
      <main className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-[#111] border border-[#222] p-4 flex items-center gap-4 animate-pulse"
              style={{ opacity: 1 - i * 0.1 }}
            >
              <div className="w-20 h-10 rounded bg-[#1f1f1f]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded bg-[#1f1f1f]" />
                <div className="h-3 w-1/4 rounded bg-[#1f1f1f]" />
              </div>
              <div className="w-20 h-8 rounded-lg bg-[#1f1f1f]" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
