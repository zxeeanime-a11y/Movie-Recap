import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FrameRate, SubtitleCue, VideoResolution } from '../src/types/studio';
import { computeNonOverlappingDubbingSchedule, generateASS, generateSRT, generateVTT } from '../src/utils/studioRules';

const execFileAsync = promisify(execFile);

export interface MediaMetadata {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  has_audio: boolean;
}

export async function probeMedia(filePath: string): Promise<MediaMetadata> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media file not found: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  if (['.srt', '.ass', '.vtt', '.txt'].includes(ext)) {
    return { duration_sec: 0, width: 0, height: 0, fps: 0, codec: 'text/subtitle', has_audio: false };
  }

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
      }>;
    };

    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');
    let fps = 30;
    if (videoStream?.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den > 0 && num > 0) fps = Number((num / den).toFixed(2));
    }

    return {
      duration_sec: Number(Number(data.format?.duration || 0).toFixed(2)),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: videoStream ? fps : 0,
      codec: videoStream?.codec_name || audioStream?.codec_name || 'unknown',
      has_audio: Boolean(audioStream),
    };
  } catch (err) {
    throw new Error(`Unsupported or unreadable media container: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function generateRealSampleVideo(outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Builds a valid 9-second 1280x720 H.264/AAC MP4 with 3 distinct visual scenes and real spoken English dialogue (flite)
  const filter = [
    'color=c=#111827:s=1280x720:d=3[c1]',
    'color=c=#312E81:s=1280x720:d=3[c2]',
    'color=c=#064E3B:s=1280x720:d=3[c3]',
    '[c1]drawbox=x=120:y=140:w=1040:h=440:color=#8B5CF6@0.35:t=fill,drawtext=text=\'SCENE 01 - OPENING ARRIVAL\':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2[v1]',
    '[c2]drawbox=x=200:y=120:w=880:h=480:color=#3B82F6@0.4:t=fill,drawtext=text=\'SCENE 02 - THE VAULT DISCOVERY\':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2[v2]',
    '[c3]drawbox=x=160:y=160:w=960:h=400:color=#10B981@0.4:t=fill,drawtext=text=\'SCENE 03 - FINAL REVELATION\':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2[v3]',
    '[v1][v2][v3]concat=n=3:v=1:a=0[vout]',
    "flite=text='The detective arrived at the station at midnight.':voice=slt[sp1]",
    "flite=text='Look at the vault door. Someone already opened it.':voice=slt[sp2]",
    "flite=text='We only have ten minutes before the truth disappears.':voice=slt[sp3]",
    '[sp1]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=3,atrim=0:3[s1]',
    '[sp2]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=3,atrim=0:3[s2]',
    '[sp3]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=3,atrim=0:3[s3]',
    '[s1][s2][s3]concat=n=3:v=0:a=1[speech]',
    'sine=frequency=196:sample_rate=44100:duration=9,aformat=sample_rates=44100:channel_layouts=stereo,volume=0.06[bgm]',
    '[speech][bgm]amix=inputs=2:duration=first,asetpts=PTS-STARTPTS,asetnsamples=n=1024:p=0[aout]',
  ].join(';');

  await execFileAsync('ffmpeg', [
    '-y',
    '-filter_complex',
    filter,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outPath,
  ]);
}

export async function extractAudioWavAndMp3(
  inputPath: string,
  outWavPath: string,
  outMp3Path: string
): Promise<{ wavPath: string; mp3Path: string; durationSec: number }> {
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  const meta = await probeMedia(inputPath);
  if (!meta.has_audio) {
    // Generate silent 16kHz mono track matching video duration if source video has no audio stream
    const dur = Math.max(1, meta.duration_sec || 5);
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=16000:cl=mono`,
      '-t',
      String(dur),
      '-acodec',
      'pcm_s16le',
      outWavPath,
    ]);
  } else {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outWavPath,
    ]);
  }

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    outWavPath,
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '96k',
    outMp3Path,
  ]);

  return { wavPath: outWavPath, mp3Path: outMp3Path, durationSec: meta.duration_sec };
}

/**
 * Normalizes Gemini TTS audio bytes (complete WAV or raw 24kHz mono 16-bit PCM)
 * into a verified playable WAV file using FFmpeg when PCM conversion is required.
 */
export async function ensurePlayableWavFromGeminiAudio(
  audioBuffer: Buffer,
  mimeType: string,
  outWavPath: string
): Promise<{ wavPath: string; formatUsed: 'wav' | 'pcm-ffmpeg-wav'; durationSec: number }> {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Gemini TTS returned an empty audio buffer.');
  }

  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  const normalizedMime = (mimeType || '').toLowerCase();
  const hasRiffHeader =
    audioBuffer.length >= 12 &&
    audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    audioBuffer.subarray(8, 12).toString('ascii') === 'WAVE';

  const isWavMime = normalizedMime.includes('audio/wav') || normalizedMime.includes('audio/x-wav') || normalizedMime.includes('audio/wave');
  const isRawPcmMime = normalizedMime.includes('l16') || normalizedMime.includes('pcm') || normalizedMime.includes('raw');

  let formatUsed: 'wav' | 'pcm-ffmpeg-wav' = 'wav';

  if (hasRiffHeader && !isRawPcmMime) {
    fs.writeFileSync(outWavPath, audioBuffer);
  } else {
    // Extract sample rate / channel count if provided in MIME parameters (e.g. audio/L16;rate=24000;channels=1)
    const rateMatch = normalizedMime.match(/rate=(\d+)/);
    const chanMatch = normalizedMime.match(/channels=(\d+)/);
    const sampleRate = rateMatch ? rateMatch[1] : '24000';
    const channels = chanMatch ? chanMatch[1] : '1';

    const tmpPcmPath = `${outWavPath}.raw_${Date.now()}.pcm`;
    fs.writeFileSync(tmpPcmPath, audioBuffer);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        's16le',
        '-ar',
        sampleRate,
        '-ac',
        channels,
        '-i',
        tmpPcmPath,
        '-acodec',
        'pcm_s16le',
        outWavPath,
      ]);
      formatUsed = isWavMime && hasRiffHeader ? 'wav' : 'pcm-ffmpeg-wav';
    } finally {
      if (fs.existsSync(tmpPcmPath)) {
        fs.unlinkSync(tmpPcmPath);
      }
    }
  }

  const validation = await validateSpeechAudioNotSilent(outWavPath);
  return { wavPath: outWavPath, formatUsed, durationSec: validation.durationSec };
}

/**
 * Verifies an audio file is non-empty, playable, and contains real non-silent audio energy.
 * Rejects empty or pure-silence tracks so fake/silent audio is never treated as valid speech.
 */
export async function validateSpeechAudioNotSilent(audioPath: string): Promise<{
  durationSec: number;
  meanVolumeDb: number;
  maxVolumeDb: number;
}> {
  const meta = await probeMedia(audioPath);
  if (!meta.has_audio || meta.duration_sec < 0.12) {
    throw new Error(
      `Generated audio failed playback validation (has_audio=${meta.has_audio}, duration=${meta.duration_sec}s).`
    );
  }

  const { stderr } = await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-i',
    audioPath,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);

  const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+|-inf)\s*dB/i);
  const maxMatch = stderr.match(/max_volume:\s*([-\d.]+|-inf)\s*dB/i);

  const rawMax = maxMatch?.[1];
  const rawMean = meanMatch?.[1];
  const maxVolumeDb = rawMax === '-inf' ? -Infinity : Number(rawMax);
  const meanVolumeDb = rawMean === '-inf' ? -Infinity : Number(rawMean);

  if (!Number.isFinite(maxVolumeDb) || maxVolumeDb < -55 || !Number.isFinite(meanVolumeDb) || meanVolumeDb < -72) {
    throw new Error(
      `Generated audio appears silent or invalid (mean_volume=${rawMean ?? 'unknown'} dB, max_volume=${rawMax ?? 'unknown'} dB).`
    );
  }

  return {
    durationSec: meta.duration_sec,
    meanVolumeDb: Number(meanVolumeDb.toFixed(1)),
    maxVolumeDb: Number(maxVolumeDb.toFixed(1)),
  };
}

/**
 * Converts Edge TTS MP3 (or any FFmpeg-readable audio) into normalized 24kHz mono 16-bit WAV
 * and verifies real non-silent speech output.
 */
export async function convertAudioToPlayableWav(
  inputAudioPath: string,
  outWavPath: string
): Promise<{ wavPath: string; durationSec: number; meanVolumeDb: number; maxVolumeDb: number }> {
  if (!fs.existsSync(inputAudioPath) || fs.statSync(inputAudioPath).size < 128) {
    throw new Error('TTS engine produced an empty or missing audio stream.');
  }

  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputAudioPath,
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    outWavPath,
  ]);

  const stats = await validateSpeechAudioNotSilent(outWavPath);
  return { wavPath: outWavPath, ...stats };
}

export async function isBinaryAvailable(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

export async function separateAudioStems(
  inputMediaPath: string,
  outDir: string
): Promise<{
  engine: 'demucs' | 'ffmpeg-spectral-separator';
  dialoguePath: string;
  musicPath: string;
  sfxPath: string;
}> {
  fs.mkdirSync(outDir, { recursive: true });
  const dialoguePath = path.join(outDir, 'dialogue_stem.wav');
  const musicPath = path.join(outDir, 'music_stem.wav');
  const sfxPath = path.join(outDir, 'sfx_stem.wav');

  const hasDemucs = await isBinaryAvailable('demucs');
  if (hasDemucs) {
    const rawWav = path.join(outDir, 'demucs_input.wav');
    await execFileAsync('ffmpeg', ['-y', '-i', inputMediaPath, '-vn', '-ar', '44100', '-ac', '2', rawWav]);
    await execFileAsync('demucs', ['-o', outDir, '--two-stems=vocals', rawWav]);
    const base = path.basename(rawWav, '.wav');
    const demucsVocals = path.join(outDir, 'htdemucs', base, 'vocals.wav');
    const demucsNoVocals = path.join(outDir, 'htdemucs', base, 'no_vocals.wav');
    if (fs.existsSync(demucsVocals) && fs.existsSync(demucsNoVocals)) {
      fs.copyFileSync(demucsVocals, dialoguePath);
      fs.copyFileSync(demucsNoVocals, musicPath);
      await execFileAsync('ffmpeg', ['-y', '-i', demucsNoVocals, '-af', 'highpass=f=3200', sfxPath]);
      return { engine: 'demucs', dialoguePath, musicPath, sfxPath };
    }
  }

  // FFmpeg spectral/center-side separation fallback when Demucs isn't installed in container
  const meta = await probeMedia(inputMediaPath);
  if (!meta.has_audio) {
    const dur = Math.max(1, meta.duration_sec || 5);
    for (const target of [dialoguePath, musicPath, sfxPath]) {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=stereo',
        '-t',
        String(dur),
        target,
      ]);
    }
    return { engine: 'ffmpeg-spectral-separator', dialoguePath, musicPath, sfxPath };
  }

  // Dialogue stem: center-weighted vocal speech band (250Hz - 3800Hz)
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputMediaPath,
    '-vn',
    '-af',
    'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=220,lowpass=f=3800',
    '-ar',
    '44100',
    dialoguePath,
  ]);
  // Music stem: stereo side + warm low-mid bed
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputMediaPath,
    '-vn',
    '-af',
    'lowpass=f=1800,volume=0.85',
    '-ar',
    '44100',
    musicPath,
  ]);
  // Effects / ambience stem: high transient band
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputMediaPath,
    '-vn',
    '-af',
    'highpass=f=3400,volume=0.75',
    '-ar',
    '44100',
    sfxPath,
  ]);

  return { engine: 'ffmpeg-spectral-separator', dialoguePath, musicPath, sfxPath };
}

export async function detectScenesAndKeyframes(
  videoPath: string,
  keyframesDir: string,
  durationSec: number
): Promise<{ scene_index: number; start_sec: number; end_sec: number; keyframe_path: string }[]> {
  fs.mkdirSync(keyframesDir, { recursive: true });
  const totalDur = Math.max(3, durationSec || 9);

  // Use FFmpeg scene change detection timestamps
  let timestamps: number[] = [0];
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i',
      videoPath,
      '-vf',
      "select='gt(scene,0.22)',showinfo",
      '-f',
      'null',
      '-',
    ]);
    const matches = [...stderr.matchAll(/pts_time:([0-9.]+)/g)];
    for (const m of matches) {
      const t = Number(m[1]);
      if (t > 0.6 && t < totalDur - 0.5) {
        if (timestamps.every((prev) => Math.abs(prev - t) >= 1.2)) {
          timestamps.push(Number(t.toFixed(2)));
        }
      }
    }
  } catch {
    // Fallback below if showinfo returned non-zero
  }

  // Ensure at least 3 representative segments if video had gentle transitions
  if (timestamps.length < 3) {
    const step = totalDur / 3;
    timestamps = [0, Number(step.toFixed(2)), Number((step * 2).toFixed(2))];
  }
  timestamps = timestamps.slice(0, 12).sort((a, b) => a - b);

  const scenes: { scene_index: number; start_sec: number; end_sec: number; keyframe_path: string }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const startSec = timestamps[i];
    const endSec = i < timestamps.length - 1 ? timestamps[i + 1] : Number(totalDur.toFixed(2));
    const midSec = Number(((startSec + endSec) / 2).toFixed(2));
    const frameFile = path.join(keyframesDir, `scene_${String(i + 1).padStart(2, '0')}.jpg`);

    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(midSec),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      frameFile,
    ]);

    scenes.push({
      scene_index: i + 1,
      start_sec: startSec,
      end_sec: Math.max(startSec + 0.5, endSec),
      keyframe_path: frameFile,
    });
  }

  return scenes;
}

function getScaleFilter(resolution: VideoResolution | string): string {
  switch (resolution) {
    case '480p':
      return 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2';
    case '1080p':
      return 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2';
    case '4k':
      return 'scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2';
    case '720p':
    default:
      return 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
  }
}

export async function renderSubtitleDeliverable(params: {
  format: string;
  cues: SubtitleCue[];
  projectName: string;
  outPath: string;
  videoPath?: string;
  resolution?: VideoResolution;
  fps?: FrameRate;
}): Promise<{ filePath: string; fileSize: number }> {
  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  const fmt = params.format.toLowerCase();

  if (fmt === 'srt') {
    fs.writeFileSync(params.outPath, generateSRT(params.cues, true), 'utf8');
  } else if (fmt === 'vtt') {
    fs.writeFileSync(params.outPath, generateVTT(params.cues, true), 'utf8');
  } else if (fmt === 'ass') {
    fs.writeFileSync(params.outPath, generateASS(params.cues, params.projectName, true), 'utf8');
  } else if (fmt === 'mp4_burned' || fmt === 'mp4') {
    if (!params.videoPath || !fs.existsSync(params.videoPath)) {
      throw new Error('Source video file is required to render MP4 with burned-in subtitles.');
    }
    const assPath = params.outPath.replace(/\.mp4$/i, '.ass');
    fs.writeFileSync(assPath, generateASS(params.cues, params.projectName, true), 'utf8');
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const scale = getScaleFilter(params.resolution || '720p');
    const fps = params.fps || 30;
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      params.videoPath,
      '-vf',
      `${scale},ass='${escapedAss}':fontsdir=/usr/share/fonts/truetype/noto`,
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      params.outPath,
    ]);
  } else if (fmt === 'mp4_embedded') {
    if (!params.videoPath || !fs.existsSync(params.videoPath)) {
      throw new Error('Source video file is required to render MP4 with embedded subtitle track.');
    }
    const srtPath = params.outPath.replace(/\.mp4$/i, '.srt');
    fs.writeFileSync(srtPath, generateSRT(params.cues, true), 'utf8');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      params.videoPath,
      '-i',
      srtPath,
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-c:s',
      'mov_text',
      '-metadata:s:s:0',
      'language=mya',
      '-movflags',
      '+faststart',
      params.outPath,
    ]);
  } else {
    throw new Error(`Unsupported subtitle export format: ${params.format}`);
  }

  const stat = fs.statSync(params.outPath);
  return { filePath: params.outPath, fileSize: stat.size };
}

export async function renderAudioExport(
  sourceAudioOrVideoPath: string,
  format: 'mp3' | 'wav' | 'aac',
  outPath: string
): Promise<{ filePath: string; fileSize: number }> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (!fs.existsSync(sourceAudioOrVideoPath)) {
    throw new Error('Audio asset not found for export.');
  }

  if (format === 'mp3') {
    await execFileAsync('ffmpeg', ['-y', '-i', sourceAudioOrVideoPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', outPath]);
  } else if (format === 'aac') {
    await execFileAsync('ffmpeg', ['-y', '-i', sourceAudioOrVideoPath, '-vn', '-c:a', 'aac', '-b:a', '192k', outPath]);
  } else {
    await execFileAsync('ffmpeg', ['-y', '-i', sourceAudioOrVideoPath, '-vn', '-c:a', 'pcm_s16le', '-ar', '44100', outPath]);
  }
  return { filePath: outPath, fileSize: fs.statSync(outPath).size };
}

export async function assembleRecapMp4(params: {
  videoPath: string;
  selectedScenes: { start_sec: number; end_sec: number }[];
  narrationWavPath?: string;
  subtitles?: SubtitleCue[];
  outPath: string;
  resolution: VideoResolution;
  fps: FrameRate;
  burnSubtitles: boolean;
  bgmVolume: number;
}): Promise<{ filePath: string; fileSize: number; durationSec: number }> {
  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  const workDir = path.dirname(params.outPath);
  const scenes = params.selectedScenes.length > 0 ? params.selectedScenes : [{ start_sec: 0, end_sec: 6 }];

  // Cut and normalize each selected clip
  const clipPaths: string[] = [];
  const scale = getScaleFilter(params.resolution);
  const meta = await probeMedia(params.videoPath);

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const dur = Math.max(0.5, s.end_sec - s.start_sec);
    const clipPath = path.join(workDir, `recap_clip_${i}.mp4`);
    const args = [
      '-y',
      '-ss',
      String(s.start_sec),
      '-t',
      String(dur),
      '-i',
      params.videoPath,
      '-vf',
      scale,
      '-r',
      String(params.fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
    ];
    if (meta.has_audio) {
      args.push('-c:a', 'aac', '-ar', '44100', '-ac', '2');
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest', '-c:a', 'aac');
    }
    args.push(clipPath);
    await execFileAsync('ffmpeg', args);
    clipPaths.push(clipPath);
  }

  const concatListPath = path.join(workDir, 'concat_list.txt');
  fs.writeFileSync(
    concatListPath,
    clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8'
  );
  const rawJoined = path.join(workDir, 'recap_joined.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c',
    'copy',
    rawJoined,
  ]);

  let currentVideo = rawJoined;
  if (params.narrationWavPath && fs.existsSync(params.narrationWavPath)) {
    await validateSpeechAudioNotSilent(params.narrationWavPath);
    const narratedPath = path.join(workDir, 'recap_narrated.mp4');
    const bgVol = Math.max(0, Math.min(0.35, params.bgmVolume));
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      currentVideo,
      '-i',
      params.narrationWavPath,
      '-filter_complex',
      `[0:a]lowpass=f=1200,volume=${bgVol}[bg];[1:a]aresample=44100,volume=1.0[vo];[bg][vo]amix=inputs=2:duration=longest:dropout_transition=2[aout]`,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      narratedPath,
    ]);
    currentVideo = narratedPath;
  }

  if (params.burnSubtitles && params.subtitles && params.subtitles.length > 0) {
    const assPath = path.join(workDir, 'recap_subs.ass');
    fs.writeFileSync(assPath, generateASS(params.subtitles, 'Movie Recap', true), 'utf8');
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      currentVideo,
      '-vf',
      `ass='${escapedAss}':fontsdir=/usr/share/fonts/truetype/noto`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      params.outPath,
    ]);
  } else {
    await execFileAsync('ffmpeg', ['-y', '-i', currentVideo, '-c', 'copy', '-movflags', '+faststart', params.outPath]);
  }

  const outMeta = await probeMedia(params.outPath);
  return {
    filePath: params.outPath,
    fileSize: fs.statSync(params.outPath).size,
    durationSec: outMeta.duration_sec,
  };
}

export async function mixAndRenderDubbedMp4(params: {
  videoPath: string;
  ttsSegments: { filePath: string; startSec: number; endSec: number }[];
  musicStemPath?: string;
  sfxStemPath?: string;
  originalAudioPath?: string;
  restoreOriginalAudio: boolean;
  dialogueVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  outPath: string;
  resolution: VideoResolution;
  fps: FrameRate;
}): Promise<{ filePath: string; fileSize: number; mixedAudioPath: string }> {
  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  const workDir = path.dirname(params.outPath);
  const mixedAudioPath = path.join(workDir, 'mixed_dub_audio.wav');

  if (params.restoreOriginalAudio && params.originalAudioPath && fs.existsSync(params.originalAudioPath)) {
    fs.copyFileSync(params.originalAudioPath, mixedAudioPath);
  } else {
    const inputs: string[] = [];
    const filters: string[] = [];
    const mixInputs: string[] = [];
    let idx = 0;

    if (params.musicStemPath && fs.existsSync(params.musicStemPath)) {
      inputs.push('-i', params.musicStemPath);
      filters.push(`[${idx}:a]volume=${params.bgmVolume}[m${idx}]`);
      mixInputs.push(`[m${idx}]`);
      idx++;
    }
    if (params.sfxStemPath && fs.existsSync(params.sfxStemPath)) {
      inputs.push('-i', params.sfxStemPath);
      filters.push(`[${idx}:a]volume=${params.sfxVolume}[s${idx}]`);
      mixInputs.push(`[s${idx}]`);
      idx++;
    }

    const existingSegments: { filePath: string; startSec: number; endSec: number; actualDurationSec: number }[] = [];
    for (const seg of params.ttsSegments) {
      if (fs.existsSync(seg.filePath)) {
        const segMeta = await probeMedia(seg.filePath);
        existingSegments.push({
          filePath: seg.filePath,
          startSec: seg.startSec,
          endSec: seg.endSec,
          actualDurationSec: segMeta.duration_sec,
        });
      }
    }

    const scheduledSegments = computeNonOverlappingDubbingSchedule(existingSegments);
    for (const seg of scheduledSegments) {
      inputs.push('-i', seg.filePath);
      const tempoFilter = seg.tempoFactor > 1.01 ? `atempo=${seg.tempoFactor},` : '';
      filters.push(
        `[${idx}:a]aresample=44100,${tempoFilter}atrim=0:${seg.maxSlotSec},asetpts=PTS-STARTPTS,adelay=${seg.delayMs}|${seg.delayMs},volume=${params.dialogueVolume}[d${idx}]`
      );
      mixInputs.push(`[d${idx}]`);
      idx++;
    }

    if (mixInputs.length === 0) {
      await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '5', mixedAudioPath]);
    } else if (mixInputs.length === 1) {
      await execFileAsync('ffmpeg', ['-y', ...inputs, '-filter_complex', `${filters[0]}`, '-map', mixInputs[0], mixedAudioPath]);
    } else {
      const amix = `${filters.join(';')};${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0[aout]`;
      await execFileAsync('ffmpeg', ['-y', ...inputs, '-filter_complex', amix, '-map', '[aout]', mixedAudioPath]);
    }
  }

  const scale = getScaleFilter(params.resolution);
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    params.videoPath,
    '-i',
    mixedAudioPath,
    '-vf',
    scale,
    '-r',
    String(params.fps),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    params.outPath,
  ]);

  return {
    filePath: params.outPath,
    fileSize: fs.statSync(params.outPath).size,
    mixedAudioPath,
  };
}
