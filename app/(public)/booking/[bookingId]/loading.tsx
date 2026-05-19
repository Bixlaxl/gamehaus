export default function BookingConfirmationLoading() {
  return (
    <div className="min-h-screen bg-[#F7F5F2]">
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="rounded-3xl overflow-hidden border border-[#EBEBEB] bg-white shadow-sm">
          {/* Green accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-emerald-600" />

          {/* Success icon skeleton */}
          <div className="p-7 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto animate-pulse">
              <div className="w-8 h-8 rounded-full bg-emerald-200" />
            </div>
            <div className="h-6 w-40 bg-gray-100 rounded-lg mx-auto animate-pulse" />
            <div className="h-4 w-28 bg-gray-100 rounded-lg mx-auto animate-pulse" />
          </div>

          {/* Dashed divider */}
          <div className="border-t border-dashed border-[#EBEBEB] mx-0 relative flex items-center">
            <div className="w-5 h-5 rounded-full -ml-2.5 bg-[#F7F5F2]" />
            <div className="flex-1" />
            <div className="w-5 h-5 rounded-full -mr-2.5 bg-[#F7F5F2]" />
          </div>

          {/* Booking item skeleton */}
          <div className="px-6 py-5 space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-100 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 w-28 bg-gray-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>

          {/* Dashed divider */}
          <div className="border-t border-dashed border-[#EBEBEB] relative flex items-center">
            <div className="w-5 h-5 rounded-full -ml-2.5 bg-[#F7F5F2]" />
            <div className="flex-1" />
            <div className="w-5 h-5 rounded-full -mr-2.5 bg-[#F7F5F2]" />
          </div>

          {/* Amount skeleton */}
          <div className="px-6 py-5 space-y-2.5">
            <div className="flex justify-between">
              <div className="h-4 w-12 bg-gray-100 rounded animate-pulse" />
              <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
            </div>
            <div className="flex justify-between">
              <div className="h-4 w-10 bg-gray-100 rounded animate-pulse" />
              <div className="h-4 w-14 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>

          {/* Instructions skeleton */}
          <div className="mx-5 mb-6 px-4 py-3 rounded-2xl bg-[#F5F3EF]">
            <div className="h-3 w-full bg-gray-200 rounded animate-pulse" />
          </div>
        </div>

        {/* CTA skeleton */}
        <div className="mt-5 h-14 rounded-2xl bg-[#D4541A]/30 animate-pulse" />
      </div>
    </div>
  );
}
