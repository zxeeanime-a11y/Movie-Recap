import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type {
  ExportFormat,
  FrameRate,
  ModuleType,
  ProjectRecord,
  ProjectSettings,
  ProviderId,
  SubtitleCue,
  VideoResolution,
} from '../src/types/studio';
import {
  autoFixSubtitleOverlaps,
  canEditMyanmarTranslation,
  canExportProject,
  computeSuitableRecapDuration,
  DEFAULT_MYANMAR_VOICE_ID,
  enforceSingleVoiceRule,
  validateMediaUpload,
  validateSubtitles,
} from '../src/utils/studioRules';
import {
  getProviderConfigsForUI,
  saveProviderConfig,
  synthesizeMyanmarTTS,
  testProviderConnection,
} from './aiProviders.ts';
import { sanitizeErrorMessage, signSessionToken, verifySessionToken } from './crypto.ts';
import {
  BACKUPS_ROOT,
  CHUNKS_ROOT,
  DB_PATH,
  db,
  EXPORTS_ROOT,
  MEDIA_ROOT,
  writeAuditLog,
} from './db.ts';
import {
  cancelJob,
  createOrStartProjectJob,
  getLatestProjectJob,
  retrySingleJobStep,
} from './jobRunner.ts';
import {
  assembleRecapMp4,
  generateRealSampleVideo,
  isBinaryAvailable,
  mixAndRenderDubbedMp4,
  probeMedia,
  renderAudioExport,
  renderSubtitleDeliverable,
} from './mediaEngine.ts';

interface AuthedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'editor';
    preferred_lang: 'en' | 'my';
  };
}

const uploadChunkMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per chunk
});

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'local';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > 300) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please slow down requests.' });
  }
  return next();
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie || '';
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return result;
}

function setSessionCookie(res: Response, userId: string, role: string) {
  const token = signSessionToken({
    userId,
    role,
    exp: Date.now() + 7 * 24 * 3600 * 1000,
  });
  res.cookie('ai_studio_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req);
  let verified = verifySessionToken(cookies.ai_studio_session);

  if (!verified) {
    // Bootstrap default local Studio Producer session on first visit unless user explicitly signed out
    if (cookies.ai_studio_signed_out === '1') {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const admin = db.prepare(`SELECT id, role FROM users ORDER BY created_at ASC LIMIT 1`).get() as
      | { id: string; role: string }
      | undefined;
    if (!admin) {
      return res.status(401).json({ error: 'No workspace user found.' });
    }
    setSessionCookie(res, admin.id, admin.role);
    verified = { userId: admin.id, role: admin.role, exp: Date.now() + 3600_000 };
  }

  const user = db
    .prepare(`SELECT id, email, name, role, preferred_lang FROM users WHERE id = ?`)
    .get(verified.userId) as AuthedRequest['authUser'] | undefined;
  if (!user) {
    return res.status(401).json({ error: 'Session user no longer exists.' });
  }
  req.authUser = user;
  return next();
}

function getOwnedProject(projectId: string, userId: string): ProjectRecord | null {
  const row = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const settings = db
    .prepare(`SELECT * FROM project_settings WHERE project_id = ?`)
    .get(projectId) as unknown as ProjectSettings | undefined;
  return {
    ...(row as unknown as ProjectRecord),
    approved_for_export: Boolean(row.approved_for_export),
    translation_locked: Boolean(row.translation_locked),
    settings: settings
      ? {
          ...settings,
          burn_subtitles: Boolean(settings.burn_subtitles),
          restore_original_audio: Boolean(settings.restore_original_audio),
        }
      : undefined,
  };
}

function createProjectVersionSnapshot(projectId: string, userId: string, label: string) {
  const project = getOwnedProject(projectId, userId);
  if (!project) return;
  const subtitles = db.prepare(`SELECT * FROM subtitles WHERE project_id = ?`).all(projectId);
  const scenes = db.prepare(`SELECT * FROM video_scenes WHERE project_id = ?`).all(projectId);
  const latestRecap = db
    .prepare(`SELECT * FROM recap_scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1`)
    .get(projectId);
  const maxVer = db
    .prepare(`SELECT COALESCE(MAX(version_number), 0) as v FROM project_versions WHERE project_id = ?`)
    .get(projectId) as { v: number };
  const nextVer = (maxVer?.v || 0) + 1;

  db.prepare(
    `INSERT INTO project_versions (id, project_id, user_id, version_number, label, snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `ver_${projectId}_${nextVer}`,
    projectId,
    userId,
    nextVer,
    label,
    JSON.stringify({ project, subtitles, scenes, latestRecap }),
    new Date().toISOString()
  );
}

export function createApiRouter() {
  const router = express.Router();
  router.use(rateLimit);

  // ---- AUTHENTICATION ----
  router.get('/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.authUser });
  });

  router.post('/auth/register', (req: Request, res: Response) => {
    const { email, name, password, role } = req.body as {
      email?: string;
      name?: string;
      password?: string;
      role?: 'admin' | 'editor';
    };
    if (!email || !name || !password || password.length < 6) {
      return res.status(400).json({ error: 'Valid email, name, and password (min 6 chars) are required.' });
    }
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const hash = bcrypt.hashSync(password, 10);
    const assignedRole = role === 'admin' ? 'admin' : 'editor';
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, preferred_lang, created_at)
       VALUES (?, ?, ?, ?, ?, 'en', ?)`
    ).run(id, email.toLowerCase(), name.trim(), hash, assignedRole, new Date().toISOString());

    res.clearCookie('ai_studio_signed_out');
    setSessionCookie(res, id, assignedRole);
    writeAuditLog(id, 'USER_REGISTERED', 'user', id, email.toLowerCase(), req.ip);
    res.status(201).json({
      user: { id, email: email.toLowerCase(), name: name.trim(), role: assignedRole, preferred_lang: 'en' },
    });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as
      | {
          id: string;
          email: string;
          name: string;
          password_hash: string;
          role: 'admin' | 'editor';
          preferred_lang: 'en' | 'my';
        }
      | undefined;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    res.clearCookie('ai_studio_signed_out');
    setSessionCookie(res, user.id, user.role);
    writeAuditLog(user.id, 'USER_LOGIN', 'user', user.id, user.email, req.ip);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        preferred_lang: user.preferred_lang,
      },
    });
  });

  router.post('/auth/logout', (req: Request, res: Response) => {
    res.clearCookie('ai_studio_session');
    res.cookie('ai_studio_signed_out', '1', { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  router.post('/auth/quick-demo', (req: Request, res: Response) => {
    const admin = db.prepare(`SELECT id, email, name, role, preferred_lang FROM users ORDER BY created_at ASC LIMIT 1`).get() as
      | AuthedRequest['authUser']
      | undefined;
    if (!admin) return res.status(404).json({ error: 'Default studio profile missing.' });
    res.clearCookie('ai_studio_signed_out');
    setSessionCookie(res, admin.id, admin.role);
    res.json({ user: admin });
  });

  router.patch('/auth/preferences', requireAuth, (req: AuthedRequest, res: Response) => {
    const { preferred_lang } = req.body as { preferred_lang?: 'en' | 'my' };
    if (preferred_lang === 'en' || preferred_lang === 'my') {
      db.prepare(`UPDATE users SET preferred_lang = ? WHERE id = ?`).run(preferred_lang, req.authUser!.id);
    }
    res.json({ ok: true });
  });

  // ---- VOICE PROFILES ----
  router.get('/voices', requireAuth, (_req: AuthedRequest, res: Response) => {
    const voices = db
      .prepare(
        `SELECT *, CASE WHEN voice_id = 'my-MM-NilarNeural' THEN 1 ELSE 0 END as is_default,
                CASE WHEN provider = 'edge-tts' THEN 0 ELSE 1 END as requires_api_key
         FROM voice_profiles
         ORDER BY CASE voice_id
           WHEN 'my-MM-NilarNeural' THEN 1
           WHEN 'my-MM-ThihaNeural' THEN 2
           WHEN 'Kore' THEN 3
           ELSE 4
         END ASC, name ASC`
      )
      .all() as unknown as Record<string, unknown>[];
    res.json({
      voices: voices.map((v) => ({
        ...v,
        is_default: Boolean(v.is_default),
        requires_api_key: Boolean(v.requires_api_key),
      })),
    });
  });

  // ---- ADMIN AI PROVIDER SETTINGS ----
  router.get('/providers', requireAuth, (_req: AuthedRequest, res: Response) => {
    res.json({ providers: getProviderConfigsForUI() });
  });

  router.put('/providers/:provider', requireAuth, (req: AuthedRequest, res: Response) => {
    const provider = req.params.provider as ProviderId;
    if (provider !== 'gemini' && provider !== 'groq') {
      return res.status(400).json({ error: 'Unsupported provider.' });
    }
    try {
      saveProviderConfig(provider, req.body);
      writeAuditLog(req.authUser!.id, 'PROVIDER_UPDATED', 'api_provider', provider, 'Updated model/key config', req.ip);
      res.json({ providers: getProviderConfigsForUI() });
    } catch (err) {
      res.status(400).json({ error: sanitizeErrorMessage(err) });
    }
  });

  router.post('/providers/:provider/test', requireAuth, async (req: AuthedRequest, res: Response) => {
    const provider = req.params.provider as ProviderId;
    if (provider !== 'gemini' && provider !== 'groq') {
      return res.status(400).json({ error: 'Unsupported provider.' });
    }
    const status = await testProviderConnection(provider);
    writeAuditLog(
      req.authUser!.id,
      'PROVIDER_TESTED',
      'api_provider',
      provider,
      `Status: ${status.last_test_status}`,
      req.ip
    );
    res.json({ provider: status });
  });

  // ---- PROJECTS ----
  router.get('/projects', requireAuth, (req: AuthedRequest, res: Response) => {
    const moduleFilter = req.query.module as string | undefined;
    const query = ((req.query.q as string) || '').trim().toLowerCase();

    let rows = db
      .prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC`)
      .all(req.authUser!.id) as unknown as Record<string, unknown>[];

    if (moduleFilter && ['subtitle', 'recap', 'dubbing'].includes(moduleFilter)) {
      rows = rows.filter((r) => r.module === moduleFilter);
    }
    if (query) {
      rows = rows.filter(
        (r) =>
          String(r.name).toLowerCase().includes(query) ||
          String(r.description).toLowerCase().includes(query)
      );
    }

    const enriched = rows.map((r) => {
      const settings = db.prepare(`SELECT * FROM project_settings WHERE project_id = ?`).get(String(r.id));
      const mediaCount = db
        .prepare(`SELECT COUNT(*) as c FROM media_files WHERE project_id = ?`)
        .get(String(r.id)) as { c: number };
      return {
        ...r,
        approved_for_export: Boolean(r.approved_for_export),
        translation_locked: Boolean(r.translation_locked),
        settings,
        mediaCount: mediaCount.c,
      };
    });

    res.json({ projects: enriched });
  });

  router.post('/projects', requireAuth, (req: AuthedRequest, res: Response) => {
    const { module, name, description, settings } = req.body as {
      module?: ModuleType;
      name?: string;
      description?: string;
      settings?: Partial<ProjectSettings>;
    };
    if (!module || !['subtitle', 'recap', 'dubbing'].includes(module)) {
      return res.status(400).json({ error: 'Valid module (subtitle, recap, or dubbing) is required.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required.' });
    }

    const id = `proj_${module}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO projects (id, user_id, module, name, description, status, active_step, approved_for_export, translation_locked, autosave_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Draft', 1, 0, 1, 1, ?, ?)`
    ).run(id, req.authUser!.id, module, name.trim(), (description || '').trim(), now, now);

    db.prepare(
      `INSERT INTO project_settings (
        project_id, source_language, target_language, recap_style, target_platform, output_format,
        processing_mode, selected_voice, target_duration_sec, resolution, fps, burn_subtitles,
        bgm_volume, dialogue_volume, sfx_volume, restore_original_audio, settings_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '{}', ?)`
    ).run(
      id,
      settings?.source_language || 'English',
      settings?.target_language || 'Myanmar',
      settings?.recap_style || 'Dramatic Storyteller',
      settings?.target_platform || 'YouTube (16:9)',
      settings?.output_format || (module === 'subtitle' ? 'mp4_burned' : 'mp4'),
      settings?.processing_mode || 'full',
      settings?.selected_voice || DEFAULT_MYANMAR_VOICE_ID,
      settings?.target_duration_sec || 60,
      settings?.resolution || '720p',
      settings?.fps || 30,
      settings?.burn_subtitles === false ? 0 : 1,
      settings?.bgm_volume ?? 0.35,
      settings?.dialogue_volume ?? 1.0,
      settings?.sfx_volume ?? 0.75,
      now
    );

    createProjectVersionSnapshot(id, req.authUser!.id, 'Initial Project Creation');
    writeAuditLog(req.authUser!.id, 'PROJECT_CREATED', 'project', id, `${module}: ${name.trim()}`, req.ip);

    res.status(201).json({ project: getOwnedProject(id, req.authUser!.id) });
  });

  router.get('/projects/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const media = db
      .prepare(`SELECT * FROM media_files WHERE project_id = ? ORDER BY created_at DESC`)
      .all(project.id);
    const rawScenes = db
      .prepare(`SELECT * FROM video_scenes WHERE project_id = ? ORDER BY scene_index ASC`)
      .all(project.id) as unknown as Record<string, unknown>[];
    const scenes = rawScenes.map((s) => ({
      ...s,
      characters: JSON.parse(String(s.characters_json || '[]')),
      selected: Boolean(s.selected),
    }));
    const transcripts = db
      .prepare(`SELECT * FROM transcripts WHERE project_id = ? ORDER BY segment_index ASC`)
      .all(project.id);
    const rawSubs = db
      .prepare(`SELECT * FROM subtitles WHERE project_id = ? ORDER BY cue_index ASC`)
      .all(project.id) as unknown as Record<string, unknown>[];
    const subtitles = rawSubs.map((c) => ({
      ...c,
      has_overlap: Boolean(c.has_overlap),
      duration_valid: Boolean(c.duration_valid),
      locked: Boolean(c.locked),
    }));
    const rawRecap = db
      .prepare(`SELECT * FROM recap_scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1`)
      .get(project.id) as Record<string, unknown> | undefined;
    const recapScript = rawRecap
      ? {
          ...rawRecap,
          story_arc: JSON.parse(String(rawRecap.story_arc_json || '{}')),
          segments: JSON.parse(String(rawRecap.segments_json || '[]')),
          approved: Boolean(rawRecap.approved),
        }
      : null;
    const audioTracks = db
      .prepare(`SELECT * FROM audio_tracks WHERE project_id = ? ORDER BY created_at DESC, segment_index ASC`)
      .all(project.id);
    const latestJob = getLatestProjectJob(project.id);
    const exports = db
      .prepare(`SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC`)
      .all(project.id);
    const versions = db
      .prepare(`SELECT id, project_id, version_number, label, created_at FROM project_versions WHERE project_id = ? ORDER BY version_number DESC`)
      .all(project.id);

    res.json({
      project,
      media,
      scenes,
      transcripts,
      subtitles,
      recapScript,
      audioTracks,
      latestJob,
      exports,
      versions,
    });
  });

  router.patch('/projects/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { name, description, active_step, expected_version, settings } = req.body as {
      name?: string;
      description?: string;
      active_step?: number;
      expected_version?: number;
      settings?: Partial<ProjectSettings>;
    };

    if (expected_version !== undefined && expected_version < project.autosave_version) {
      return res.status(409).json({
        error: 'Newer saved state exists on server. Reloaded latest version safely.',
        latestVersion: project.autosave_version,
      });
    }

    const now = new Date().toISOString();
    const nextVer = project.autosave_version + 1;
    db.prepare(
      `UPDATE projects SET name = ?, description = ?, active_step = ?, autosave_version = ?, updated_at = ? WHERE id = ?`
    ).run(
      name !== undefined ? name.trim() || project.name : project.name,
      description !== undefined ? description : project.description,
      active_step !== undefined ? active_step : project.active_step,
      nextVer,
      now,
      project.id
    );

    if (settings && project.settings) {
      const s = { ...project.settings, ...settings };
      db.prepare(
        `UPDATE project_settings SET
          source_language = ?, target_language = ?, recap_style = ?, target_platform = ?, output_format = ?,
          processing_mode = ?, selected_voice = ?, target_duration_sec = ?, resolution = ?, fps = ?,
          burn_subtitles = ?, bgm_volume = ?, dialogue_volume = ?, sfx_volume = ?, restore_original_audio = ?, updated_at = ?
         WHERE project_id = ?`
      ).run(
        s.source_language,
        s.target_language,
        s.recap_style,
        s.target_platform,
        s.output_format,
        s.processing_mode,
        s.selected_voice,
        s.target_duration_sec,
        s.resolution,
        s.fps,
        s.burn_subtitles ? 1 : 0,
        s.bgm_volume,
        s.dialogue_volume,
        s.sfx_volume,
        s.restore_original_audio ? 1 : 0,
        now,
        project.id
      );
    }

    res.json({ project: getOwnedProject(project.id, req.authUser!.id) });
  });

  router.delete('/projects/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(project.id);
    writeAuditLog(req.authUser!.id, 'PROJECT_DELETED', 'project', project.id, project.name, req.ip);
    res.json({ ok: true });
  });

  router.post('/projects/:id/approve', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const approved = req.body.approved !== false;
    const now = new Date().toISOString();
    db.prepare(`UPDATE projects SET approved_for_export = ?, status = ?, updated_at = ? WHERE id = ?`).run(
      approved ? 1 : 0,
      approved ? 'Reviewing' : project.status,
      now,
      project.id
    );
    if (approved) {
      createProjectVersionSnapshot(project.id, req.authUser!.id, 'Approved for Export');
    }
    writeAuditLog(req.authUser!.id, approved ? 'EXPORT_APPROVED' : 'EXPORT_REVOKED', 'project', project.id, '', req.ip);
    res.json({ project: getOwnedProject(project.id, req.authUser!.id) });
  });

  router.post('/projects/:id/translation-lock', requireAuth, (req: AuthedRequest, res: Response) => {
    if (req.authUser!.role !== 'admin') {
      return res.status(403).json({ error: 'Only a project administrator can change Myanmar translation lock policy.' });
    }
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const locked = req.body.locked !== false;
    db.prepare(`UPDATE projects SET translation_locked = ?, updated_at = ? WHERE id = ?`).run(
      locked ? 1 : 0,
      new Date().toISOString(),
      project.id
    );
    db.prepare(`UPDATE subtitles SET locked = ? WHERE project_id = ?`).run(locked ? 1 : 0, project.id);
    writeAuditLog(
      req.authUser!.id,
      locked ? 'TRANSLATION_LOCKED' : 'TRANSLATION_UNLOCKED_BY_ADMIN',
      'project',
      project.id,
      '',
      req.ip
    );
    res.json({ project: getOwnedProject(project.id, req.authUser!.id) });
  });

  router.post('/projects/:id/versions', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const label = String(req.body.label || 'Manual Checkpoint').slice(0, 80);
    createProjectVersionSnapshot(project.id, req.authUser!.id, label);
    const versions = db
      .prepare(`SELECT id, project_id, version_number, label, created_at FROM project_versions WHERE project_id = ? ORDER BY version_number DESC`)
      .all(project.id);
    res.status(201).json({ versions });
  });

  router.post('/projects/:id/versions/:versionId/restore', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const ver = db
      .prepare(`SELECT * FROM project_versions WHERE id = ? AND project_id = ?`)
      .get(req.params.versionId, project.id) as { snapshot_json: string; version_number: number } | undefined;
    if (!ver) return res.status(404).json({ error: 'Version snapshot not found.' });

    const snap = JSON.parse(ver.snapshot_json) as {
      project?: ProjectRecord;
      subtitles?: SubtitleCue[];
    };
    if (snap.project) {
      db.prepare(`UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?`).run(
        snap.project.name,
        snap.project.description,
        new Date().toISOString(),
        project.id
      );
    }
    if (snap.subtitles && snap.subtitles.length > 0) {
      db.prepare(`DELETE FROM subtitles WHERE project_id = ?`).run(project.id);
      const ins = db.prepare(
        `INSERT INTO subtitles (id, project_id, cue_index, start_sec, end_sec, source_text, myanmar_text, reading_speed_cps, has_overlap, duration_valid, locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of snap.subtitles) {
        ins.run(
          c.id,
          project.id,
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
    }
    writeAuditLog(req.authUser!.id, 'VERSION_RESTORED', 'project', project.id, `v${ver.version_number}`, req.ip);
    res.json({ ok: true });
  });

  // ---- SUBTITLES & SCENES & RECAP & DUBBING UPDATES ----
  router.patch('/projects/:id/subtitles', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { cues, adminOverride } = req.body as { cues?: SubtitleCue[]; adminOverride?: boolean };
    if (!Array.isArray(cues)) return res.status(400).json({ error: 'cues array required.' });

    const existing = db
      .prepare(`SELECT id, myanmar_text FROM subtitles WHERE project_id = ?`)
      .all(project.id) as unknown as { id: string; myanmar_text: string }[];
    const existingMap = new Map(existing.map((e) => [e.id, e.myanmar_text]));

    const myanmarTextChanged = cues.some((c) => (existingMap.get(c.id) ?? '') !== (c.myanmar_text ?? ''));
    if (myanmarTextChanged) {
      const check = canEditMyanmarTranslation(project, req.authUser!.role, Boolean(adminOverride));
      if (!check.allowed) {
        return res.status(403).json({ error: check.reason });
      }
    }

    const validated = validateSubtitles(cues);
    db.prepare(`DELETE FROM subtitles WHERE project_id = ?`).run(project.id);
    const ins = db.prepare(
      `INSERT INTO subtitles (id, project_id, cue_index, start_sec, end_sec, source_text, myanmar_text, reading_speed_cps, has_overlap, duration_valid, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of validated.cues) {
      ins.run(
        c.id,
        project.id,
        c.cue_index,
        c.start_sec,
        c.end_sec,
        c.source_text,
        c.myanmar_text,
        c.reading_speed_cps,
        c.has_overlap ? 1 : 0,
        c.duration_valid ? 1 : 0,
        project.translation_locked ? 1 : 0
      );
    }

    res.json({ subtitles: validated.cues, summary: validated });
  });

  router.post('/projects/:id/subtitles/fix-overlaps', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const raw = db
      .prepare(`SELECT * FROM subtitles WHERE project_id = ? ORDER BY cue_index ASC`)
      .all(project.id) as unknown as SubtitleCue[];
    const fixed = autoFixSubtitleOverlaps(raw);
    const upd = db.prepare(
      `UPDATE subtitles SET start_sec = ?, end_sec = ?, reading_speed_cps = ?, has_overlap = ?, duration_valid = ? WHERE id = ?`
    );
    for (const c of fixed) {
      upd.run(c.start_sec, c.end_sec, c.reading_speed_cps, c.has_overlap ? 1 : 0, c.duration_valid ? 1 : 0, c.id);
    }
    res.json({ subtitles: fixed });
  });

  router.patch('/projects/:id/scenes/:sceneId', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { selected, action_summary, important_events } = req.body as {
      selected?: boolean;
      action_summary?: string;
      important_events?: string;
    };
    const scene = db
      .prepare(`SELECT * FROM video_scenes WHERE id = ? AND project_id = ?`)
      .get(req.params.sceneId, project.id) as Record<string, unknown> | undefined;
    if (!scene) return res.status(404).json({ error: 'Scene not found.' });

    db.prepare(
      `UPDATE video_scenes SET selected = ?, action_summary = ?, important_events = ?, updated_at = ? WHERE id = ?`
    ).run(
      selected !== undefined ? (selected ? 1 : 0) : Number(scene.selected),
      action_summary !== undefined ? action_summary : String(scene.action_summary || ''),
      important_events !== undefined ? important_events : String(scene.important_events || ''),
      new Date().toISOString(),
      req.params.sceneId
    );

    const allScenes = db
      .prepare(`SELECT * FROM video_scenes WHERE project_id = ? ORDER BY scene_index ASC`)
      .all(project.id) as unknown as Record<string, unknown>[];
    const mapped = allScenes.map((s) => ({
      ...s,
      characters: JSON.parse(String(s.characters_json || '[]')),
      selected: Boolean(s.selected),
    }));
    res.json({ scenes: mapped });
  });

  router.patch('/projects/:id/recap-script', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const { full_myanmar_script, title_suggestion, caption_suggestion, approved } = req.body as {
      full_myanmar_script?: string;
      title_suggestion?: string;
      caption_suggestion?: string;
      approved?: boolean;
    };
    const latest = db
      .prepare(`SELECT * FROM recap_scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1`)
      .get(project.id) as Record<string, unknown> | undefined;
    if (!latest) return res.status(404).json({ error: 'Recap script not generated yet.' });

    const nextText = full_myanmar_script ?? String(latest.full_myanmar_script);
    const rawScenes = db
      .prepare(`SELECT * FROM video_scenes WHERE project_id = ? ORDER BY scene_index ASC`)
      .all(project.id) as unknown as Record<string, unknown>[];
    const dur = computeSuitableRecapDuration({
      scenes: rawScenes.map((s) => ({
        ...(s as unknown as Parameters<typeof computeSuitableRecapDuration>[0]['scenes'][number]),
        selected: Boolean(s.selected),
      })),
      myanmarScript: nextText,
    });

    db.prepare(
      `UPDATE recap_scripts SET full_myanmar_script = ?, title_suggestion = ?, caption_suggestion = ?, estimated_duration_sec = ?, approved = ? WHERE id = ?`
    ).run(
      nextText,
      title_suggestion ?? String(latest.title_suggestion),
      caption_suggestion ?? String(latest.caption_suggestion),
      dur.recommendedSec,
      approved !== undefined ? (approved ? 1 : 0) : Number(latest.approved),
      String(latest.id)
    );
    db.prepare(`UPDATE project_settings SET target_duration_sec = ? WHERE project_id = ?`).run(
      dur.recommendedSec,
      project.id
    );
    res.json({ ok: true, recommendedSec: dur.recommendedSec });
  });

  router.post('/projects/:id/dubbing/voice', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const { voice_id } = req.body as { voice_id?: string };
    if (!voice_id) return res.status(400).json({ error: 'voice_id is required.' });

    // Enforce Absolute One-Voice Rule: update single project voice while preserving prior audio track versions
    const normalized = enforceSingleVoiceRule([{ speaker_id: 'ALL', voice_name: voice_id }], voice_id);
    const chosenVoice = normalized[0].voice_name!;

    db.prepare(`UPDATE project_settings SET selected_voice = ?, updated_at = ? WHERE project_id = ?`).run(
      chosenVoice,
      new Date().toISOString(),
      project.id
    );
    writeAuditLog(
      req.authUser!.id,
      'DUBBING_SINGLE_VOICE_SET',
      'project',
      project.id,
      `Voice set to ${chosenVoice} (all characters)`,
      req.ip
    );
    res.json({ project: getOwnedProject(project.id, req.authUser!.id) });
  });

  // ---- MYANMAR TTS TEST ENDPOINT (API-KEY-FREE EDGE TTS + GEMINI TTS) ----
  router.post('/tts/test', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { text, voice_id } = req.body as { text?: string; voice_id?: string };
    const sampleText = (text || 'မြန်မာဘာသာဖြင့် အသံထုတ်လုပ်ရန် စာသား').trim();
    const chosenVoice = (voice_id || DEFAULT_MYANMAR_VOICE_ID).trim() || DEFAULT_MYANMAR_VOICE_ID;
    const ttsTestDir = path.join(MEDIA_ROOT, 'tts_tests');
    fs.mkdirSync(ttsTestDir, { recursive: true });
    const safeVoiceSlug = chosenVoice.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `tts_test_${safeVoiceSlug}_${Date.now()}.wav`;
    const outPath = path.join(ttsTestDir, filename);

    try {
      const result = await synthesizeMyanmarTTS(sampleText, chosenVoice, outPath);
      writeAuditLog(
        req.authUser!.id,
        'MYANMAR_TTS_TEST',
        'tts',
        filename,
        `provider=${result.providerUsed}, model=${result.modelUsed}, voice=${result.voiceUsed}, duration=${result.durationSec}s`,
        req.ip
      );
      res.json({
        ok: true,
        ...result,
        audioUrl: `/api/tts/test/${filename}`,
      });
    } catch (err) {
      const msg = sanitizeErrorMessage(err);
      res.status(400).json({ error: msg });
    }
  });

  router.get('/tts/test/:filename', requireAuth, (req: AuthedRequest, res: Response) => {
    const safeFile = path.basename(req.params.filename);
    const target = path.join(MEDIA_ROOT, 'tts_tests', safeFile);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'TTS test audio file not found.' });
    }
    res.sendFile(target);
  });

  // ---- MEDIA LIBRARY & CHUNKED RESUMABLE UPLOAD ----
  router.get('/media', requireAuth, (req: AuthedRequest, res: Response) => {
    const media = db
      .prepare(`SELECT * FROM media_files WHERE user_id = ? ORDER BY created_at DESC`)
      .all(req.authUser!.id);
    res.json({ media });
  });

  router.post('/media/upload/init', requireAuth, (req: AuthedRequest, res: Response) => {
    const { filename, mimeType, sizeBytes, sha256, projectId } = req.body as {
      filename?: string;
      mimeType?: string;
      sizeBytes?: number;
      sha256?: string;
      projectId?: string;
    };

    const check = validateMediaUpload(filename || '', mimeType || '', Number(sizeBytes || 0));
    if (!check.valid || !check.category) {
      return res.status(400).json({ error: check.error });
    }

    if (projectId && !getOwnedProject(projectId, req.authUser!.id)) {
      return res.status(403).json({ error: 'Project access denied.' });
    }

    // Duplicate detection via SHA-256 hash
    if (sha256) {
      const dup = db
        .prepare(`SELECT * FROM media_files WHERE user_id = ? AND sha256 = ? LIMIT 1`)
        .get(req.authUser!.id, sha256) as Record<string, unknown> | undefined;
      if (dup && fs.existsSync(String(dup.file_path))) {
        return res.json({ duplicate: true, media: dup });
      }
    }

    const uploadId = `upl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const chunkDir = path.join(CHUNKS_ROOT, uploadId);
    fs.mkdirSync(chunkDir, { recursive: true });
    fs.writeFileSync(
      path.join(chunkDir, 'meta.json'),
      JSON.stringify({
        uploadId,
        userId: req.authUser!.id,
        projectId: projectId || null,
        filename,
        mimeType: mimeType || 'application/octet-stream',
        category: check.category,
        sizeBytes,
        sha256: sha256 || '',
      })
    );

    res.json({ duplicate: false, uploadId, category: check.category });
  });

  router.post(
    '/media/upload/chunk',
    requireAuth,
    uploadChunkMulter.single('chunk'),
    (req: AuthedRequest, res: Response) => {
      const { uploadId, chunkIndex } = req.body as { uploadId?: string; chunkIndex?: string };
      if (!uploadId || chunkIndex === undefined || !req.file) {
        return res.status(400).json({ error: 'uploadId, chunkIndex, and chunk binary are required.' });
      }
      const chunkDir = path.join(CHUNKS_ROOT, path.basename(uploadId));
      const metaPath = path.join(chunkDir, 'meta.json');
      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ error: 'Upload session not found or cancelled.' });
      }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { userId: string };
      if (meta.userId !== req.authUser!.id) {
        return res.status(403).json({ error: 'Upload ownership mismatch.' });
      }

      fs.writeFileSync(path.join(chunkDir, `part_${String(Number(chunkIndex)).padStart(6, '0')}`), req.file.buffer);
      res.json({ ok: true, chunkIndex: Number(chunkIndex) });
    }
  );

  router.post('/media/upload/complete', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { uploadId, storageMode } = req.body as { uploadId?: string; storageMode?: 'local' | 'cloud' };
    if (!uploadId) return res.status(400).json({ error: 'uploadId required.' });

    const chunkDir = path.join(CHUNKS_ROOT, path.basename(uploadId));
    const metaPath = path.join(chunkDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Upload session expired.' });

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
      userId: string;
      projectId: string | null;
      filename: string;
      mimeType: string;
      category: string;
      sha256: string;
    };
    if (meta.userId !== req.authUser!.id) return res.status(403).json({ error: 'Forbidden.' });

    const partFiles = fs
      .readdirSync(chunkDir)
      .filter((f) => f.startsWith('part_'))
      .sort();
    if (partFiles.length === 0) return res.status(400).json({ error: 'No uploaded chunks found.' });

    const targetDir = path.join(MEDIA_ROOT, meta.projectId || 'library');
    fs.mkdirSync(targetDir, { recursive: true });
    const safeName = `${Date.now()}_${path.basename(meta.filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const finalPath = path.join(targetDir, safeName);

    const writeStream = fs.createWriteStream(finalPath);
    const hasher = crypto.createHash('sha256');
    for (const part of partFiles) {
      const buf = fs.readFileSync(path.join(chunkDir, part));
      hasher.update(buf);
      writeStream.write(buf);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    fs.rmSync(chunkDir, { recursive: true, force: true });

    const fileSha = meta.sha256 || hasher.digest('hex');
    const stat = fs.statSync(finalPath);

    let probed = { duration_sec: 0, width: 0, height: 0, fps: 0, codec: '' };
    if (meta.category === 'video' || meta.category === 'audio') {
      try {
        probed = await probeMedia(finalPath);
      } catch (err) {
        fs.unlinkSync(finalPath);
        return res.status(400).json({ error: sanitizeErrorMessage(err) });
      }
    }

    const mediaId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.prepare(
      `INSERT INTO media_files (id, user_id, project_id, filename, original_name, mime_type, media_type, size_bytes, sha256, storage_mode, file_path, duration_sec, width, height, fps, codec, upload_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
      mediaId,
      req.authUser!.id,
      meta.projectId,
      safeName,
      meta.filename,
      meta.mimeType,
      meta.category,
      stat.size,
      fileSha,
      storageMode === 'cloud' ? 'cloud' : 'local',
      finalPath,
      probed.duration_sec,
      probed.width,
      probed.height,
      probed.fps,
      probed.codec,
      new Date().toISOString()
    );

    writeAuditLog(req.authUser!.id, 'MEDIA_UPLOADED', 'media', mediaId, meta.filename, req.ip);
    const media = db.prepare(`SELECT * FROM media_files WHERE id = ?`).get(mediaId);
    res.status(201).json({ media });
  });

  router.post('/media/upload/cancel', requireAuth, (req: AuthedRequest, res: Response) => {
    const { uploadId } = req.body as { uploadId?: string };
    if (uploadId) {
      const chunkDir = path.join(CHUNKS_ROOT, path.basename(uploadId));
      fs.rmSync(chunkDir, { recursive: true, force: true });
    }
    res.json({ ok: true });
  });

  router.post('/media/generate-sample', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { projectId } = req.body as { projectId?: string };
    if (projectId && !getOwnedProject(projectId, req.authUser!.id)) {
      return res.status(403).json({ error: 'Project access denied.' });
    }
    const targetDir = path.join(MEDIA_ROOT, projectId || 'library');
    fs.mkdirSync(targetDir, { recursive: true });
    const filename = `sample_mystery_clip_${Date.now()}.mp4`;
    const outPath = path.join(targetDir, filename);

    await generateRealSampleVideo(outPath);
    const meta = await probeMedia(outPath);
    const buf = fs.readFileSync(outPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    const mediaId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.prepare(
      `INSERT INTO media_files (id, user_id, project_id, filename, original_name, mime_type, media_type, size_bytes, sha256, storage_mode, file_path, duration_sec, width, height, fps, codec, upload_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'video/mp4', 'video', ?, ?, 'local', ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
      mediaId,
      req.authUser!.id,
      projectId || null,
      filename,
      'Midnight_Vault_Sample.mp4',
      buf.length,
      sha256,
      outPath,
      meta.duration_sec,
      meta.width,
      meta.height,
      meta.fps,
      meta.codec,
      new Date().toISOString()
    );

    const media = db.prepare(`SELECT * FROM media_files WHERE id = ?`).get(mediaId);
    res.status(201).json({ media });
  });

  router.post('/media/:id/attach', requireAuth, (req: AuthedRequest, res: Response) => {
    const { projectId } = req.body as { projectId?: string };
    if (!projectId || !getOwnedProject(projectId, req.authUser!.id)) {
      return res.status(403).json({ error: 'Project not found.' });
    }
    const media = db
      .prepare(`SELECT * FROM media_files WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.authUser!.id);
    if (!media) return res.status(404).json({ error: 'Media file not found.' });
    db.prepare(`UPDATE media_files SET project_id = ? WHERE id = ?`).run(projectId, req.params.id);
    res.json({ ok: true });
  });

  router.delete('/media/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const media = db
      .prepare(`SELECT * FROM media_files WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.authUser!.id) as { file_path: string } | undefined;
    if (!media) return res.status(404).json({ error: 'Media not found.' });
    if (fs.existsSync(media.file_path)) {
      try {
        fs.unlinkSync(media.file_path);
      } catch {
        // ignore if already removed
      }
    }
    db.prepare(`DELETE FROM media_files WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Protected HTTP Range streaming for video/audio preview
  router.get('/media/:id/stream', requireAuth, (req: AuthedRequest, res: Response) => {
    const media = db
      .prepare(`SELECT * FROM media_files WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.authUser!.id) as { file_path: string; mime_type: string } | undefined;
    if (!media || !fs.existsSync(media.file_path)) {
      return res.status(404).json({ error: 'Media file not found.' });
    }

    const stat = fs.statSync(media.file_path);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': media.mime_type || 'video/mp4',
      });
      fs.createReadStream(media.file_path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': media.mime_type || 'video/mp4',
      });
      fs.createReadStream(media.file_path).pipe(res);
    }
  });

  // Stream rendered preview (recap_preview.mp4 / dubbed_preview.mp4)
  router.get('/projects/:id/preview-video', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const candidate =
      project.module === 'recap'
        ? path.join(MEDIA_ROOT, project.id, 'recap_preview.mp4')
        : project.module === 'dubbing'
          ? path.join(MEDIA_ROOT, project.id, 'dubbed_preview.mp4')
          : '';
    if (!candidate || !fs.existsSync(candidate)) {
      return res.status(404).json({ error: 'Rendered preview not created yet.' });
    }
    const stat = fs.statSync(candidate);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(candidate, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
      fs.createReadStream(candidate).pipe(res);
    }
  });

  router.get('/scenes/:id/keyframe', requireAuth, (req: AuthedRequest, res: Response) => {
    const scene = db
      .prepare(
        `SELECT vs.keyframe_path, p.user_id FROM video_scenes vs JOIN projects p ON p.id = vs.project_id WHERE vs.id = ?`
      )
      .get(req.params.id) as { keyframe_path: string; user_id: string } | undefined;
    if (!scene || scene.user_id !== req.authUser!.id || !fs.existsSync(scene.keyframe_path)) {
      return res.status(404).json({ error: 'Keyframe not found.' });
    }
    res.sendFile(scene.keyframe_path);
  });

  router.get('/audio/:id/stream', requireAuth, (req: AuthedRequest, res: Response) => {
    const track = db
      .prepare(
        `SELECT at.file_path, p.user_id FROM audio_tracks at JOIN projects p ON p.id = at.project_id WHERE at.id = ?`
      )
      .get(req.params.id) as { file_path: string; user_id: string } | undefined;
    if (!track || track.user_id !== req.authUser!.id || !fs.existsSync(track.file_path)) {
      return res.status(404).json({ error: 'Audio track not found.' });
    }
    res.sendFile(track.file_path);
  });

  // ---- BACKGROUND JOBS ----
  router.get('/jobs', requireAuth, (req: AuthedRequest, res: Response) => {
    const jobs = db
      .prepare(`SELECT * FROM processing_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(req.authUser!.id) as unknown as Record<string, unknown>[];
    res.json({
      jobs: jobs.map((j) => ({
        ...j,
        logs: JSON.parse(String(j.logs_json || '[]')),
        cancel_requested: Boolean(j.cancel_requested),
      })),
    });
  });

  router.post('/projects/:id/jobs/start', requireAuth, (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    try {
      const fromStep = Number(req.body.fromStep || 1);
      const job = createOrStartProjectJob(project.id, req.authUser!.id, fromStep);
      res.status(201).json({ job });
    } catch (err) {
      res.status(409).json({ error: sanitizeErrorMessage(err) });
    }
  });

  router.post('/jobs/:jobId/retry-step', requireAuth, (req: AuthedRequest, res: Response) => {
    const stepNumber = Number(req.body.stepNumber);
    if (!stepNumber) return res.status(400).json({ error: 'stepNumber is required.' });
    try {
      const job = retrySingleJobStep(req.params.jobId, req.authUser!.id, stepNumber);
      res.json({ job });
    } catch (err) {
      res.status(400).json({ error: sanitizeErrorMessage(err) });
    }
  });

  router.post('/jobs/:jobId/cancel', requireAuth, (req: AuthedRequest, res: Response) => {
    try {
      const job = cancelJob(req.params.jobId, req.authUser!.id);
      res.json({ job });
    } catch (err) {
      res.status(400).json({ error: sanitizeErrorMessage(err) });
    }
  });

  // ---- EXPORTS ----
  router.get('/exports', requireAuth, (req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT e.*, p.name as project_name FROM exports e JOIN projects p ON p.id = e.project_id WHERE e.user_id = ? ORDER BY e.created_at DESC`
      )
      .all(req.authUser!.id);
    res.json({ exports: rows });
  });

  router.post('/projects/:id/exports', requireAuth, async (req: AuthedRequest, res: Response) => {
    const project = getOwnedProject(req.params.id, req.authUser!.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { format, resolution, fps } = req.body as {
      format?: ExportFormat;
      resolution?: VideoResolution;
      fps?: FrameRate;
    };
    const chosenFormat = (format || 'mp4') as ExportFormat;
    const chosenRes = resolution || project.settings?.resolution || '720p';
    const chosenFps = Number(fps || project.settings?.fps || 30) as FrameRate;

    const media = db
      .prepare(
        `SELECT * FROM media_files WHERE project_id = ? AND media_type IN ('video','audio') ORDER BY created_at DESC LIMIT 1`
      )
      .get(project.id) as { file_path: string } | undefined;

    const subtitles = db
      .prepare(`SELECT * FROM subtitles WHERE project_id = ? ORDER BY cue_index ASC`)
      .all(project.id) as unknown as SubtitleCue[];
    const recapScript = db
      .prepare(`SELECT * FROM recap_scripts WHERE project_id = ? ORDER BY version DESC LIMIT 1`)
      .get(project.id) as { id: string; title_suggestion: string } | undefined;
    const ttsTracks = db
      .prepare(`SELECT * FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment'`)
      .all(project.id) as unknown as { file_path: string; start_sec: number; end_sec: number }[];

    const hasOutput =
      project.module === 'subtitle'
        ? subtitles.length > 0
        : project.module === 'recap'
          ? Boolean(recapScript)
          : ttsTracks.length > 0 || Boolean(project.settings?.restore_original_audio);

    const gate = canExportProject(project, Boolean(media && fs.existsSync(media.file_path)), hasOutput);
    if (!gate.allowed) {
      return res.status(403).json({ error: gate.reason });
    }

    const exportId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const extMap: Record<string, string> = {
      srt: 'srt',
      ass: 'ass',
      vtt: 'vtt',
      mp3: 'mp3',
      wav: 'wav',
      aac: 'aac',
      mp4: 'mp4',
      mp4_burned: 'mp4',
      mp4_embedded: 'mp4',
    };
    const fileExt = extMap[chosenFormat] || 'mp4';
    const outDir = path.join(EXPORTS_ROOT, project.id);
    const outPath = path.join(outDir, `${project.module}_${chosenFormat}_${exportId}.${fileExt}`);

    db.prepare(
      `INSERT INTO exports (id, user_id, project_id, module, format, resolution, fps, file_path, file_size, status, error_message, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'rendering', '', ?, ?)`
    ).run(
      exportId,
      req.authUser!.id,
      project.id,
      project.module,
      chosenFormat,
      chosenRes,
      chosenFps,
      outPath,
      JSON.stringify({ module: project.module, approved: true }),
      new Date().toISOString()
    );

    try {
      let fileSize = 0;
      if (['mp3', 'wav', 'aac'].includes(chosenFormat)) {
        const audioCandidate =
          project.module === 'recap'
            ? (
                db
                  .prepare(
                    `SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'recap_voiceover' ORDER BY created_at DESC LIMIT 1`
                  )
                  .get(project.id) as { file_path: string } | undefined
              )?.file_path || media!.file_path
            : project.module === 'dubbing' && fs.existsSync(path.join(MEDIA_ROOT, project.id, 'dubbed_preview.mp4'))
              ? path.join(MEDIA_ROOT, project.id, 'dubbed_preview.mp4')
              : media!.file_path;

        const resAudio = await renderAudioExport(audioCandidate, chosenFormat as 'mp3' | 'wav' | 'aac', outPath);
        fileSize = resAudio.fileSize;
      } else if (project.module === 'subtitle') {
        const resSub = await renderSubtitleDeliverable({
          format: chosenFormat,
          cues: subtitles,
          projectName: project.name,
          outPath,
          videoPath: media?.file_path,
          resolution: chosenRes,
          fps: chosenFps,
        });
        fileSize = resSub.fileSize;
      } else if (project.module === 'recap') {
        const scenes = db
          .prepare(
            `SELECT start_sec, end_sec FROM video_scenes WHERE project_id = ? AND selected = 1 ORDER BY scene_index ASC`
          )
          .all(project.id) as unknown as { start_sec: number; end_sec: number }[];
        const voTrack = db
          .prepare(
            `SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'recap_voiceover' ORDER BY created_at DESC LIMIT 1`
          )
          .get(project.id) as { file_path: string } | undefined;
        const resRecap = await assembleRecapMp4({
          videoPath: media!.file_path,
          selectedScenes: scenes,
          narrationWavPath: voTrack?.file_path,
          subtitles,
          outPath,
          resolution: chosenRes,
          fps: chosenFps,
          burnSubtitles: Boolean(project.settings?.burn_subtitles),
          bgmVolume: project.settings?.bgm_volume ?? 0.25,
        });
        fileSize = resRecap.fileSize;
      } else {
        const musicStem = db
          .prepare(
            `SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'music_stem' ORDER BY created_at DESC LIMIT 1`
          )
          .get(project.id) as { file_path: string } | undefined;
        const sfxStem = db
          .prepare(
            `SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'sfx_stem' ORDER BY created_at DESC LIMIT 1`
          )
          .get(project.id) as { file_path: string } | undefined;
        const origAudio = db
          .prepare(
            `SELECT file_path FROM audio_tracks WHERE project_id = ? AND track_type = 'original' ORDER BY created_at DESC LIMIT 1`
          )
          .get(project.id) as { file_path: string } | undefined;
        const latestVerRow = db
          .prepare(
            `SELECT COALESCE(MAX(version), 1) as v FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment'`
          )
          .get(project.id) as { v: number };
        const latestTts = db
          .prepare(
            `SELECT file_path, start_sec, end_sec FROM audio_tracks WHERE project_id = ? AND track_type = 'tts_segment' AND version = ? ORDER BY segment_index ASC`
          )
          .all(project.id, latestVerRow.v) as unknown as { file_path: string; start_sec: number; end_sec: number }[];

        const resDub = await mixAndRenderDubbedMp4({
          videoPath: media!.file_path,
          ttsSegments: latestTts.map((t) => ({ filePath: t.file_path, startSec: t.start_sec, endSec: t.end_sec })),
          musicStemPath: musicStem?.file_path,
          sfxStemPath: sfxStem?.file_path,
          originalAudioPath: origAudio?.file_path,
          restoreOriginalAudio: Boolean(project.settings?.restore_original_audio),
          dialogueVolume: project.settings?.dialogue_volume ?? 1.0,
          bgmVolume: project.settings?.bgm_volume ?? 0.35,
          sfxVolume: project.settings?.sfx_volume ?? 0.75,
          outPath,
          resolution: chosenRes,
          fps: chosenFps,
        });
        fileSize = resDub.fileSize;
      }

      db.prepare(`UPDATE exports SET status = 'completed', file_size = ? WHERE id = ?`).run(fileSize, exportId);
      db.prepare(`UPDATE projects SET status = 'Completed', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        project.id
      );
      writeAuditLog(req.authUser!.id, 'EXPORT_COMPLETED', 'export', exportId, `${chosenFormat} (${fileSize} bytes)`, req.ip);

      const record = db.prepare(`SELECT * FROM exports WHERE id = ?`).get(exportId);
      res.status(201).json({ export: record });
    } catch (err) {
      const msg = sanitizeErrorMessage(err);
      db.prepare(`UPDATE exports SET status = 'failed', error_message = ? WHERE id = ?`).run(msg, exportId);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/exports/:id/download', requireAuth, (req: AuthedRequest, res: Response) => {
    const row = db
      .prepare(`SELECT * FROM exports WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.authUser!.id) as { file_path: string; format: string } | undefined;
    if (!row || !fs.existsSync(row.file_path)) {
      return res.status(404).json({ error: 'Export deliverable not found.' });
    }
    res.download(row.file_path, path.basename(row.file_path));
  });

  // ---- SYSTEM SETTINGS, WORKERS, AUDIT LOGS & BACKUP ----
  router.get('/system/info', requireAuth, async (req: AuthedRequest, res: Response) => {
    const [ffmpegOk, ffprobeOk, demucsOk] = await Promise.all([
      isBinaryAvailable('ffmpeg'),
      isBinaryAvailable('ffprobe'),
      isBinaryAvailable('demucs'),
    ]);
    const logs = db
      .prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`)
      .all(req.authUser!.id);
    const backups = fs.existsSync(BACKUPS_ROOT)
      ? fs
          .readdirSync(BACKUPS_ROOT)
          .filter((f) => f.endsWith('.db'))
          .sort()
          .reverse()
      : [];

    res.json({
      engines: {
        ffmpeg: ffmpegOk,
        ffprobe: ffprobeOk,
        demucs: demucsOk,
        audioSeparatorActive: demucsOk ? 'Demucs v4' : 'FFmpeg Spectral Separator (Local)',
        localWorkerContract: 'Local CLI Companion / Server Worker Ready',
      },
      auditLogs: logs,
      backups,
    });
  });

  router.post('/system/backup', requireAuth, (req: AuthedRequest, res: Response) => {
    const filename = `studio_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const dest = path.join(BACKUPS_ROOT, filename);
    fs.copyFileSync(DB_PATH, dest);
    writeAuditLog(req.authUser!.id, 'DATABASE_BACKUP', 'system', filename, 'SQLite snapshot saved', req.ip);
    res.status(201).json({ backup: filename });
  });

  return router;
}
