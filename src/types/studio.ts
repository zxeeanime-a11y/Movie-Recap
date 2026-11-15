export type ModuleType = 'subtitle' | 'recap' | 'dubbing';

export type JobStatus =
  | 'Draft'
  | 'Queued'
  | 'Preparing'
  | 'Processing'
  | 'Reviewing'
  | 'Rendering'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ProviderId = 'gemini' | 'groq';

export type MediaCategory = 'video' | 'audio' | 'subtitle' | 'image';

export type VideoResolution = '480p' | '720p' | '1080p' | '4k';

export type FrameRate = 24 | 25 | 30 | 60;

export type ExportFormat = 'mp4' | 'mp4_burned' | 'mp4_embedded' | 'srt' | 'ass' | 'vtt' | 'mp3' | 'wav' | 'aac';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor';
  preferred_lang: 'en' | 'my';
  created_at: string;
}

export interface ProjectSettings {
  project_id: string;
  source_language: string;
  target_language: string;
  recap_style: string;
  target_platform: string;
  output_format: string;
  processing_mode: 'full' | 'segmented';
  selected_voice: string;
  target_duration_sec: number;
  resolution: VideoResolution;
  fps: FrameRate;
  burn_subtitles: boolean;
  bgm_volume: number;
  dialogue_volume: number;
  sfx_volume: number;
  restore_original_audio: boolean;
  updated_at: string;
}

export interface ProjectRecord {
  id: string;
  user_id: string;
  module: ModuleType;
  name: string;
  description: string;
  status: JobStatus;
  active_step: number;
  approved_for_export: boolean;
  translation_locked: boolean;
  autosave_version: number;
  created_at: string;
  updated_at: string;
  settings?: ProjectSettings;
}

export interface MediaFileRecord {
  id: string;
  user_id: string;
  project_id: string | null;
  filename: string;
  original_name: string;
  mime_type: string;
  media_type: MediaCategory;
  size_bytes: number;
  sha256: string;
  storage_mode: 'local' | 'cloud';
  file_path: string;
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  upload_status: string;
  created_at: string;
}

export interface SubtitleCue {
  id: string;
  project_id: string;
  cue_index: number;
  start_sec: number;
  end_sec: number;
  source_text: string;
  myanmar_text: string;
  reading_speed_cps: number;
  has_overlap: boolean;
  duration_valid: boolean;
  locked: boolean;
}

export interface TranscriptSegment {
  id: string;
  project_id: string;
  segment_index: number;
  speaker_id: string;
  start_sec: number;
  end_sec: number;
  original_text: string;
  translated_myanmar: string;
  confidence: number;
  approved: boolean;
}

export interface VideoScene {
  id: string;
  project_id: string;
  scene_index: number;
  start_sec: number;
  end_sec: number;
  keyframe_path: string;
  characters: string[];
  location: string;
  action_summary: string;
  dialogue_context: string;
  important_events: string;
  emotional_shift: string;
  story_position: string;
  plot_twist: string;
  importance_score: number;
  selected: boolean;
}

export interface StoryArc {
  beginning: string;
  middle: string;
  main_conflict: string;
  character_relationships: string;
  climax: string;
  ending: string;
  important_twists: string[];
}

export interface RecapSegment {
  scene_index: number;
  start_sec: number;
  end_sec: number;
  myanmar_narration: string;
  transition_note: string;
}

export interface RecapScriptRecord {
  id: string;
  project_id: string;
  version: number;
  story_arc: StoryArc;
  estimated_duration_sec: number;
  narration_speed_wps: number;
  segments: RecapSegment[];
  full_myanmar_script: string;
  title_suggestion: string;
  caption_suggestion: string;
  approved: boolean;
  created_at: string;
}

export interface AudioTrackRecord {
  id: string;
  project_id: string;
  track_type:
    | 'original'
    | 'dialogue_stem'
    | 'music_stem'
    | 'sfx_stem'
    | 'tts_segment'
    | 'recap_voiceover'
    | 'mixed_dub';
  segment_index: number;
  voice_name: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  speed_ratio: number;
  file_path: string;
  version: number;
  created_at: string;
}

export interface JobStepRecord {
  id: string;
  job_id: string;
  project_id: string;
  step_number: number;
  step_key: string;
  step_label: string;
  status: StepStatus;
  output_summary: string;
  error_details: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProcessingJobRecord {
  id: string;
  user_id: string;
  project_id: string;
  module: ModuleType;
  status: JobStatus;
  current_step: number;
  progress_pct: number;
  logs: string[];
  error_message: string;
  cancel_requested: boolean;
  steps: JobStepRecord[];
  created_at: string;
  updated_at: string;
}

export interface ExportRecord {
  id: string;
  user_id: string;
  project_id: string;
  module: ModuleType;
  format: string;
  resolution: string;
  fps: number;
  file_path: string;
  file_size: number;
  status: 'pending' | 'rendering' | 'completed' | 'failed';
  error_message: string;
  metadata_json: string;
  created_at: string;
}

export interface ProjectVersionRecord {
  id: string;
  project_id: string;
  user_id: string;
  version_number: number;
  label: string;
  snapshot_json: string;
  created_at: string;
}

export interface ProviderConfigStatus {
  provider: ProviderId;
  configured: boolean;
  source: 'env' | 'vault' | 'none';
  masked_key: string;
  selected_model: string;
  tts_model: string;
  transcribe_model: string;
  llm_model: string;
  last_test_status: 'untested' | 'connected' | 'error';
  last_test_at: string | null;
  last_error: string;
  latency_ms: number | null;
  available_models: { id: string; label: string; capabilities: string[] }[];
}

export interface VoiceProfile {
  id: string;
  name: string;
  provider: 'edge-tts' | 'gemini';
  voice_id: string;
  style_note: string;
  sample_text: string;
  is_default?: boolean;
  requires_api_key?: boolean;
}

export interface TimelineTrack {
  id: string;
  kind: 'video' | 'original_audio' | 'dialogue' | 'ai_voice' | 'music' | 'sfx' | 'subtitle';
  label: string;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  label: string;
  startSec: number;
  endSec: number;
  color: string;
  text?: string;
  voiceName?: string;
}
