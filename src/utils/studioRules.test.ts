import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoFixSubtitleOverlaps,
  canEditMyanmarTranslation,
  canExportProject,
  checkDubbingVoiceConsistency,
  computeNonOverlappingDubbingSchedule,
  computeSuitableRecapDuration,
  DEFAULT_MYANMAR_VOICE_ID,
  enforceSingleVoiceRule,
  filterAndPaginateScenes,
  generateASS,
  generateSRT,
  generateVTT,
  getModuleSteps,
  moveClipWithSnap,
  splitClipAtTime,
  summarizeWorkflowSteps,
  validateMediaUpload,
  validateSubtitles,
} from './studioRules';
import type { SubtitleCue, TimelineClip, VideoScene } from '../types/studio';

test('validateMediaUpload accepts valid video, audio, subtitle, image and rejects invalid types', () => {
  assert.equal(validateMediaUpload('movie.mp4', 'video/mp4', 1024).valid, true);
  assert.equal(validateMediaUpload('track.flac', 'audio/flac', 500).valid, true);
  assert.equal(validateMediaUpload('subs.ass', 'text/plain', 200).valid, true);
  assert.equal(validateMediaUpload('poster.webp', 'image/webp', 800).valid, true);
  assert.equal(validateMediaUpload('malware.exe', 'application/x-msdownload', 100).valid, false);
  assert.equal(validateMediaUpload('empty.mp4', 'video/mp4', 0).valid, false);
});

test('subtitle validation detects overlaps, invalid durations, and auto-fix resolves overlaps', () => {
  const cues: SubtitleCue[] = [
    {
      id: '1',
      project_id: 'p1',
      cue_index: 1,
      start_sec: 0,
      end_sec: 3.5,
      source_text: 'Hello everyone.',
      myanmar_text: 'မင်္ဂလာပါ။',
      reading_speed_cps: 0,
      has_overlap: false,
      duration_valid: true,
      locked: true,
    },
    {
      id: '2',
      project_id: 'p1',
      cue_index: 2,
      start_sec: 2.8,
      end_sec: 5.0,
      source_text: 'The journey begins.',
      myanmar_text: 'ခရီးစတင်ပါပြီ။',
      reading_speed_cps: 0,
      has_overlap: false,
      duration_valid: true,
      locked: true,
    },
  ];

  const initial = validateSubtitles(cues);
  assert.equal(initial.overlapCount, 2);

  const fixed = autoFixSubtitleOverlaps(cues);
  const rechecked = validateSubtitles(fixed);
  assert.equal(rechecked.overlapCount, 0);
});

test('SRT, VTT, and ASS generators format Myanmar Unicode properly', () => {
  const cues: SubtitleCue[] = [
    {
      id: '1',
      project_id: 'p1',
      cue_index: 1,
      start_sec: 1.25,
      end_sec: 4.5,
      source_text: 'We must survive.',
      myanmar_text: 'ကျွန်တော်တို့ ရှင်သန်ရမယ်။',
      reading_speed_cps: 8,
      has_overlap: false,
      duration_valid: true,
      locked: true,
    },
  ];
  const srt = generateSRT(cues, true);
  assert.match(srt, /00:00:01,250 --> 00:00:04,500/);
  assert.match(srt, /ကျွန်တော်တို့ ရှင်သန်ရမယ်။/);

  const vtt = generateVTT(cues, true);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.250 --> 00:00:04\.500/);

  const ass = generateASS(cues, 'Test', true);
  assert.match(ass, /Noto Sans Myanmar/);
  assert.match(ass, /Dialogue: 0,0:00:01\.25,0:00:04\.50/);
});

test('enforceSingleVoiceRule defaults to my-MM-NilarNeural and guarantees ONE voice across all dubbing characters', () => {
  assert.equal(DEFAULT_MYANMAR_VOICE_ID, 'my-MM-NilarNeural');
  const segments = [
    { speaker_id: 'SPK_01_MALE', voice_name: 'Fenrir', text: 'Line 1' },
    { speaker_id: 'SPK_02_FEMALE', voice_name: 'Puck', text: 'Line 2' },
    { speaker_id: 'NARRATOR', voice_name: 'Zephyr', text: 'Line 3' },
  ];
  const defaultEnforced = enforceSingleVoiceRule(segments, '');
  assert.equal(checkDubbingVoiceConsistency(defaultEnforced, 'my-MM-NilarNeural'), true);

  const thihaEnforced = enforceSingleVoiceRule(segments, 'my-MM-ThihaNeural');
  assert.equal(checkDubbingVoiceConsistency(thihaEnforced, 'my-MM-ThihaNeural'), true);
  assert.equal(thihaEnforced[0].speaker_id, 'SPK_01_MALE');
  assert.equal(thihaEnforced[1].speaker_id, 'SPK_02_FEMALE');
  assert.equal(thihaEnforced[1].voice_name, 'my-MM-ThihaNeural');
});

test('computeNonOverlappingDubbingSchedule prevents segment speech from overlapping next segment', () => {
  const scheduled = computeNonOverlappingDubbingSchedule([
    { filePath: '/tmp/1.wav', startSec: 0, endSec: 2.5, actualDurationSec: 3.0 },
    { filePath: '/tmp/2.wav', startSec: 2.6, endSec: 5.0, actualDurationSec: 2.1 },
  ]);
  assert.equal(scheduled.length, 2);
  assert.ok(scheduled[0].maxSlotSec <= 2.56, 'Segment 1 must finish before Segment 2 starts at 2.6s');
  assert.ok(scheduled[0].tempoFactor > 1.0 && scheduled[0].tempoFactor <= 1.5);
  assert.equal(scheduled[1].tempoFactor, 1.0);
});

test('canExportProject blocks export until user approves review', () => {
  const unapproved = canExportProject(
    { module: 'subtitle', approved_for_export: false, status: 'Reviewing' },
    true,
    true
  );
  assert.equal(unapproved.allowed, false);

  const approved = canExportProject(
    { module: 'subtitle', approved_for_export: true, status: 'Reviewing' },
    true,
    true
  );
  assert.equal(approved.allowed, true);
});

test('canEditMyanmarTranslation enforces locked translation unless admin explicitly unlocks', () => {
  assert.equal(canEditMyanmarTranslation({ translation_locked: true }, 'editor', false).allowed, false);
  assert.equal(canEditMyanmarTranslation({ translation_locked: true }, 'admin', false).allowed, false);
  assert.equal(canEditMyanmarTranslation({ translation_locked: true }, 'admin', true).allowed, true);
  assert.equal(canEditMyanmarTranslation({ translation_locked: false }, 'editor', false).allowed, true);
});

test('computeSuitableRecapDuration preserves story completeness', () => {
  const scenes: VideoScene[] = [
    {
      id: 's1',
      project_id: 'p1',
      scene_index: 1,
      start_sec: 0,
      end_sec: 10,
      keyframe_path: '',
      characters: ['Hero'],
      location: 'City',
      action_summary: 'Hero arrives',
      dialogue_context: '',
      important_events: 'Inciting incident',
      emotional_shift: 'Calm to tense',
      story_position: 'Beginning',
      plot_twist: '',
      importance_score: 9,
      selected: true,
    },
    {
      id: 's2',
      project_id: 'p1',
      scene_index: 2,
      start_sec: 10,
      end_sec: 20,
      keyframe_path: '',
      characters: ['Hero', 'Villain'],
      location: 'Bridge',
      action_summary: 'Betrayal reveal',
      dialogue_context: '',
      important_events: 'Major twist',
      emotional_shift: 'Shock',
      story_position: 'Climax',
      plot_twist: 'Villain is his brother',
      importance_score: 10,
      selected: true,
    },
  ];
  const res = computeSuitableRecapDuration({
    scenes,
    myanmarScript: 'ဇာတ်လမ်းအစမှာ သူရဲကောင်းဟာ မြို့ထဲကို ရောက်လာခဲ့ပါတယ်။ နောက်ဆုံးမှာတော့ ရန်သူဟာ သူ့ညီဖြစ်နေမှန်း သိလိုက်ရပါတယ်။',
  });
  assert.ok(res.recommendedSec >= 15);
  assert.equal(res.importantSceneCount, 2);
});

test('timeline split and snap operations work accurately', () => {
  const clip: TimelineClip = {
    id: 'c1',
    trackId: 't1',
    label: 'Scene 1',
    startSec: 0,
    endSec: 10,
    color: '#8B5CF6',
  };
  const split = splitClipAtTime([clip], 'c1', 4.5);
  assert.equal(split.length, 2);
  assert.equal(split[0].endSec, 4.5);
  assert.equal(split[1].startSec, 4.5);

  const moved = moveClipWithSnap(split[1], 6.13, true, 0.25);
  assert.equal(moved.startSec, 6.25);
  assert.equal(moved.endSec, 11.75);
});

test('filterAndPaginateScenes supports search, filter modes, and pagination', () => {
  const sampleScenes: VideoScene[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `sc_${idx + 1}`,
    project_id: 'p1',
    scene_index: idx + 1,
    start_sec: idx * 5,
    end_sec: (idx + 1) * 5,
    keyframe_path: '',
    characters: idx % 2 === 0 ? ['Aye'] : ['Min'],
    location: idx === 4 ? 'Train Station' : 'Street',
    action_summary: idx === 4 ? 'Sudden ambush at platform' : `Action beat ${idx + 1}`,
    dialogue_context: '',
    important_events: '',
    emotional_shift: '',
    story_position: idx < 3 ? 'Beginning' : 'Climax',
    plot_twist: idx === 7 ? 'Hidden twin revealed' : '',
    importance_score: idx >= 6 ? 9 : 4,
    selected: idx % 2 === 0,
  }));

  const page1 = filterAndPaginateScenes(sampleScenes, { page: 1, pageSize: 6 });
  assert.equal(page1.items.length, 6);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.filteredCount, 10);

  const page2 = filterAndPaginateScenes(sampleScenes, { page: 2, pageSize: 6 });
  assert.equal(page2.items.length, 4);
  assert.equal(page2.items[0].scene_index, 7);

  const selectedOnly = filterAndPaginateScenes(sampleScenes, { filter: 'selected', page: 1, pageSize: 6 });
  assert.equal(selectedOnly.filteredCount, 5);

  const pivotalOnly = filterAndPaginateScenes(sampleScenes, { filter: 'pivotal', page: 1, pageSize: 6 });
  assert.equal(pivotalOnly.filteredCount, 4);

  const searchTrain = filterAndPaginateScenes(sampleScenes, { searchQuery: 'station', page: 1, pageSize: 6 });
  assert.equal(searchTrain.filteredCount, 1);
  assert.equal(searchTrain.items[0].scene_index, 5);
});

test('summarizeWorkflowSteps computes completed, failed, and remaining counts accurately', () => {
  const steps = getModuleSteps('dubbing');
  const jobSteps = steps.map((s) => ({
    step_number: s.stepNumber,
    step_label: s.label,
    status: s.stepNumber <= 4 ? 'completed' : s.stepNumber === 5 ? 'failed' : 'pending',
  }));
  const summary = summarizeWorkflowSteps(steps, jobSteps, 5);
  assert.equal(summary.total, 13);
  assert.equal(summary.completedCount, 4);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.remainingCount, 9);
  assert.equal(summary.currentStepNumber, 5);
  assert.equal(summary.currentStepLabel, 'Speech Recognition (Groq Whisper)');
});

