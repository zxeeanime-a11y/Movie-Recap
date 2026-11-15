import type {
  ExportFormat,
  FrameRate,
  MediaFileRecord,
  ModuleType,
  ProcessingJobRecord,
  ProjectRecord,
  ProjectSettings,
  ProjectVersionRecord,
  ProviderConfigStatus,
  ProviderId,
  RecapScriptRecord,
  SubtitleCue,
  TranscriptSegment,
  UserProfile,
  VideoResolution,
  VideoScene,
  VoiceProfile,
  AudioTrackRecord,
  ExportRecord,
} from '../types/studio';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(String(json.error || `Request failed (${res.status})`));
  }
  return json as T;
}

export interface ProjectDetailResponse {
  project: ProjectRecord;
  media: MediaFileRecord[];
  scenes: VideoScene[];
  transcripts: TranscriptSegment[];
  subtitles: SubtitleCue[];
  recapScript: RecapScriptRecord | null;
  audioTracks: AudioTrackRecord[];
  latestJob: ProcessingJobRecord | null;
  exports: ExportRecord[];
  versions: ProjectVersionRecord[];
}

export const api = {
  getMe: () => request<{ user: UserProfile }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, name: string, password: string, role: 'admin' | 'editor') =>
    request<{ user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password, role }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  quickDemoLogin: () => request<{ user: UserProfile }>('/api/auth/quick-demo', { method: 'POST' }),
  setLanguagePref: (preferred_lang: 'en' | 'my') =>
    request<{ ok: boolean }>('/api/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ preferred_lang }),
    }),

  getVoices: () => request<{ voices: VoiceProfile[] }>('/api/voices'),

  getProviders: () => request<{ providers: ProviderConfigStatus[] }>('/api/providers'),
  updateProvider: (
    provider: ProviderId,
    data: {
      apiKey?: string;
      clearKey?: boolean;
      selected_model?: string;
      tts_model?: string;
      transcribe_model?: string;
      llm_model?: string;
    }
  ) =>
    request<{ providers: ProviderConfigStatus[] }>(`/api/providers/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  testProvider: (provider: ProviderId) =>
    request<{ provider: ProviderConfigStatus }>(`/api/providers/${provider}/test`, {
      method: 'POST',
    }),

  listProjects: (module?: ModuleType, q?: string) => {
    const params = new URLSearchParams();
    if (module) params.set('module', module);
    if (q) params.set('q', q);
    const qs = params.toString();
    return request<{ projects: (ProjectRecord & { mediaCount: number })[] }>(
      `/api/projects${qs ? `?${qs}` : ''}`
    );
  },
  createProject: (data: {
    module: ModuleType;
    name: string;
    description: string;
    settings?: Partial<ProjectSettings>;
  }) =>
    request<{ project: ProjectRecord }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getProject: (id: string) => request<ProjectDetailResponse>(`/api/projects/${id}`),
  updateProject: (
    id: string,
    data: {
      name?: string;
      description?: string;
      active_step?: number;
      expected_version?: number;
      settings?: Partial<ProjectSettings>;
    }
  ) =>
    request<{ project: ProjectRecord }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  approveProjectForExport: (id: string, approved = true) =>
    request<{ project: ProjectRecord }>(`/api/projects/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    }),
  setTranslationLock: (id: string, locked: boolean) =>
    request<{ project: ProjectRecord }>(`/api/projects/${id}/translation-lock`, {
      method: 'POST',
      body: JSON.stringify({ locked }),
    }),
  createVersion: (id: string, label: string) =>
    request<{ versions: ProjectVersionRecord[] }>(`/api/projects/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  restoreVersion: (id: string, versionId: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}/versions/${versionId}/restore`, {
      method: 'POST',
    }),

  updateSubtitles: (id: string, cues: SubtitleCue[], adminOverride = false) =>
    request<{ subtitles: SubtitleCue[] }>(`/api/projects/${id}/subtitles`, {
      method: 'PATCH',
      body: JSON.stringify({ cues, adminOverride }),
    }),
  fixSubtitleOverlaps: (id: string) =>
    request<{ subtitles: SubtitleCue[] }>(`/api/projects/${id}/subtitles/fix-overlaps`, {
      method: 'POST',
    }),
  updateScene: (
    projectId: string,
    sceneId: string,
    data: { selected?: boolean; action_summary?: string; important_events?: string }
  ) =>
    request<{ scenes: VideoScene[] }>(`/api/projects/${projectId}/scenes/${sceneId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateRecapScript: (
    projectId: string,
    data: {
      full_myanmar_script?: string;
      title_suggestion?: string;
      caption_suggestion?: string;
      approved?: boolean;
    }
  ) =>
    request<{ ok: boolean; recommendedSec: number }>(`/api/projects/${projectId}/recap-script`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  setDubbingSingleVoice: (projectId: string, voice_id: string) =>
    request<{ project: ProjectRecord }>(`/api/projects/${projectId}/dubbing/voice`, {
      method: 'POST',
      body: JSON.stringify({ voice_id }),
    }),
  testMyanmarTTS: (data: { text?: string; voice_id?: string }) =>
    request<{
      ok: boolean;
      voiceUsed: string;
      providerUsed?: string;
      modelUsed: string;
      apiVersion: string;
      endpoint: string;
      mimeType: string;
      formatUsed: string;
      durationSec: number;
      audioUrl: string;
    }>('/api/tts/test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listMedia: () => request<{ media: MediaFileRecord[] }>('/api/media'),
  generateSampleMedia: (projectId?: string) =>
    request<{ media: MediaFileRecord }>('/api/media/generate-sample', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  attachMediaToProject: (mediaId: string, projectId: string) =>
    request<{ ok: boolean }>(`/api/media/${mediaId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  deleteMedia: (mediaId: string) => request<{ ok: boolean }>(`/api/media/${mediaId}`, { method: 'DELETE' }),

  listJobs: () => request<{ jobs: ProcessingJobRecord[] }>('/api/jobs'),
  startProjectJob: (projectId: string, fromStep = 1) =>
    request<{ job: ProcessingJobRecord }>(`/api/projects/${projectId}/jobs/start`, {
      method: 'POST',
      body: JSON.stringify({ fromStep }),
    }),
  retryJobStep: (jobId: string, stepNumber: number) =>
    request<{ job: ProcessingJobRecord }>(`/api/jobs/${jobId}/retry-step`, {
      method: 'POST',
      body: JSON.stringify({ stepNumber }),
    }),
  cancelJob: (jobId: string) =>
    request<{ job: ProcessingJobRecord }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),

  listExports: () => request<{ exports: (ExportRecord & { project_name: string })[] }>('/api/exports'),
  createExport: (
    projectId: string,
    data: { format: ExportFormat; resolution?: VideoResolution; fps?: FrameRate }
  ) =>
    request<{ export: ExportRecord }>(`/api/projects/${projectId}/exports`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSystemInfo: () =>
    request<{
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
    }>('/api/system/info'),
  createBackup: () => request<{ backup: string }>('/api/system/backup', { method: 'POST' }),
};

export interface ChunkedUploadController {
  pause: () => void;
  resume: () => void;
  cancel: () => Promise<void>;
}

export async function uploadFileChunked(params: {
  file: File;
  projectId?: string;
  storageMode: 'local' | 'cloud';
  onProgress: (pct: number, statusText: string) => void;
  onControllerReady?: (ctrl: ChunkedUploadController) => void;
}): Promise<{ media: MediaFileRecord; duplicate: boolean }> {
  const { file, projectId, storageMode, onProgress } = params;
  onProgress(2, 'Hashing file for duplicate check...');

  let sha256 = '';
  try {
    if (file.size <= 100 * 1024 * 1024 && window.crypto?.subtle) {
      const buf = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest('SHA-256', buf);
      sha256 = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback to server-side hash
  }

  const initRes = await request<{ duplicate: boolean; media?: MediaFileRecord; uploadId?: string }>(
    '/api/media/upload/init',
    {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        sha256,
        projectId,
      }),
    }
  );

  if (initRes.duplicate && initRes.media) {
    if (projectId && initRes.media.project_id !== projectId) {
      await api.attachMediaToProject(initRes.media.id, projectId);
    }
    onProgress(100, 'Duplicate detected — linked existing asset.');
    return { media: initRes.media, duplicate: true };
  }

  const uploadId = initRes.uploadId!;
  const chunkSize = 2 * 1024 * 1024; // 2MB chunks
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

  let paused = false;
  let cancelled = false;
  let resumeResolver: (() => void) | null = null;

  params.onControllerReady?.({
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      resumeResolver?.();
      resumeResolver = null;
    },
    cancel: async () => {
      cancelled = true;
      paused = false;
      resumeResolver?.();
      await request('/api/media/upload/cancel', {
        method: 'POST',
        body: JSON.stringify({ uploadId }),
      });
    },
  });

  for (let i = 0; i < totalChunks; i++) {
    if (cancelled) throw new Error('Upload cancelled by user.');
    while (paused) {
      onProgress(Math.round((i / totalChunks) * 90), `Paused at chunk ${i}/${totalChunks}`);
      await new Promise<void>((resolve) => {
        resumeResolver = resolve;
      });
      if (cancelled) throw new Error('Upload cancelled by user.');
    }

    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const slice = file.slice(start, end);

    const form = new FormData();
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('chunk', slice, `${file.name}.part${i}`);

    await request('/api/media/upload/chunk', { method: 'POST', body: form });
    onProgress(Math.round(((i + 1) / totalChunks) * 90), `Uploaded chunk ${i + 1} / ${totalChunks}`);
  }

  onProgress(95, 'Finalizing and probing media metadata...');
  const completed = await request<{ media: MediaFileRecord }>('/api/media/upload/complete', {
    method: 'POST',
    body: JSON.stringify({ uploadId, storageMode }),
  });
  onProgress(100, 'Upload complete');
  return { media: completed.media, duplicate: false };
}
