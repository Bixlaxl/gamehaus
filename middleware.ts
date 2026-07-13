import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes handle their own auth
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  // Generate secure CSP Nonce using Edge-compatible Web Crypto API
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  const nonce = btoa(Array.from(array).map(b => String.fromCharCode(b)).join(""));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const requiresAuth = pathname.startsWith("/owner") || pathname.startsWith("/pos");
  const isLogin      = pathname === "/login";

  // Public pages — skip auth entirely, no network call needed
  if (!requiresAuth && !isLogin) {
    const res = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    applyCsp(res, nonce);
    return res;
  }

  // Protected or login pages — need to verify the session
  let supabaseResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

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
          supabaseResponse = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });
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
    const res = NextResponse.redirect(loginUrl);
    applyCsp(res, nonce);
    return res;
  }

  // Authenticated user hitting /login → redirect by role
  if (user && isLogin) {
    const redirectUrl = request.nextUrl.clone();
    const token  = (await supabase.auth.getSession()).data.session?.access_token;
    const claims = token ? parseJwt(token) : null;
    const role   = (claims?.app_role ?? claims?.role) as string | undefined;
    redirectUrl.pathname = role === "staff" ? "/pos" : "/owner";
    const res = NextResponse.redirect(redirectUrl);
    applyCsp(res, nonce);
    return res;
  }

  // Staff explicitly trying to access /owner → redirect to /pos
  if (user && pathname.startsWith("/owner")) {
    const token  = (await supabase.auth.getSession()).data.session?.access_token;
    const claims = token ? parseJwt(token) : null;
    const role   = (claims?.app_role ?? claims?.role) as string | undefined;
    if (role === "staff") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/pos";
      const res = NextResponse.redirect(redirectUrl);
      applyCsp(res, nonce);
      return res;
    }
  }

  applyCsp(supabaseResponse, nonce);
  return supabaseResponse;
}

function applyCsp(response: NextResponse, nonce: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : "";

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.razorpay.com https://vercel.live;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob: https://${supabaseHost} https://*.supabase.co;
    connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://api.razorpay.com https://vitals.vercel-insights.com;
    frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com;
    font-src 'self' data:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'self';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, " ").trim();

  response.headers.set("Content-Security-Policy", cspHeader);
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
