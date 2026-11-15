import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { EdgeTTS } from 'node-edge-tts';
import type { ProviderConfigStatus, ProviderId, StoryArc } from '../src/types/studio';
import { DEFAULT_MYANMAR_VOICE_ID } from '../src/utils/studioRules';
import { decryptSecret, encryptSecret, maskApiKey, sanitizeErrorMessage } from './crypto.ts';
import { db } from './db.ts';
import { convertAudioToPlayableWav, ensurePlayableWavFromGeminiAudio } from './mediaEngine.ts';

export const GEMINI_MODELS = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Fast Multimodal & Reasoning)', capabilities: ['text', 'vision', 'json', 'translation'] },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Low-Latency Text)', capabilities: ['text', 'json', 'translation'] },
  { id: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Transcribe (Audio Transcription)', capabilities: ['audio_transcribe'] },
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash Lite TTS (Myanmar Speech)', capabilities: ['tts'] },
  { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS (Expressive Narration)', capabilities: ['tts'] },
];

export const GROQ_MODELS = [
  { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Fast Speech Transcription)', capabilities: ['audio_transcribe'] },
  { id: 'whisper-large-v3', label: 'Whisper Large v3 (High Accuracy Transcription)', capabilities: ['audio_transcribe'] },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (Fast Text Processing)', capabilities: ['text', 'json'] },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Ultra-Fast Text)', capabilities: ['text'] },
  { id: 'openai/gpt-oss-120b', label: 'OpenAI GPT-OSS 120B (Groq Reasoning)', capabilities: ['text', 'json'] },
  { id: 'openai/gpt-oss-20b', label: 'OpenAI GPT-OSS 20B (Fast Text Processing)', capabilities: ['text', 'json'] },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Multilingual Fast Text)', capabilities: ['text', 'json'] },
  { id: 'allam-2-7b', label: 'ALLaM 2 7B (Fast Text Processing)', capabilities: ['text'] },
];

interface ProviderRow {
  provider: ProviderId;
  encrypted_key: string;
  masked_key: string;
  selected_model: string;
  tts_model: string;
  transcribe_model: string;
  llm_model: string;
  last_test_status: 'untested' | 'connected' | 'error';
  last_test_at: string | null;
  last_error: string;
  latency_ms: number | null;
  updated_at: string;
}

export function resolveProviderApiKey(provider: ProviderId): {
  apiKey: string;
  source: 'env' | 'vault' | 'none';
} {
  const row = db.prepare('SELECT encrypted_key FROM api_providers WHERE provider = ?').get(provider) as
    | { encrypted_key: string }
    | undefined;
  if (row?.encrypted_key) {
    const decrypted = decryptSecret(row.encrypted_key);
    if (decrypted) {
      return { apiKey: decrypted, source: 'vault' };
    }
  }

  const envKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;
  if (envKey && envKey.trim() && !envKey.startsWith('MY_')) {
    return { apiKey: envKey.trim(), source: 'env' };
  }
  return { apiKey: '', source: 'none' };
}

export function getProviderConfigsForUI(): ProviderConfigStatus[] {
  const rows = db.prepare('SELECT * FROM api_providers').all() as unknown as ProviderRow[];
  return rows.map((row) => {
    const resolved = resolveProviderApiKey(row.provider);
    return {
      provider: row.provider,
      configured: Boolean(resolved.apiKey),
      source: resolved.source,
      masked_key: resolved.apiKey ? maskApiKey(resolved.apiKey) : '',
      selected_model: row.selected_model,
      tts_model: row.tts_model,
      transcribe_model: row.transcribe_model,
      llm_model: row.llm_model,
      last_test_status: row.last_test_status,
      last_test_at: row.last_test_at,
      last_error: row.last_error,
      latency_ms: row.latency_ms,
      available_models: row.provider === 'gemini' ? GEMINI_MODELS : GROQ_MODELS,
    };
  });
}

export function saveProviderConfig(
  provider: ProviderId,
  updates: {
    apiKey?: string;
    clearKey?: boolean;
    selected_model?: string;
    tts_model?: string;
    transcribe_model?: string;
    llm_model?: string;
  }
) {
  const existing = db.prepare('SELECT * FROM api_providers WHERE provider = ?').get(provider) as
    | ProviderRow
    | undefined;
  if (!existing) throw new Error(`Unknown provider: ${provider}`);

  let encryptedKey = existing.encrypted_key;
  let maskedKey = existing.masked_key;

  if (updates.clearKey) {
    encryptedKey = '';
    maskedKey = '';
  } else if (updates.apiKey && updates.apiKey.trim()) {
    const trimmed = updates.apiKey.trim();
    encryptedKey = encryptSecret(trimmed);
    maskedKey = maskApiKey(trimmed);
  }

  db.prepare(
    `UPDATE api_providers
     SET encrypted_key = ?, masked_key = ?, selected_model = ?, tts_model = ?, transcribe_model = ?, llm_model = ?, updated_at = ?
     WHERE provider = ?`
  ).run(
    encryptedKey,
    maskedKey,
    updates.selected_model || existing.selected_model,
    updates.tts_model ?? existing.tts_model,
    updates.transcribe_model ?? existing.transcribe_model,
    updates.llm_model ?? existing.llm_model,
    new Date().toISOString(),
    provider
  );
}

function getGeminiClient(apiVersion?: string): { ai: GoogleGenAI; config: ProviderRow } {
  const { apiKey } = resolveProviderApiKey('gemini');
  if (!apiKey) {
    throw new Error('Google Gemini API key is not configured. Add it in AI Settings or environment secrets.');
  }
  const row = db.prepare('SELECT * FROM api_providers WHERE provider = ?').get('gemini') as unknown as ProviderRow;
  const ai = new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return { ai, config: row };
}

export async function testProviderConnection(provider: ProviderId): Promise<ProviderConfigStatus> {
  const started = Date.now();
  const now = new Date().toISOString();
  const resolved = resolveProviderApiKey(provider);

  if (!resolved.apiKey) {
    const errMsg = `${provider === 'gemini' ? 'Google Gemini' : 'Groq'} API key is missing.`;
    db.prepare(
      `UPDATE api_providers SET last_test_status = 'error', last_test_at = ?, last_error = ?, latency_ms = NULL, updated_at = ? WHERE provider = ?`
    ).run(now, errMsg, now, provider);
    return getProviderConfigsForUI().find((p) => p.provider === provider)!;
  }

  try {
    if (provider === 'gemini') {
      const { ai, config } = getGeminiClient();
      const testModel = config.selected_model || 'gemini-4-hydrogen';
      const response = await Promise.race([
        ai.models.generateContent({
          model: testModel,
          contents: 'Respond with exactly: OK',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini connection test timed out after 45s.')), 45000)
        ),
      ]);
      if (!response.text) {
        throw new Error('Gemini returned an empty verification response.');
      }
    } else {
      const row = db.prepare('SELECT * FROM api_providers WHERE provider = ?').get('groq') as unknown as ProviderRow;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${resolved.apiKey}` },
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Groq API error (${res.status}): ${text.slice(0, 200)}`);
        }
        const json = (await res.json()) as { data?: { id: string }[] };
        const modelIds = (json.data || []).map((m) => m.id);
        const missing: string[] = [];
        if (row.selected_model && modelIds.length > 0 && !modelIds.includes(row.selected_model)) {
          missing.push(row.selected_model);
        }
        if (row.transcribe_model && modelIds.length > 0 && !modelIds.includes(row.transcribe_model)) {
          missing.push(row.transcribe_model);
        }
        if (missing.length > 0) {
          throw new Error(
            `Model(s) unavailable on this Groq key: ${missing.join(', ')}. Available: ${modelIds.slice(0, 20).join(', ')}`
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    const latency = Date.now() - started;
    db.prepare(
      `UPDATE api_providers SET last_test_status = 'connected', last_test_at = ?, last_error = '', latency_ms = ?, updated_at = ? WHERE provider = ?`
    ).run(now, latency, now, provider);
  } catch (err) {
    const safeErr = sanitizeErrorMessage(err);
    db.prepare(
      `UPDATE api_providers SET last_test_status = 'error', last_test_at = ?, last_error = ?, latency_ms = NULL, updated_at = ? WHERE provider = ?`
    ).run(now, safeErr, now, provider);
  }

  return getProviderConfigsForUI().find((p) => p.provider === provider)!;
}

export async function transcribeAudioWithGroqOrFallback(
  audioFilePath: string,
  sourceLanguage: string,
  allowGeminiFallback = true
): Promise<{
  providerUsed: 'groq' | 'gemini';
  segments: { start_sec: number; end_sec: number; text: string; speaker_id: string }[];
}> {
  const groqKey = resolveProviderApiKey('groq').apiKey;
  const groqRow = db.prepare('SELECT * FROM api_providers WHERE provider = ?').get('groq') as unknown as ProviderRow;

  if (groqKey) {
    try {
      const fileBuffer = fs.readFileSync(audioFilePath);
      const form = new FormData();
      form.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
      form.append('model', groqRow.transcribe_model || 'whisper-large-v3-turbo');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      if (sourceLanguage && sourceLanguage.toLowerCase() !== 'auto') {
        const langMap: Record<string, string> = {
          english: 'en',
          myanmar: 'my',
          burmese: 'my',
          korean: 'ko',
          japanese: 'ja',
          chinese: 'zh',
          thai: 'th',
          hindi: 'hi',
          spanish: 'es',
        };
        const code = langMap[sourceLanguage.toLowerCase()];
        if (code) form.append('language', code);
      }

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: form,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq Whisper HTTP ${res.status}: ${errText.slice(0, 240)}`);
      }

      const data = (await res.json()) as {
        text?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
      };

      const segments =
        data.segments && data.segments.length > 0
          ? data.segments.map((s, idx) => ({
              start_sec: Number(s.start.toFixed(2)),
              end_sec: Number(Math.max(s.start + 0.5, s.end).toFixed(2)),
              text: s.text.trim(),
              speaker_id: `SPEAKER_${String((idx % 2) + 1).padStart(2, '0')}`,
            }))
          : data.text?.trim()
            ? [{ start_sec: 0, end_sec: 5, text: data.text.trim(), speaker_id: 'SPEAKER_01' }]
            : [];

      return { providerUsed: 'groq', segments };
    } catch (groqErr) {
      if (!allowGeminiFallback || !resolveProviderApiKey('gemini').apiKey) {
        throw groqErr;
      }
      // Explicit fallback to Gemini 3.5 Transcribe only when Groq failed and Gemini is configured
    }
  } else if (!allowGeminiFallback || !resolveProviderApiKey('gemini').apiKey) {
    throw new Error('Groq API key is required for Whisper speech recognition (and Gemini fallback is unavailable).');
  }

  // Gemini audio transcription adapter
  const { ai, config } = getGeminiClient();
  const base64Audio = fs.readFileSync(audioFilePath).toString('base64');
  const response = await ai.models.generateContent({
    model: config.transcribe_model || 'gemini-3.5-transcribe',
    contents: {
      parts: [
        { inlineData: { mimeType: 'audio/mp3', data: base64Audio } },
        {
          text: `Transcribe the spoken dialogue in this audio (${sourceLanguage}). Return a JSON array of segments with start_sec, end_sec, text, and speaker_id. If there is no speech (only music/tones), return an empty array [].`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            start_sec: { type: Type.NUMBER },
            end_sec: { type: Type.NUMBER },
            text: { type: Type.STRING },
            speaker_id: { type: Type.STRING },
          },
          required: ['start_sec', 'end_sec', 'text', 'speaker_id'],
        },
      },
    },
  });

  const parsed = JSON.parse((response.text || '[]').trim()) as Array<{
    start_sec: number;
    end_sec: number;
    text: string;
    speaker_id: string;
  }>;
  return { providerUsed: 'gemini', segments: parsed };
}

export async function translateSegmentsToMyanmar(
  segments: { segment_index: number; speaker_id: string; start_sec: number; end_sec: number; original_text: string }[],
  sourceLanguage: string,
  contextNote: string
): Promise<{ segment_index: number; myanmar_text: string }[]> {
  if (segments.length === 0) return [];
  const { ai, config } = getGeminiClient();

  const response = await ai.models.generateContent({
    model: config.selected_model || 'gemini-4-hydrogen',
    contents: `Translate the following ${sourceLanguage} dialogue segments into natural, expressive Myanmar Unicode (မြန်မာဘာသာ).
Rules:
1. Understand story context (${contextNote}) and maintain terminology & character name consistency.
2. Preserve emotional tone and natural spoken Myanmar phrasing suitable for subtitles/dubbing.
3. Return clean Myanmar Unicode only in myanmar_text.

Segments JSON:
${JSON.stringify(segments.map((s) => ({ segment_index: s.segment_index, speaker_id: s.speaker_id, original_text: s.original_text })))}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            segment_index: { type: Type.INTEGER },
            myanmar_text: { type: Type.STRING },
          },
          required: ['segment_index', 'myanmar_text'],
        },
      },
    },
  });

  return JSON.parse((response.text || '[]').trim()) as { segment_index: number; myanmar_text: string }[];
}

export async function analyzeKeyframesWithGemini(
  scenes: { scene_index: number; start_sec: number; end_sec: number; keyframe_path: string }[],
  projectTitle: string
): Promise<
  Array<{
    scene_index: number;
    characters: string[];
    location: string;
    action_summary: string;
    dialogue_context: string;
    important_events: string;
    emotional_shift: string;
    story_position: string;
    plot_twist: string;
    importance_score: number;
  }>
> {
  const { ai, config } = getGeminiClient();
  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

  for (const s of scenes.slice(0, 10)) {
    if (fs.existsSync(s.keyframe_path)) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: fs.readFileSync(s.keyframe_path).toString('base64'),
        },
      });
      parts.push({
        text: `Scene #${s.scene_index} (${s.start_sec}s - ${s.end_sec}s)`,
      });
    }
  }

  parts.push({
    text: `Analyze these extracted movie scene keyframes for project "${projectTitle}". For each scene_index, identify characters visible/implied, location, action_summary, dialogue_context, important_events, emotional_shift, story_position (Beginning/Rising Action/Climax/Ending), plot_twist (if any, else empty string), and importance_score (1 to 10).`,
  });

  const response = await ai.models.generateContent({
    model: config.selected_model || 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            scene_index: { type: Type.INTEGER },
            characters: { type: Type.ARRAY, items: { type: Type.STRING } },
            location: { type: Type.STRING },
            action_summary: { type: Type.STRING },
            dialogue_context: { type: Type.STRING },
            important_events: { type: Type.STRING },
            emotional_shift: { type: Type.STRING },
            story_position: { type: Type.STRING },
            plot_twist: { type: Type.STRING },
            importance_score: { type: Type.NUMBER },
          },
          required: ['scene_index', 'characters', 'location', 'action_summary', 'importance_score'],
        },
      },
    },
  });

  return JSON.parse((response.text || '[]').trim());
}

export async function generateStoryAndRecapScriptWithGemini(params: {
  projectName: string;
  recapStyle: string;
  targetPlatform: string;
  scenes: Array<{
    scene_index: number;
    start_sec: number;
    end_sec: number;
    action_summary: string;
    important_events: string;
    emotional_shift: string;
    story_position: string;
    plot_twist: string;
    importance_score: number;
  }>;
}): Promise<{
  story_arc: StoryArc;
  segments: Array<{
    scene_index: number;
    start_sec: number;
    end_sec: number;
    myanmar_narration: string;
    transition_note: string;
  }>;
  full_myanmar_script: string;
  title_suggestion: string;
  caption_suggestion: string;
}> {
  const { ai, config } = getGeminiClient();

  const response = await ai.models.generateContent({
    model: config.selected_model || 'gemini-4-hydrogen',
    contents: `You are an expert Myanmar Movie Recap storyteller.
Project: "${params.projectName}"
Recap Style: ${params.recapStyle}
Target Platform: ${params.targetPlatform}

Selected Scenes:
${JSON.stringify(params.scenes)}

Tasks:
1. Build a complete Story Understanding structure (beginning, middle, main_conflict, character_relationships, climax, ending, important_twists).
2. Write a cohesive, natural Myanmar Unicode (မြန်မာဘာသာ) recap narration script mapped scene-by-scene, preserving character consistency and smooth transitions without sacrificing important plot beats.
3. Provide an engaging Myanmar title_suggestion and social caption_suggestion.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          story_arc: {
            type: Type.OBJECT,
            properties: {
              beginning: { type: Type.STRING },
              middle: { type: Type.STRING },
              main_conflict: { type: Type.STRING },
              character_relationships: { type: Type.STRING },
              climax: { type: Type.STRING },
              ending: { type: Type.STRING },
              important_twists: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['beginning', 'middle', 'main_conflict', 'climax', 'ending', 'important_twists'],
          },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene_index: { type: Type.INTEGER },
                start_sec: { type: Type.NUMBER },
                end_sec: { type: Type.NUMBER },
                myanmar_narration: { type: Type.STRING },
                transition_note: { type: Type.STRING },
              },
              required: ['scene_index', 'start_sec', 'end_sec', 'myanmar_narration'],
            },
          },
          full_myanmar_script: { type: Type.STRING },
          title_suggestion: { type: Type.STRING },
          caption_suggestion: { type: Type.STRING },
        },
        required: ['story_arc', 'segments', 'full_myanmar_script', 'title_suggestion', 'caption_suggestion'],
      },
    },
  });

  return JSON.parse((response.text || '{}').trim());
}

export interface GeminiTTSResult {
  filePath: string;
  voiceUsed: string;
  providerUsed: 'edge-tts' | 'gemini';
  modelUsed: string;
  apiVersion: string;
  endpoint: string;
  mimeType: string;
  formatUsed: 'wav' | 'pcm-ffmpeg-wav' | 'edge-mp3-ffmpeg-wav';
  durationSec: number;
  attempts?: number;
}

export const EDGE_BURMESE_VOICES = ['my-MM-NilarNeural', 'my-MM-ThihaNeural'] as const;
export const GEMINI_PREBUILT_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

export function resolveVoiceProvider(voiceId?: string): {
  provider: 'edge-tts' | 'gemini';
  voiceId: string;
} {
  const chosen = (voiceId || DEFAULT_MYANMAR_VOICE_ID).trim() || DEFAULT_MYANMAR_VOICE_ID;
  if ((EDGE_BURMESE_VOICES as readonly string[]).includes(chosen)) {
    return { provider: 'edge-tts', voiceId: chosen };
  }
  if ((GEMINI_PREBUILT_VOICES as readonly string[]).includes(chosen)) {
    return { provider: 'gemini', voiceId: chosen };
  }
  throw new Error(
    `Unsupported voice "${chosen}". Never silently switching voices; select my-MM-NilarNeural, my-MM-ThihaNeural, or a Gemini voice.`
  );
}

export function isTransientEdgeTTSError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /(ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|WebSocket|Timed out|socket|network|429|500|502|503|504|empty or missing audio|before synthesis|turn\.end)/i.test(
    msg
  );
}

export interface EdgeTTSDeps {
  maxAttempts?: number;
  retryDelaysMs?: number[];
  timeoutMs?: number;
  synthesizeToMp3?: (text: string, voiceId: string, mp3Path: string, timeoutMs: number) => Promise<void>;
  convertToWav?: (mp3Path: string, wavPath: string) => Promise<{ wavPath: string; durationSec: number }>;
}

/**
 * API-key-free Burmese Neural TTS using node-edge-tts (my-MM-NilarNeural / my-MM-ThihaNeural).
 * Does NOT require Microsoft Azure credentials, never silently switches voices,
 * uses bounded retry logic on transient connection failures, and validates non-silent audio output.
 */
export async function generateMyanmarTTSWithEdge(
  text: string,
  voiceId: string,
  outWavPath: string,
  deps: EdgeTTSDeps = {}
): Promise<GeminiTTSResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Cannot synthesize TTS for empty text.');
  }
  if (!(EDGE_BURMESE_VOICES as readonly string[]).includes(voiceId)) {
    throw new Error(`Invalid Edge TTS Burmese voice "${voiceId}". Refusing to silently switch voice.`);
  }

  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
  const retryDelaysMs = deps.retryDelaysMs ?? [700, 1600];
  const timeoutMs = deps.timeoutMs ?? 20000;
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });

  const synthesizeToMp3 =
    deps.synthesizeToMp3 ??
    (async (txt: string, vId: string, mp3Path: string, tMs: number) => {
      const tts = new EdgeTTS({
        voice: vId,
        lang: 'my-MM',
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        timeout: tMs,
      });
      await tts.ttsPromise(txt, mp3Path);
    });

  const convertToWav = deps.convertToWav ?? convertAudioToPlayableWav;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tmpMp3Path = `${outWavPath}.edge_${Date.now()}_${attempt}.mp3`;
    console.info(
      JSON.stringify({
        event: 'edge_tts_request',
        provider: 'edge-tts',
        voiceId,
        attempt,
        maxAttempts,
        textLength: cleanText.length,
      })
    );

    try {
      await synthesizeToMp3(cleanText, voiceId, tmpMp3Path, timeoutMs);
      const normalized = await convertToWav(tmpMp3Path, outWavPath);

      console.info(
        JSON.stringify({
          event: 'edge_tts_success',
          provider: 'edge-tts',
          voiceId,
          attempt,
          durationSec: normalized.durationSec,
          bytes: fs.existsSync(outWavPath) ? fs.statSync(outWavPath).size : 0,
        })
      );

      return {
        filePath: outWavPath,
        voiceUsed: voiceId,
        providerUsed: 'edge-tts',
        modelUsed: 'edge-neural-my-MM',
        apiVersion: 'edge-ws-v1',
        endpoint: 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1',
        mimeType: 'audio/mpeg -> audio/wav',
        formatUsed: 'edge-mp3-ffmpeg-wav',
        durationSec: normalized.durationSec,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      const errMsg = sanitizeErrorMessage(err);
      console.warn(
        JSON.stringify({
          event: 'edge_tts_attempt_failed',
          voiceId,
          attempt,
          maxAttempts,
          error: errMsg,
        })
      );

      if (attempt < maxAttempts && isTransientEdgeTTSError(err)) {
        const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    } finally {
      if (fs.existsSync(tmpMp3Path)) {
        try {
          fs.unlinkSync(tmpMp3Path);
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  const finalErr = sanitizeErrorMessage(lastError);
  throw new Error(
    `Edge TTS (${voiceId}) failed after ${maxAttempts} attempt(s) without voice fallback: ${finalErr}`
  );
}

/**
 * Unified Burmese speech synthesis dispatcher.
 * Strictly respects the selected voice ID without ever silently switching voices or providers.
 */
export async function synthesizeMyanmarTTS(
  text: string,
  voiceId: string,
  outWavPath: string
): Promise<GeminiTTSResult> {
  const resolved = resolveVoiceProvider(voiceId);
  if (resolved.provider === 'edge-tts') {
    return generateMyanmarTTSWithEdge(text, resolved.voiceId, outWavPath);
  }
  return generateMyanmarTTSWithGemini(text, resolved.voiceId, outWavPath);
}

export async function generateMyanmarTTSWithGemini(
  text: string,
  voiceName: string,
  outWavPath: string
): Promise<GeminiTTSResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Cannot synthesize TTS for empty text.');
  }
  if (!(GEMINI_PREBUILT_VOICES as readonly string[]).includes(voiceName)) {
    throw new Error(`Invalid Gemini TTS voice "${voiceName}". Refusing to silently switch voice.`);
  }

  const apiVersion = 'v1beta';
  const { ai, config } = getGeminiClient(apiVersion);
  const ttsModel = config.tts_model || 'gemini-3.8-flash-lite-tts';
  // Enforce Single Voice Rule: one prebuilt voice only, never MultiSpeakerVoiceConfig
  const chosenVoice = voiceName;
  const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${ttsModel}:generateContent`;

  // Log request metadata without ever logging API keys
  console.info(
    JSON.stringify({
      event: 'gemini_tts_request',
      endpoint,
      apiVersion,
      model: ttsModel,
      voiceName: chosenVoice,
      textLength: cleanText.length,
    })
  );

  const response = await ai.models.generateContent({
    model: ttsModel,
    contents: [
      {
        parts: [
          {
            text: cleanText,
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: chosenVoice,
          },
        },
      },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((p) => p.inlineData?.data);
  const base64Audio = audioPart?.inlineData?.data;
  const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

  if (!base64Audio) {
    throw new Error(
      `Gemini TTS (${ttsModel} via ${apiVersion}) returned no inline audio data.`
    );
  }

  const audioBuffer = Buffer.from(base64Audio, 'base64');
  if (audioBuffer.length === 0) {
    throw new Error('Gemini TTS Base64 audio decoded to 0 bytes.');
  }

  const normalized = await ensurePlayableWavFromGeminiAudio(audioBuffer, mimeType, outWavPath);

  console.info(
    JSON.stringify({
      event: 'gemini_tts_success',
      model: ttsModel,
      voiceName: chosenVoice,
      mimeType,
      formatUsed: normalized.formatUsed,
      durationSec: normalized.durationSec,
      bytes: fs.statSync(outWavPath).size,
    })
  );

  return {
    filePath: outWavPath,
    voiceUsed: chosenVoice,
    providerUsed: 'gemini',
    modelUsed: ttsModel,
    apiVersion,
    endpoint,
    mimeType,
    formatUsed: normalized.formatUsed,
    durationSec: normalized.durationSec,
    attempts: 1,
  };
}
