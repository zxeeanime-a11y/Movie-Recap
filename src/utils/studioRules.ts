import type {
  MediaCategory,
  ModuleType,
  ProjectRecord,
  SubtitleCue,
  TimelineClip,
  TranscriptSegment,
  VideoScene,
} from '../types/studio';

export const ALLOWED_MEDIA_EXTENSIONS: Record<MediaCategory, string[]> = {
  video: ['.mp4', '.mov', '.mkv', '.webm'],
  audio: ['.mp3', '.wav', '.aac', '.m4a', '.flac'],
  subtitle: ['.srt', '.ass', '.vtt', '.txt'],
  image: ['.jpg', '.jpeg', '.png', '.webp'],
};

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export function validateMediaUpload(
  filename: string,
  mimeType: string,
  sizeBytes: number
): { valid: boolean; category?: MediaCategory; error?: string } {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'Filename is required.' };
  }
  if (sizeBytes <= 0) {
    return { valid: false, error: 'File cannot be empty (0 bytes).' };
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return { valid: false, error: 'File exceeds maximum 2 GB upload limit.' };
  }

  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';

  for (const [category, extensions] of Object.entries(ALLOWED_MEDIA_EXTENSIONS) as [
    MediaCategory,
    string[],
  ][]) {
    if (extensions.includes(ext)) {
      if (mimeType) {
        const lowerMime = mimeType.toLowerCase();
        const mimeOk =
          lowerMime === 'application/octet-stream' ||
          (category === 'video' && (lowerMime.startsWith('video/') || lowerMime === 'application/x-matroska')) ||
          (category === 'audio' && lowerMime.startsWith('audio/')) ||
          (category === 'image' && lowerMime.startsWith('image/')) ||
          (category === 'subtitle' && (lowerMime.startsWith('text/') || lowerMime.includes('subrip') || lowerMime.includes('vtt')));
        if (!mimeOk) {
          return {
            valid: false,
            error: `MIME type "${mimeType}" does not match ${category} file extension "${ext}".`,
          };
        }
      }
      return { valid: true, category };
    }
  }

  return {
    valid: false,
    error: `Unsupported file extension "${ext || 'none'}". Supported: MP4, MOV, MKV, WEBM, MP3, WAV, AAC, M4A, FLAC, SRT, ASS, VTT, TXT, JPG, PNG, WEBP.`,
  };
}

export function formatTimecodeSRT(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const adjustedSecs = ms === 1000 ? secs + 1 : secs;
  const adjustedMs = ms === 1000 ? 0 : ms;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(adjustedSecs).padStart(2, '0')},${String(adjustedMs).padStart(3, '0')}`;
}

export function formatTimecodeVTT(seconds: number): string {
  return formatTimecodeSRT(seconds).replace(',', '.');
}

export function formatTimecodeASS(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.min(99, Math.round((safe - Math.floor(safe)) * 100));
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatDisplayTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function calculateReadingSpeedCPS(text: string, durationSec: number): number {
  const clean = text.replace(/\s+/g, '');
  if (durationSec <= 0) return 999;
  return Number((clean.length / durationSec).toFixed(1));
}

export function validateSubtitles(cues: SubtitleCue[]): {
  cues: SubtitleCue[];
  overlapCount: number;
  invalidDurationCount: number;
  highSpeedCount: number;
} {
  const sorted = [...cues].sort((a, b) => a.start_sec - b.start_sec || a.cue_index - b.cue_index);
  let overlapCount = 0;
  let invalidDurationCount = 0;
  let highSpeedCount = 0;

  const validated = sorted.map((cue, idx) => {
    const duration = cue.end_sec - cue.start_sec;
    const durationValid = duration >= 0.5 && duration <= 8.0;
    if (!durationValid) invalidDurationCount += 1;

    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
    const overlapsPrev = prev ? cue.start_sec < prev.end_sec - 0.001 : false;
    const overlapsNext = next ? cue.end_sec > next.start_sec + 0.001 : false;
    const hasOverlap = overlapsPrev || overlapsNext;
    if (hasOverlap) overlapCount += 1;

    const textForSpeed = cue.myanmar_text?.trim() || cue.source_text || '';
    const cps = calculateReadingSpeedCPS(textForSpeed, Math.max(0.1, duration));
    if (cps > 24) highSpeedCount += 1;

    return {
      ...cue,
      cue_index: idx + 1,
      reading_speed_cps: cps,
      has_overlap: hasOverlap,
      duration_valid: durationValid,
    };
  });

  return { cues: validated, overlapCount, invalidDurationCount, highSpeedCount };
}

export function autoFixSubtitleOverlaps(cues: SubtitleCue[]): SubtitleCue[] {
  const sorted = [...cues].sort((a, b) => a.start_sec - b.start_sec);
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (curr.end_sec > next.start_sec) {
      const midpoint = Number(((curr.end_sec + next.start_sec) / 2).toFixed(3));
      curr.end_sec = Math.max(curr.start_sec + 0.5, next.start_sec - 0.04);
      if (curr.end_sec > next.start_sec) {
        curr.end_sec = Math.max(curr.start_sec + 0.5, midpoint);
        next.start_sec = Math.max(curr.end_sec + 0.04, next.start_sec);
        if (next.end_sec <= next.start_sec) {
          next.end_sec = next.start_sec + 0.8;
        }
      }
    }
  }
  return validateSubtitles(sorted).cues;
}

export function generateSRT(cues: SubtitleCue[], useMyanmar = true): string {
  return [...cues]
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((cue, idx) => {
      const text = useMyanmar ? cue.myanmar_text || cue.source_text : cue.source_text;
      return `${idx + 1}\n${formatTimecodeSRT(cue.start_sec)} --> ${formatTimecodeSRT(cue.end_sec)}\n${text.trim()}\n`;
    })
    .join('\n');
}

export function generateVTT(cues: SubtitleCue[], useMyanmar = true): string {
  const body = [...cues]
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((cue, idx) => {
      const text = useMyanmar ? cue.myanmar_text || cue.source_text : cue.source_text;
      return `${idx + 1}\n${formatTimecodeVTT(cue.start_sec)} --> ${formatTimecodeVTT(cue.end_sec)}\n${text.trim()}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function generateASS(cues: SubtitleCue[], title = 'AI Movie Recap Studio', useMyanmar = true): string {
  const header = `[Script Info]
Title: ${title}
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans Myanmar,54,&H00FFFFFF,&H000000FF,&H0011141C,&H80000000,-1,0,0,0,100,100,0,0,1,3,1.5,2,40,40,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = [...cues]
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((cue) => {
      const raw = useMyanmar ? cue.myanmar_text || cue.source_text : cue.source_text;
      const sanitized = raw.replace(/\r?\n/g, '\\N').trim();
      return `Dialogue: 0,${formatTimecodeASS(cue.start_sec)},${formatTimecodeASS(cue.end_sec)},Default,,0,0,0,,${sanitized}`;
    })
    .join('\n');

  return `${header}\n${events}\n`;
}

export const DEFAULT_MYANMAR_VOICE_ID = 'my-MM-NilarNeural';
export const EDGE_TTS_MYANMAR_VOICES = ['my-MM-NilarNeural', 'my-MM-ThihaNeural'] as const;

/**
 * ABSOLUTE VOICE RULE — ONE VOICE ONLY
 * Enforces that every segment in an AI Dubbing project uses the exact project-level selectedVoice.
 * Speaker IDs are kept solely for dialogue segmentation and organization.
 */
export function enforceSingleVoiceRule<
  T extends { speaker_id?: string; voice_name?: string; voiceName?: string },
>(segments: T[], projectVoice: string): T[] {
  const canonicalVoice = projectVoice.trim() || DEFAULT_MYANMAR_VOICE_ID;
  return segments.map((seg) => ({
    ...seg,
    ...(Object.prototype.hasOwnProperty.call(seg, 'voice_name') ? { voice_name: canonicalVoice } : {}),
    ...(Object.prototype.hasOwnProperty.call(seg, 'voiceName') ? { voiceName: canonicalVoice } : {}),
  }));
}

export interface DubbingSegmentTimingInput {
  filePath: string;
  startSec: number;
  endSec: number;
  actualDurationSec: number;
}

export interface ScheduledDubbingSegment extends DubbingSegmentTimingInput {
  delayMs: number;
  tempoFactor: number;
  maxSlotSec: number;
}

/**
 * Prevents dubbed speech segments from overlapping the subsequent segment.
 * Computes a bounded FFmpeg atempo speedup (1.0x - 1.5x) and hard slot trim ceiling
 * before the next segment begins.
 */
export function computeNonOverlappingDubbingSchedule(
  segments: DubbingSegmentTimingInput[],
  minGapSec = 0.04
): ScheduledDubbingSegment[] {
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);
  return sorted.map((seg, idx) => {
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
    const rawActual = Math.max(0.1, seg.actualDurationSec || Math.max(0.5, seg.endSec - seg.startSec));
    const slotBudget = next
      ? Math.max(0.25, next.startSec - seg.startSec - minGapSec)
      : Math.max(rawActual, seg.endSec - seg.startSec);

    let tempoFactor = 1.0;
    if (rawActual > slotBudget) {
      tempoFactor = Math.min(1.5, Number((rawActual / slotBudget).toFixed(3)));
    }
    return {
      ...seg,
      delayMs: Math.max(0, Math.round(seg.startSec * 1000)),
      tempoFactor,
      maxSlotSec: Number(slotBudget.toFixed(3)),
    };
  });
}

/**
 * Computes a suitable recap duration based on story complexity, important scenes,
 * Myanmar script length, and natural narration speed—never sacrificing critical story beats.
 */
export function computeSuitableRecapDuration(params: {
  scenes: VideoScene[];
  myanmarScript: string;
  narrationWordsPerSec?: number;
}): {
  recommendedSec: number;
  complexityScore: number;
  importantSceneCount: number;
  estimatedSpeechSec: number;
} {
  const wps = params.narrationWordsPerSec ?? 2.3;
  const selectedScenes = params.scenes.filter((s) => s.selected);
  const importantCount = selectedScenes.filter((s) => s.importance_score >= 7 || Boolean(s.plot_twist)).length;

  const avgImportance =
    selectedScenes.length > 0
      ? selectedScenes.reduce((acc, s) => acc + s.importance_score, 0) / selectedScenes.length
      : 5;

  const complexityScore = Number(
    Math.min(10, avgImportance * 0.65 + Math.min(3.5, importantCount * 0.7)).toFixed(1)
  );

  // Myanmar script syllable/segment estimation (spaces or Myanmar punctuation boundaries)
  const cleanText = params.myanmarScript.trim();
  const unitCount = cleanText
    ? Math.max(cleanText.split(/\s+/).length, Math.ceil(cleanText.length / 7))
    : selectedScenes.length * 18;

  const estimatedSpeechSec = Math.ceil(unitCount / wps);
  const minVisualBreathSec = selectedScenes.length * 4;
  const recommendedSec = Math.max(15, estimatedSpeechSec + Math.ceil(selectedScenes.length * 1.2), minVisualBreathSec);

  return {
    recommendedSec,
    complexityScore,
    importantSceneCount: importantCount,
    estimatedSpeechSec,
  };
}

/**
 * Enforces the Business Rule:
 * "Do not allow final export before user review and approval."
 */
export function canExportProject(
  project: Pick<ProjectRecord, 'module' | 'approved_for_export' | 'status'>,
  hasMedia: boolean,
  hasModuleOutput: boolean
): { allowed: boolean; reason?: string } {
  if (!hasMedia) {
    return { allowed: false, reason: 'Import source media before exporting.' };
  }
  if (!hasModuleOutput) {
    return {
      allowed: false,
      reason: `Complete ${project.module.toUpperCase()} processing output before exporting.`,
    };
  }
  if (!project.approved_for_export) {
    return {
      allowed: false,
      reason: 'Final review and explicit user approval is required before export.',
    };
  }
  return { allowed: true };
}

/**
 * Enforces the Business Rule:
 * "Myanmar translation editing must remain LOCKED according to the confirmed product setting.
 * Provide controlled review and correction workflows only if explicitly authorized by the project administrator."
 */
export function canEditMyanmarTranslation(
  project: Pick<ProjectRecord, 'translation_locked'>,
  userRole: 'admin' | 'editor',
  adminAuthorizedOverride = false
): { allowed: boolean; reason?: string } {
  if (!project.translation_locked) {
    return { allowed: true };
  }
  if (userRole === 'admin' && adminAuthorizedOverride) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'Myanmar translation is locked by project policy. Administrator authorization is required to unlock corrections.',
  };
}

export function splitClipAtTime(clips: TimelineClip[], clipId: string, splitSec: number): TimelineClip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return clips;
  if (splitSec <= target.startSec + 0.1 || splitSec >= target.endSec - 0.1) {
    return clips;
  }

  const first: TimelineClip = {
    ...target,
    endSec: Number(splitSec.toFixed(3)),
  };
  const second: TimelineClip = {
    ...target,
    id: `${target.id}_part2_${Date.now()}`,
    label: `${target.label} (2)`,
    startSec: Number(splitSec.toFixed(3)),
  };

  return clips.flatMap((c) => (c.id === clipId ? [first, second] : [c]));
}

export function moveClipWithSnap(
  clip: TimelineClip,
  newStartSec: number,
  snapEnabled: boolean,
  snapIntervalSec = 0.25
): TimelineClip {
  const duration = Math.max(0.2, clip.endSec - clip.startSec);
  const snapped = snapEnabled
    ? Math.round(newStartSec / snapIntervalSec) * snapIntervalSec
    : newStartSec;
  const clampedStart = Math.max(0, Number(snapped.toFixed(3)));
  return {
    ...clip,
    startSec: clampedStart,
    endSec: Number((clampedStart + duration).toFixed(3)),
  };
}

export function getModuleSteps(module: ModuleType): { stepNumber: number; key: string; label: string }[] {
  if (module === 'subtitle') {
    return [
      { stepNumber: 1, key: 'create_project', label: 'Create Project' },
      { stepNumber: 2, key: 'import_media', label: 'Import Media' },
      { stepNumber: 3, key: 'extract_audio', label: 'Audio Extraction (FFmpeg)' },
      { stepNumber: 4, key: 'speech_recognition', label: 'Speech Recognition (Groq Whisper)' },
      { stepNumber: 5, key: 'myanmar_translation', label: 'Myanmar Translation (Gemini)' },
      { stepNumber: 6, key: 'subtitle_generation', label: 'Subtitle Segmentation & Validation' },
      { stepNumber: 7, key: 'preview_review', label: 'Preview & Final Review' },
      { stepNumber: 8, key: 'export', label: 'Export Deliverables' },
    ];
  }
  if (module === 'recap') {
    return [
      { stepNumber: 1, key: 'create_project', label: 'Create Recap Project' },
      { stepNumber: 2, key: 'import_movie', label: 'Import Movie' },
      { stepNumber: 3, key: 'processing_mode', label: 'Processing Mode' },
      { stepNumber: 4, key: 'scene_detection', label: 'Scene Detection' },
      { stepNumber: 5, key: 'scene_analysis', label: 'AI Scene Analysis (Gemini)' },
      { stepNumber: 6, key: 'story_understanding', label: 'Story Understanding' },
      { stepNumber: 7, key: 'scene_selection', label: 'Scene Selection' },
      { stepNumber: 8, key: 'recap_duration', label: 'Recap Duration' },
      { stepNumber: 9, key: 'myanmar_script', label: 'Myanmar Recap Script (Gemini)' },
      { stepNumber: 10, key: 'voiceover', label: 'Myanmar Voiceover (AI TTS)' },
      { stepNumber: 11, key: 'video_assembly', label: 'Video Assembly (FFmpeg)' },
      { stepNumber: 12, key: 'synchronization', label: 'Audio & Video Sync' },
      { stepNumber: 13, key: 'final_review', label: 'Final Review & Approval' },
      { stepNumber: 14, key: 'export', label: 'Export Final MP4' },
    ];
  }
  return [
    { stepNumber: 1, key: 'create_project', label: 'Create Dubbing Project' },
    { stepNumber: 2, key: 'import_video', label: 'Import Video' },
    { stepNumber: 3, key: 'extract_audio', label: 'Extract Original Audio' },
    { stepNumber: 4, key: 'audio_separation', label: 'Audio Separation (Dialogue / Music / SFX)' },
    { stepNumber: 5, key: 'speech_recognition', label: 'Speech Recognition (Groq Whisper)' },
    { stepNumber: 6, key: 'myanmar_translation', label: 'Myanmar Translation (Gemini)' },
    { stepNumber: 7, key: 'select_voice', label: 'Select Single Project Voice' },
    { stepNumber: 8, key: 'tts_generation', label: 'Myanmar TTS (One-Voice AI)' },
    { stepNumber: 9, key: 'timing_adjustment', label: 'Timing & Pace Alignment' },
    { stepNumber: 10, key: 'audio_mixing', label: 'Multi-Stem Audio Mixing' },
    { stepNumber: 11, key: 'video_sync', label: 'Video Synchronization' },
    { stepNumber: 12, key: 'preview_review', label: 'Preview & Approval' },
    { stepNumber: 13, key: 'export', label: 'Export Dubbed MP4' },
  ];
}

export function checkDubbingVoiceConsistency(
  tracks: { voice_name: string }[],
  projectVoice: string
): boolean {
  if (tracks.length === 0) return true;
  return tracks.every((t) => t.voice_name === projectVoice);
}

export function checkAudioGapsAndOverlaps(segments: TranscriptSegment[]): {
  overlaps: number;
  gaps: number;
} {
  const sorted = [...segments].sort((a, b) => a.start_sec - b.start_sec);
  let overlaps = 0;
  let gaps = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = sorted[i + 1].start_sec - sorted[i].end_sec;
    if (diff < -0.01) overlaps += 1;
    if (diff > 5.0) gaps += 1;
  }
  return { overlaps, gaps };
}

export type SceneFilterMode = 'all' | 'selected' | 'pivotal';

export function filterAndPaginateScenes(
  scenes: VideoScene[],
  options: {
    searchQuery?: string;
    filter?: SceneFilterMode;
    page?: number;
    pageSize?: number;
  }
): {
  items: VideoScene[];
  totalCount: number;
  filteredCount: number;
  page: number;
  totalPages: number;
  pageSize: number;
} {
  const query = (options.searchQuery || '').trim().toLowerCase();
  const filter = options.filter || 'all';
  const pageSize = Math.max(1, options.pageSize || 6);

  const filtered = scenes.filter((scene) => {
    if (filter === 'selected' && !scene.selected) return false;
    if (filter === 'pivotal' && scene.importance_score < 7 && !scene.plot_twist) return false;
    if (!query) return true;
    const haystack = [
      String(scene.scene_index),
      `#${scene.scene_index}`,
      scene.location,
      scene.action_summary,
      scene.story_position,
      scene.plot_twist,
      scene.dialogue_context,
      scene.important_events,
      ...(scene.characters || []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, options.page || 1));
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    totalCount: scenes.length,
    filteredCount: filtered.length,
    page,
    totalPages,
    pageSize,
  };
}

export interface WorkflowSummary {
  total: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
  remainingCount: number;
  currentStepNumber: number;
  currentStepLabel: string;
  progressPct: number;
}

export function summarizeWorkflowSteps(
  moduleSteps: Array<{ stepNumber: number; key: string; label: string }>,
  jobSteps: Array<{ step_number: number; step_label: string; status: string }> | undefined,
  projectActiveStep: number
): WorkflowSummary {
  const total = Math.max(1, moduleSteps.length);
  if (jobSteps && jobSteps.length > 0) {
    const completedCount = jobSteps.filter((s) => s.status === 'completed').length;
    const failedStep = jobSteps.find((s) => s.status === 'failed');
    const runningStep = jobSteps.find((s) => s.status === 'running');
    const failedCount = jobSteps.filter((s) => s.status === 'failed').length;
    const runningCount = jobSteps.filter((s) => s.status === 'running').length;
    const remainingCount = Math.max(0, jobSteps.length - completedCount);
    const current =
      runningStep ||
      failedStep ||
      jobSteps.find((s) => s.status === 'pending') ||
      jobSteps[jobSteps.length - 1];
    const progressPct = Math.round((completedCount / jobSteps.length) * 100);
    return {
      total: jobSteps.length,
      completedCount,
      failedCount,
      runningCount,
      remainingCount,
      currentStepNumber: current?.step_number || 1,
      currentStepLabel: current?.step_label || moduleSteps[0]?.label || 'Ready',
      progressPct,
    };
  }

  const clampedActive = Math.min(total, Math.max(1, projectActiveStep || 1));
  const completedCount = Math.min(total, Math.max(0, clampedActive));
  const remainingCount = Math.max(0, total - completedCount);
  const activeStepObj = moduleSteps.find((s) => s.stepNumber === clampedActive) || moduleSteps[0];
  return {
    total,
    completedCount,
    failedCount: 0,
    runningCount: 0,
    remainingCount,
    currentStepNumber: activeStepObj?.stepNumber || 1,
    currentStepLabel: activeStepObj?.label || 'Ready',
    progressPct: Math.round((completedCount / total) * 100),
  };
}

