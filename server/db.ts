import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const MEDIA_ROOT = path.join(DATA_DIR, 'media');
export const CHUNKS_ROOT = path.join(DATA_DIR, 'chunks');
export const EXPORTS_ROOT = path.join(DATA_DIR, 'exports');
export const BACKUPS_ROOT = path.join(DATA_DIR, 'backups');
export const DB_PATH = path.join(DATA_DIR, 'studio.db');

for (const dir of [DATA_DIR, MEDIA_ROOT, CHUNKS_ROOT, EXPORTS_ROOT, BACKUPS_ROOT]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      preferred_lang TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      module TEXT NOT NULL CHECK(module IN ('subtitle','recap','dubbing')),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      active_step INTEGER NOT NULL DEFAULT 1,
      approved_for_export INTEGER NOT NULL DEFAULT 0,
      translation_locked INTEGER NOT NULL DEFAULT 1,
      autosave_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_module ON projects(module);

    CREATE TABLE IF NOT EXISTS project_settings (
      project_id TEXT PRIMARY KEY,
      source_language TEXT NOT NULL DEFAULT 'English',
      target_language TEXT NOT NULL DEFAULT 'Myanmar',
      recap_style TEXT NOT NULL DEFAULT 'Dramatic Storyteller',
      target_platform TEXT NOT NULL DEFAULT 'YouTube (16:9)',
      output_format TEXT NOT NULL DEFAULT 'mp4',
      processing_mode TEXT NOT NULL DEFAULT 'full',
      selected_voice TEXT NOT NULL DEFAULT 'my-MM-NilarNeural',
      target_duration_sec INTEGER NOT NULL DEFAULT 60,
      resolution TEXT NOT NULL DEFAULT '720p',
      fps INTEGER NOT NULL DEFAULT 30,
      burn_subtitles INTEGER NOT NULL DEFAULT 1,
      bgm_volume REAL NOT NULL DEFAULT 0.35,
      dialogue_volume REAL NOT NULL DEFAULT 1.0,
      sfx_volume REAL NOT NULL DEFAULT 0.75,
      restore_original_audio INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_mode TEXT NOT NULL DEFAULT 'local',
      file_path TEXT NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      fps REAL NOT NULL DEFAULT 0,
      codec TEXT NOT NULL DEFAULT '',
      upload_status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_user ON media_files(user_id);
    CREATE INDEX IF NOT EXISTS idx_media_project ON media_files(project_id);

    CREATE TABLE IF NOT EXISTS video_scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_index INTEGER NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      keyframe_path TEXT NOT NULL DEFAULT '',
      characters_json TEXT NOT NULL DEFAULT '[]',
      location TEXT NOT NULL DEFAULT '',
      action_summary TEXT NOT NULL DEFAULT '',
      dialogue_context TEXT NOT NULL DEFAULT '',
      important_events TEXT NOT NULL DEFAULT '',
      emotional_shift TEXT NOT NULL DEFAULT '',
      story_position TEXT NOT NULL DEFAULT '',
      plot_twist TEXT NOT NULL DEFAULT '',
      importance_score REAL NOT NULL DEFAULT 5,
      selected INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scenes_project ON video_scenes(project_id);

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      speaker_label TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      speaker_id TEXT NOT NULL DEFAULT 'SPEAKER_01',
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      original_text TEXT NOT NULL,
      translated_myanmar TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 1.0,
      approved INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_transcripts_project ON transcripts(project_id);

    CREATE TABLE IF NOT EXISTS subtitles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      cue_index INTEGER NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      source_text TEXT NOT NULL,
      myanmar_text TEXT NOT NULL DEFAULT '',
      reading_speed_cps REAL NOT NULL DEFAULT 0,
      has_overlap INTEGER NOT NULL DEFAULT 0,
      duration_valid INTEGER NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subtitles_project ON subtitles(project_id);

    CREATE TABLE IF NOT EXISTS recap_scripts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      story_arc_json TEXT NOT NULL DEFAULT '{}',
      estimated_duration_sec INTEGER NOT NULL DEFAULT 60,
      narration_speed_wps REAL NOT NULL DEFAULT 2.3,
      segments_json TEXT NOT NULL DEFAULT '[]',
      full_myanmar_script TEXT NOT NULL DEFAULT '',
      title_suggestion TEXT NOT NULL DEFAULT '',
      caption_suggestion TEXT NOT NULL DEFAULT '',
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS voice_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      style_note TEXT NOT NULL,
      sample_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audio_tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      track_type TEXT NOT NULL,
      segment_index INTEGER NOT NULL DEFAULT 0,
      voice_name TEXT NOT NULL DEFAULT '',
      start_sec REAL NOT NULL DEFAULT 0,
      end_sec REAL NOT NULL DEFAULT 0,
      duration_sec REAL NOT NULL DEFAULT 0,
      speed_ratio REAL NOT NULL DEFAULT 1.0,
      file_path TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_audio_project ON audio_tracks(project_id);

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      module TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 1,
      progress_pct INTEGER NOT NULL DEFAULT 0,
      logs_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT NOT NULL DEFAULT '',
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_project ON processing_jobs(project_id);

    CREATE TABLE IF NOT EXISTS job_steps (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      step_key TEXT NOT NULL,
      step_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output_summary TEXT NOT NULL DEFAULT '',
      error_details TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      module TEXT NOT NULL,
      format TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT '720p',
      fps INTEGER NOT NULL DEFAULT 30,
      file_path TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_providers (
      provider TEXT PRIMARY KEY,
      encrypted_key TEXT NOT NULL DEFAULT '',
      masked_key TEXT NOT NULL DEFAULT '',
      selected_model TEXT NOT NULL,
      tts_model TEXT NOT NULL DEFAULT '',
      transcribe_model TEXT NOT NULL DEFAULT '',
      llm_model TEXT NOT NULL DEFAULT '',
      last_test_status TEXT NOT NULL DEFAULT 'untested',
      last_test_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  seedDefaults();
}

function seedDefaults() {
  const now = new Date().toISOString();

  // Seed default Studio Administrator if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (userCount.c === 0) {
    const hash = bcrypt.hashSync('studio-admin-2026', 10);
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, preferred_lang, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('user_admin_1', 'admin@recapstudio.local', 'Studio Producer', hash, 'admin', 'en', now);
  }

  // Seed API-key-free Edge TTS Burmese voices (Nilar default, Thiha) + Gemini voices
  const voices = [
    {
      id: 'voice_nilar',
      name: 'Nilar (Burmese Neural · Default)',
      provider: 'edge-tts',
      voice_id: 'my-MM-NilarNeural',
      style_note: 'API-Key-Free · Natural Burmese female neural voice (Default)',
      sample_text: 'မင်္ဂလာပါ။ ဒီနေ့ ဇာတ်လမ်းအကျဉ်းချုပ်ကို မြန်မာဘာသာဖြင့် တင်ဆက်ပေးပါမယ်။',
    },
    {
      id: 'voice_thiha',
      name: 'Thiha (Burmese Neural)',
      provider: 'edge-tts',
      voice_id: 'my-MM-ThihaNeural',
      style_note: 'API-Key-Free · Deep Burmese male neural voice',
      sample_text: 'မင်္ဂလာပါ။ မြန်မာအသံသွင်း စနစ်ကို စတင်အသုံးပြုနိုင်ပါပြီ။',
    },
    {
      id: 'voice_kore',
      name: 'Kore (Gemini TTS)',
      provider: 'gemini',
      voice_id: 'Kore',
      style_note: 'Gemini Key · Warm, articulate storytelling voice',
      sample_text: 'မင်္ဂလာပါ။ ဒီနေ့ ဇာတ်လမ်းအကျဉ်းချုပ်ကို တင်ဆက်ပေးပါမယ်။',
    },
    {
      id: 'voice_charon',
      name: 'Charon (Gemini TTS)',
      provider: 'gemini',
      voice_id: 'Charon',
      style_note: 'Gemini Key · Deep, authoritative dramatic narration voice',
      sample_text: 'အမှောင်ထုထဲက လျှို့ဝှက်ချက်တွေဟာ စတင်ပေါ်ထွက်လာပါပြီ။',
    },
    {
      id: 'voice_puck',
      name: 'Puck (Gemini TTS)',
      provider: 'gemini',
      voice_id: 'Puck',
      style_note: 'Gemini Key · Energetic, expressive fast-paced recap voice',
      sample_text: 'မထင်မှတ်ထားတဲ့ အလှည့်အပြောင်းတစ်ခု စတင်လာပါတော့တယ်။',
    },
    {
      id: 'voice_fenrir',
      name: 'Fenrir (Gemini TTS)',
      provider: 'gemini',
      voice_id: 'Fenrir',
      style_note: 'Gemini Key · Rich, steady cinema trailer & thriller voice',
      sample_text: 'သူတို့အားလုံးရဲ့ ကံကြမ္မာဟာ ဒီတစ်ညတည်းမှာ ပြောင်းလဲသွားခဲ့တယ်။',
    },
    {
      id: 'voice_zephyr',
      name: 'Zephyr (Gemini TTS)',
      provider: 'gemini',
      voice_id: 'Zephyr',
      style_note: 'Gemini Key · Clear, calm documentary & subtitle dubbing voice',
      sample_text: 'ဇာတ်ကောင်တိုင်းရဲ့ ခံစားချက်ကို အနီးကပ် မြင်တွေ့ရမှာပါ။',
    },
  ];

  const upsertVoice = db.prepare(
    `INSERT INTO voice_profiles (id, name, provider, voice_id, style_note, sample_text)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       provider = excluded.provider,
       voice_id = excluded.voice_id,
       style_note = excluded.style_note,
       sample_text = excluded.sample_text`
  );
  for (const v of voices) {
    upsertVoice.run(v.id, v.name, v.provider, v.voice_id, v.style_note, v.sample_text);
  }

  // Seed provider configuration rows (never fake connected status—starts untested)
  db.prepare(
    `INSERT OR IGNORE INTO api_providers
      (provider, encrypted_key, masked_key, selected_model, tts_model, transcribe_model, llm_model, last_test_status, last_test_at, last_error, latency_ms, updated_at)
     VALUES (?, '', '', ?, ?, ?, ?, 'untested', NULL, '', NULL, ?)`
  ).run(
    'gemini',
    'gemini-4-hydrogen',
    'gemini-3.8-flash-lite-tts',
    'gemini-3.5-transcribe',
    'gemini-4-hydrogen',
    now
  );

  db.prepare(
    `INSERT OR IGNORE INTO api_providers
      (provider, encrypted_key, masked_key, selected_model, tts_model, transcribe_model, llm_model, last_test_status, last_test_at, last_error, latency_ms, updated_at)
     VALUES (?, '', '', ?, '', ?, ?, 'untested', NULL, '', NULL, ?)`
  ).run('groq', 'llama-3.3-70b-versatile', 'whisper-large-v3-turbo', 'llama-3.3-70b-versatile', now);
}

export function writeAuditLog(
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details = '',
  ip = '127.0.0.1'
) {
  const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, action, resourceType, resourceId, details, ip, new Date().toISOString());
}
