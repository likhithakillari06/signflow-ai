"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getAppUrl } from "@/lib/env";
import { createWorkspaceForUser } from "@/lib/services/workspace";
import { createSupabaseServer } from "@/lib/supabase/server";

export type AuthState = { error?: string; notice?: string };

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(72),
});
const companyName = z.string().trim().min(2, "Enter your company name.").max(120);

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: /confirm/i.test(error.message) ? "Please confirm your email address first (check your inbox)." : "Incorrect email or password." };
  }
  redirect("/dashboard");
}

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  if (process.env.SIGNUPS_DISABLED === "true") return { error: "New sign-ups are closed on this deployment. Ask the owner for an account." };
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const company = companyName.safeParse(form.get("company"));
  if (!company.success) return { error: company.error.issues[0].message };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { data: { company: company.data }, emailRedirectTo: `${await getAppUrl()}/auth/confirm` },
  });
  if (error) return { error: error.message };
  if (!data.session || !data.user) {
    return { notice: "Almost there. We sent a confirmation link to your email; open it, then sign in." };
  }
  await createWorkspaceForUser(data.user.id, company.data);
  redirect("/dashboard");
}

export async function createWorkspaceAction(_: AuthState, form: FormData): Promise<AuthState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const company = companyName.safeParse(form.get("company"));
  if (!company.success) return { error: company.error.issues[0].message };
  await createWorkspaceForUser(user.id, company.data);
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
