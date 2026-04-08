"use client";

import { startTransition, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { AppData } from "@/lib/types";

type AuthMode = "sign-in" | "sign-up" | "bootstrap";

export function AuthScreen({ initialData }: { initialData: AppData }) {
  const [mode, setMode] = useState<AuthMode>(
    initialData.bootstrapRequired ? "bootstrap" : "sign-in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const route =
    mode === "bootstrap"
      ? "/api/auth/bootstrap"
      : mode === "sign-up"
        ? "/api/auth/sign-up"
        : "/api/auth/sign-in";

  async function submit() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error ?? "Request failed");
        return;
      }

      startTransition(() => {
        window.location.reload();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#08080a] px-5 py-10">
      {/* Radial glow + dot grid */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(255,102,51,0.06), transparent), radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 24px 24px",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff6633]">
            <Sparkles className="size-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-[#ededef]">
            fal
          </span>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-white/[0.08] bg-[#111114] p-6">
          <h1 className="text-xl font-semibold tracking-tight text-[#ededef]">
            {initialData.bootstrapRequired
              ? "Create admin account"
              : "Sign in to dashboard"}
          </h1>
          <p className="mt-1.5 text-sm text-[#5c5c66]">
            {initialData.bootstrapRequired
              ? "Set up the first admin account for your team."
              : "Enter your credentials to access the dashboard."}
          </p>

          {initialData.configurationError ? (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
              {initialData.configurationError}
            </div>
          ) : null}

          {!initialData.bootstrapRequired ? (
            <div className="mt-5 flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
              <button
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "sign-in"
                    ? "bg-[#ff6633] text-white"
                    : "text-[#5c5c66] hover:text-[#9898a0]"
                }`}
                onClick={() => setMode("sign-in")}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "sign-up"
                    ? "bg-[#ff6633] text-white"
                    : "text-[#5c5c66] hover:text-[#9898a0]"
                }`}
                onClick={() => setMode("sign-up")}
                type="button"
              >
                Join by invite
              </button>
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-[#5c5c66]">
                Email
              </span>
              <input
                className="w-full rounded-lg border border-white/[0.06] bg-[#0c0c0f] px-3 py-2.5 text-sm text-[#ededef] outline-none transition placeholder:text-[#3d3d44] focus:border-[#ff6633]/30 focus:ring-1 focus:ring-[#ff6633]/20"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                type="email"
                value={email}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-[#5c5c66]">
                Password
              </span>
              <input
                className="w-full rounded-lg border border-white/[0.06] bg-[#0c0c0f] px-3 py-2.5 text-sm text-[#ededef] outline-none transition placeholder:text-[#3d3d44] focus:border-[#ff6633]/30 focus:ring-1 focus:ring-[#ff6633]/20"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                type="password"
                value={password}
              />
            </label>
          </div>

          <button
            className="mt-5 w-full rounded-lg bg-[#ff6633] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#ff7a4d] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={submit}
            disabled={busy}
            type="button"
          >
            {busy
              ? "Working..."
              : mode === "bootstrap"
                ? "Create admin account"
                : mode === "sign-up"
                  ? "Create account"
                  : "Sign in"}
          </button>

          <p className="mt-3 text-xs leading-relaxed text-[#3d3d44]">
            {mode === "bootstrap"
              ? "This creates the only admin account. All other access is invite-only."
              : mode === "sign-up"
                ? "You need an invite from the admin to create an account."
                : "Use the credentials for your invite-backed account."}
          </p>

          {message ? (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-300">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
