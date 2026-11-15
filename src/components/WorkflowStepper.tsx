import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { ProcessingJobRecord } from '../types/studio';
import { summarizeWorkflowSteps } from '../utils/studioRules';

interface WorkflowStepperProps {
  steps: Array<{ stepNumber: number; key: string; label: string }>;
  activeStep: number;
  job: ProcessingJobRecord | null;
  accent?: 'blue' | 'purple' | 'emerald';
  onRetryStep?: (jobId: string, stepNumber: number) => void;
}

const ACCENT_MAP = {
  blue: {
    bar: 'bg-[#3B82F6]',
    badge: 'text-[#60A5FA]',
    activeRing: 'border-[#3B82F6] bg-[#3B82F6]/20 text-white',
    donePill: 'border-[#10B981]/40 bg-[#10B981]/15 text-[#6EE7B7]',
  },
  purple: {
    bar: 'bg-[#8B5CF6]',
    badge: 'text-[#A78BFA]',
    activeRing: 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-white',
    donePill: 'border-[#10B981]/40 bg-[#10B981]/15 text-[#6EE7B7]',
  },
  emerald: {
    bar: 'bg-[#10B981]',
    badge: 'text-[#34D399]',
    activeRing: 'border-[#10B981] bg-[#10B981]/20 text-white',
    donePill: 'border-[#10B981]/40 bg-[#10B981]/15 text-[#6EE7B7]',
  },
};

export function WorkflowStepper({
  steps,
  activeStep,
  job,
  accent = 'purple',
  onRetryStep,
}: WorkflowStepperProps) {
  const [expanded, setExpanded] = useState(false);
  const colors = ACCENT_MAP[accent];
  const summary = summarizeWorkflowSteps(steps, job?.steps, activeStep);
  const isRunning = Boolean(job && ['Queued', 'Preparing', 'Processing', 'Rendering'].includes(job.status));
  const failedJobStep = job?.steps.find((s) => s.status === 'failed');

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0B0D12] p-3 sm:p-3.5 space-y-2.5">
      {/* Compact Stepper Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`font-mono font-semibold tabular-nums ${colors.badge}`}>
              Step {summary.currentStepNumber}/{summary.total}
            </span>
            <span className="font-semibold text-white truncate">{summary.currentStepLabel}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 font-mono tabular-nums">
            <span className="text-[#10B981]">{summary.completedCount} done</span>
            <span>{summary.remainingCount} remaining</span>
            {summary.failedCount > 0 && (
              <span className="text-[#FCA5A5] font-semibold">{summary.failedCount} failed</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#171B26] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-white/25 whitespace-nowrap shrink-0"
        >
          <span>{expanded ? 'Hide Steps' : `All ${summary.total} Steps`}</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Progress Bar + Compact Horizontal Step Rail */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#171B26]">
        <div
          className={`h-full transition-all ${summary.failedCount > 0 ? 'bg-[#EF4444]' : colors.bar}`}
          style={{ width: `${Math.max(4, summary.progressPct)}%` }}
        />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5" aria-label="Workflow steps progress">
        {steps.map((s) => {
          const jobStep = job?.steps.find((js) => js.step_number === s.stepNumber);
          const status = jobStep
            ? jobStep.status
            : activeStep > s.stepNumber
              ? 'completed'
              : activeStep === s.stepNumber
                ? 'running'
                : 'pending';

          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={`Step ${s.stepNumber}: ${s.label} (${status})`}
              aria-label={`Step ${s.stepNumber}: ${s.label}, status ${status}`}
              className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] tabular-nums transition-colors ${
                status === 'failed'
                  ? 'border-[#EF4444]/60 bg-[#EF4444]/15 text-[#FCA5A5]'
                  : status === 'completed'
                    ? colors.donePill
                    : status === 'running'
                      ? colors.activeRing
                      : 'border-white/[0.07] bg-[#11141C] text-slate-500'
              }`}
            >
              {status === 'completed' ? (
                <Check className="h-3.5 w-3.5" />
              ) : status === 'failed' ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                s.stepNumber
              )}
            </button>
          );
        })}
      </div>

      {/* Visible Error Highlight & Failed Step Retry */}
      {failedJobStep && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-semibold">
              Failed at Step {failedJobStep.step_number}: {failedJobStep.step_label}
            </div>
            {(failedJobStep.error_details || job?.error_message) && (
              <div className="break-words text-[11px] leading-relaxed text-[#FECACA]">
                {failedJobStep.error_details || job?.error_message}
              </div>
            )}
          </div>
          {job && onRetryStep && !isRunning && (
            <button
              type="button"
              onClick={() => onRetryStep(job.id, failedJobStep.step_number)}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md border border-[#EF4444]/50 bg-[#171B26] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#EF4444]/20"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Retry Step {failedJobStep.step_number}</span>
            </button>
          )}
        </div>
      )}

      {/* Expandable Full Step List */}
      {expanded && (
        <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s) => {
            const jobStep = job?.steps.find((js) => js.step_number === s.stepNumber);
            const status = jobStep
              ? jobStep.status
              : activeStep > s.stepNumber
                ? 'completed'
                : activeStep === s.stepNumber
                  ? 'running'
                  : 'pending';

            return (
              <div
                key={s.key}
                className={`flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs ${
                  status === 'failed'
                    ? 'border-[#EF4444]/40 bg-[#EF4444]/10'
                    : status === 'completed'
                      ? 'border-[#10B981]/25 bg-[#11141C]'
                      : status === 'running'
                        ? 'border-white/20 bg-[#171B26]'
                        : 'border-white/[0.05] bg-[#11141C]/60 opacity-75'
                }`}
              >
                <div className="flex min-w-0 items-start gap-2">
                  {status === 'completed' ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#10B981]" />
                  ) : status === 'running' ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#3B82F6]" />
                  ) : status === 'failed' ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EF4444]" />
                  ) : (
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 leading-snug">
                      {s.stepNumber}. {s.label}
                    </div>
                    {jobStep?.output_summary && (
                      <div className="mt-0.5 text-[11px] text-slate-400 break-words">
                        {jobStep.output_summary}
                      </div>
                    )}
                    {jobStep?.error_details && (
                      <div className="mt-0.5 text-[11px] text-[#FCA5A5] break-words">
                        {jobStep.error_details}
                      </div>
                    )}
                  </div>
                </div>

                {status === 'failed' && job && onRetryStep && !isRunning && (
                  <button
                    type="button"
                    onClick={() => onRetryStep(job.id, s.stepNumber)}
                    className="shrink-0 rounded-md border border-[#EF4444]/50 bg-[#171B26] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#EF4444]/20"
                  >
                    <RotateCcw className="inline h-3 w-3 mr-1" />
                    Retry
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
