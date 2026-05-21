export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-28 bg-gray-200 rounded-lg" />
      <div className="flex items-center gap-3">
        <div className="h-9 w-36 bg-gray-200 rounded-lg" />
        <div className="h-9 w-44 bg-gray-200 rounded-lg" />
        <div className="h-9 w-44 bg-gray-200 rounded-lg" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-100 h-10" />
        <div className="divide-y divide-gray-50">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-24 bg-gray-200 rounded" />
              <div className="flex-1 space-y-1">
                <div className="h-4 w-32 bg-gray-200 rounded" />
                <div className="h-3 w-24 bg-gray-200 rounded" />
              </div>
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
              <div className="h-5 w-20 bg-gray-200 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
