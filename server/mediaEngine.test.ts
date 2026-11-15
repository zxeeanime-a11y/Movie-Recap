import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SubtitleCue } from '../src/types/studio';
import {
  detectScenesAndKeyframes,
  ensurePlayableWavFromGeminiAudio,
  extractAudioWavAndMp3,
  generateRealSampleVideo,
  probeMedia,
  renderSubtitleDeliverable,
  separateAudioStems,
  validateSpeechAudioNotSilent,
} from './mediaEngine.ts';

const execFileAsync = promisify(execFile);

test('FFmpeg media engine extracts audio, separates stems, detects scenes, and burns Myanmar subtitles into MP4', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio_test_'));
  try {
    const sampleMp4 = path.join(tmpDir, 'sample.mp4');
    await generateRealSampleVideo(sampleMp4);
    assert.equal(fs.existsSync(sampleMp4), true);

    const meta = await probeMedia(sampleMp4);
    assert.ok(meta.duration_sec >= 8.5 && meta.duration_sec <= 9.5);
    assert.equal(meta.width, 1280);
    assert.equal(meta.height, 720);
    assert.equal(meta.has_audio, true);

    const wavOut = path.join(tmpDir, 'audio.wav');
    const mp3Out = path.join(tmpDir, 'audio.mp3');
    await extractAudioWavAndMp3(sampleMp4, wavOut, mp3Out);
    assert.ok(fs.statSync(wavOut).size > 1000);
    assert.ok(fs.statSync(mp3Out).size > 1000);

    const stems = await separateAudioStems(sampleMp4, path.join(tmpDir, 'stems'));
    assert.equal(fs.existsSync(stems.dialoguePath), true);
    assert.equal(fs.existsSync(stems.musicPath), true);
    assert.equal(fs.existsSync(stems.sfxPath), true);

    const scenes = await detectScenesAndKeyframes(sampleMp4, path.join(tmpDir, 'kf'), meta.duration_sec);
    assert.ok(scenes.length >= 3);
    assert.equal(fs.existsSync(scenes[0].keyframe_path), true);

    const cues: SubtitleCue[] = [
      {
        id: 'c1',
        project_id: 'p1',
        cue_index: 1,
        start_sec: 0.5,
        end_sec: 3.0,
        source_text: 'The detective arrived at midnight.',
        myanmar_text: 'စုံထောက်ကြီးဟာ သန်းခေါင်ယံမှာ ရောက်လာခဲ့တယ်။',
        reading_speed_cps: 10,
        has_overlap: false,
        duration_valid: true,
        locked: true,
      },
    ];
    const burnedMp4 = path.join(tmpDir, 'burned.mp4');
    const res = await renderSubtitleDeliverable({
      format: 'mp4_burned',
      cues,
      projectName: 'Test',
      outPath: burnedMp4,
      videoPath: sampleMp4,
      resolution: '720p',
      fps: 30,
    });
    assert.ok(res.fileSize > 10_000);
    const outMeta = await probeMedia(burnedMp4);
    assert.equal(outMeta.width, 1280);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensurePlayableWavFromGeminiAudio converts 24kHz mono 16-bit raw PCM to valid playable WAV via FFmpeg', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_pcm_test_'));
  try {
    // 1 second of 24kHz mono 16-bit PCM (440 Hz tone)
    const sampleRate = 24000;
    const pcmBuffer = Buffer.alloc(sampleRate * 2);
    for (let i = 0; i < sampleRate; i++) {
      const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000);
      pcmBuffer.writeInt16LE(sample, i * 2);
    }

    const wavFromPcm = path.join(tmpDir, 'converted.wav');
    const pcmRes = await ensurePlayableWavFromGeminiAudio(pcmBuffer, 'audio/L16;rate=24000', wavFromPcm);
    assert.equal(pcmRes.formatUsed, 'pcm-ffmpeg-wav');
    assert.ok(pcmRes.durationSec >= 0.9 && pcmRes.durationSec <= 1.1);
    const header = fs.readFileSync(wavFromPcm).subarray(0, 4).toString('ascii');
    assert.equal(header, 'RIFF');

    // Also verify passing an existing RIFF WAV preserves it cleanly
    const wavBytes = fs.readFileSync(wavFromPcm);
    const wavDirect = path.join(tmpDir, 'direct.wav');
    const directRes = await ensurePlayableWavFromGeminiAudio(wavBytes, 'audio/wav', wavDirect);
    assert.equal(directRes.formatUsed, 'wav');
    assert.ok(directRes.durationSec >= 0.9 && directRes.durationSec <= 1.1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('validateSpeechAudioNotSilent rejects pure silent WAV so fake/silent audio never passes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts_silence_test_'));
  try {
    const silentWav = path.join(tmpDir, 'silent.wav');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=24000:cl=mono',
      '-t',
      '1.2',
      silentWav,
    ]);
    await assert.rejects(() => validateSpeechAudioNotSilent(silentWav), /silent|invalid/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
