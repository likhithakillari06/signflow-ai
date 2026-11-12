"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { createWorkspaceAction, type AuthState } from "../(auth)/actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(createWorkspaceAction, {});
  return (
    <form action={action} className="grid gap-4">
      <Field label="Company name" htmlFor="company">
        <Input id="company" name="company" required maxLength={120} placeholder="Astra AI" />
      </Field>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>Create workspace</Button>
    </form>
  );
}
