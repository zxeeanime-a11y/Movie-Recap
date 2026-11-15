import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Lock,
  Mic,
  Plus,
  RotateCcw,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FrameRate, TimelineClip, VideoResolution, VoiceProfile } from '../types/studio';
import { api, type ProjectDetailResponse } from '../services/api';
import { canExportProject, DEFAULT_MYANMAR_VOICE_ID, formatDisplayTimecode, getModuleSteps } from '../utils/studioRules';
import { JobProgressPanel } from './JobProgressPanel';
import { MediaUploadPanel } from './MediaUploadPanel';
import { TimelineEditor } from './TimelineEditor';
import { WorkflowStepper } from './WorkflowStepper';

interface DubbingStudioViewProps {
  detail: ProjectDetailResponse | null;
  voices: VoiceProfile[];
  onRefresh: () => void;
  onCreateNew: () => void;
  onNotify: (msg: string) => void;
}

export function DubbingStudioView({
  detail,
  voices,
  onRefresh,
  onCreateNew,
  onNotify,
}: DubbingStudioViewProps) {
  const [exportRes, setExportRes] = useState<VideoResolution>(detail?.project.settings?.resolution || '720p');
  const [exportFps, setExportFps] = useState<FrameRate>(detail?.project.settings?.fps || 30);
  const [exporting, setExporting] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voiceTestAudioUrl, setVoiceTestAudioUrl] = useState('');
  const [voiceTestInfo, setVoiceTestInfo] = useState('');
  const [showMobileInfo, setShowMobileInfo] = useState(false);
  const [error, setError] = useState('');

  const project = detail?.project;
  const primaryVideo = detail?.media.find((m) => m.media_type === 'video');
  const transcripts = detail?.transcripts || [];
  const audioTracks = detail?.audioTracks || [];
  const steps = getModuleSteps('dubbing');

  const dialogueStem = audioTracks.find((a) => a.track_type === 'dialogue_stem');
  const musicStem = audioTracks.find((a) => a.track_type === 'music_stem');
  const sfxStem = audioTracks.find((a) => a.track_type === 'sfx_stem');
  const originalTrack = audioTracks.find((a) => a.track_type === 'original');
  const ttsTracks = audioTracks.filter((a) => a.track_type === 'tts_segment');

  const timelineClips: TimelineClip[] = useMemo(() => {
    const clips: TimelineClip[] = [];
    if (primaryVideo) {
      clips.push({
        id: `dv_${primaryVideo.id}`,
        trackId: 't_video',
        label: primaryVideo.original_name,
        startSec: 0,
        endSec: primaryVideo.duration_sec || 9,
        color: '#3B82F6',
      });
    }
    if (dialogueStem) {
      clips.push({
        id: `ddlg_${dialogueStem.id}`,
        trackId: 't_dlg',
        label: 'Separated Dialogue Stem',
        startSec: 0,
        endSec: dialogueStem.duration_sec || 9,
        color: '#64748B',
      });
    }
    if (musicStem) {
      clips.push({
        id: `dmus_${musicStem.id}`,
        trackId: 't_bgm',
        label: 'Background Music Stem',
        startSec: 0,
        endSec: musicStem.duration_sec || 9,
        color: '#8B5CF6',
      });
    }
    if (sfxStem) {
      clips.push({
        id: `dsfx_${sfxStem.id}`,
        trackId: 't_sfx',
        label: 'SFX / Ambience Stem',
        startSec: 0,
        endSec: sfxStem.duration_sec || 9,
        color: '#F59E0B',
      });
    }
    for (const seg of ttsTracks) {
      clips.push({
        id: `dtts_${seg.id}`,
        trackId: 't_ai',
        label: `MM Dub #${seg.segment_index} (${seg.voice_name})`,
        startSec: seg.start_sec,
        endSec: seg.end_sec,
        color: '#10B981',
      });
    }
    return clips;
  }, [primaryVideo, dialogueStem, musicStem, sfxStem, ttsTracks]);

  if (!detail || !project) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#171B26] p-6 sm:p-10 text-center space-y-4">
        <h2 className="font-display text-lg sm:text-xl font-bold text-white">
          AI DUBBING Studio · <span className="myanmar-text">မြန်မာအသံသွင်းခြင်း</span>
        </h2>
        <p className="mx-auto max-w-lg text-xs sm:text-sm text-slate-400">
          Separate dialogue from music and SFX stems, translate dialogue into Myanmar Unicode, synthesize Myanmar speech using strictly ONE selected project voice across all characters, mix stems cleanly, and export dubbed MP4.
        </p>
        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#10B981] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#059669]"
        >
          <Plus className="h-4 w-4" />
          <span>Create AI Dubbing Project</span>
        </button>
      </div>
    );
  }

  const singleVoice = project.settings?.selected_voice || DEFAULT_MYANMAR_VOICE_ID;
  const exportGate = canExportProject(
    project,
    Boolean(primaryVideo),
    ttsTracks.length > 0 || Boolean(project.settings?.restore_original_audio)
  );

  const handleVoiceChange = async (voiceId: string) => {
    setError('');
    try {
      await api.setDubbingSingleVoice(project.id, voiceId);
      onNotify(`Single project voice set to "${voiceId}". Earlier audio versions preserved.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      await api.createExport(project.id, {
        format: 'mp4',
        resolution: exportRes,
        fps: exportFps,
      });
      onNotify('Exported Myanmar dubbed MP4.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header + Compact Stepper */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#10B981]">
              <span>Module 03 · AI DUBBING</span>
              <button
                type="button"
                onClick={() => setShowMobileInfo((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#0B0D12] px-2 py-0.5 text-[11px] text-slate-300 sm:hidden"
              >
                <span>{showMobileInfo ? 'Hide Info' : 'Voice & Info'}</span>
                {showMobileInfo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
            <h1 className="mt-1 font-display text-lg sm:text-xl font-bold text-white break-words">
              {project.name}
            </h1>
            <p className={`mt-0.5 text-xs text-slate-400 ${showMobileInfo ? 'block' : 'hidden sm:block'}`}>
              {project.settings?.source_language} → {project.settings?.target_language} · Active Single Voice:{' '}
              <span className="font-semibold text-white">{singleVoice}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() =>
                void api
                  .updateProject(project.id, {
                    settings: { restore_original_audio: !project.settings?.restore_original_audio },
                  })
                  .then(() => {
                    onNotify(
                      project.settings?.restore_original_audio
                        ? 'Switched back to Myanmar AI Dubbed mix.'
                        : 'Restored original preserved audio.'
                    );
                    onRefresh();
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    onRefresh();
                  })
              }
              className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                project.settings?.restore_original_audio
                  ? 'border-[#F59E0B]/50 bg-[#F59E0B]/15 text-[#FCD34D]'
                  : 'border-white/10 bg-[#0B0D12] text-slate-300 hover:text-white'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>
                {project.settings?.restore_original_audio
                  ? 'Original Restored'
                  : 'Restore Original'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                void api
                  .approveProjectForExport(project.id, !project.approved_for_export)
                  .then(() => {
                    onNotify(project.approved_for_export ? 'Approval revoked.' : 'Dubbing approved for export.');
                    onRefresh();
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                    onRefresh();
                  })
              }
              className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold ${
                project.approved_for_export
                  ? 'bg-[#10B981] text-white'
                  : 'border border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{project.approved_for_export ? 'Approved' : 'Approve Dubbed Video'}</span>
            </button>
          </div>
        </div>

        {/* Mandatory Absolute One-Voice Rule Panel */}
        <div className="flex flex-col gap-3 rounded-xl border border-[#10B981]/30 bg-[#10B981]/10 p-3 sm:p-3.5">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" />
            <div className="min-w-0 text-xs">
              <div className="font-semibold text-white">
                Absolute One-Voice Policy Active (All Characters & Narration)
              </div>
              <div className={`mt-0.5 text-slate-300 ${showMobileInfo ? 'block' : 'hidden sm:block'}`}>
                Every male, female, and narrator line uses this single project voice. Speaker IDs are kept solely for dialogue segmentation.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="dubbing-single-voice" className="text-xs font-medium text-white whitespace-nowrap">
              Project Voice:
            </label>
            <select
              id="dubbing-single-voice"
              value={singleVoice}
              onChange={(e) => void handleVoiceChange(e.target.value)}
              className="min-h-[38px] w-full sm:w-auto flex-1 sm:flex-initial rounded-lg border border-white/20 bg-[#0B0D12] px-3 py-1.5 text-xs font-semibold text-white"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.voice_id}>
                  {v.name} — {v.style_note}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={testingVoice}
              onClick={() => {
                setTestingVoice(true);
                setError('');
                void api
                  .testMyanmarTTS({
                    voice_id: singleVoice,
                    text: 'မြန်မာဘာသာဖြင့် အသံထုတ်လုပ်ရန် စာသား',
                  })
                  .then((res) => {
                    setVoiceTestAudioUrl(res.audioUrl);
                    setVoiceTestInfo(
                      `${res.providerUsed || res.modelUsed} · Voice: ${res.voiceUsed} · ${res.durationSec}s (${res.formatUsed})`
                    );
                    onNotify(`Myanmar TTS test succeeded (${res.durationSec}s, voice ${res.voiceUsed}).`);
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setTestingVoice(false));
              }}
              className="inline-flex min-h-[38px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-[#10B981]/50 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-[#10B981] hover:bg-[#10B981]/15 disabled:opacity-50"
            >
              {testingVoice ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              <span>{testingVoice ? 'Testing TTS...' : 'Test Myanmar Voice'}</span>
            </button>
          </div>
          {voiceTestAudioUrl && (
            <div className="flex w-full flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-[#10B981]/20 pt-2.5 text-xs">
              <span className="font-mono text-[#6EE7B7] break-words">{voiceTestInfo}</span>
              <audio controls src={voiceTestAudioUrl} className="h-8 w-full sm:w-64" />
            </div>
          )}
        </div>

        <WorkflowStepper
          steps={steps}
          activeStep={project.active_step}
          job={detail.latestJob}
          accent="emerald"
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
        <div className="flex items-start gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Upload + Job Runner */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white">Step 2 · Import Video</h3>
          <MediaUploadPanel projectId={project.id} onUploaded={() => onRefresh()} />
        </div>

        <JobProgressPanel
          job={detail.latestJob}
          onStartPipeline={(from) =>
            void api
              .startProjectJob(project.id, from)
              .then(() => {
                onNotify('Started AI Dubbing pipeline.');
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

      {/* Stem Separation & Mixing Console */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white">
            Steps 3–4 · Separated Audio Stems & Original Recovery
          </h3>
          {[
            { label: 'Original Audio (Preserved)', track: originalTrack },
            { label: 'Dialogue / Vocal Stem', track: dialogueStem },
            { label: 'Background Music Stem', track: musicStem },
            { label: 'Sound Effects / Ambience Stem', track: sfxStem },
          ].map((item) => (
            <div
              key={item.label}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] p-2.5 text-xs"
            >
              <span className="font-medium text-slate-200">{item.label}</span>
              {item.track ? (
                <audio controls src={`/api/audio/${item.track.id}/stream`} className="h-8 w-full sm:max-w-[230px]" />
              ) : (
                <span className="text-slate-500">Not extracted yet</span>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
          <h3 className="font-display text-sm font-semibold text-white">
            Step 10 · Multi-Stem Mix Levels
          </h3>
          {[
            {
              label: 'AI Dubbed Dialogue Level',
              key: 'dialogue_volume' as const,
              val: project.settings?.dialogue_volume ?? 1.0,
            },
            {
              label: 'Background Music Stem Level',
              key: 'bgm_volume' as const,
              val: project.settings?.bgm_volume ?? 0.35,
            },
            {
              label: 'Sound Effects Stem Level',
              key: 'sfx_volume' as const,
              val: project.settings?.sfx_volume ?? 0.75,
            },
          ].map((slider) => (
            <div key={slider.key} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">{slider.label}</span>
                <span className="font-mono tabular-nums text-slate-400">{Math.round(slider.val * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={slider.val}
                onChange={(e) =>
                  void api
                    .updateProject(project.id, {
                      settings: { [slider.key]: Number(e.target.value) },
                    })
                    .then(() => onRefresh())
                    .catch((err) => {
                      setError(err instanceof Error ? err.message : String(err));
                      onRefresh();
                    })
                }
                className="h-2 w-full accent-[#10B981]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Dialogue Segments + Single-Voice TTS Output */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
        <h3 className="font-display text-sm font-semibold text-white">
          Steps 5–9 · Dialogue Segmentation, Myanmar Translation & One-Voice TTS Clips
        </h3>
        {transcripts.length === 0 ? (
          <div className="rounded-lg border border-white/[0.06] bg-[#0B0D12] p-6 sm:p-8 text-center text-xs text-slate-500">
            No dubbed dialogue segments yet. Run the pipeline to separate stems, transcribe with Groq Whisper, translate with Gemini, and generate single-voice Myanmar TTS.
          </div>
        ) : (
          <>
            {/* Mobile Stacked Cards */}
            <div className="space-y-3 md:hidden">
              {transcripts.map((seg) => {
                const tts = ttsTracks.find((t) => t.segment_index === seg.segment_index);
                return (
                  <div
                    key={seg.id}
                    className="rounded-xl border border-white/[0.07] bg-[#0B0D12] p-3 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-[#10B981]">
                        {seg.speaker_id} · {formatDisplayTimecode(seg.start_sec)}–{formatDisplayTimecode(seg.end_sec)}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {tts?.voice_name || singleVoice} (v{tts?.version || 1})
                      </span>
                    </div>
                    <p className="text-slate-300 break-words">{seg.original_text}</p>
                    <p className="text-white myanmar-text break-words">{seg.translated_myanmar || '—'}</p>
                    {tts ? (
                      <div className="flex items-center gap-2 pt-1">
                        <audio controls src={`/api/audio/${tts.id}/stream`} className="h-8 w-full" />
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">{tts.speed_ratio}x</span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">Pending TTS</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Tablet/Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-mono">Speaker ID</th>
                    <th className="py-2 pr-3 font-mono">Time</th>
                    <th className="py-2 pr-3">Source Dialogue</th>
                    <th className="py-2 pr-3">Myanmar Dubbing Line</th>
                    <th className="py-2 pr-3">Assigned Voice</th>
                    <th className="py-2">Generated Audio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {transcripts.map((seg) => {
                    const tts = ttsTracks.find((t) => t.segment_index === seg.segment_index);
                    return (
                      <tr key={seg.id}>
                        <td className="py-2.5 pr-3 font-mono text-slate-400">{seg.speaker_id}</td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {formatDisplayTimecode(seg.start_sec)}–{formatDisplayTimecode(seg.end_sec)}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-300 max-w-xs break-words">{seg.original_text}</td>
                        <td className="py-2.5 pr-3 text-white max-w-xs myanmar-text break-words">
                          {seg.translated_myanmar || '—'}
                        </td>
                        <td className="py-2.5 pr-3 font-medium text-[#10B981]">
                          {tts?.voice_name || singleVoice} (v{tts?.version || 1})
                        </td>
                        <td className="py-2.5">
                          {tts ? (
                            <div className="flex items-center gap-2">
                              <audio controls src={`/api/audio/${tts.id}/stream`} className="h-8 max-w-[180px]" />
                              <span className="font-mono text-[10px] text-slate-400">
                                {tts.speed_ratio}x
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">Pending TTS</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Video & Audio Timeline */}
      <TimelineEditor
        videoUrl={
          project.active_step >= 10
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

      {/* Export Dubbed MP4 */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-white">Step 13 · Export Dubbed MP4</h3>
            <p className="text-xs text-slate-400 break-words">
              {exportGate.allowed ? 'Approved for final Myanmar dubbed MP4 export.' : exportGate.reason}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Dubbing export FPS"
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
              onClick={handleExport}
              className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exporting ? 'Rendering Dubbed MP4...' : 'Export Dubbed MP4'}</span>
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
                  <Mic className="h-4 w-4 shrink-0 text-[#10B981]" />
                  <span className="font-semibold text-white uppercase">{exp.format}</span>
                  <span className="font-mono text-slate-400 break-words">
                    {exp.resolution} · {exp.fps}fps · {(exp.file_size / 1024).toFixed(1)} KB
                  </span>
                </div>
                {exp.status === 'completed' && (
                  <a
                    href={`/api/exports/${exp.id}/download`}
                    className="inline-flex min-h-[32px] items-center rounded-md bg-[#10B981]/20 px-3 py-1 text-xs font-medium text-[#6EE7B7] hover:bg-[#10B981]/30 shrink-0"
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
