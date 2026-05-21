export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-3">
            <div className="h-3 w-20 bg-gray-200 rounded" />
            <div className="h-8 w-28 bg-gray-200 rounded" />
            <div className="h-3 w-16 bg-gray-200 rounded" />
          </div>
        ))}
      </div>

      {/* Chart + live panel row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="flex items-end gap-2 h-40">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex-1 bg-gray-200 rounded-t-lg" style={{ height: `${40 + (i * 13) % 70}%` }} />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-3">
          <div className="h-4 w-20 bg-gray-200 rounded" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="h-8 w-8 bg-gray-200 rounded-full shrink-0" />
                <div className="space-y-1 flex-1">
                  <div className="h-3 w-24 bg-gray-200 rounded" />
                  <div className="h-3 w-16 bg-gray-200 rounded" />
                </div>
                <div className="h-4 w-16 bg-gray-200 rounded shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent orders table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-100 h-10" />
        <div className="divide-y divide-gray-50">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-24 bg-gray-200 rounded" />
              <div className="h-4 w-32 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="ml-auto h-4 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
