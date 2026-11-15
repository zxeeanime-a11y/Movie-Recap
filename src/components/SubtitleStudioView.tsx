import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  History,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Unlock,
  Volume2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  ExportFormat,
  FrameRate,
  SubtitleCue,
  TimelineClip,
  UserProfile,
  VideoResolution,
  VoiceProfile,
} from '../types/studio';
import { api, type ProjectDetailResponse } from '../services/api';
import { canExportProject, DEFAULT_MYANMAR_VOICE_ID, formatDisplayTimecode, getModuleSteps } from '../utils/studioRules';
import { JobProgressPanel } from './JobProgressPanel';
import { MediaUploadPanel } from './MediaUploadPanel';
import { TimelineEditor } from './TimelineEditor';
import { WorkflowStepper } from './WorkflowStepper';

interface SubtitleStudioViewProps {
  detail: ProjectDetailResponse | null;
  user: UserProfile | null;
  voices: VoiceProfile[];
  onRefresh: () => void;
  onCreateNew: () => void;
  onNotify: (msg: string) => void;
  onAutosaveState: (s: 'idle' | 'saving' | 'saved' | 'offline') => void;
}

export function SubtitleStudioView({
  detail,
  user,
  voices,
  onRefresh,
  onCreateNew,
  onNotify,
  onAutosaveState,
}: SubtitleStudioViewProps) {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('srt');
  const [exportRes, setExportRes] = useState<VideoResolution>(detail?.project.settings?.resolution || '720p');
  const [exportFps, setExportFps] = useState<FrameRate>(detail?.project.settings?.fps || 30);
  const [exporting, setExporting] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceTestAudioUrl, setVoiceTestAudioUrl] = useState('');
  const [voiceTestInfo, setVoiceTestInfo] = useState('');
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [actionError, setActionError] = useState('');
  const [editingCues, setEditingCues] = useState<SubtitleCue[] | null>(null);

  const project = detail?.project;
  const cues = editingCues ?? detail?.subtitles ?? [];
  const primaryVideo = detail?.media.find((m) => m.media_type === 'video' || m.media_type === 'audio');
  const steps = getModuleSteps('subtitle');

  const timelineClips: TimelineClip[] = useMemo(() => {
    const list: TimelineClip[] = [];
    if (primaryVideo) {
      list.push({
        id: `vid_${primaryVideo.id}`,
        trackId: 't_video',
        label: primaryVideo.original_name,
        startSec: 0,
        endSec: primaryVideo.duration_sec || 9,
        color: '#3B82F6',
      });
      list.push({
        id: `orig_${primaryVideo.id}`,
        trackId: 't_orig',
        label: 'Original Audio',
        startSec: 0,
        endSec: primaryVideo.duration_sec || 9,
        color: '#64748B',
      });
    }
    for (const c of cues) {
      list.push({
        id: `subclip_${c.id}`,
        trackId: 't_sub',
        label: c.myanmar_text || c.source_text,
        startSec: c.start_sec,
        endSec: c.end_sec,
        color: '#8B5CF6',
      });
    }
    return list;
  }, [primaryVideo, cues]);

  if (!detail || !project) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#171B26] p-6 sm:p-10 text-center space-y-4">
        <h2 className="font-display text-lg sm:text-xl font-bold text-white">
          SUBTITLE Studio · မြန်မာစာတန်းထိုး
        </h2>
        <p className="mx-auto max-w-lg text-xs sm:text-sm text-slate-400">
          Extract audio with FFmpeg, transcribe speech via Groq Whisper, translate contextually into Myanmar Unicode with Gemini, validate subtitle timing, and export SRT, ASS, VTT, or burned-in MP4.
        </p>
        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#3B82F6] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2563EB]"
        >
          <Plus className="h-4 w-4" />
          <span>Create Subtitle Project</span>
        </button>
      </div>
    );
  }

  const exportGate = canExportProject(project, Boolean(primaryVideo), cues.length > 0);
  const canUnlockTranslation = user?.role === 'admin';

  const handleSaveCues = async (nextCues: SubtitleCue[]) => {
    setActionError('');
    onAutosaveState('saving');
    try {
      await api.updateSubtitles(project.id, nextCues, !project.translation_locked);
      setEditingCues(null);
      onAutosaveState('saved');
      onRefresh();
    } catch (err) {
      onAutosaveState('idle');
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleLock = async () => {
    setActionError('');
    try {
      await api.setTranslationLock(project.id, !project.translation_locked);
      onNotify(
        project.translation_locked
          ? 'Administrator unlocked Myanmar translation editing.'
          : 'Myanmar translation locked by policy.'
      );
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setActionError('');
    try {
      await api.createExport(project.id, {
        format: exportFormat,
        resolution: exportRes,
        fps: exportFps,
      });
      onNotify(`Exported ${exportFormat.toUpperCase()} deliverable.`);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header & Compact Stepper */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#3B82F6]">
                Module 01 · SUBTITLE · မြန်မာစာတန်းထိုး
              </span>
              <button
                type="button"
                onClick={() => setInfoExpanded((v) => !v)}
                aria-expanded={infoExpanded}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 md:hidden"
              >
                <span>{infoExpanded ? 'Less' : 'Project Info'}</span>
                {infoExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
            <h1 className="mt-1 font-display text-lg sm:text-xl font-bold text-white truncate">
              {project.name}
            </h1>
            <p className={`mt-0.5 text-xs text-slate-400 ${infoExpanded ? 'block' : 'hidden md:block'}`}>
              {project.settings?.source_language} → {project.settings?.target_language} · Status: {project.status} · Version v{project.autosave_version}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void api
                  .createVersion(project.id, `Checkpoint ${new Date().toLocaleTimeString()}`)
                  .then(() => {
                    onNotify('Saved project version snapshot.');
                    onRefresh();
                  })
                  .catch((e) => {
                    setActionError(e instanceof Error ? e.message : String(e));
                    onRefresh();
                  })
              }
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-white/25"
            >
              <History className="h-3.5 w-3.5" />
              <span>Save Version</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void api
                  .approveProjectForExport(project.id, !project.approved_for_export)
                  .then(() => {
                    onNotify(project.approved_for_export ? 'Approval revoked.' : 'Project approved for export.');
                    onRefresh();
                  })
                  .catch((e) => {
                    setActionError(e instanceof Error ? e.message : String(e));
                    onRefresh();
                  })
              }
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                project.approved_for_export
                  ? 'bg-[#10B981] text-white'
                  : 'border border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{project.approved_for_export ? 'Approved' : 'Approve for Export'}</span>
            </button>
          </div>
        </div>

        <WorkflowStepper
          steps={steps}
          activeStep={project.active_step}
          job={detail.latestJob}
          accent="blue"
          onRetryStep={(jobId, stepNum) =>
            void api
              .retryJobStep(jobId, stepNum)
              .then(() => {
                onNotify(`Retrying step #${stepNum}.`);
                onRefresh();
              })
              .catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
          }
        />
      </div>

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5] break-words">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Media Import + Job Runner */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white">Step 2 · Source Media</h3>
          <MediaUploadPanel projectId={project.id} onUploaded={() => onRefresh()} />
          {detail.media.length > 0 && (
            <div className="space-y-1.5 pt-2">
              {detail.media.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] px-3 py-2 text-xs"
                >
                  <span className="truncate font-medium text-slate-200">{m.original_name}</span>
                  <span className="font-mono text-slate-400">
                    {m.duration_sec}s · {m.width}x{m.height} · {m.codec}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <JobProgressPanel
          job={detail.latestJob}
          onStartPipeline={(from) =>
            void api
              .startProjectJob(project.id, from)
              .then(() => {
                onNotify('Started Subtitle background pipeline.');
                onRefresh();
              })
              .catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
          }
          onRetryStep={(jobId, stepNum) =>
            void api
              .retryJobStep(jobId, stepNum)
              .then(() => {
                onNotify(`Retrying step #${stepNum}.`);
                onRefresh();
              })
              .catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
          }
          onCancelJob={(jobId) =>
            void api
              .cancelJob(jobId)
              .then(() => {
                onNotify('Job cancelled.');
                onRefresh();
              })
              .catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
          }
        />
      </div>

      {/* Video & Subtitle Timeline Preview */}
      <TimelineEditor
        videoUrl={primaryVideo ? `/api/media/${primaryVideo.id}/stream` : undefined}
        durationSec={primaryVideo?.duration_sec || 10}
        subtitles={cues}
        initialClips={timelineClips}
        resolutionPreview={exportRes}
        onResolutionPreviewChange={setExportRes}
      />

      {/* Subtitle Cues & Locked Myanmar Translation Policy */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">
              Steps 4–7 · Transcript, Myanmar Translation & Timing Validation
            </h3>
            <p className="text-xs text-slate-400">
              {project.translation_locked
                ? 'Myanmar translation editing is LOCKED per confirmed studio policy.'
                : 'Administrator unlock active — controlled Myanmar corrections permitted.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Subtitle Burmese voice"
              value={project.settings?.selected_voice || DEFAULT_MYANMAR_VOICE_ID}
              onChange={(e) =>
                void api
                  .updateProject(project.id, { settings: { selected_voice: e.target.value } })
                  .then(() => onRefresh())
                  .catch((err) => {
                    setActionError(err instanceof Error ? err.message : String(err));
                    onRefresh();
                  })
              }
              className="min-h-[38px] max-w-full rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1.5 text-xs text-white"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.voice_id}>
                  Voice: {v.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={testingVoice}
              onClick={() => {
                const chosenVoice = project.settings?.selected_voice || DEFAULT_MYANMAR_VOICE_ID;
                const previewText =
                  cues[0]?.myanmar_text || 'မင်္ဂလာပါ။ မြန်မာစာတန်းထိုး အသံစမ်းသပ်မှု ဖြစ်ပါတယ်။';
                setTestingVoice(true);
                setActionError('');
                void api
                  .testMyanmarTTS({ voice_id: chosenVoice, text: previewText })
                  .then((res) => {
                    setVoiceTestAudioUrl(res.audioUrl);
                    setVoiceTestInfo(`${res.providerUsed || res.modelUsed} · ${res.voiceUsed} · ${res.durationSec}s`);
                    onNotify(`Burmese voice preview ready (${res.voiceUsed}, ${res.durationSec}s).`);
                  })
                  .catch((e) => setActionError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setTestingVoice(false));
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-[#3B82F6]/50 disabled:opacity-50"
            >
              {testingVoice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5 text-[#3B82F6]" />}
              <span>{testingVoice ? 'Synthesizing...' : 'Test Voice'}</span>
            </button>

            {cues.some((c) => c.has_overlap) && (
              <button
                type="button"
                onClick={() =>
                  void api
                    .fixSubtitleOverlaps(project.id)
                    .then(() => {
                      onNotify('Resolved subtitle overlaps.');
                      onRefresh();
                    })
                    .catch((e) => {
                      setActionError(e instanceof Error ? e.message : String(e));
                      onRefresh();
                    })
                }
                className="min-h-[38px] rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-3 py-1.5 text-xs font-medium text-[#FCD34D]"
              >
                Auto-Fix Overlaps
              </button>
            )}

            <button
              type="button"
              disabled={!canUnlockTranslation}
              onClick={handleToggleLock}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-white/25 disabled:opacity-40"
            >
              {project.translation_locked ? (
                <>
                  <Lock className="h-3.5 w-3.5 text-[#EF4444]" />
                  <span>Admin Unlock Translation</span>
                </>
              ) : (
                <>
                  <Unlock className="h-3.5 w-3.5 text-[#10B981]" />
                  <span>Lock Translation</span>
                </>
              )}
            </button>

            {editingCues && (
              <button
                type="button"
                onClick={() => void handleSaveCues(editingCues)}
                className="min-h-[38px] rounded-lg bg-[#8B5CF6] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#7C3AED]"
              >
                Save Subtitle Timing
              </button>
            )}
          </div>
        </div>

        {voiceTestAudioUrl && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-lg border border-[#3B82F6]/25 bg-[#0B0D12] px-3 py-2 text-xs">
            <span className="font-mono text-[#93C5FD] break-words">{voiceTestInfo}</span>
            <audio controls src={voiceTestAudioUrl} className="h-9 w-full sm:w-64" />
          </div>
        )}

        {cues.length === 0 ? (
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D12] p-8 text-center text-xs text-slate-500">
            No subtitles generated yet. Import media and click Start Processing to extract audio, transcribe with Groq Whisper, and translate with Gemini.
          </div>
        ) : (
          <>
            {/* Mobile Compact Cue Cards */}
            <div className="space-y-2.5 md:hidden">
              {cues.map((cue, idx) => (
                <div key={cue.id} className="rounded-lg border border-white/[0.06] bg-[#0B0D12] p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="text-slate-300 tabular-nums">
                      #{cue.cue_index} · {formatDisplayTimecode(cue.start_sec)} → {formatDisplayTimecode(cue.end_sec)}
                    </span>
                    <span className={cue.has_overlap ? 'text-[#EF4444]' : 'text-[#10B981]'}>
                      {cue.reading_speed_cps} cps · {cue.has_overlap ? 'Overlap' : 'Valid'}
                    </span>
                  </div>
                  <div className="text-slate-400 leading-relaxed">{cue.source_text}</div>
                  <input
                    type="text"
                    readOnly={project.translation_locked}
                    value={cue.myanmar_text}
                    onChange={(e) => {
                      const next = [...cues];
                      next[idx] = { ...cue, myanmar_text: e.target.value };
                      setEditingCues(next);
                    }}
                    aria-label={`Myanmar subtitle line ${cue.cue_index}`}
                    className={`w-full min-h-[40px] rounded-md border px-2.5 py-1.5 text-sm myanmar-text ${
                      project.translation_locked
                        ? 'border-white/[0.05] bg-[#171B26]/70 text-slate-200 cursor-not-allowed'
                        : 'border-[#8B5CF6]/40 bg-[#171B26] text-white focus:outline-none'
                    }`}
                  />
                </div>
              ))}
            </div>

            {/* Tablet & Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-mono">#</th>
                    <th className="py-2 pr-3 font-mono">Timecode</th>
                    <th className="py-2 pr-3">Original Transcript</th>
                    <th className="py-2 pr-3">Myanmar Unicode Subtitle</th>
                    <th className="py-2 text-right font-mono">CPS / Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {cues.map((cue, idx) => (
                    <tr key={cue.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-400">{cue.cue_index}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {formatDisplayTimecode(cue.start_sec)} → {formatDisplayTimecode(cue.end_sec)}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-300 max-w-xs">{cue.source_text}</td>
                      <td className="py-2.5 pr-3 min-w-[260px]">
                        <input
                          type="text"
                          readOnly={project.translation_locked}
                          value={cue.myanmar_text}
                          onChange={(e) => {
                            const next = [...cues];
                            next[idx] = { ...cue, myanmar_text: e.target.value };
                            setEditingCues(next);
                          }}
                          aria-label={`Myanmar subtitle line ${cue.cue_index}`}
                          className={`w-full rounded-md border px-2.5 py-1.5 text-sm myanmar-text ${
                            project.translation_locked
                              ? 'border-white/[0.05] bg-[#0B0D12]/60 text-slate-200 cursor-not-allowed'
                              : 'border-[#8B5CF6]/40 bg-[#0B0D12] text-white focus:outline-none'
                          }`}
                        />
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className={cue.has_overlap ? 'text-[#EF4444]' : 'text-[#10B981]'}>
                          {cue.reading_speed_cps} cps · {cue.has_overlap ? 'Overlap' : 'Valid'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Step 8: Export Deliverables */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">Step 8 · Subtitle Export</h3>
            <p className="text-xs text-slate-400">
              {exportGate.allowed
                ? 'Review approved. Ready to render SRT, ASS, VTT, or MP4 deliverables.'
                : exportGate.reason}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Subtitle export format"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className="min-h-[38px] max-w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs text-white"
            >
              <option value="srt">SRT Subtitles (.srt)</option>
              <option value="ass">ASS Styled Subtitles (.ass)</option>
              <option value="vtt">WebVTT (.vtt)</option>
              <option value="mp4_burned">MP4 Burned-in Subtitles (.mp4)</option>
              <option value="mp4_embedded">MP4 Embedded Subtitle Track (.mp4)</option>
            </select>

            <select
              aria-label="Export frame rate"
              value={exportFps}
              onChange={(e) => setExportFps(Number(e.target.value) as FrameRate)}
              className="min-h-[38px] rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs text-white"
            >
              <option value={24}>24 FPS</option>
              <option value={25}>25 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>

            <button
              type="button"
              disabled={!exportGate.allowed || exporting}
              onClick={handleExport}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exporting ? 'Rendering...' : 'Render & Export'}</span>
            </button>
          </div>
        </div>

        {detail.exports.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            {detail.exports.map((exp) => (
              <div
                key={exp.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#10B981]" />
                  <span className="font-semibold text-white uppercase">{exp.format}</span>
                  <span className="font-mono text-slate-400 truncate">
                    {exp.resolution} · {exp.fps}fps · {(exp.file_size / 1024).toFixed(1)} KB
                  </span>
                </div>
                {exp.status === 'completed' && (
                  <a
                    href={`/api/exports/${exp.id}/download`}
                    className="rounded-md bg-[#8B5CF6]/20 px-3 py-1.5 text-xs font-medium text-[#C4B5FD] hover:bg-[#8B5CF6]/30"
                  >
                    Download
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

