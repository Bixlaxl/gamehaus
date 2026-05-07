import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { MapPin, Clock, Phone } from "lucide-react";

export default async function HomePage() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .eq("is_active", true);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Hero */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-950 py-20 px-4 text-center">
        <h1 className="text-5xl font-bold mb-4">Gamehaus</h1>
        <p className="text-xl text-gray-400 max-w-xl mx-auto">
          Premium snooker tables & gaming stations. Book online, play instantly.
        </p>
      </div>

      {/* Locations */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-8 text-center">Our Locations</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {locations?.map((loc) => (
            <Link
              key={loc.id}
              href={`/${loc.slug}`}
              className="group bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-blue-500 transition-all"
            >
              <h3 className="text-xl font-bold mb-3 group-hover:text-blue-400 transition-colors">
                {loc.name}
              </h3>
              <div className="space-y-2 text-gray-400 text-sm">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{loc.address}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>
                    {loc.opening_time} – {loc.closing_time}
                  </span>
                </div>
                {loc.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    <span>{loc.phone}</span>
                  </div>
                )}
              </div>
              <div className="mt-4 text-blue-400 text-sm font-medium group-hover:text-blue-300">
                Browse tables →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
