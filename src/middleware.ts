import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function noCache(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isPublic = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/auth/callback";
  if (!url || !publishableKey) {
    if (request.nextUrl.pathname === "/login") return noCache(NextResponse.next());
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    return noCache(NextResponse.redirect(target));
  }

  let response = NextResponse.next({ request });
  const authHeaders: Record<string,string> = {};
  const finish = (result = response) => {
    if (result !== response) response.cookies.getAll().forEach(cookie => result.cookies.set(cookie));
    Object.entries(authHeaders).forEach(([name,value]) => result.headers.set(name,value));
    return noCache(result);
  };
  const unavailable = () => finish(new NextResponse("Session verification is temporarily unavailable. Refresh this page to try again; you have not been signed out.", {status:503,headers:{"Retry-After":"5","Content-Type":"text/plain; charset=utf-8"}}));
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const updated = NextResponse.next({ request });
        response.cookies.getAll().forEach(cookie => updated.cookies.set(cookie));
        response = updated;
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.assign(authHeaders,headers);
      },
    },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  // A temporary Auth outage is not an expired session. Keep cookies and fail closed.
  if (authError && (authError.name === "AuthRetryableFetchError" || authError.status === 429 || (authError.status ?? 0) >= 500)) return unavailable();
  const isLogin = request.nextUrl.pathname === "/login";
  if (!user && !isPublic) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    return finish(NextResponse.redirect(target));
  }
  if (user) {
    const { data: profile, error: profileError } = await supabase.from("profiles").select("active").eq("id", user.id).maybeSingle();
    if (profileError) return unavailable();
    if (profile?.active === false) {
      await supabase.auth.signOut();
      const target = request.nextUrl.clone();
      target.pathname = "/login";
      target.searchParams.set("error", "inactive");
      return finish(NextResponse.redirect(target));
    }
    if (isLogin) {
      const target = request.nextUrl.clone();
      target.pathname = "/dashboard";
      target.search = "";
      return finish(NextResponse.redirect(target));
    }
  }
  return finish();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
