import type { ReactNode } from "react";

/**
 * Shared detail-screen header (master_design_system.md §3.C: "one DetailHeader
 * replaces ~8 independently hand-rolled header implementations" — photo/avatar,
 * bilingual title block, status chip, action button row).
 *
 * Replaces the near-identical header block previously copy-pasted across
 * Resident Profile, Household Detail, Credential/Civil/Service/Rental Request
 * Detail, Rental House Detail and Tenant Detail (docs/ux/ux_pattern_map.md
 * Cluster C).
 */
export function DetailHeader({
  photoUrl,
  initials,
  titleAm,
  titleEn,
  meta,
  status,
  actions,
}: {
  /** Signed URL for a photo/avatar image. Falls back to `initials` when absent. */
  photoUrl?: string | null;
  /** 1-2 letter fallback shown when there's no photo. */
  initials?: string;
  titleAm: string;
  /** Secondary line under the Amharic title — English name, request number, etc. */
  titleEn?: string;
  /** Small icon+text facts under the title (ID number, location, submitted date). */
  meta?: { icon?: ReactNode; label: ReactNode }[];
  /** Rendered status chip, positioned top-right on wide screens. */
  status?: ReactNode;
  /** Action buttons (print, share, permission-gated actions). */
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-[color:var(--shell-header)] px-5 py-5 text-white shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={titleAm}
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/40"
            />
          ) : (
            <div className="font-am-body flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/15 text-xl font-semibold ring-2 ring-white/25">
              {initials ?? "—"}
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-am-heading truncate text-xl font-semibold">{titleAm}</h1>
              {status}
            </div>
            {titleEn && <p className="truncate text-sm text-white/70">{titleEn}</p>}
            {meta && meta.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/70">
                {meta.map((m, i) => (
                  <span key={i} className="font-am-body inline-flex items-center gap-1">
                    {m.icon}
                    {m.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
