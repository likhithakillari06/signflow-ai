import { getContext } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await getContext();
  return (
    <AppShell workspaceName={workspace.name} email={user.email}>
      {children}
    </AppShell>
  );
}
