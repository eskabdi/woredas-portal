import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAuthState } from "@/hooks/useAuthBootstrap";
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
 * The classic hash-fragment invite/recovery flow (`#access_token=…`) is
 * consumed automatically by supabase-js's own `detectSessionInUrl` before
 * this component ever renders -- nothing to do here for that shape, and the
 * status==='pending' branch below already routes an invite to /set-password.
 *
 * What supabase-js does NOT handle automatically is the other shape GoTrue
 * can send these links in: `?token_hash=…&type=invite` or `type=recovery`
 * (what Supabase's dashboard email templates use when they link straight to
 * the site URL instead of routing through GoTrue's own /verify redirect),
 * and its rejection counterpart `?error=…&error_description=…` (expired or
 * already-used link). None of these were handled before this fix -- all
 * silently fell through to `!role` and landed on /login with no
 * explanation, which is indistinguishable from "nothing happened" to
 * whoever clicked the link.
 *
 * For `recovery` specifically (F12,
 * docs/rbac-security-forensic-review.md): the store is populated explicitly
 * here via fetchAuthState()/setAuth(), the same "don't trust the ambient
 * listener for a time-sensitive transition" pattern set-password.tsx already
 * uses -- whether verifyOtp's resulting session change surfaces through
 * onAuthStateChange as PASSWORD_RECOVERY or SIGNED_IN isn't something this
 * app's listener (useAuthBootstrap.ts) needs to special-case if this handler
 * never depends on it firing at all.
 */
function useAuthLinkHandler() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [state, setState] = useState<
    | { kind: "checking" }
    | { kind: "settled" }
    | { kind: "recovery-settled" }
    | { kind: "error"; description: string }
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

    if (outcome.kind === "recovery") {
      supabase.auth
        .verifyOtp({ token_hash: outcome.tokenHash, type: "recovery" })
        .then(async ({ data, error }) => {
          if (error || !data.session?.user) {
            setState({ kind: "error", description: error?.message ?? "Recovery link invalid" });
            return;
          }
          const { appUser, consolePermissions, permissions } = await fetchAuthState(
            data.session.user.id,
          );
          setAuth(data.session.user, appUser, consolePermissions, permissions);
          setState({ kind: "recovery-settled" });
        });
      return;
    }

    supabase.auth.verifyOtp({ token_hash: outcome.tokenHash, type: "invite" }).then(({ error }) => {
      setState(error ? { kind: "error", description: error.message } : { kind: "settled" });
    });
  }, [setAuth]);

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
  const tokenState = useAuthLinkHandler();
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.appUser?.status);

  if (tokenState.kind === "checking") return <Loading />;
  if (tokenState.kind === "error") return <InvalidLinkCard description={tokenState.description} />;

  // A recovery link's user is normally already active -- send them straight
  // to /set-password rather than through the pending/active branching below,
  // which would otherwise route an active user directly to their dashboard
  // and skip the "choose a new password" step entirely.
  //
  // But this handler runs before isLoading/status are otherwise checked, so
  // without this guard a type=recovery link generated for a suspended or
  // deactivated account (CLAUDE.md notes this path stays reachable if an
  // administrator ever sends one manually from the Supabase dashboard) would
  // let that account set a brand-new password and reach /set-password --
  // exactly the capability the ordinary login-time status gate a few lines
  // below (`status !== "active"` -> /login) exists to deny. Mirrors that
  // same gate rather than forcing a sign-out: an already-live session for a
  // non-active account is the existing, accepted behavior on this route.
  if (tokenState.kind === "recovery-settled") {
    if (status && status !== "active" && status !== "pending") {
      return <Navigate to="/login" />;
    }
    return <Navigate to="/set-password" />;
  }

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
