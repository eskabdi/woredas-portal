import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { translateError } from "@/lib/errorMessages";

/**
 * Invokes a Supabase Edge Function and recovers its real JSON error body.
 *
 * `supabase.functions.invoke()` throws `FunctionsHttpError` on any non-2xx
 * response *before* the body is ever read, so `error.message` is always the
 * client library's own hardcoded string ("Edge Function returned a non-2xx
 * status code") -- never the function's own, specific rejection reason. The
 * real body is still on `error.context` (a `Response`); this reads it and
 * runs the result through `translateError()` so every call site shows the
 * function's actual reason, not the library's generic one.
 *
 * See docs/rbac-security-forensic-review.md, F1.
 */
export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; friendlyError: string | null }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return { data, friendlyError: null };

  let raw: string | null = null;
  if (error instanceof FunctionsHttpError) {
    try {
      const errorBody = await error.context.json();
      raw = typeof errorBody?.error === "string" ? errorBody.error : null;
    } catch {
      /* non-JSON body -- fall through to the generic message */
    }
  }
  return { data: null, friendlyError: translateError(raw ?? error.message) };
}
