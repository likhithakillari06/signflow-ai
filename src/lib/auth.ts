import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { asUser } from "./db";
import { createSupabaseServer } from "./supabase/server";
import type { Workspace } from "./types";

export type SessionUser = { id: string; email: string };

/** Verifies the session with Supabase Auth (not just the cookie contents). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

export const findWorkspace = cache(async (userId: string): Promise<Workspace | null> => {
  const rows = await asUser(userId, (tx) => tx<Workspace[]>`
    select w.id, w.name, w.default_template_id, w.link_expiry_days, w.created_at
      from workspaces w join workspace_members m on m.workspace_id = w.id
     where m.user_id = ${userId}
     order by m.created_at limit 1`);
  return rows[0] ?? null;
});

export type AppContext = { user: SessionUser; workspace: Workspace };

/** For pages: redirects to login / onboarding when needed. The workspace always comes from the
 *  server-side membership lookup, never from anything the browser sends. */
export async function getContext(): Promise<AppContext> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspace(user.id);
  if (!workspace) redirect("/onboarding");
  return { user, workspace };
}

/** For actions and route handlers: returns null instead of redirecting. */
export async function getContextOrNull(): Promise<AppContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const workspace = await findWorkspace(user.id);
  if (!workspace) return null;
  return { user, workspace };
}
