#!/usr/bin/env bun
/**
 * INSA Enforcer 6.2: seeds one synthetic test account per privilege level
 * (super_admin, tenant_admin, a mid-tier operational role, viewer) into a
 * STAGING Supabase project, using this app's own auth surface rather than
 * hand-rolled SQL -- see docs/staging-runbook.md for the full runbook this
 * script is one step of.
 *
 * Why not just INSERT rows: invite-tenant-user and invite-platform-admin
 * (supabase/functions/) both require the CALLER to already be an active
 * admin -- they mint new accounts, they don't bootstrap the first one. So
 * this script has an unavoidable chicken-and-egg step: the very first
 * super_admin is created directly via the Auth Admin API and a raw
 * app_user insert (the same pattern supabase/seed-app-users.sql already
 * uses for this project's own real bootstrap admin -- not a shortcut
 * invented here). Every account after that is created through the real
 * invite-platform-admin / invite-tenant-user Edge Functions, signed in as
 * that bootstrap super_admin, so the accounts this script produces are
 * provisioned exactly the way a real admin would provision them -- correct
 * app_user rows, correct audit_log entries, correct rate-limit bucket
 * writes. Each invited account is then activated by signing in as THAT
 * account and calling activate-invited-user (self-service, same as a real
 * user completing /set-password) rather than a raw
 * `UPDATE app_user SET status = 'active'` -- this is the one place a raw
 * write would have been simpler, and deliberately isn't, so the accounts
 * this script creates exercise the exact same code path a real invited
 * user's first login does.
 *
 * Usage:
 *   export SUPABASE_URL=https://<staging-ref>.supabase.co
 *   export SUPABASE_PUBLISHABLE_KEY=<staging anon/publishable key>
 *   export SUPABASE_SERVICE_ROLE_KEY=<staging service_role key>
 *   bun run scripts/seed-staging-users.ts <staging-project-ref>
 *
 * The project ref is a REQUIRED explicit argument, not a default or an env
 * var read implicitly -- the one real risk with this script is a
 * copy-pasted wrong ref, not a code defect, since invite-platform-admin/
 * invite-tenant-user are project-scoped by whichever URL/service-role key
 * this process happens to be holding. NEVER run this against the
 * production project ref.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const PRODUCTION_PROJECT_REF = "tugzuexfyzbdnghbmrjl";
// Aboker, one of the six woredas supabase/seed.sql inserts with this fixed
// UUID -- same one supabase/seed-app-users.sql's own real tenant_admin
// example already uses, so it's guaranteed present after a normal deploy.
const STAGING_TEST_WOREDA_ID = "81ac2ad6-a320-4069-b8dc-0c43e358371b";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const projectRef = process.argv[2];
if (!projectRef) {
  console.error("usage: bun run scripts/seed-staging-users.ts <staging-project-ref>");
  process.exit(2);
}
if (projectRef === PRODUCTION_PROJECT_REF) {
  fail(
    `refusing to run against the production project ref (${PRODUCTION_PROJECT_REF}). ` +
      "This script creates accounts with fake @example.com addresses and a freshly " +
      "generated password -- it must only ever target a staging project.",
  );
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  fail(
    "missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY. " +
      "Export these for the STAGING project before running this script.",
  );
}
if (!SUPABASE_URL.includes(projectRef)) {
  fail(
    `SUPABASE_URL (${SUPABASE_URL}) doesn't contain project ref ${projectRef} -- ` +
      "double check these point at the same project before continuing.",
  );
}

// A fresh random password per run, printed once at the end -- never a
// hardcoded literal in this file, and never written to a scratch file.
const TEST_PASSWORD = randomBytes(12).toString("base64url");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Account {
  label: string;
  email: string;
  fullName: string;
  role: "super_admin" | "tenant_admin" | "registry_clerk" | "viewer";
}

const ACCOUNTS: Account[] = [
  {
    label: "super_admin",
    email: "staging-super-admin@example.com",
    fullName: "Staging Super Admin",
    role: "super_admin",
  },
  {
    label: "tenant_admin",
    email: "staging-tenant-admin@example.com",
    fullName: "Staging Tenant Admin",
    role: "tenant_admin",
  },
  {
    label: "mid-tier operational role (registry_clerk)",
    email: "staging-registry-clerk@example.com",
    fullName: "Staging Registry Clerk",
    role: "registry_clerk",
  },
  {
    label: "viewer",
    email: "staging-viewer@example.com",
    fullName: "Staging Viewer",
    role: "viewer",
  },
];

/** Signs in as `email` on a throwaway client and calls an Edge Function with that session. */
async function callAsUser<T>(email: string, fn: string, body: Record<string, unknown>) {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInErr) throw new Error(`sign-in as ${email} failed: ${signInErr.message}`);
  const { data, error } = await client.functions.invoke<T>(fn, { body });
  if (error) throw new Error(`${fn} as ${email} failed: ${error.message}`);
  return data;
}

/** Sets a known password on an already-created auth user and activates the
 * pending app_user row via the real self-service activation path. */
async function setPasswordAndActivate(userId: string, email: string) {
  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (pwErr) throw new Error(`setting password for ${email} failed: ${pwErr.message}`);
  await callAsUser(email, "activate-invited-user", {});
}

async function main() {
  console.log(`Seeding ${ACCOUNTS.length} staging test accounts into ${projectRef}...`);

  // 1. Bootstrap the super_admin directly -- there is no existing caller
  // that could invite it. Mirrors supabase/seed-app-users.sql's own pattern.
  const superAdmin = ACCOUNTS[0]!;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: superAdmin.email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    fail(`creating bootstrap super_admin failed: ${createErr?.message ?? "no user returned"}`);
  }
  const superAdminId = created.user.id;
  const { error: insertErr } = await admin.from("app_user").insert({
    user_id: superAdminId,
    woreda_id: null,
    role: "super_admin",
    full_name: superAdmin.fullName,
    username: "staging-super-admin",
    status: "active",
  });
  if (insertErr)
    fail(`inserting bootstrap super_admin's app_user row failed: ${insertErr.message}`);
  console.log(`  [1/4] ${superAdmin.label}: ${superAdmin.email} (bootstrap, active)`);

  // 2. tenant_admin -- via invite-platform-admin, called as the bootstrap super_admin.
  const tenantAdmin = ACCOUNTS[1]!;
  const invitePlatformResult = await callAsUser<{ user_id: string }>(
    superAdmin.email,
    "invite-platform-admin",
    {
      email: tenantAdmin.email,
      full_name: tenantAdmin.fullName,
      role: "tenant_admin",
      woredaId: STAGING_TEST_WOREDA_ID,
    },
  );
  await setPasswordAndActivate(invitePlatformResult.user_id, tenantAdmin.email);
  console.log(`  [2/4] ${tenantAdmin.label}: ${tenantAdmin.email} (invited + activated)`);

  // 3 & 4. mid-tier + viewer -- via invite-tenant-user, also called as the
  // bootstrap super_admin (it satisfies invite-tenant-user's isSuper check,
  // so there's no need to sign in as the tenant_admin created above).
  for (const [i, account] of ACCOUNTS.slice(2).entries()) {
    const inviteResult = await callAsUser<{ user_id: string }>(
      superAdmin.email,
      "invite-tenant-user",
      {
        email: account.email,
        full_name: account.fullName,
        role: account.role,
        woredaId: STAGING_TEST_WOREDA_ID,
      },
    );
    await setPasswordAndActivate(inviteResult.user_id, account.email);
    console.log(`  [${i + 3}/4] ${account.label}: ${account.email} (invited + activated)`);
  }

  console.log("\nDone. Test account credentials (store these, do not commit them):\n");
  for (const account of ACCOUNTS) {
    console.log(`  ${account.email.padEnd(34)} ${TEST_PASSWORD}`);
  }
  console.log(
    "\nAll four accounts share this one password. Sign in at the staging deploy's /login.",
  );
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
