import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { parseAuthRedirect } from "@/lib/authRedirect";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
});

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-sm text-slate-500">Loading…</div>
    </div>
  );
}

/**
 * The classic hash-fragment invite flow (`#access_token=…`) is consumed
 * automatically by supabase-js's own `detectSessionInUrl` before this
 * component ever renders -- nothing to do here for that shape, and the
 * status==='pending' branch below already routes it to /set-password.
 *
 * What supabase-js does NOT handle automatically is the other shape GoTrue
 * can send an invite link in: `?token_hash=…&type=invite` (what Supabase's
 * dashboard email templates use when they link straight to the site URL
 * instead of routing through GoTrue's own /verify redirect), and its
 * rejection counterpart `?error=…&error_description=…` (expired or
 * already-used link). Neither was handled before this fix -- both silently
 * fell through to `!role` and landed on /login with no explanation, which
 * is indistinguishable from "nothing happened" to whoever clicked the link.
 */
function useInviteTokenHandler() {
  const [state, setState] = useState<
    { kind: "checking" } | { kind: "settled" } | { kind: "error"; description: string }
  >({ kind: "checking" });

  useEffect(() => {
    const outcome = parseAuthRedirect(window.location.search, window.location.hash);
    if (outcome.kind === "none") {
      setState({ kind: "settled" });
      return;
    }
    // Scrub the token/error out of the address bar immediately -- it's
    // single-use and shouldn't linger in history regardless of what happens
    // next (verifyOtp success falls through to the redirect below; failure
    // shows the error card in place, without the token still sitting in the URL).
    window.history.replaceState({}, "", "/");

    if (outcome.kind === "error") {
      setState({ kind: "error", description: outcome.description });
      return;
    }

    supabase.auth.verifyOtp({ token_hash: outcome.tokenHash, type: "invite" }).then(({ error }) => {
      setState(error ? { kind: "error", description: error.message } : { kind: "settled" });
    });
  }, []);

  return state;
}

function InvalidLinkCard({ description }: { description: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
        <h1 className="font-noto-ethiopic text-2xl font-bold text-slate-900">ወረዳ አስተዳደር ሥርዓት</h1>
        <p className="mt-1 text-sm text-slate-500">Woreda Administration ERP — Harari Region</p>
        <div className="my-6 border-t border-slate-200" />
        <h2 className="text-lg font-semibold text-slate-900">This link is no longer valid</h2>
        <p className="mt-2 text-sm text-slate-600">
          Invitation and reset links expire after a short time and can only be used once. Ask an
          administrator to send a new one.
        </p>
        <p className="mt-4 text-xs text-slate-400">{description}</p>
        <a
          href="/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
        >
          Back to sign in
        </a>
      </div>
    </div>
  );
}

function IndexRedirect() {
  const tokenState = useInviteTokenHandler();
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.appUser?.status);

  if (tokenState.kind === "checking") return <Loading />;
  if (tokenState.kind === "error") return <InvalidLinkCard description={tokenState.description} />;

  if (isLoading) return <Loading />;

  if (!role) return <Navigate to="/login" />;

  // An invitation link redeems its token and lands here, because Supabase sends
  // invites to the project's site URL. Such an account is 'pending' and has no
  // password yet, so send it on to choose one rather than to a dashboard whose
  // queries would all come back empty — user_has_perm() requires 'active'.
  if (status === "pending") return <Navigate to="/set-password" />;

  // Suspended or deactivated accounts get turned away at sign-in.
  if (status !== "active") return <Navigate to="/login" />;

  if (role === "super_admin") return <Navigate to="/admin/dashboard" />;
  return <Navigate to="/woreda/dashboard" />;
}
