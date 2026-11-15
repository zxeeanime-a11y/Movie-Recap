import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateMyanmarTTSWithEdge,
  isTransientEdgeTTSError,
  resolveVoiceProvider,
} from './aiProviders.ts';

test('resolveVoiceProvider defaults to my-MM-NilarNeural and never silently switches voices', () => {
  assert.deepEqual(resolveVoiceProvider(undefined), {
    provider: 'edge-tts',
    voiceId: 'my-MM-NilarNeural',
  });
  assert.deepEqual(resolveVoiceProvider('my-MM-NilarNeural'), {
    provider: 'edge-tts',
    voiceId: 'my-MM-NilarNeural',
  });
  assert.deepEqual(resolveVoiceProvider('my-MM-ThihaNeural'), {
    provider: 'edge-tts',
    voiceId: 'my-MM-ThihaNeural',
  });
  assert.deepEqual(resolveVoiceProvider('Kore'), {
    provider: 'gemini',
    voiceId: 'Kore',
  });
  assert.throws(() => resolveVoiceProvider('unknown-voice-999'), /Never silently switching voices/i);
});

test('isTransientEdgeTTSError detects network/WebSocket/timeout errors', () => {
  assert.equal(isTransientEdgeTTSError(new Error('WebSocket closed before turn.end (code 1006)')), true);
  assert.equal(isTransientEdgeTTSError(new Error('Timed out while connecting to Edge TTS')), true);
  assert.equal(isTransientEdgeTTSError(new Error('Invalid Edge TTS Burmese voice')), false);
});

test('generateMyanmarTTSWithEdge performs bounded retry on transient error without changing voice', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge_retry_test_'));
  const outWav = path.join(tmpDir, 'nilar.wav');
  const seenVoices: string[] = [];
  let calls = 0;

  try {
    const res = await generateMyanmarTTSWithEdge('မင်္ဂလာပါ', 'my-MM-NilarNeural', outWav, {
      maxAttempts: 3,
      retryDelaysMs: [10, 10],
      synthesizeToMp3: async (_txt, voiceId, mp3Path) => {
        calls += 1;
        seenVoices.push(voiceId);
        if (calls === 1) {
          throw new Error('ECONNRESET: temporary WebSocket drop');
        }
        fs.writeFileSync(mp3Path, Buffer.alloc(512, 1));
      },
      convertToWav: async (_mp3Path, wavPath) => {
        fs.writeFileSync(wavPath, Buffer.from('RIFF0000WAVEfmt '));
        return { wavPath, durationSec: 1.8 };
      },
    });

    assert.equal(calls, 2);
    assert.deepEqual(seenVoices, ['my-MM-NilarNeural', 'my-MM-NilarNeural']);
    assert.equal(res.voiceUsed, 'my-MM-NilarNeural');
    assert.equal(res.providerUsed, 'edge-tts');
    assert.equal(res.attempts, 2);
    assert.equal(res.durationSec, 1.8);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generateMyanmarTTSWithEdge fails cleanly after maxAttempts without silently switching voices', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge_fail_test_'));
  const outWav = path.join(tmpDir, 'thiha.wav');
  const seenVoices: string[] = [];

  try {
    await assert.rejects(
      () =>
        generateMyanmarTTSWithEdge('စမ်းသပ်စာသား', 'my-MM-ThihaNeural', outWav, {
          maxAttempts: 3,
          retryDelaysMs: [5, 5],
          synthesizeToMp3: async (_txt, voiceId) => {
            seenVoices.push(voiceId);
            throw new Error('Timed out waiting for Edge TTS');
          },
        }),
      /my-MM-ThihaNeural.*3 attempt\(s\) without voice fallback/i
    );

    assert.deepEqual(seenVoices, ['my-MM-ThihaNeural', 'my-MM-ThihaNeural', 'my-MM-ThihaNeural']);
    assert.equal(fs.existsSync(outWav), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
