import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isPublic = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/auth/callback" || request.nextUrl.pathname === "/scan-qr";
  if (!url || !publishableKey) {
    if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/scan-qr") return NextResponse.next();
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    return NextResponse.redirect(target);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname === "/login";
  if (!user && !isPublic) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("active").eq("id", user.id).maybeSingle();
    if (!profile?.active) {
      await supabase.auth.signOut();
      const target = request.nextUrl.clone();
      target.pathname = "/login";
      target.searchParams.set("error", "inactive");
      const redirect = NextResponse.redirect(target);
      response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
      return redirect;
    }
    if (isLogin) {
      const target = request.nextUrl.clone();
      target.pathname = request.nextUrl.searchParams.get("next") === "/scan-qr" ? "/scan-qr" : "/dashboard";
      target.search = "";
      const redirect = NextResponse.redirect(target);
      response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
      return redirect;
    }
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
