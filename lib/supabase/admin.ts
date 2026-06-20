import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

let globalAdminClient: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  if (!globalAdminClient) {
    globalAdminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
        },
      }
    );
  }
  return globalAdminClient;
}
