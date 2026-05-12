import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public API routes — accessible without login
  const publicApiRoutes = [
    "/api/payments/webhook",
    "/api/payments/create-order",
    "/api/payments/demo-confirm",
    "/api/customers/lookup",
    "/api/orders",
  ];
  const isPublicApi = publicApiRoutes.some(r => pathname === r || pathname.startsWith(r + "/"));

  // Paths that require authentication
  const requiresAuth =
    pathname.startsWith("/owner") ||
    pathname === "/pos" ||
    (pathname.startsWith("/api/") && !isPublicApi);

  // Unauthenticated user hitting a protected route → login
  if (!user && requiresAuth) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user hitting /login → redirect by role
  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    // Use JWT role claim if the auth hook is set up, else fall back to /owner
    // The individual pages will further redirect if role doesn't match
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const claims = token ? parseJwt(token) : null;
    const role = claims?.role as string | undefined;
    redirectUrl.pathname = role === "staff" ? "/pos" : "/owner";
    return NextResponse.redirect(redirectUrl);
  }

  // Staff explicitly trying to access /owner → redirect to /pos
  // Only block if role claim is explicitly "staff" (hook is set up)
  if (user && pathname.startsWith("/owner")) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const claims = token ? parseJwt(token) : null;
    const role = claims?.role as string | undefined;
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
