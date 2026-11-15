import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.ts';
import { getJobWithSteps, retrySingleJobStep } from './jobRunner.ts';

test('retrySingleJobStep on Step 8 preserves Steps 1-7 completed status and stored outputs', () => {
  const now = new Date().toISOString();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const userRow = db.prepare(`SELECT id FROM users LIMIT 1`).get() as { id: string } | undefined;
  assert.ok(userRow, 'Default user exists');

  const projectId = `proj_reg_${suffix}`;
  const jobId = `job_reg_${suffix}`;

  try {
    db.prepare(
      `INSERT INTO projects (id, user_id, module, name, description, status, active_step, created_at, updated_at)
       VALUES (?, ?, 'dubbing', 'Step 8 Recovery Regression', '', 'Failed', 8, ?, ?)`
    ).run(projectId, userRow.id, now, now);

    db.prepare(
      `INSERT INTO project_settings (project_id, source_language, target_language, selected_voice, updated_at)
       VALUES (?, 'English', 'Myanmar', 'Kore', ?)`
    ).run(projectId, now);

    db.prepare(
      `INSERT INTO processing_jobs (id, user_id, project_id, module, status, current_step, progress_pct, logs_json, error_message, cancel_requested, created_at, updated_at)
       VALUES (?, ?, ?, 'dubbing', 'Failed', 8, 54, '[]', 'Simulated 400 speechMetadata error', 0, ?, ?)`
    ).run(jobId, userRow.id, projectId, now, now);

    const insStep = db.prepare(
      `INSERT INTO job_steps (id, job_id, project_id, step_number, step_key, step_label, status, output_summary, error_details, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const stepKeys = [
      [1, 'create_project', 'Create Dubbing Project', 'completed', 'Project verified'],
      [2, 'import_video', 'Import Video', 'completed', 'Video verified 9s'],
      [3, 'extract_audio', 'Extract Original Audio', 'completed', 'Extracted 16kHz WAV'],
      [4, 'audio_separation', 'Audio Separation', 'completed', 'Separated 3 stems'],
      [5, 'speech_recognition', 'Speech Recognition', 'completed', 'Transcribed 3 segments'],
      [6, 'myanmar_translation', 'Myanmar Translation', 'completed', 'Translated 3 Myanmar segments'],
      [7, 'select_voice', 'Select Single Project Voice', 'completed', 'Locked voice Kore'],
      [8, 'tts_generation', 'Myanmar TTS', 'failed', ''],
      [9, 'timing_adjustment', 'Timing & Pace Alignment', 'pending', ''],
      [10, 'audio_mixing', 'Multi-Stem Audio Mixing', 'pending', ''],
      [11, 'video_sync', 'Video Synchronization', 'pending', ''],
      [12, 'preview_review', 'Preview & Approval', 'pending', ''],
      [13, 'export', 'Export Dubbed MP4', 'pending', ''],
    ] as const;

    for (const [num, key, label, status, summary] of stepKeys) {
      insStep.run(
        `jstep_${jobId}_${num}`,
        jobId,
        projectId,
        num,
        key,
        label,
        status,
        summary,
        num === 8 ? 'HTTP 400 INVALID_ARGUMENT' : '',
        num <= 8 ? now : null,
        num <= 7 ? now : null
      );
    }

    const updated = retrySingleJobStep(jobId, userRow.id, 8);
    assert.ok(updated);
    const steps = (updated.steps || []) as Array<{
      step_number: number;
      status: string;
      output_summary: string;
      completed_at: string | null;
      error_details: string;
    }>;

    // Steps 1-7 must remain completed with original output summaries and timestamps intact
    for (let s = 1; s <= 7; s++) {
      const found = steps.find((st) => st.step_number === s)!;
      assert.equal(found.status, 'completed', `Step ${s} must remain completed`);
      assert.equal(found.completed_at, now, `Step ${s} completed_at must remain unchanged`);
      assert.ok(found.output_summary.length > 0, `Step ${s} output_summary preserved`);
    }

    // Step 8 must have been reset to pending (ready for retry) and error cleared
    const step8 = steps.find((st) => st.step_number === 8)!;
    assert.equal(step8.status, 'pending');
    assert.equal(step8.error_details, '');

    // Downstream steps 9-13 must still be pending until Step 8 succeeds
    for (let s = 9; s <= 13; s++) {
      const found = steps.find((st) => st.step_number === s)!;
      assert.equal(found.status, 'pending', `Step ${s} stays pending until Step 8 succeeds`);
    }
  } finally {
    // Cancel and clean up synthetic regression records immediately
    db.prepare(`UPDATE processing_jobs SET cancel_requested = 1 WHERE id = ?`).run(jobId);
    const check = getJobWithSteps(jobId);
    if (check) {
      db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    }
  }
});
