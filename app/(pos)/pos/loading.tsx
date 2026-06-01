// Skeleton for the Tables tab — fills the navigation gap when returning
// from /pos/bookings or /pos/inventory so the side rail re-highlight feels
// immediate even before POSScreen mounts.
export default function Loading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-[#111] border-b border-[#1f1f1f]">
        <div className="h-3.5 w-32 rounded bg-[#1f1f1f] animate-pulse" />
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-lg bg-[#1f1f1f] animate-pulse" />
          <div className="h-7 w-24 rounded-lg bg-[#1f1f1f] animate-pulse" />
          <div className="h-7 w-20 rounded-lg bg-[#1f1f1f] animate-pulse" />
        </div>
      </header>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl bg-[#111] border border-[#222] min-h-[180px] animate-pulse"
            style={{ opacity: 1 - i * 0.08 }}
          />
        ))}
      </div>
    </div>
  );
}
