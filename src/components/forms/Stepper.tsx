/**
 * Shared segmented-pill wizard stepper (master_design_system.md §3.B:
 * "Segmented Stepper: Replace line-and-circle wizards with a top segmented
 * progress pill bar indicating active step and completion percentage").
 *
 * Replaces two independently-built circle-and-line steppers that existed
 * before this component: `ResidentWizardSteps.tsx`'s `StepIndicator` and
 * `admin.tenants.$woredaId.provision.tsx`'s inline stepper markup
 * (docs/ux/ux_restructure_plan.md, Cluster B; docs/ux/ux_audit_findings.md
 * Cluster B finding: two independent implementations of the same concept).
 *
 * Deliberately a plain color-transition on click/step-change, not a
 * framer-motion spring: per the apple-design skill, springs earn their keep
 * on gesture-driven, interruptible motion (something the user is dragging
 * or flicking) -- a wizard step change is a discrete, click-triggered state
 * transition with no gesture velocity to honor, so a settle-style CSS
 * transition is the right tool, same reasoning already applied to the
 * sidebar's collapse animation in AppShell.
 */
export interface StepperStep {
  id: number;
  am: string;
  en: string;
}

export function Stepper({
  steps,
  current,
  maxReached,
  onJump,
}: {
  steps: StepperStep[];
  current: number;
  /** Steps up to and including this one can be jumped to via `onJump`. Omit for a display-only stepper (no step is clickable). */
  maxReached?: number;
  onJump?: (id: number) => void;
}) {
  const reach = maxReached ?? current;
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  );
  const currentStep = steps[idx] ?? steps[0];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <p className="font-am-body text-sm font-semibold text-slate-700">
          ደረጃ {idx + 1} ከ {steps.length}{" "}
          <span className="font-normal opacity-60">
            / Step {idx + 1} of {steps.length}
          </span>
        </p>
        <p className="font-am-heading text-sm font-medium text-[color:var(--color-primary)]">
          {currentStep.am}{" "}
          <span className="font-am-body font-normal opacity-70">/ {currentStep.en}</span>
        </p>
      </div>
      <div className="flex gap-1.5">
        {steps.map((s) => {
          const filled = s.id <= current;
          const isCurrent = s.id === current;
          const reachable = !!onJump && s.id <= reach && !isCurrent;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump?.(s.id)}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`${s.am} / ${s.en}`}
              title={`${s.am} / ${s.en}`}
              className={`h-2 flex-1 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                filled ? "bg-[color:var(--color-primary)]" : "bg-slate-200"
              } ${reachable ? "cursor-pointer hover:opacity-80" : reachable === false && onJump ? "cursor-not-allowed" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}
