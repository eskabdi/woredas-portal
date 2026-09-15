/**
 * Shared read-only workflow-progress indicator for the four workflow-style
 * detail screens (Credential, Civil Event, Service Request, Rental Request)
 * that each hand-rolled their own stage tracking before this component
 * (docs/ux/ux_pattern_map.md Cluster C; master_design_system.md §3.C: "where
 * am I in this process" should be visible at a glance, not inferred from
 * badge text).
 *
 * Unlike `Stepper` (forms/Stepper.tsx), this is not interactive — a workflow
 * stage advances only through a permission-gated action elsewhere on the
 * page, never by clicking the indicator itself. It also has to represent an
 * off-the-happy-path outcome (rejected, returned for correction) that a form
 * wizard never does, hence the separate `exception` prop rather than reusing
 * `Stepper` for both.
 */
export interface WorkflowStage {
  key: string;
  am: string;
  en: string;
}

export function WorkflowStepper({
  stages,
  currentStage,
  exception,
}: {
  stages: WorkflowStage[];
  /** Key of the current stage. Ignored (dots render up to `exception` instead) when `exception` is set. */
  currentStage: string;
  /** An off-the-happy-path outcome (rejected, returned) that pauses or ends the flow before its natural next stage. */
  exception?: { am: string; en: string; tone: "danger" | "warning" };
}) {
  const idx = Math.max(
    0,
    stages.findIndex((s) => s.key === currentStage),
  );
  const currentStageInfo = stages[idx];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-md">
      <div className="flex items-center">
        {stages.map((s, i) => {
          const done = i < idx || (i === idx && !exception);
          const isCurrent = i === idx;
          return (
            <div key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`h-3 w-3 shrink-0 rounded-full ${
                    done
                      ? "bg-[color:var(--color-primary)]"
                      : isCurrent
                        ? "bg-amber-500"
                        : "bg-slate-200"
                  }`}
                  aria-current={isCurrent ? "step" : undefined}
                />
                <span
                  className={`font-am-body mt-1.5 max-w-20 text-center text-[11px] leading-tight ${
                    isCurrent ? "font-semibold text-slate-800" : "text-slate-500"
                  }`}
                >
                  {s.am}
                </span>
              </div>
              {i < stages.length - 1 && (
                <div
                  className={`mx-1 h-0.5 flex-1 rounded-full ${
                    i < idx ? "bg-[color:var(--color-primary)]" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {exception ? (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            /* WCAG 2.1 AA: the raw --status-danger/--status-warning tokens
             * (2.15-3.76:1 on their own light tint) are calibrated as
             * accent hues against the dark --shell-header background, not
             * as text-on-light -- darker Tailwind shades pass 4.5:1 here. */
            exception.tone === "danger"
              ? "bg-[color:var(--status-danger-bg)] text-red-700"
              : "bg-[color:var(--status-warning-bg)] text-amber-700"
          }`}
        >
          <span className="font-am-body font-medium">{exception.am}</span>
          <span className="ml-1 font-normal">/ {exception.en}</span>
        </div>
      ) : (
        currentStageInfo && (
          <p className="font-am-body mt-3 text-sm text-slate-600">
            አሁን ያለበት ደረጃ <span className="font-medium text-slate-900">{currentStageInfo.am}</span>
            <span className="opacity-70"> / Current stage: {currentStageInfo.en}</span>
          </p>
        )
      )}
    </div>
  );
}
