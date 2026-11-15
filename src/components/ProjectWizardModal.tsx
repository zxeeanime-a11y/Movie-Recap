import { Captions, Check, Film, Mic, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  FrameRate,
  MediaFileRecord,
  ModuleType,
  ProjectRecord,
  VideoResolution,
  VoiceProfile,
} from '../types/studio';
import { api } from '../services/api';
import { DEFAULT_MYANMAR_VOICE_ID } from '../utils/studioRules';
import { MediaUploadPanel } from './MediaUploadPanel';

interface ProjectWizardModalProps {
  open: boolean;
  initialModule?: ModuleType;
  voices: VoiceProfile[];
  onClose: () => void;
  onCreated: (project: ProjectRecord) => void;
}

export function ProjectWizardModal({
  open,
  initialModule = 'subtitle',
  voices,
  onClose,
  onCreated,
}: ProjectWizardModalProps) {
  const [step, setStep] = useState(1);
  const [module, setModule] = useState<ModuleType>(initialModule);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('English');
  const [targetLanguage, setTargetLanguage] = useState('Myanmar');
  const [recapStyle, setRecapStyle] = useState('Dramatic Storyteller');
  const [targetPlatform, setTargetPlatform] = useState('YouTube (16:9)');
  const [processingMode, setProcessingMode] = useState<'full' | 'segmented'>('full');
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_MYANMAR_VOICE_ID);
  const [resolution, setResolution] = useState<VideoResolution>('720p');
  const [fps, setFps] = useState<FrameRate>(30);
  const [uploadedMedia, setUploadedMedia] = useState<MediaFileRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setModule(initialModule);
      setStep(1);
      setName('');
      setDescription('');
      setSelectedVoice(DEFAULT_MYANMAR_VOICE_ID);
      setUploadedMedia([]);
      setError('');
    }
  }, [open, initialModule]);

  if (!open) return null;

  const steps = [
    '1. Select Module',
    '2. Project Info',
    '3. Import Media',
    '4. AI Configuration',
    '5. Review & Create',
  ];

  const handleFinish = async (asDraft = false) => {
    if (!name.trim()) {
      setError('Project name is required.');
      setStep(2);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await api.createProject({
        module,
        name: name.trim(),
        description: description.trim(),
        settings: {
          source_language: sourceLanguage,
          target_language: targetLanguage,
          recap_style: recapStyle,
          target_platform: targetPlatform,
          processing_mode: processingMode,
          selected_voice: selectedVoice,
          resolution,
          fps,
        },
      });
      for (const m of uploadedMedia) {
        await api.attachMediaToProject(m.id, res.project.id);
      }
      onCreated(res.project);
      if (!asDraft || uploadedMedia.length > 0) {
        onClose();
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#171B26] shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3 sm:px-6 sm:py-4 bg-[#11141C]">
          <div className="min-w-0">
            <h2 id="wizard-title" className="font-display text-base sm:text-lg font-bold text-white truncate">
              Create Production Project
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400">Step {step} of 5 · Preserves inputs across navigation</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close project wizard"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex overflow-x-auto no-scrollbar sm:grid sm:grid-cols-5 border-b border-white/[0.06] bg-[#0B0D12] px-3 sm:px-4 py-2 gap-1.5 sm:gap-2">
          {steps.map((label, idx) => {
            const num = idx + 1;
            const active = num === step;
            const done = num < step;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(num)}
                className={`shrink-0 whitespace-nowrap sm:truncate rounded-md px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-[#8B5CF6]/20 text-white border border-[#8B5CF6]/50'
                    : done
                      ? 'text-[#10B981]'
                      : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                {
                  id: 'subtitle' as ModuleType,
                  title: 'SUBTITLE',
                  mm: 'မြန်မာစာတန်းထိုး',
                  desc: 'Extract audio, transcribe via Groq Whisper, translate contextually to Myanmar Unicode, and export SRT/ASS/VTT or burned MP4.',
                  icon: Captions,
                  color: 'text-[#3B82F6]',
                },
                {
                  id: 'recap' as ModuleType,
                  title: 'MOVIE RECAP',
                  mm: 'ဇာတ်လမ်းအကျဉ်းချုပ်',
                  desc: 'Detect scenes, analyze story arc with Gemini, write Myanmar narration, synthesize voiceover, and render recap MP4.',
                  icon: Film,
                  color: 'text-[#8B5CF6]',
                },
                {
                  id: 'dubbing' as ModuleType,
                  title: 'AI DUBBING',
                  mm: 'မြန်မာအသံသွင်းခြင်း',
                  desc: 'Separate dialogue, music & SFX stems, translate dialogue, synthesize single-voice Myanmar dubbing, and mix final MP4.',
                  icon: Mic,
                  color: 'text-[#10B981]',
                },
              ].map((m) => {
                const Icon = m.icon;
                const selected = module === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModule(m.id)}
                    className={`flex flex-col items-start rounded-xl border p-4 text-left transition-colors ${
                      selected
                        ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
                        : 'border-white/[0.08] bg-[#0B0D12] hover:border-white/20'
                    }`}
                  >
                    <Icon className={`h-6 w-6 ${m.color}`} />
                    <div className="mt-3 font-display text-sm font-bold text-white">{m.title}</div>
                    <div className="text-xs text-[#8B5CF6]">{m.mm}</div>
                    <p className="mt-2 text-xs text-slate-400 leading-relaxed">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="wiz-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Project Name
                </label>
                <input
                  id="wiz-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Midnight Vault — Myanmar Recap"
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white focus:border-[#8B5CF6] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="wiz-desc" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Story Context / Production Notes
                </label>
                <textarea
                  id="wiz-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Character names, genre, or terminology guidelines for Gemini translation..."
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white focus:border-[#8B5CF6] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="wiz-src-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Source Language
                  </label>
                  <select
                    id="wiz-src-lang"
                    value={sourceLanguage}
                    onChange={(e) => setSourceLanguage(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                  >
                    <option value="English">English</option>
                    <option value="Korean">Korean</option>
                    <option value="Japanese">Japanese</option>
                    <option value="Chinese">Chinese</option>
                    <option value="Thai">Thai</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Auto">Auto Detect</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="wiz-tgt-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Target Language
                  </label>
                  <input
                    id="wiz-tgt-lang"
                    type="text"
                    value={targetLanguage}
                    onChange={(e) => setTargetLanguage(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <MediaUploadPanel
                onUploaded={(m) => setUploadedMedia((prev) => [...prev, m])}
              />
              {uploadedMedia.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-300">Attached Media Assets</div>
                  {uploadedMedia.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-[#0B0D12] px-3 py-2 text-xs text-slate-200"
                    >
                      <span>{m.original_name}</span>
                      <span className="font-mono text-slate-400">
                        {m.duration_sec}s · {m.width}x{m.height} · {m.storage_mode}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {module === 'recap' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Recap Style</label>
                    <select
                      value={recapStyle}
                      onChange={(e) => setRecapStyle(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                    >
                      <option value="Dramatic Storyteller">Dramatic Storyteller</option>
                      <option value="Suspense & Thriller">Suspense & Thriller</option>
                      <option value="Fast Viral Summary">Fast Viral Summary</option>
                      <option value="Emotional Character Focus">Emotional Character Focus</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Target Platform</label>
                    <select
                      value={targetPlatform}
                      onChange={(e) => setTargetPlatform(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                    >
                      <option value="YouTube (16:9)">YouTube (16:9)</option>
                      <option value="Facebook Video">Facebook Video</option>
                      <option value="TikTok / Reels">TikTok / Reels</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Processing Mode</label>
                    <select
                      value={processingMode}
                      onChange={(e) => setProcessingMode(e.target.value as 'full' | 'segmented')}
                      className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                    >
                      <option value="full">Full Movie Processing</option>
                      <option value="segmented">Segment-by-Segment Processing</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="wiz-voice" className="block text-xs font-medium text-slate-300 mb-1.5">
                  {module === 'dubbing'
                    ? 'Single Project Voice (One-Voice Rule)'
                    : module === 'recap'
                      ? 'Burmese Narration Voice'
                      : 'Burmese AI Voice (Preview / TTS)'}
                </label>
                <select
                  id="wiz-voice"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.voice_id}>
                      {v.name} — {v.style_note}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Output Resolution</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as VideoResolution)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p HD</option>
                  <option value="1080p">1080p Full HD</option>
                  <option value="4k">4K UHD</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Frame Rate</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value) as FrameRate)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-sm text-white"
                >
                  <option value={24}>24 FPS</option>
                  <option value={25}>25 FPS</option>
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                </select>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-5 space-y-3 text-sm">
              <div className="flex justify-between border-b border-white/[0.06] pb-2">
                <span className="text-slate-400">Module</span>
                <span className="font-semibold text-white uppercase">{module}</span>
              </div>
              <div className="flex justify-between border-b border-white/[0.06] pb-2">
                <span className="text-slate-400">Project Name</span>
                <span className="font-semibold text-white">{name || '(Untitled)'}</span>
              </div>
              <div className="flex justify-between border-b border-white/[0.06] pb-2">
                <span className="text-slate-400">Languages</span>
                <span className="text-slate-200">{sourceLanguage} → {targetLanguage}</span>
              </div>
              <div className="flex justify-between border-b border-white/[0.06] pb-2">
                <span className="text-slate-400">Output Profile</span>
                <span className="font-mono text-slate-200">{resolution} · {fps} FPS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Attached Media</span>
                <span className="font-mono text-slate-200">{uploadedMedia.length} file(s)</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-[#11141C] px-4 py-3 sm:px-6 sm:py-4">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="min-h-[38px] rounded-lg border border-white/10 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-40"
          >
            Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleFinish(true)}
              className="min-h-[38px] rounded-lg border border-white/15 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/5"
            >
              Save Draft
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(5, s + 1))}
                className="min-h-[38px] rounded-lg bg-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED]"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleFinish(false)}
                className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-2 text-xs font-semibold text-white hover:bg-[#059669]"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{submitting ? 'Creating...' : 'Create Project'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
