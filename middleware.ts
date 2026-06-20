import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes handle their own auth
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  const requiresAuth = pathname.startsWith("/owner") || pathname.startsWith("/pos");
  const isLogin      = pathname === "/login";

  // Public pages — skip auth entirely, no network call needed
  if (!requiresAuth && !isLogin) {
    return NextResponse.next({ request });
  }

  // Protected or login pages — need to verify the session
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Unauthenticated user hitting a protected route → login
  if (!user && requiresAuth) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user hitting /login → redirect by role
  if (user && isLogin) {
    const redirectUrl = request.nextUrl.clone();
    const token  = (await supabase.auth.getSession()).data.session?.access_token;
    const claims = token ? parseJwt(token) : null;
    const role   = (claims?.app_role ?? claims?.role) as string | undefined;
    redirectUrl.pathname = role === "staff" ? "/pos" : "/owner";
    return NextResponse.redirect(redirectUrl);
  }

  // Staff explicitly trying to access /owner → redirect to /pos
  if (user && pathname.startsWith("/owner")) {
    const token  = (await supabase.auth.getSession()).data.session?.access_token;
    const claims = token ? parseJwt(token) : null;
    const role   = (claims?.app_role ?? claims?.role) as string | undefined;
    if (role === "staff") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/pos";
      return NextResponse.redirect(redirectUrl);
    }
  }

  return supabaseResponse;
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split(".")[1];
    const decoded = Buffer.from(base64, "base64url").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
