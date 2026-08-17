import type { ComponentType, ReactNode } from "react";

export function PageHeader({
  icon: Icon,
  titleAm,
  titleEn,
  description,
  actions,
  variant = "plain",
}: {
  icon?: ComponentType<{ className?: string }>;
  titleAm: string;
  titleEn: string;
  description?: string;
  actions?: ReactNode;
  variant?: "plain" | "blue";
}) {
  if (variant === "blue") {
    return (
      <div className="flex items-center gap-3 rounded-t-lg bg-blue-700 px-5 py-4 text-white">
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="font-noto-ethiopic text-lg font-semibold">{titleAm}</h1>
          <p className="text-sm text-blue-100">{titleEn}</p>
          {description && (
            <p className="font-noto-ethiopic mt-1 text-xs text-blue-100/90">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white shadow-sm ring-1 ring-blue-800/20">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 leading-tight">
          <h1 className="font-noto-ethiopic truncate text-xl font-semibold text-slate-900">
            {titleAm}
          </h1>
          <p className="text-sm text-slate-500">{titleEn}</p>
          {description && (
            <p className="font-noto-ethiopic mt-1 text-xs text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
