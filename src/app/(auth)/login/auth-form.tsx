"use client";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { signInAction, signUpAction, type AuthState } from "../actions";

export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signIn, signingIn] = useActionState<AuthState, FormData>(signInAction, {});
  const [signUpState, signUp, signingUp] = useActionState<AuthState, FormData>(signUpAction, {});
  const state = mode === "signin" ? signInState : signUpState;
  const pending = signingIn || signingUp;

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 rounded-lg bg-secondary p-1 text-sm font-medium">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md py-1.5 transition-colors ${mode === m ? "bg-card shadow-sm" : "text-muted-foreground"}`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form action={mode === "signin" ? signIn : signUp} className="grid gap-4">
        {mode === "signup" ? (
          <Field label="Company name" htmlFor="company" hint="This becomes your private workspace.">
            <Input id="company" name="company" placeholder="Astra AI" required maxLength={120} autoComplete="organization" />
          </Field>
        ) : null}
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
        </Field>
        <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        </Field>
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {mode === "signin" ? "Sign in" : "Create workspace"}
        </Button>
      </form>
    </div>
  );
}
