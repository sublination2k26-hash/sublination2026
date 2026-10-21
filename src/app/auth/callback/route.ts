import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      let destination = new URL("/dashboard", request.url);
      try {
        destination = new URL(next, request.url);
      } catch {
        // Invalid redirect parameters fall back to the dashboard.
      }
      if (destination.origin !== request.nextUrl.origin) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
      return NextResponse.redirect(destination);
    }
  }
  return NextResponse.redirect(new URL("/login?error=invite", request.url));
}
