import {
  ArrowRight,
  Captions,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  FolderOpen,
  HardDrive,
  Mic,
  Plus,
  Server,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type {
  ExportRecord,
  MediaFileRecord,
  ModuleType,
  ProcessingJobRecord,
  ProjectRecord,
  ProviderConfigStatus,
  UserProfile,
} from '../types/studio';
import { api } from '../services/api';
import { getModuleSteps } from '../utils/studioRules';
import { MediaUploadPanel } from './MediaUploadPanel';

export function DashboardView({
  projects,
  jobs,
  providers,
  exportsList,
  onOpenProject,
  onNewModuleProject,
  onOpenRoute,
}: {
  projects: (ProjectRecord & { mediaCount: number })[];
  jobs: ProcessingJobRecord[];
  providers: ProviderConfigStatus[];
  exportsList: (ExportRecord & { project_name: string })[];
  onOpenProject: (p: ProjectRecord) => void;
  onNewModuleProject: (m: ModuleType) => void;
  onOpenRoute: (route: 'ai-settings' | 'projects' | 'exports' | 'subtitle' | 'recap' | 'dubbing') => void;
}) {
  const [projectInfoExpanded, setProjectInfoExpanded] = useState(false);
  const activeJobsList = jobs.filter((j) =>
    ['Queued', 'Preparing', 'Processing', 'Rendering'].includes(j.status)
  );
  const activeJobs = activeJobsList.length;
  const connectedCount = providers.filter((p) => p.last_test_status === 'connected').length;
  const latestProject = projects[0] || null;
  const latestJob = latestProject ? jobs.find((j) => j.project_id === latestProject.id) || jobs[0] : jobs[0];
  const latestStepsTotal = latestProject ? getModuleSteps(latestProject.module).length : 8;
  const latestPct = latestJob
    ? latestJob.progress_pct
    : latestProject
      ? Math.min(100, Math.round((latestProject.active_step / latestStepsTotal) * 100))
      : 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Compact Header & Unified Status Strip */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-lg sm:text-2xl font-bold text-white leading-tight">
            AI MOVIE RECAP STUDIO
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-400">
            Myanmar localization workspace · Subtitle, Movie Recap & AI Dubbing
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:flex md:items-center md:gap-5 text-xs text-slate-300 font-mono tabular-nums">
          <div className="rounded-lg border border-white/[0.06] bg-[#171B26] px-3 py-2 md:border-0 md:bg-transparent md:p-0">
            <span className="text-slate-400 md:mr-1">Projects:</span>
            <span className="font-semibold text-white">{projects.length}</span>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#171B26] px-3 py-2 md:border-0 md:bg-transparent md:p-0">
            <span className="text-slate-400 md:mr-1">Active:</span>
            <span className="font-semibold text-[#3B82F6]">{activeJobs}</span>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#171B26] px-3 py-2 md:border-0 md:bg-transparent md:p-0">
            <span className="text-slate-400 md:mr-1">Exports:</span>
            <span className="font-semibold text-white">{exportsList.length}</span>
          </div>
          <button
            type="button"
            onClick={() => onOpenRoute('ai-settings')}
            className="rounded-lg border border-white/[0.06] bg-[#171B26] px-3 py-2 text-left text-[#A78BFA] hover:underline font-sans font-medium md:border-0 md:bg-transparent md:p-0"
          >
            AI: {connectedCount}/2 ready
          </button>
        </div>
      </div>

      {/* Collapsible Active Project & Compact Processing Progress */}
      {latestProject && (
        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-3.5 sm:p-4 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                <span className="font-semibold uppercase text-[#A78BFA]">{latestProject.module}</span>
                <span>·</span>
                <span>{latestJob?.status || latestProject.status}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  Step {latestJob?.current_step || latestProject.active_step}/{latestStepsTotal}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold text-white">
                {latestProject.name}
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setProjectInfoExpanded((v) => !v)}
                aria-expanded={projectInfoExpanded}
                aria-label="Toggle project details"
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/10 bg-[#0B0D12] px-2.5 text-xs text-slate-300 hover:text-white"
              >
                <span>{projectInfoExpanded ? 'Hide Details' : 'Details'}</span>
                {projectInfoExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => onOpenProject(latestProject)}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg bg-[#8B5CF6] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#7C3AED]"
              >
                <span>Resume</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
              <span>Pipeline Progress</span>
              <span>{latestPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0B0D12]">
              <div
                className={`h-full transition-all ${
                  latestJob?.status === 'Failed'
                    ? 'bg-[#EF4444]'
                    : latestPct >= 100
                      ? 'bg-[#10B981]'
                      : 'bg-[#8B5CF6]'
                }`}
                style={{ width: `${Math.max(5, latestPct)}%` }}
              />
            </div>
          </div>

          {projectInfoExpanded && (
            <div className="grid grid-cols-1 gap-2 border-t border-white/[0.06] pt-2.5 text-xs text-slate-300 sm:grid-cols-3">
              <div>
                <span className="text-slate-500">Media Assets:</span> {latestProject.mediaCount} file(s)
              </div>
              <div>
                <span className="text-slate-500">Export Approval:</span>{' '}
                {latestProject.approved_for_export ? 'Approved' : 'Pending Review'}
              </div>
              <div>
                <span className="text-slate-500">Updated:</span>{' '}
                {new Date(latestProject.updated_at).toLocaleDateString()}
              </div>
              {latestProject.description && (
                <div className="sm:col-span-3 text-slate-400 myanmar-text">
                  {latestProject.description}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Three Independent Production Modules (responsive across Mobile 1-col, Tablet 2-col, Desktop 3-col) */}
      <div className="grid grid-cols-1 gap-3.5 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
        {[
          {
            id: 'subtitle' as ModuleType,
            num: 'Module 01',
            title: 'SUBTITLE',
            mm: 'မြန်မာစာတန်းထိုး',
            shortDesc: 'FFmpeg audio, Groq Whisper, locked Myanmar Unicode & SRT/ASS/MP4 export.',
            desc: 'Extract audio via FFmpeg, transcribe with Groq Whisper, translate contextually into locked Myanmar Unicode, validate overlaps & speed, and export SRT/ASS/VTT or burned MP4.',
            accent: 'text-[#3B82F6]',
            btn: 'bg-[#3B82F6] hover:bg-[#2563EB]',
            icon: Captions,
          },
          {
            id: 'recap' as ModuleType,
            num: 'Module 02',
            title: 'MOVIE RECAP',
            mm: 'ဇာတ်လမ်းအကျဉ်းချုပ်',
            shortDesc: 'Scene detection, Gemini story arc, Myanmar voiceover & final recap MP4.',
            desc: 'Detect scene boundaries, analyze characters and plot twists with Gemini, estimate story-first recap duration, generate Myanmar narration & voiceover, and assemble final MP4.',
            accent: 'text-[#8B5CF6]',
            btn: 'bg-[#8B5CF6] hover:bg-[#7C3AED]',
            icon: Film,
          },
          {
            id: 'dubbing' as ModuleType,
            num: 'Module 03',
            title: 'AI DUBBING',
            mm: 'မြန်မာအသံသွင်းခြင်း',
            shortDesc: 'Stem separation, single-voice Myanmar TTS across all lines & stem mix.',
            desc: 'Separate dialogue, music & SFX stems, translate dialogue, synthesize Myanmar speech using strictly ONE project voice across all characters, mix stems, and render dubbed MP4.',
            accent: 'text-[#10B981]',
            btn: 'bg-[#10B981] hover:bg-[#059669]',
            icon: Mic,
          },
        ].map((mod) => {
          const Icon = mod.icon;
          const moduleProjects = projects.filter((p) => p.module === mod.id);
          const count = moduleProjects.length;
          return (
            <div
              key={mod.id}
              className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-6 space-y-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-medium">{mod.num}</span>
                  <span className="font-mono tabular-nums">{count} projects</span>
                </div>
                <div className="flex items-center gap-3">
                  <Icon className={`h-6 w-6 shrink-0 ${mod.accent}`} />
                  <div className="min-w-0">
                    <h2 className="font-display text-base sm:text-lg font-bold text-white leading-tight">
                      {mod.title}
                    </h2>
                    <div className={`text-xs sm:text-sm font-medium myanmar-text ${mod.accent}`}>
                      {mod.mm}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed sm:hidden">{mod.shortDesc}</p>
                <p className="hidden sm:block text-xs text-slate-300 leading-relaxed">{mod.desc}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNewModuleProject(mod.id)}
                  className={`flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors ${mod.btn}`}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="truncate">New {mod.title}</span>
                </button>
                {count > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenProject(moduleProjects[0])}
                    className="inline-flex min-h-[42px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-xs font-medium text-slate-200 hover:border-white/25"
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Projects */}
      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm sm:text-base font-semibold text-white">Recent Projects</h2>
          <button
            type="button"
            onClick={() => onOpenRoute('projects')}
            className="inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-[#A78BFA] hover:underline"
          >
            <span>View All</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No projects created yet. Choose one of the three modules above to start your first Myanmar production.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {projects.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                  <div className="mt-0.5 text-[11px] sm:text-xs text-slate-400 truncate">
                    {p.module.toUpperCase()} · {p.status} · Step {p.active_step} · {p.mediaCount} asset(s)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenProject(p)}
                  className="inline-flex min-h-[38px] shrink-0 items-center rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs font-medium text-white hover:border-[#8B5CF6]/50"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MyProjectsView({
  projects,
  onOpenProject,
  onNewProject,
  onRefresh,
  onDeletedProject,
}: {
  projects: (ProjectRecord & { mediaCount: number })[];
  onOpenProject: (p: ProjectRecord) => void;
  onNewProject: () => void;
  onRefresh: () => void;
  onDeletedProject?: (projectId: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | ModuleType>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const filtered = filter === 'all' ? projects : projects.filter((p) => p.module === filter);

  const handleDelete = async (id: string) => {
    if (deletingId === id) return;
    setDeletingId(id);
    setActionError('');
    try {
      await api.deleteProject(id);
      if (onDeletedProject) {
        onDeletedProject(id);
      } else {
        onRefresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/project not found/i.test(msg)) {
        if (onDeletedProject) onDeletedProject(id);
        else onRefresh();
      } else {
        setActionError(msg);
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-lg sm:text-xl font-bold text-white">My Projects</h1>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-lg border border-white/[0.08] bg-[#11141C] p-1">
            {(['all', 'subtitle', 'recap', 'dubbing'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`min-h-[34px] rounded-md px-2.5 sm:px-3 py-1 text-xs font-medium capitalize whitespace-nowrap ${
                  filter === f ? 'bg-[#171B26] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#8B5CF6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED] shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
          {actionError}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-8 text-center text-xs text-slate-400">
          No projects match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3.5"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="uppercase font-semibold">{p.module}</span>
                  <span className="font-mono">{p.status}</span>
                </div>
                <h2 className="mt-2 font-display text-base font-bold text-white truncate">{p.name}</h2>
                <p className="mt-1 text-xs text-slate-400 line-clamp-2 myanmar-text">
                  {p.description || 'No description provided.'}
                </p>
              </div>
              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <span className="font-mono text-[11px] text-slate-500">
                  Updated {new Date(p.updated_at).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={deletingId === p.id}
                    onClick={() => void handleDelete(p.id)}
                    aria-label={`Delete project ${p.name}`}
                    className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-slate-500 hover:bg-white/5 hover:text-[#EF4444] disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProject(p)}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#8B5CF6]/20 px-3 py-1.5 text-xs font-medium text-[#C4B5FD] hover:bg-[#8B5CF6]/30"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Open</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MediaLibraryView({
  media,
  onRefresh,
}: {
  media: MediaFileRecord[];
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg sm:text-xl font-bold text-white">Media Library</h1>
        <p className="text-xs text-slate-400">
          Unified local & cloud media repository with SHA-256 duplicate protection and FFprobe metadata
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5">
        <MediaUploadPanel onUploaded={() => onRefresh()} />
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5">
        {media.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">No media files uploaded yet.</div>
        ) : (
          <>
            {/* Mobile Compact Cards */}
            <div className="space-y-2.5 md:hidden">
              {media.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#0B0D12] p-3 text-xs"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-white truncate">{m.original_name}</div>
                    <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {m.media_type.toUpperCase()} · {m.duration_sec}s · {(m.size_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void api.deleteMedia(m.id).then(() => onRefresh()).catch(() => onRefresh())}
                    aria-label={`Delete media ${m.original_name}`}
                    className="inline-flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-[#EF4444]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Tablet & Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-slate-400">
                  <tr>
                    <th className="py-2 pr-3">File Name</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 font-mono">Duration</th>
                    <th className="py-2 pr-3 font-mono">Resolution / Codec</th>
                    <th className="py-2 pr-3 font-mono">Size</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {media.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 pr-3 font-medium text-white">{m.original_name}</td>
                      <td className="py-2.5 pr-3 text-slate-300 uppercase">{m.media_type}</td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-300">{m.duration_sec}s</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-400">
                        {m.width ? `${m.width}x${m.height}` : '—'} · {m.codec || 'n/a'}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-400">
                        {(m.size_bytes / 1024).toFixed(1)} KB
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void api.deleteMedia(m.id).then(() => onRefresh()).catch(() => onRefresh())}
                          aria-label={`Delete media ${m.original_name}`}
                          className="rounded p-1.5 text-slate-400 hover:text-[#EF4444]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ExportCenterView({
  exportsList,
}: {
  exportsList: (ExportRecord & { project_name: string })[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg sm:text-xl font-bold text-white">Export Center</h1>
        <p className="text-xs text-slate-400">
          Verified deliverables rendered only after explicit user review and approval
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5">
        {exportsList.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No exports generated yet. Complete and approve a Subtitle, Movie Recap, or AI Dubbing project to render deliverables.
          </div>
        ) : (
          <>
            {/* Mobile Compact Cards */}
            <div className="space-y-2.5 md:hidden">
              {exportsList.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#0B0D12] p-3 text-xs"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-white truncate">{e.project_name}</div>
                    <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {e.module.toUpperCase()} · {e.format.toUpperCase()} · {e.resolution} · {(e.file_size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  {e.status === 'completed' && (
                    <a
                      href={`/api/exports/${e.id}/download`}
                      className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg bg-[#8B5CF6]/20 px-3 py-1.5 text-xs font-medium text-[#C4B5FD]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Save</span>
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* Tablet & Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-slate-400">
                  <tr>
                    <th className="py-2 pr-3">Project</th>
                    <th className="py-2 pr-3">Module</th>
                    <th className="py-2 pr-3">Format</th>
                    <th className="py-2 pr-3 font-mono">Profile</th>
                    <th className="py-2 pr-3 font-mono">Size</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {exportsList.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2.5 pr-3 font-medium text-white">{e.project_name}</td>
                      <td className="py-2.5 pr-3 uppercase text-slate-300">{e.module}</td>
                      <td className="py-2.5 pr-3 uppercase font-mono text-[#8B5CF6]">{e.format}</td>
                      <td className="py-2.5 pr-3 font-mono text-slate-400">
                        {e.resolution} · {e.fps}fps
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-400">
                        {(e.file_size / 1024).toFixed(1)} KB
                      </td>
                      <td className="py-2.5 pr-3 text-[#10B981] capitalize">{e.status}</td>
                      <td className="py-2.5 text-right">
                        {e.status === 'completed' && (
                          <a
                            href={`/api/exports/${e.id}/download`}
                            className="inline-flex items-center gap-1 rounded-md bg-[#8B5CF6]/20 px-2.5 py-1 text-xs font-medium text-[#C4B5FD] hover:bg-[#8B5CF6]/30"
                          >
                            <Download className="h-3 w-3" />
                            Download
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SystemSettingsView({
  info,
  onRefresh,
  onNotify,
}: {
  info: {
    engines: {
      ffmpeg: boolean;
      ffprobe: boolean;
      demucs: boolean;
      audioSeparatorActive: string;
      localWorkerContract: string;
    };
    auditLogs: Array<{
      id: string;
      action: string;
      resource_type: string;
      resource_id: string;
      details: string;
      created_at: string;
    }>;
    backups: string[];
  } | null;
  onRefresh: () => void;
  onNotify: (msg: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-white">System Settings & Hybrid Worker Status</h1>
          <p className="text-xs text-slate-400">
            Media binaries, local/cloud execution boundary, SQLite backup snapshots, and security audit trail
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            void api
              .createBackup()
              .then((r) => {
                onNotify(`Database snapshot saved: ${r.backup}`);
                onRefresh();
              })
              .catch((err) => onNotify(`Backup failed: ${err instanceof Error ? err.message : String(err)}`))
          }
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED]"
        >
          <HardDrive className="h-3.5 w-3.5" />
          <span>Create Database Backup</span>
        </button>
      </div>

      {info && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4">
            <div className="flex items-center gap-2 text-slate-400">
              <Server className="h-4 w-4 text-[#3B82F6]" />
              <span>FFmpeg / FFprobe</span>
            </div>
            <div className="mt-2 font-semibold text-white">
              {info.engines.ffmpeg && info.engines.ffprobe ? 'Installed & Active' : 'Missing Binary'}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4">
            <div className="flex items-center gap-2 text-slate-400">
              <Mic className="h-4 w-4 text-[#10B981]" />
              <span>Audio Separation Engine</span>
            </div>
            <div className="mt-2 font-semibold text-white">{info.engines.audioSeparatorActive}</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4">
            <div className="flex items-center gap-2 text-slate-400">
              <Shield className="h-4 w-4 text-[#8B5CF6]" />
              <span>Hybrid Worker Boundary</span>
            </div>
            <div className="mt-2 font-semibold text-white">{info.engines.localWorkerContract}</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4">
            <div className="flex items-center gap-2 text-slate-400">
              <HardDrive className="h-4 w-4 text-[#F59E0B]" />
              <span>Database Backups</span>
            </div>
            <div className="mt-2 font-semibold text-white">{info.backups.length} snapshot(s)</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.08] bg-[#171B26] p-4 sm:p-5 space-y-3">
        <h2 className="font-display text-sm font-semibold text-white">Security & Processing Audit Log</h2>
        <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05] text-xs">
          {(info?.auditLogs || []).map((log) => (
            <div key={log.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 py-2.5">
              <div className="min-w-0 break-words">
                <span className="font-mono font-semibold text-slate-200">{log.action}</span>
                <span className="ml-2 text-slate-400">
                  {log.resource_type} · {log.details || log.resource_id}
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-500 shrink-0">
                {new Date(log.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuthModal({
  open,
  user,
  onClose,
  onAuthChanged,
}: {
  open: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onAuthChanged: (u: UserProfile | null) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'editor'>('editor');
  const [error, setError] = useState('');

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, name, password, role);
      onAuthChanged(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#171B26] p-4 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-white">Studio Account & Access</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="rounded p-1 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {user && (
          <div className="rounded-lg border border-white/[0.08] bg-[#0B0D12] p-3 text-xs space-y-1">
            <div className="font-semibold text-white">{user.name}</div>
            <div className="text-slate-400">
              {user.email} · Role: <span className="uppercase text-[#10B981]">{user.role}</span>
            </div>
            <button
              type="button"
              onClick={() =>
                void api
                  .logout()
                  .then(() => {
                    onAuthChanged(null);
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : String(err));
                  })
              }
              className="mt-2 rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
            >
              Sign Out
            </button>
          </div>
        )}

        <div className="flex gap-2 rounded-lg bg-[#0B0D12] p-1 border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium ${
              mode === 'login' ? 'bg-[#171B26] text-white' : 'text-slate-400'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium ${
              mode === 'register' ? 'bg-[#171B26] text-white' : 'text-slate-400'
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-2.5 text-xs text-[#FCA5A5]">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3 text-xs">
          {mode === 'register' && (
            <div>
              <label className="block text-slate-300 mb-1">Display Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-white"
              />
            </div>
          )}
          <div>
            <label className="block text-slate-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-white"
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="block text-slate-300 mb-1">Workspace Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'editor')}
                className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-white"
              >
                <option value="editor">Editor</option>
                <option value="admin">Project Administrator</option>
              </select>
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() =>
                void api
                  .quickDemoLogin()
                  .then((r) => {
                    onAuthChanged(r.user);
                    onClose();
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              }
              className="text-slate-400 hover:text-white underline"
            >
              Use Studio Producer Session
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#8B5CF6] px-4 py-2 font-semibold text-white hover:bg-[#7C3AED]"
            >
              {mode === 'login' ? 'Sign In' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
