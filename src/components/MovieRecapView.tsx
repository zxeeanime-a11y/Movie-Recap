import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  FrameRate,
  TimelineClip,
  VideoResolution,
  VoiceProfile,
} from '../types/studio';
import { api, type ProjectDetailResponse } from '../services/api';
import { canExportProject, DEFAULT_MYANMAR_VOICE_ID, getModuleSteps } from '../utils/studioRules';
import { JobProgressPanel } from './JobProgressPanel';
import { MediaUploadPanel } from './MediaUploadPanel';
import { SceneLibraryPanel } from './SceneLibraryPanel';
import { TimelineEditor } from './TimelineEditor';
import { WorkflowStepper } from './WorkflowStepper';

interface MovieRecapViewProps {
  detail: ProjectDetailResponse | null;
  voices: VoiceProfile[];
  onRefresh: () => void;
  onCreateNew: () => void;
  onNotify: (msg: string) => void;
  onAutosaveState: (s: 'idle' | 'saving' | 'saved' | 'offline') => void;
}

export function MovieRecapView({
  detail,
  voices,
  onRefresh,
  onCreateNew,
  onNotify,
  onAutosaveState,
}: MovieRecapViewProps) {
  const [exportRes, setExportRes] = useState<VideoResolution>(detail?.project.settings?.resolution || '720p');
  const [exportFps, setExportFps] = useState<FrameRate>(detail?.project.settings?.fps || 30);
  const [exporting, setExporting] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceTestAudioUrl, setVoiceTestAudioUrl] = useState('');
  const [voiceTestInfo, setVoiceTestInfo] = useState('');
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [error, setError] = useState('');
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);

  const project = detail?.project;
  const primaryVideo = detail?.media.find((m) => m.media_type === 'video');
  const scenes = detail?.scenes || [];
  const recapScript = detail?.recapScript;
  const voiceoverTrack = detail?.audioTracks.find((t) => t.track_type === 'recap_voiceover');
  const steps = getModuleSteps('recap');

  const timelineClips: TimelineClip[] = useMemo(() => {
    const clips: TimelineClip[] = [];
    for (const s of scenes.filter((sc) => sc.selected)) {
      clips.push({
        id: `scclip_${s.id}`,
        trackId: 't_video',
        label: `Scene ${s.scene_index}: ${s.location || 'Clip'}`,
        startSec: s.start_sec,
        endSec: s.end_sec,
        color: '#8B5CF6',
      });
    }
    if (voiceoverTrack) {
      clips.push({
        id: `vo_${voiceoverTrack.id}`,
        trackId: 't_ai',
        label: `Myanmar VO (${voiceoverTrack.voice_name})`,
        startSec: 0,
        endSec: voiceoverTrack.duration_sec || 9,
        color: '#10B981',
      });
    }
    return clips;
  }, [scenes, voiceoverTrack]);

  if (!detail || !project) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#171B26] p-6 sm:p-10 text-center space-y-4">
        <h2 className="font-display text-lg sm:text-xl font-bold text-white">
          MOVIE RECAP Studio · ဇာတ်လမ်းအကျဉ်းချုပ်
        </h2>
        <p className="mx-auto max-w-lg text-xs sm:text-sm text-slate-400">
          Detect scene boundaries and keyframes, analyze plot arcs with Gemini, select pivotal scenes, compute story-first recap duration, synthesize Myanmar narration, and assemble a synchronized recap MP4.
        </p>
        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#8B5CF6] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#7C3AED]"
        >
          <Plus className="h-4 w-4" />
          <span>Create Movie Recap Project</span>
        </button>
      </div>
    );
  }

  const exportGate = canExportProject(project, Boolean(primaryVideo), Boolean(recapScript));

  const handleSaveScript = async () => {
    if (!recapScript) return;
    onAutosaveState('saving');
    try {
      const res = await api.updateRecapScript(project.id, {
        full_myanmar_script: scriptDraft ?? recapScript.full_myanmar_script,
        title_suggestion: titleDraft ?? recapScript.title_suggestion,
        caption_suggestion: captionDraft ?? recapScript.caption_suggestion,
        approved: true,
      });
      setScriptDraft(null);
      setTitleDraft(null);
      setCaptionDraft(null);
      onAutosaveState('saved');
      onNotify(`Saved recap script (recommended duration ${res.recommendedSec}s).`);
      onRefresh();
    } catch (err) {
      onAutosaveState('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportMp4 = async () => {
    setExporting(true);
    setError('');
    try {
      await api.createExport(project.id, {
        format: 'mp4',
        resolution: exportRes,
        fps: exportFps,
      });
      onNotify('Rendered final Movie Recap MP4.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header & Compact Workflow Stepper */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#8B5CF6]">
                Module 02 · MOVIE RECAP · ဇာတ်လမ်းအကျဉ်းချုပ်
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
              {project.settings?.recap_style} · {project.settings?.target_platform} · Mode:{' '}
              {project.settings?.processing_mode === 'full' ? 'Full Movie' : 'Segment-by-Segment'} · Target Duration:{' '}
              {project.settings?.target_duration_sec}s
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Processing mode"
              value={project.settings?.processing_mode || 'full'}
              onChange={(e) =>
                void api
                  .updateProject(project.id, {
                    settings: { processing_mode: e.target.value as 'full' | 'segmented' },
                  })
                  .then(() => onRefresh())
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    onRefresh();
                  })
              }
              className="min-h-[38px] rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1.5 text-xs text-white"
            >
              <option value="full">Full Movie</option>
              <option value="segmented">Segmented</option>
            </select>

            <select
              aria-label="Recap narrator voice"
              value={project.settings?.selected_voice || DEFAULT_MYANMAR_VOICE_ID}
              onChange={(e) =>
                void api
                  .updateProject(project.id, { settings: { selected_voice: e.target.value } })
                  .then(() => onRefresh())
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    onRefresh();
                  })
              }
              className="min-h-[38px] max-w-full rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 py-1.5 text-xs text-white"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.voice_id}>
                  Narrator: {v.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={testingVoice}
              onClick={() => {
                const chosen = project.settings?.selected_voice || DEFAULT_MYANMAR_VOICE_ID;
                setTestingVoice(true);
                setError('');
                void api
                  .testMyanmarTTS({
                    voice_id: chosen,
                    text:
                      scriptDraft ||
                      recapScript?.full_myanmar_script?.slice(0, 180) ||
                      'မင်္ဂလာပါ။ ဒီနေ့ ဇာတ်လမ်းအကျဉ်းချုပ်ကို တင်ဆက်ပေးပါမယ်။',
                  })
                  .then((res) => {
                    setVoiceTestAudioUrl(res.audioUrl);
                    setVoiceTestInfo(`${res.providerUsed || res.modelUsed} · ${res.voiceUsed} · ${res.durationSec}s`);
                    onNotify(`Narrator voice test succeeded (${res.voiceUsed}, ${res.durationSec}s).`);
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setTestingVoice(false));
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-[#8B5CF6]/50 disabled:opacity-50"
            >
              {testingVoice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5 text-[#8B5CF6]" />}
              <span>{testingVoice ? 'Testing...' : 'Test Voice'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                void api
                  .approveProjectForExport(project.id, !project.approved_for_export)
                  .then(() => {
                    onNotify(project.approved_for_export ? 'Approval revoked.' : 'Recap approved for export.');
                    onRefresh();
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    onRefresh();
                  })
              }
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold ${
                project.approved_for_export
                  ? 'bg-[#10B981] text-white'
                  : 'border border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{project.approved_for_export ? 'Approved' : 'Approve Final Recap'}</span>
            </button>
          </div>
        </div>

        {voiceTestAudioUrl && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-lg border border-[#8B5CF6]/25 bg-[#0B0D12] px-3 py-2 text-xs">
            <span className="font-mono text-[#C4B5FD] break-words">{voiceTestInfo}</span>
            <audio controls src={voiceTestAudioUrl} className="h-9 w-full sm:w-64" />
          </div>
        )}

        <WorkflowStepper
          steps={steps}
          activeStep={project.active_step}
          job={detail.latestJob}
          accent="purple"
          onRetryStep={(jobId, stepNum) =>
            void api
              .retryJobStep(jobId, stepNum)
              .then(() => {
                onNotify(`Retrying step #${stepNum}.`);
                onRefresh();
              })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5] break-words">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Import + Pipeline Runner */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white">Step 2 · Import Movie</h3>
          <MediaUploadPanel projectId={project.id} onUploaded={() => onRefresh()} />
          {primaryVideo && (
            <div className="rounded-lg border border-white/[0.06] bg-[#0B0D12] px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-200 font-medium truncate">{primaryVideo.original_name}</span>
              <span className="font-mono text-slate-400">
                {primaryVideo.duration_sec}s · {primaryVideo.width}x{primaryVideo.height} · {primaryVideo.fps}fps
              </span>
            </div>
          )}
        </div>

        <JobProgressPanel
          job={detail.latestJob}
          onStartPipeline={(from) =>
            void api
              .startProjectJob(project.id, from)
              .then(() => {
                onNotify('Started Movie Recap pipeline.');
                onRefresh();
              })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
          onRetryStep={(jobId, stepNum) =>
            void api
              .retryJobStep(jobId, stepNum)
              .then(() => {
                onNotify(`Retrying step #${stepNum}.`);
                onRefresh();
              })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
          onCancelJob={(jobId) =>
            void api
              .cancelJob(jobId)
              .then(() => {
                onNotify('Job cancelled.');
                onRefresh();
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          }
        />
      </div>

      {/* Steps 4-7: Responsive Scene Library (2-col mobile grid, search, filter, pagination, expandable details) */}
      <SceneLibraryPanel
        scenes={scenes}
        onToggleScene={(sceneId, selected) =>
          void api
            .updateScene(project.id, sceneId, { selected })
            .then(() => onRefresh())
            .catch((err) => {
              setError(err instanceof Error ? err.message : String(err));
              onRefresh();
            })
        }
      />

      {/* Steps 6, 8, 9, 10: Story Arc, Recap Duration, Myanmar Script & Voiceover */}
      {recapScript && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[#8B5CF6]" />
              <h3 className="font-display text-sm font-semibold text-white">
                Step 6 · Structured Story Understanding
              </h3>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ['Beginning', recapScript.story_arc.beginning],
                ['Middle', recapScript.story_arc.middle],
                ['Main Conflict', recapScript.story_arc.main_conflict],
                ['Character Relationships', recapScript.story_arc.character_relationships],
                ['Climax', recapScript.story_arc.climax],
                ['Ending', recapScript.story_arc.ending],
              ].map(([label, val]) => (
                <div key={String(label)} className="rounded-lg bg-[#0B0D12] p-2.5">
                  <div className="font-semibold text-slate-300">{label}</div>
                  <div className="mt-0.5 text-slate-400 myanmar-text break-words">{val || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-white">
                Steps 9–10 · Myanmar Recap Script & Voiceover
              </h3>
              <span className="font-mono text-xs text-[#10B981] shrink-0">
                Est. Duration: {recapScript.estimated_duration_sec}s
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Title Suggestion</label>
                <input
                  type="text"
                  value={titleDraft ?? recapScript.title_suggestion}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white myanmar-text"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Myanmar Recap Script (မြန်မာဘာသာ)</label>
                <textarea
                  rows={7}
                  value={scriptDraft ?? recapScript.full_myanmar_script}
                  onChange={(e) => setScriptDraft(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white myanmar-text"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Social Caption</label>
                <input
                  type="text"
                  value={captionDraft ?? recapScript.caption_suggestion}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-xs text-slate-200 myanmar-text"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <button
                  type="button"
                  onClick={handleSaveScript}
                  className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED] shrink-0"
                >
                  Save & Confirm Script
                </button>
                {voiceoverTrack && (
                  <audio controls src={`/api/audio/${voiceoverTrack.id}/stream`} className="h-9 w-full sm:max-w-xs" />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline & Final Preview */}
      <TimelineEditor
        videoUrl={
          project.active_step >= 11
            ? `/api/projects/${project.id}/preview-video`
            : primaryVideo
              ? `/api/media/${primaryVideo.id}/stream`
              : undefined
        }
        durationSec={primaryVideo?.duration_sec || 10}
        initialClips={timelineClips}
        resolutionPreview={exportRes}
        onResolutionPreviewChange={setExportRes}
      />

      {/* Steps 13-14: Final Review & MP4 Export */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-white">
              Steps 13–14 · Final Review & MP4 Export
            </h3>
            <p className="text-xs text-slate-400 break-words">
              {exportGate.allowed ? 'Approved for final MP4 rendering.' : exportGate.reason}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Recap export frame rate"
              value={exportFps}
              onChange={(e) => setExportFps(Number(e.target.value) as FrameRate)}
              className="min-h-[38px] rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs text-white"
            >
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>

            <button
              type="button"
              disabled={!exportGate.allowed || exporting}
              onClick={handleExportMp4}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exporting ? 'Rendering MP4...' : 'Export Recap MP4'}</span>
            </button>
          </div>
        </div>

        {detail.exports.length > 0 && (
          <div className="space-y-2 border-t border-white/[0.06] pt-3">
            {detail.exports.map((exp) => (
              <div
                key={exp.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Film className="h-4 w-4 shrink-0 text-[#8B5CF6]" />
                  <span className="font-semibold text-white uppercase">{exp.format}</span>
                  <span className="font-mono text-slate-400 break-words">
                    {exp.resolution} · {exp.fps}fps · {(exp.file_size / 1024).toFixed(1)} KB
                  </span>
                </div>
                {exp.status === 'completed' && (
                  <a
                    href={`/api/exports/${exp.id}/download`}
                    className="inline-flex min-h-[32px] items-center rounded-md bg-[#8B5CF6]/20 px-3 py-1 text-xs font-medium text-[#C4B5FD] hover:bg-[#8B5CF6]/30 shrink-0"
                  >
                    Download MP4
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
