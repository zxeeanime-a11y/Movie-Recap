import fs from 'node:fs';
import path from 'node:path';
import type {
  JobStatus,
  ModuleType,
  ProjectRecord,
  ProjectSettings,
  SubtitleCue,
  TranscriptSegment,
  VideoScene,
} from '../src/types/studio';
import {
  checkAudioGapsAndOverlaps,
  checkDubbingVoiceConsistency,
  computeNonOverlappingDubbingSchedule,
  computeSuitableRecapDuration,
  DEFAULT_MYANMAR_VOICE_ID,
  enforceSingleVoiceRule,
  getModuleSteps,
  validateSubtitles,
} from '../src/utils/studioRules';
import {
  analyzeKeyframesWithGemini,
  generateStoryAndRecapScriptWithGemini,
  synthesizeMyanmarTTS,
  transcribeAudioWithGroqOrFallback,
  translateSegmentsToMyanmar,
} from './aiProviders.ts';
import { sanitizeErrorMessage } from './crypto.ts';
import { db, MEDIA_ROOT, writeAuditLog } from './db.ts';
import {
  assembleRecapMp4,
  detectScenesAndKeyframes,
  extractAudioWavAndMp3,
  mixAndRenderDubbedMp4,
  probeMedia,
  separateAudioStems,
} from './mediaEngine.ts';

function appendJobLog(jobId: string, line: string) {
  const row = db.prepare('SELECT logs_json FROM processing_jobs WHERE id = ?').get(jobId) as
    | { logs_json: string }
    | undefined;
  const logs = row ? (JSON.parse(row.logs_json) as string[]) : [];
  logs.push(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  db.prepare('UPDATE processing_jobs SET logs_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(logs.slice(-120)),
    new Date().toISOString(),
    jobId
  );
}

function updateJobState(
  jobId: string,
  projectId: string,
  status: JobStatus,
  currentStep: number,
  progressPct: number,
  errorMessage = ''
) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE processing_jobs SET status = ?, current_step = ?, progress_pct = ?, error_message = ?, updated_at = ? WHERE id = ?`
  ).run(status, currentStep, progressPct, errorMessage, now, jobId);
  db.prepare(`UPDATE projects SET status = ?, active_step = ?, updated_at = ? WHERE id = ?`).run(
    status,
    currentStep,
    now,
    projectId
  );
}

function isCancelRequested(jobId: string): boolean {
  const row = db.prepare('SELECT cancel_requested FROM processing_jobs WHERE id = ?').get(jobId) as
    | { cancel_requested: number }
    | undefined;
  return Boolean(row?.cancel_requested);
}

export function getJobWithSteps(jobId: string) {
  const job = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!job) return null;
  const steps = db
    .prepare('SELECT * FROM job_steps WHERE job_id = ? ORDER BY step_number ASC')
    .all(jobId) as unknown as Record<string, unknown>[];
  return {
    ...job,
    logs: JSON.parse((job.logs_json as string) || '[]'),
    cancel_requested: Boolean(job.cancel_requested),
    steps,
  };
}

export function getLatestProjectJob(projectId: string) {
  const row = db
    .prepare('SELECT id FROM processing_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(projectId) as { id: string } | undefined;
  if (!row) return null;
  return getJobWithSteps(row.id);
}

export function createOrStartProjectJob(projectId: string, userId: string, fromStep = 1) {
  // Prevent duplicate active jobs on same project
  const active = db
    .prepare(
      `SELECT id FROM processing_jobs WHERE project_id = ? AND status IN ('Queued','Preparing','Processing','Rendering') LIMIT 1`
    )
    .get(projectId) as { id: string } | undefined;
  if (active) {
    throw new Error('A background job is already running for this project.');
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as
    | (ProjectRecord & { module: ModuleType })
    | undefined;
  if (!project) throw new Error('Project not found.');

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const stepsDef = getModuleSteps(project.module);

  db.prepare(
    `INSERT INTO processing_jobs (id, user_id, project_id, module, status, current_step, progress_pct, logs_json, error_message, cancel_requested, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Queued', ?, 0, '[]', '', 0, ?, ?)`
  ).run(jobId, userId, projectId, project.module, fromStep, now, now);

  const insertStep = db.prepare(
    `INSERT INTO job_steps (id, job_id, project_id, step_number, step_key, step_label, status, output_summary, error_details)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', '')`
  );
  for (const s of stepsDef) {
    const initialStatus = s.stepNumber < fromStep ? 'completed' : 'pending';
    insertStep.run(
      `jstep_${jobId}_${s.stepNumber}`,
      jobId,
      projectId,
      s.stepNumber,
      s.key,
      s.label,
      initialStatus
    );
  }

  appendJobLog(jobId, `Queued ${project.module.toUpperCase()} pipeline starting at step ${fromStep}.`);
  writeAuditLog(userId, 'JOB_CREATED', 'job', jobId, `Module ${project.module}`);

  // Launch asynchronously without blocking HTTP response
  setImmediate(() => {
    void executeJobPipeline(jobId, fromStep);
  });

  return getJobWithSteps(jobId);
}

export function retrySingleJobStep(jobId: string, userId: string, stepNumber: number) {
  const job = db.prepare('SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?').get(jobId, userId) as
    | { id: string; project_id: string; status: string }
    | undefined;
  if (!job) throw new Error('Job not found.');
  if (['Queued', 'Preparing', 'Processing', 'Rendering'].includes(job.status)) {
    throw new Error('Cannot retry step while job is actively running.');
  }

  // Preserve completed steps < stepNumber and their outputs; only reset the target step (and any pending downstream steps stay pending until target succeeds)
  db.prepare(
    `UPDATE job_steps SET status = 'pending', error_details = '', output_summary = '' WHERE job_id = ? AND step_number = ?`
  ).run(jobId, stepNumber);
  db.prepare(`UPDATE processing_jobs SET status = 'Queued', cancel_requested = 0, error_message = '' WHERE id = ?`).run(
    jobId
  );

  appendJobLog(
    jobId,
    `Retrying from Step #${stepNumber} while preserving all earlier completed outputs (Steps 1–${Math.max(1, stepNumber - 1)}).`
  );
  setImmediate(() => {
    void executeJobPipeline(jobId, stepNumber, false);
  });

  return getJobWithSteps(jobId);
}

export function cancelJob(jobId: string, userId: string) {
  const job = db.prepare('SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?').get(jobId, userId) as
    | { id: string; project_id: string }
    | undefined;
  if (!job) throw new Error('Job not found.');
  db.prepare(`UPDATE processing_jobs SET cancel_requested = 1, status = 'Cancelled', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    jobId
  );
  db.prepare(`UPDATE projects SET status = 'Cancelled', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    job.project_id
  );
  appendJobLog(jobId, 'Cancellation requested by user.');
  return getJobWithSteps(jobId);
}

async function runSingleStep(projectId: string, module: ModuleType, stepKey: string): Promise<string> {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as unknown as ProjectRecord;
  const settings = db.prepare('SELECT * FROM project_settings WHERE project_id = ?').get(projectId) as unknown as ProjectSettings;
  const media = db
    .prepare(
      `SELECT * FROM media_files WHERE project_id = ? AND media_type IN ('video','audio') ORDER BY created_at DESC LIMIT 1`
    )
    .get(projectId) as { id: string; file_path: string; original_name: string; duration_sec: number } | undefined;

  const projectWorkDir = path.join(MEDIA_ROOT, projectId);
  fs.mkdirSync(projectWorkDir, { recursive: true });

  if (stepKey === 'create_project') {
    return `Project "${project.name}" configuration verified.`;
  }

  if (stepKey === 'import_media' || stepKey === 'import_movie' || stepKey === 'import_video') {
    if (!media || !fs.existsSync(media.file_path)) {
      throw new Error('No source video/audio file imported for this project.');
    }
    const meta = await probeMedia(media.file_path);
    db.prepare(
      `UPDATE media_files SET duration_sec = ?, width = ?, height = ?, fps = ?, codec = ? WHERE id = ?`
    ).run(meta.duration_sec, meta.width, meta.height, meta.fps, meta.codec, media.id);
    return `Verified "${media.original_name}" (${meta.duration_sec}s, ${meta.width}x${meta.height}, ${meta.fps}fps, ${meta.codec}).`;
  }

  if (stepKey === 'processing_mode') {
    return `Processing mode set to ${settings.processing_mode === 'full' ? 'Full Movie Processing' : 'Segment-by-Segment Processing'}.`;
  }

  if (stepKey === 'extract_audio') {
    if (!media || !fs.existsSync(media.file_path)) {
      throw new Error('Source media missing for audio extraction.');
    }
    const wavPath = path.join(projectWorkDir, 'extracted_audio.wav');
    const mp3Path = path.join(projectWorkDir, 'extracted_audio.mp3');
    const res = await extractAudioWavAndMp3(media.file_path, wavPath, mp3Path);
    db.prepare(`DELETE FROM audio_tracks WHERE project_id = ? AND track_type = 'original'`).run(projectId);
    db.prepare(
      `INSERT INTO audio_tracks (id, project_id, track_type, segment_index, voice_name, start_sec, end_sec, duration_sec, speed_ratio, file_path, version, created_at)
       VALUES (?, ?, 'original', 0, '', 0, ?, ?, 1.0, ?, 1, ?)`
    ).run(`aud_${Date.now()}`, projectId, res.durationSec, res.durationSec, wavPath, new Date().toISOString());
    return `FFmpeg extracted 16kHz mono WAV & MP3 (${res.durationSec}s). Original media preserved.`;
  }

  if (stepKey === 'audio_separation') {
    if (!media || !fs.existsSync(media.file_path)) {
      throw new Error('Source media missing for stem separation.');
    }
    const stemsDir = path.join(projectWorkDir, 'stems');
    const res = await separateAudioStems(media.file_path, stemsDir);
    const dur = media.duration_sec || 9;
    const now = new Date().toISOString();
    db.prepare(
      `DELETE FROM audio_tracks WHERE project_id = ? AND track_type IN ('dialogue_stem','music_stem','sfx_stem')`
    ).run(projectId);
    const ins = db.prepare(
      `INSERT INTO audio_tracks (id, project_id, track_type, segment_index, voice_name, start_sec, end_sec, duration_sec, speed_ratio, file_path, version, created_at)
       VALUES (?, ?, ?, 0, '', 0, ?, ?, 1.0, ?, 1, ?)`
    );
    ins.run(`aud_dlg_${Date.now()}`, projectId, 'dialogue_stem', dur, dur, res.dialoguePath, now);
    ins.run(`aud_mus_${Date.now() + 1}`, projectId, 'music_stem', dur, dur, res.musicPath, now);
    ins.run(`aud_sfx_${Date.now() + 2}`, projectId, 'sfx_stem', dur, dur, res.sfxPath, now);
    return `Separated dialogue, background music, and effects stems using ${res.engine}.`;
  }

  if (stepKey === 'speech_recognition') {
    const mp3Path = path.join(projectWorkDir, 'extracted_audio.mp3');
    const audioInput = fs.existsSync(mp3Path) ? mp3Path : media?.file_path;
    if (!audioInput || !fs.existsSync(audioInput)) {
      throw new Error('Audio track missing. Run Audio Extraction first.');
    }
    const result = await transcribeAudioWithGroqOrFallback(audioInput, settings.source_language, true);
    db.prepare(`DELETE FROM transcripts WHERE project_id = ?`).run(projectId);
    const ins = db.prepare(
      `INSERT INTO transcripts (id, project_id, segment_index, speaker_id, start_sec, end_sec, original_text, translated_myanmar, confidence, approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', 0.95, 0)`
    );
    result.segments.forEach((seg, idx) => {
      ins.run(
        `tr_${projectId}_${idx + 1}`,
        projectId,
        idx + 1,
        seg.speaker_id,
        seg.start_sec,
        seg.end_sec,
        seg.text
      );
    });
    return `Transcribed ${result.segments.length} segments using ${result.providerUsed.toUpperCase()}.`;
  }

  if (stepKey === 'myanmar_translation') {
    const transcripts = db
      .prepare(`SELECT * FROM transcripts WHERE project_id = ? ORDER BY segment_index ASC`)
      .all(projectId) as unknown as TranscriptSegment[];
    if (transcripts.length === 0) {
      throw new Error('No transcript segments found. Complete Speech Recognition first.');
    }
    const translated = await translateSegmentsToMyanmar(
      transcripts,
      settings.source_language,
      `${project.name} - ${project.description}`
    );
    const map = new Map(translated.map((t) => [t.segment_index, t.myanmar_text]));
    const upd = db.prepare(`UPDATE transcripts SET translated_myanmar = ? WHERE id = ?`);
    for (const seg of transcripts) {
      const myText = map.get(seg.segment_index) || '';
      upd.run(myText, seg.id);
    }
    return `Translated ${transcripts.length} segments into Myanmar Unicode via Gemini.`;
  }

  if (stepKey === 'subtitle_generation') {
    const transcripts = db
      .prepare(`SELECT * FROM transcripts WHERE project_id = ? ORDER BY segment_index ASC`)
      .all(projectId) as unknown as TranscriptSegment[];
    if (transcripts.length === 0) {
      throw new Error('No translated transcript segments available for subtitle generation.');
    }
    const rawCues: SubtitleCue[] = transcripts.map((t, idx) => ({
      id: `sub_${projectId}_${idx + 1}`,
      project_id: projectId,
      cue_index: idx + 1,
      start_sec: t.start_sec,
      end_sec: Math.max(t.start_sec + 0.8, t.end_sec),
      source_text: t.original_text,
      myanmar_text: t.translated_myanmar,
      reading_speed_cps: 0,
      has_overlap: false,
      duration_valid: true,
      locked: Boolean(project.translation_locked),
    }));
    const checked = validateSubtitles(rawCues);
    db.prepare(`DELETE FROM subtitles WHERE project_id = ?`).run(projectId);
    const ins = db.prepare(
      `INSERT INTO subtitles (id, project_id, cue_index, start_sec, end_sec, source_text, myanmar_text, reading_speed_cps, has_overlap, duration_valid, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of checked.cues) {
      ins.run(
        c.id,
        c.project_id,
        c.cue_index,
        c.start_sec,
        c.end_sec,
        c.source_text,
        c.myanmar_text,
        c.reading_speed_cps,
        c.has_overlap ? 1 : 0,
        c.duration_valid ? 1 : 0,
        c.locked ? 1 : 0
      );
    }
    return `Generated ${checked.cues.length} subtitle cues (overlaps: ${checked.overlapCount}, high-CPS warnings: ${checked.highSpeedCount}).`;
  }

  if (stepKey === 'scene_detection') {
    if (!media || !fs.existsSync(media.file_path)) {
      throw new Error('Movie file missing for scene detection.');
    }
    const keyframesDir = path.join(projectWorkDir, 'keyframes');
    const detected = await detectScenesAndKeyframes(media.file_path, keyframesDir, media.duration_sec);
    db.prepare(`DELETE FROM video_scenes WHERE project_id = ?`).run(projectId);
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO video_scenes (id, project_id, scene_index, start_sec, end_sec, keyframe_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of detected) {
      ins.run(`sc_${projectId}_${s.scene_index}`, projectId, s.scene_index, s.start_sec, s.end_sec, s.keyframe_path, now);
    }
    return `Detected ${detected.length} scene boundaries and extracted JPG keyframes.`;
  }

  if (stepKey === 'scene_analysis') {
    const scenes = db
      .prepare(`SELECT * FROM video_scenes WHERE project_id = ? ORDER BY scene_index ASC`)
      .all(projectId) as unknown as Array<{
      id: string;
      scene_index: number;
      start_sec: number;
      end_sec: number;
      keyframe_path: string;
    }>;
    if (scenes.length === 0) throw new Error('No scenes detected yet.');
    const analyzed = await analyzeKeyframesWithGemini(scenes, project.name);
    const byIdx = new Map(analyzed.map((a) => [a.scene_index, a]));
    const upd = db.prepare(
      `UPDATE video_scenes SET characters_json = ?, location = ?, action_summary = ?, dialogue_context = ?, important_events = ?, emotional_shift = ?, story_position = ?, plot_twist = ?, importance_score = ?, selected = ?, updated_at = ? WHERE id = ?`
    );
    const now = new Date().toISOString();
    for (const s of scenes) {
      const a = byIdx.get(s.scene_index);
      if (a) {
        upd.run(
          JSON.stringify(a.characters || []),
          a.location || '',
          a.action_summary || '',
          a.dialogue_context || '',
          a.important_events || '',
          a.emotional_shift || '',
          a.story_position || '',
          a.plot_twist || '',
          a.importance_score ?? 6,
          (a.importance_score ?? 6) >= 5 ? 1 : 0,
          now,
          s.id
        );
      }
    }
    return `Analyzed ${scenes.length} scene keyframes with Gemini multimodal understanding.`;
  }

  if (stepKey === 'story_understanding' || stepKey === 'myanmar_script') {
    const rawScenes = db
      .prepare(`SELECT * FROM video_scenes WHERE project_id = ? ORDER BY scene_index ASC`)
      .all(projectId) as unknown as Array<Record<string, unknown>>;
    if (rawScenes.length === 0) throw new Error('No scenes available for story & script generation.');
    const scenes: VideoScene[] = rawScenes.map((r) => ({
      id: String(r.id),
      project_id: String(r.project_id),
      scene_index: Number(r.scene_index),
      start_sec: Number(r.start_sec),
      end_sec: Number(r.end_sec),
      keyframe_path: String(r.keyframe_path || ''),
      characters: JSON.parse(String(r.characters_json || '[]')),
      location: String(r.location || ''),
      action_summary: String(r.action_summary || ''),
      dialogue_context: String(r.dialogue_context || ''),
      important_events: String(r.important_events || ''),
      emotional_shift: String(r.emotional_shift || ''),
      story_position: String(r.story_position || ''),
      plot_twist: String(r.plot_twist || ''),
      importance_score: Number(r.importance_score ?? 5),
      selected: Boolean(r.selected),
    }));

    const selected = scenes.filter((s) => s.selected);
    const scriptRes = await generateStoryAndRecapScriptWithGemini({
      projectName: project.name,
      recapStyle: settings.recap_style,
      targetPlatform: settings.target_platform,
      scenes: selected.length > 0 ? selected : scenes,
    });

    const durCalc = computeSuitableRecapDuration({
      scenes,
      myanmarScript: scriptRes.full_myanmar_script,
    });

    const latestVer = db
      .prepare(`SELECT COALESCE(MAX(version), 0) as v FROM recap_scripts WHERE project_id = ?`)
      .get(projectId) as { v: number };
    const nextVer = (latestVer?.v || 0) + 1;

    db.prepare(
      `INSERT INTO recap_scripts (id, project_id, version, story_arc_json, estimated_duration_sec, narration_speed_wps, segments_json, full_myanmar_script, title_suggestion, caption_suggestion, approved, created_at)
       VALUES (?, ?, ?, ?, ?, 2.3, ?, ?, ?, ?, 0, ?)`
    ).run(
      `recap_${projectId}_v${nextVer}`,
      projectId,
      nextVer,
      JSON.stringify(scriptRes.story_arc),
      durCalc.recommendedSec,
      JSON.stringify(scriptRes.segments),
      scriptRes.full_myanmar_script,
      scriptRes.title_suggestion,
      scriptRes.caption_suggestion,
      new Date().toISOString()
    );
    db.prepare(`UPDATE project_settings SET target_duration_sec = ? WHERE project_id = ?`).run(
      durCalc.recommendedSec,
      projectId
    );
    return `Generated Story Arc and Myanmar recap script v${nextVer} (~${durCalc.recommendedSec}s suitable duration).`;
  }

  if (stepKey === 'scene_selection' || stepKey === 'recap_duration') {
    const rawScenes = db
      .prepare(`SELECT * FROM video_scenes WHERE project_id = ? ORDER BY scene_index ASC`)
      .all(projectId) as unknown as Array<Record<string, unknown>>;
    const selectedCount = rawScenes.filter((s) => Boolean(s.selected)).length;
    return `Confirmed ${selectedCount} selected story scenes and pacing duration (${settings.target_duration_sec}s).`;
  }

  if (stepKey === 'voiceover') {
    const scriptRow = db
      .prepare(`SELECT * FROM recap_scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1`)
      .get(projectId) as { full_myanmar_script: string } | undefined;
    if (!scriptRow?.full_myanmar_script) {
      throw new Error('Myanmar recap script must be generated before voiceover synthesis.');
    }
    const voPath = path.join(projectWorkDir, `recap_voiceover_v${Date.now()}.wav`);
    const chosenVoice = settings.selected_voice || DEFAULT_MYANMAR_VOICE_ID;
    const ttsRes = await synthesizeMyanmarTTS(
      scriptRow.full_myanmar_script,
      chosenVoice,
      voPath
    );
    db.prepare(
      `INSERT INTO audio_tracks (id, project_id, track_type, segment_index, voice_name, start_sec, end_sec, duration_sec, speed_ratio, file_path, version, created_at)
       VALUES (?, ?, 'recap_voiceover', 0, ?, 0, ?, ?, 1.0, ?, 1, ?)`
    ).run(`aud_vo_${Date.now()}`, projectId, ttsRes.voiceUsed, ttsRes.durationSec, ttsRes.durationSec, voPath, new Date().toISOString());
    return `Synthesized Myanmar voiceover (${ttsRes.durationSec}s, ${ttsRes.formatUsed}) with ${ttsRes.providerUsed} voice "${ttsRes.voiceUsed}".`;
  }

  if (stepKey === 'video_assembly' || stepKey === 'synchronization') {
    if (!media || !fs.existsSync(media.file_path)) {
      throw new Error('Source movie missing for assembly.');
    }
    const rawScenes = db
      .prepare(`SELECT start_sec, end_sec FROM video_scenes WHERE project_id = ? AND selected = 1 ORDER BY scene_index ASC`)
      .all(projectId) as unknown as { start_sec: number; end_sec: number }[];
    const voTrack = db
      .prepare(`SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'recap_voiceover' ORDER BY created_at DESC LIMIT 1`)
      .get(projectId) as { file_path: string } | undefined;
    const previewOut = path.join(projectWorkDir, 'recap_preview.mp4');
    const assembled = await assembleRecapMp4({
      videoPath: media.file_path,
      selectedScenes: rawScenes,
      narrationWavPath: voTrack?.file_path,
      outPath: previewOut,
      resolution: settings.resolution || '720p',
      fps: settings.fps || 30,
      burnSubtitles: Boolean(settings.burn_subtitles),
      bgmVolume: settings.bgm_volume ?? 0.25,
    });
    return `Assembled and synchronized recap preview MP4 (${assembled.durationSec}s, ${Math.round(assembled.fileSize / 1024)} KB).`;
  }

  if (stepKey === 'select_voice') {
    const chosenVoice = settings.selected_voice || DEFAULT_MYANMAR_VOICE_ID;
    return `Locked single project voice "${chosenVoice}" for ALL characters and narration (Absolute One-Voice Rule).`;
  }

  if (stepKey === 'tts_generation') {
    const transcripts = db
      .prepare(`SELECT * FROM transcripts WHERE project_id = ? ORDER BY segment_index ASC`)
      .all(projectId) as unknown as TranscriptSegment[];
    if (transcripts.length === 0) {
      throw new Error('No translated Myanmar dialogue segments found.');
    }
    const singleVoice = settings.selected_voice || DEFAULT_MYANMAR_VOICE_ID;
    // Enforce Absolute One-Voice Rule before synthesizing
    const enforced = enforceSingleVoiceRule(
      transcripts.map((t) => ({ ...t, voice_name: singleVoice })),
      singleVoice
    );
    if (!checkDubbingVoiceConsistency(enforced, singleVoice)) {
      throw new Error('Absolute One-Voice Rule violation detected.');
    }

    const latestVer = db
      .prepare(`SELECT COALESCE(MAX(version), 0) as v FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment'`)
      .get(projectId) as { v: number };
    const nextVer = (latestVer?.v || 0) + 1;
    const ttsDir = path.join(projectWorkDir, `tts_v${nextVer}`);
    fs.mkdirSync(ttsDir, { recursive: true });

    const ins = db.prepare(
      `INSERT INTO audio_tracks (id, project_id, track_type, segment_index, voice_name, start_sec, end_sec, duration_sec, speed_ratio, file_path, version, created_at)
       VALUES (?, ?, 'tts_segment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let generatedCount = 0;
    let lastModelUsed = '';
    let lastMime = '';
    let lastFormat = '';
    try {
      for (const seg of enforced) {
        const text = (seg.translated_myanmar || seg.original_text || '').trim();
        if (!text) continue;
        const segWav = path.join(ttsDir, `seg_${seg.segment_index}.wav`);
        const ttsRes = await synthesizeMyanmarTTS(text, singleVoice, segWav);
        const targetDur = Math.max(0.5, seg.end_sec - seg.start_sec);
        const ratio = Number((ttsRes.durationSec / targetDur).toFixed(2));
        ins.run(
          `aud_tts_${projectId}_${nextVer}_${seg.segment_index}`,
          projectId,
          seg.segment_index,
          ttsRes.voiceUsed,
          seg.start_sec,
          seg.end_sec,
          ttsRes.durationSec,
          ratio,
          segWav,
          nextVer,
          new Date().toISOString()
        );
        generatedCount += 1;
        lastModelUsed = ttsRes.modelUsed;
        lastMime = ttsRes.mimeType;
        lastFormat = ttsRes.formatUsed;
      }
      if (generatedCount === 0) {
        throw new Error('No non-empty Myanmar dialogue segments were available for TTS generation.');
      }
    } catch (err) {
      // Roll back partial failed version rows while preserving all earlier versions and Steps 1-7 outputs
      db.prepare(`DELETE FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment' AND version = ?`).run(
        projectId,
        nextVer
      );
      throw err;
    }

    return `Generated ${generatedCount} playable Myanmar TTS segments (v${nextVer}, ${lastModelUsed}, ${lastMime} -> ${lastFormat}) strictly using single voice "${singleVoice}".`;
  }

  if (stepKey === 'timing_adjustment') {
    const transcripts = db
      .prepare(`SELECT * FROM transcripts WHERE project_id = ? ORDER BY segment_index ASC`)
      .all(projectId) as unknown as TranscriptSegment[];
    const latestVerRow = db
      .prepare(`SELECT COALESCE(MAX(version), 1) as v FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment'`)
      .get(projectId) as { v: number };
    const ttsRows = db
      .prepare(
        `SELECT id, file_path, start_sec, end_sec, duration_sec FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment' AND version = ? ORDER BY segment_index ASC`
      )
      .all(projectId, latestVerRow.v) as unknown as {
      id: string;
      file_path: string;
      start_sec: number;
      end_sec: number;
      duration_sec: number;
    }[];
    const scheduled = computeNonOverlappingDubbingSchedule(
      ttsRows.map((t) => ({
        filePath: t.file_path,
        startSec: t.start_sec,
        endSec: t.end_sec,
        actualDurationSec: t.duration_sec,
      }))
    );
    const updRatio = db.prepare(`UPDATE audio_tracks SET speed_ratio = ? WHERE id = ?`);
    ttsRows.forEach((row, i) => {
      if (scheduled[i]) {
        updRatio.run(scheduled[i].tempoFactor, row.id);
      }
    });
    const adjustedCount = scheduled.filter((s) => s.tempoFactor > 1.01).length;
    const check = checkAudioGapsAndOverlaps(transcripts);
    return `Timing alignment verified (non-overlap paced: ${adjustedCount} segment(s), transcript overlaps: ${check.overlaps}, long gaps: ${check.gaps}).`;
  }

  if (stepKey === 'audio_mixing' || stepKey === 'video_sync') {
    if (!media || !fs.existsSync(media.file_path)) {
      throw new Error('Source video missing for audio mixing & sync.');
    }
    const latestVerRow = db
      .prepare(`SELECT COALESCE(MAX(version), 1) as v FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment'`)
      .get(projectId) as { v: number };
    const ttsRows = db
      .prepare(
        `SELECT * FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment' AND version = ? ORDER BY segment_index ASC`
      )
      .all(projectId, latestVerRow.v) as unknown as {
      file_path: string;
      start_sec: number;
      end_sec: number;
    }[];
    const musicStem = db
      .prepare(`SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'music_stem' ORDER BY created_at DESC LIMIT 1`)
      .get(projectId) as { file_path: string } | undefined;
    const sfxStem = db
      .prepare(`SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'sfx_stem' ORDER BY created_at DESC LIMIT 1`)
      .get(projectId) as { file_path: string } | undefined;
    const origAudio = db
      .prepare(`SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'original' ORDER BY created_at DESC LIMIT 1`)
      .get(projectId) as { file_path: string } | undefined;

    const dubPreviewOut = path.join(projectWorkDir, 'dubbed_preview.mp4');
    const mixed = await mixAndRenderDubbedMp4({
      videoPath: media.file_path,
      ttsSegments: ttsRows.map((t) => ({ filePath: t.file_path, startSec: t.start_sec, endSec: t.end_sec })),
      musicStemPath: musicStem?.file_path,
      sfxStemPath: sfxStem?.file_path,
      originalAudioPath: origAudio?.file_path,
      restoreOriginalAudio: Boolean(settings.restore_original_audio),
      dialogueVolume: settings.dialogue_volume ?? 1.0,
      bgmVolume: settings.bgm_volume ?? 0.35,
      sfxVolume: settings.sfx_volume ?? 0.75,
      outPath: dubPreviewOut,
      resolution: settings.resolution || '720p',
      fps: settings.fps || 30,
    });
    return `Mixed dubbed dialogue + music + SFX stems and synchronized video preview (${Math.round(mixed.fileSize / 1024)} KB).`;
  }

  if (stepKey === 'preview_review' || stepKey === 'final_review') {
    return 'Ready for final user inspection and explicit export approval.';
  }

  if (stepKey === 'export') {
    return project.approved_for_export
      ? 'Approved for export. Use Export Center or Export panel to render deliverables.'
      : 'Waiting for explicit user review approval before export.';
  }

  return `Completed step ${stepKey}.`;
}

async function executeJobPipeline(jobId: string, startStepNumber: number, singleStepOnly = false) {
  const job = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId) as
    | { id: string; project_id: string; module: ModuleType }
    | undefined;
  if (!job) return;

  const steps = db
    .prepare('SELECT * FROM job_steps WHERE job_id = ? ORDER BY step_number ASC')
    .all(jobId) as unknown as Array<{
    id: string;
    step_number: number;
    step_key: string;
    step_label: string;
    status: string;
  }>;

  updateJobState(jobId, job.project_id, 'Preparing', startStepNumber, Math.round(((startStepNumber - 1) / steps.length) * 100));

  for (const step of steps) {
    if (singleStepOnly && step.step_number !== startStepNumber) continue;
    if (!singleStepOnly && step.step_number < startStepNumber) continue;

    if (isCancelRequested(jobId)) {
      db.prepare(`UPDATE job_steps SET status = 'cancelled' WHERE id = ?`).run(step.id);
      updateJobState(jobId, job.project_id, 'Cancelled', step.step_number, Math.round(((step.step_number - 1) / steps.length) * 100));
      appendJobLog(jobId, `Job cancelled before step ${step.step_number}.`);
      return;
    }

    // Stop auto-advancing at the review gate step so user must explicitly inspect & approve before export
    const isReviewGate = step.step_key === 'preview_review' || step.step_key === 'final_review';
    if (!singleStepOnly && step.step_key === 'export') {
      const proj = db.prepare('SELECT approved_for_export FROM projects WHERE id = ?').get(job.project_id) as {
        approved_for_export: number;
      };
      if (!proj?.approved_for_export) {
        updateJobState(jobId, job.project_id, 'Reviewing', step.step_number - 1, 90);
        appendJobLog(jobId, 'Paused at Review Gate: user approval required prior to Export.');
        return;
      }
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE job_steps SET status = 'running', started_at = ?, error_details = '' WHERE id = ?`).run(
      now,
      step.id
    );
    updateJobState(
      jobId,
      job.project_id,
      'Processing',
      step.step_number,
      Math.round(((step.step_number - 1) / steps.length) * 100)
    );
    appendJobLog(jobId, `Running Step ${step.step_number}: ${step.step_label}...`);

    try {
      const summary = await runSingleStep(job.project_id, job.module, step.step_key);
      db.prepare(`UPDATE job_steps SET status = 'completed', output_summary = ?, completed_at = ? WHERE id = ?`).run(
        summary,
        new Date().toISOString(),
        step.id
      );
      appendJobLog(jobId, `Completed Step ${step.step_number}: ${summary}`);

      if (isReviewGate && !singleStepOnly) {
        updateJobState(jobId, job.project_id, 'Reviewing', step.step_number, 90);
        appendJobLog(jobId, 'Entered Reviewing state. Inspect output and click Approve for Export to unlock deliverables.');
        return;
      }
    } catch (err) {
      const msg = sanitizeErrorMessage(err);
      db.prepare(`UPDATE job_steps SET status = 'failed', error_details = ?, completed_at = ? WHERE id = ?`).run(
        msg,
        new Date().toISOString(),
        step.id
      );
      updateJobState(
        jobId,
        job.project_id,
        'Failed',
        step.step_number,
        Math.round(((step.step_number - 1) / steps.length) * 100),
        msg
      );
      appendJobLog(jobId, `FAILED Step ${step.step_number} (${step.step_label}): ${msg}`);
      return;
    }
  }

  updateJobState(jobId, job.project_id, 'Reviewing', steps.length, 100);
  appendJobLog(jobId, 'Pipeline steps finished. Ready for review & export.');
}
