import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/** Shared back-to-parent link, same convention wherever a page needs one
 * (master_design_system.md: a child page always has a way back to its list). */
function BackLink({ href, dark, label }: { href: string; dark?: boolean; label?: ReactNode }) {
  return (
    <Link
      to={href}
      className={`mb-2 inline-flex items-center gap-1 text-xs font-medium ${
        dark ? "text-white/70 hover:text-white" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label ?? "ተመለስ / Back"}
    </Link>
  );
}

export function PageHeader({
  icon: Icon,
  titleAm,
  titleEn,
  description,
  actions,
  variant = "plain",
  /** Route to the parent list/module page -- renders a small back link above the title. */
  backHref,
  /** Override the bilingual "ተመለስ / Back" label -- pass "← Back" on English-only admin.* routes. */
  backLabel,
}: {
  icon?: ComponentType<{ className?: string }>;
  titleAm: string;
  titleEn: string;
  description?: string;
  actions?: ReactNode;
  variant?: "plain" | "blue";
  backHref?: string;
  backLabel?: ReactNode;
}) {
  if (variant === "blue") {
    return (
      <div className="rounded-t-lg bg-blue-700 px-5 py-4 text-white">
        {backHref && <BackLink href={backHref} label={backLabel} dark />}
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="font-am-heading text-lg font-semibold">{titleAm}</h1>
            <p className="text-sm text-blue-100">{titleEn}</p>
            {description && (
              <p className="font-am-body mt-1 text-xs text-blue-100/90">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      {backHref && <BackLink href={backHref} label={backLabel} />}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white shadow-sm ring-1 ring-blue-800/20">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <h1 className="font-am-heading truncate text-xl font-semibold text-slate-900">
              {titleAm}
            </h1>
            <p className="text-sm text-slate-500">{titleEn}</p>
            {description && (
              <p className="font-am-body mt-1 text-xs text-slate-500">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
