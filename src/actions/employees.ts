"use server";

import "server-only";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authEmailToEmployeeLogin } from "@/lib/auth/employee-login";
import { APP_ROLES, type AppRole } from "@/lib/auth/permissions";

export type EmployeeAccount = { id: string; name: string; loginId: string; role: AppRole; active: boolean };
type Result = { ok: true } | { error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sign in with an admin account to manage employees.");
  const { data: profile, error } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only an active admin can manage employee accounts.");
  return { supabase, user };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error("Set SUPABASE_SECRET_KEY on the server to create employee accounts.");
  return createSupabaseAdmin(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function listEmployees(): Promise<{ employees?: EmployeeAccount[]; error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { data: profiles, error } = await supabase.from("profiles").select("id,full_name,role,active,created_at").order("created_at");
    if (error) throw error;
    const admin = serviceClient();
    const employees: EmployeeAccount[] = [];
    for (const profile of profiles ?? []) {
      const { data: authData, error: userError } = await admin.auth.admin.getUserById(profile.id);
      if (userError) continue;
      employees.push({ id: profile.id, name: profile.full_name, loginId: authEmailToEmployeeLogin(authData.user.email ?? ""), role: profile.role as AppRole, active: profile.active });
    }
    return { employees };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not load employee accounts." }; }
}

export async function createEmployee(input: { name: string; email: string; password: string; role: AppRole }): Promise<Result> {
  try {
    await requireAdmin();
    if (!input.name.trim()) return { error: "Enter the employee's full name." };
    if (!APP_ROLES.includes(input.role)) return { error: "Select a valid employee role." };
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
    if (input.password.length < 8) return { error: "Password must be at least 8 characters." };
    const admin = serviceClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.name.trim() },
    });
    if (error || !data.user) throw error ?? new Error("Supabase did not create the employee account.");
    const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, full_name: input.name.trim(), role: input.role, active: true });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }
    revalidatePath("/employees");
    return { ok: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not create employee account." }; }
}

export async function updateEmployee(input: { id: string; name: string; role: AppRole; active: boolean }): Promise<Result> {
  try {
    const { supabase, user } = await requireAdmin();
    if (!input.name.trim()) return { error: "Enter the employee's full name." };
    if (!APP_ROLES.includes(input.role)) return { error: "Select a valid employee role." };
    if (input.id === user.id && !input.active) return { error: "You cannot deactivate the admin account currently in use." };
    if (input.id === user.id && input.role !== "admin") return { error: "You cannot remove admin access from the account currently in use." };
    const { data, error } = await supabase.from("profiles").update({ full_name: input.name.trim(), role: input.role, active: input.active, updated_at: new Date().toISOString() }).eq("id", input.id).select("id").single();
    if (error) throw error;
    if (!data) throw new Error("Employee was not updated. Refresh the employee list and try again.");
    revalidatePath("/employees");
    return { ok: true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not update employee." }; }
}

