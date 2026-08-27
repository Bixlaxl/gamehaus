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
      const originalGetUser = client.auth.getUser.bind(client.auth);
      client.auth.getSession = async () => {
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            // Convert base64url → base64 with proper padding (required for atob in edge runtime)
            const base64url = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64url + '==='.slice((base64url.length + 3) % 4);
            const payload = JSON.parse(atob(padded));
            const now = Math.floor(Date.now() / 1000);
            // Reject obviously expired tokens rather than forwarding them
            if (payload.exp && payload.exp < now) {
              return { data: { session: null }, error: null };
            }
            const session = {
              access_token: token,
              token_type: "bearer",
              expires_in: payload.exp ? Math.max(0, payload.exp - now) : 3600,
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

      client.auth.getUser = async (jwt?: string) => {
        const { data, error } = await client.auth.getSession();
        if (data?.session?.user) {
          return { data: { user: data.session.user }, error: null };
        }
        return originalGetUser(jwt);
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
