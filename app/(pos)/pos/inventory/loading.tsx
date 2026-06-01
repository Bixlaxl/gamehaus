// Skeleton for the staff inventory tab — same purpose as bookings/loading.tsx:
// fill the navigation gap so tab switches feel instant.
export default function Loading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-[#111] border-b border-[#1f1f1f]">
        <div className="h-3.5 w-32 rounded bg-[#1f1f1f] animate-pulse" />
        <div className="h-7 w-48 rounded-lg bg-[#1f1f1f] animate-pulse" />
      </header>
      <main className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-6xl mx-auto space-y-8">
          {Array.from({ length: 2 }).map((_, s) => (
            <section key={s}>
              <div className="h-3 w-24 rounded bg-[#1f1f1f] animate-pulse mb-3" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl bg-[#111] border border-[#222] p-3 flex items-center gap-3 animate-pulse"
                    style={{ opacity: 1 - i * 0.08 }}
                  >
                    <div className="w-14 h-14 rounded-lg bg-[#1f1f1f]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-[#1f1f1f]" />
                      <div className="h-2.5 w-1/3 rounded bg-[#1f1f1f]" />
                    </div>
                    <div className="w-20 h-7 rounded-lg bg-[#1f1f1f]" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
