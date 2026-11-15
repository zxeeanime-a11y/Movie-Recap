import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';
import type { ProcessingJobRecord } from '../types/studio';

interface JobProgressPanelProps {
  job: ProcessingJobRecord | null;
  onStartPipeline: (fromStep?: number) => void;
  onRetryStep: (jobId: string, stepNumber: number) => void;
  onCancelJob: (jobId: string) => void;
  busy?: boolean;
}

export function JobProgressPanel({
  job,
  onStartPipeline,
  onRetryStep,
  onCancelJob,
  busy,
}: JobProgressPanelProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const isRunning = Boolean(job && ['Queued', 'Preparing', 'Processing', 'Rendering'].includes(job.status));
  const completedCount = job ? job.steps.filter((s) => s.status === 'completed').length : 0;
  const failedSteps = job ? job.steps.filter((s) => s.status === 'failed') : [];
  const remainingCount = job ? Math.max(0, job.steps.length - completedCount) : 0;
  const activeStepObj = job
    ? job.steps.find((s) => s.status === 'running') ||
      failedSteps[0] ||
      job.steps.find((s) => s.step_number === job.current_step) ||
      job.steps[job.steps.length - 1]
    : null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-white">Processing Pipeline</h3>
          <p className="mt-0.5 text-xs text-slate-400 font-mono tabular-nums">
            {job
              ? `${job.status} · ${completedCount}/${job.steps.length} done · ${remainingCount} left (${job.progress_pct}%)`
              : 'Ready to run automated FFmpeg and AI steps'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isRunning && job ? (
            <button
              type="button"
              onClick={() => onCancelJob(job.id)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-1.5 text-xs font-medium text-[#FCA5A5] hover:bg-[#EF4444]/20"
            >
              <Square className="h-3.5 w-3.5" />
              <span>Cancel Job</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onStartPipeline(1)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#8B5CF6] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#7C3AED] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{job ? 'Re-Run Pipeline' : 'Start Processing'}</span>
            </button>
          )}

          {job && (
            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>{showLogs ? 'Hide Logs' : 'Logs'}</span>
            </button>
          )}
        </div>
      </div>

      {job && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#0B0D12]">
          <div
            className={`h-full transition-all ${
              job.status === 'Failed'
                ? 'bg-[#EF4444]'
                : job.status === 'Completed' || job.status === 'Reviewing'
                  ? 'bg-[#10B981]'
                  : 'bg-[#3B82F6]'
            }`}
            style={{ width: `${job.progress_pct}%` }}
          />
        </div>
      )}

      {/* Current Step Highlight */}
      {job && activeStepObj && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] px-3 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            {activeStepObj.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#10B981]" />
            ) : activeStepObj.status === 'running' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#3B82F6]" />
            ) : activeStepObj.status === 'failed' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#EF4444]" />
            ) : (
              <Clock className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <span className="truncate font-medium text-slate-200">
              Current: {activeStepObj.step_number}. {activeStepObj.step_label}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            aria-expanded={showSteps}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A78BFA] hover:underline shrink-0"
          >
            <span>{showSteps ? 'Hide Step Details' : `Step Details (${job.steps.length})`}</span>
            {showSteps ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {/* Readable Error Message (always visible when failed) */}
      {(job?.error_message || failedSteps.length > 0) && (
        <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5] space-y-2">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-semibold">Step Error (completed outputs preserved)</div>
              {job?.error_message && <div className="break-words leading-relaxed">{job.error_message}</div>}
            </div>
          </div>

          {job && failedSteps.length > 0 && !isRunning && (
            <div className="flex flex-wrap gap-2 pt-1">
              {failedSteps.map((fs) => (
                <button
                  key={fs.id}
                  type="button"
                  onClick={() => onRetryStep(job.id, fs.step_number)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#EF4444]/50 bg-[#171B26] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#EF4444]/20"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retry Step {fs.step_number}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expandable Steps List */}
      {job && job.steps.length > 0 && showSteps && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {job.steps.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] p-2.5"
            >
              <div className="flex min-w-0 items-start gap-2">
                {s.status === 'completed' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" />
                ) : s.status === 'running' ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#3B82F6]" />
                ) : s.status === 'failed' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" />
                ) : (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-200 leading-snug">
                    {s.step_number}. {s.step_label}
                  </div>
                  {s.output_summary && (
                    <div className="mt-0.5 text-[11px] text-slate-400 break-words">{s.output_summary}</div>
                  )}
                  {s.error_details && (
                    <div className="mt-0.5 text-[11px] text-[#FCA5A5] break-words">{s.error_details}</div>
                  )}
                </div>
              </div>

              {s.status === 'failed' && !isRunning && (
                <button
                  type="button"
                  onClick={() => onRetryStep(job.id, s.step_number)}
                  title={`Retry failed step ${s.step_number}`}
                  className="shrink-0 rounded-md border border-[#EF4444]/50 bg-[#171B26] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#EF4444]/20"
                >
                  <RotateCcw className="inline h-3 w-3 mr-1" />
                  Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showLogs && job && (
        <pre className="max-h-48 overflow-y-auto overflow-x-auto rounded-lg border border-white/[0.08] bg-[#0B0D12] p-3 font-mono text-[11px] text-slate-300">
          {job.logs.length > 0 ? job.logs.join('\n') : 'No logs recorded yet.'}
        </pre>
      )}
    </div>
  );
}

