import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/supabase/types";

export async function createClient() {
  try {
    const headerStore = await headers();
    const authHeader = headerStore.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const client = createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return [];
            },
            setAll() {}
          },
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        }
      );

      // Reconstruct session from Bearer JWT token since getSession() only reads cookies
      const originalGetSession = client.auth.getSession.bind(client.auth);
      client.auth.getSession = async () => {
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(base64));
            const session = {
              access_token: token,
              token_type: "bearer",
              expires_in: payload.exp ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000)) : 3600,
              refresh_token: "",
              user: {
                id: payload.sub,
                email: payload.email,
                role: payload.role || "authenticated",
                app_metadata: payload.app_metadata || {},
                user_metadata: payload.user_metadata || {},
                aud: payload.aud || "authenticated",
                created_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString()
              }
            };
            return { data: { session: session as any }, error: null };
          }
        } catch (e) {
          // ignore & fallback
        }
        return originalGetSession();
      };

      return client;
    }
  } catch (e) {
    // Ignore error if headers() is called in static context
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component — cookie mutations are ignored
          }
        },
      },
    }
  );
}
