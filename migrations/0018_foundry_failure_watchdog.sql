-- Fail closed instead of leaving a Foundry run in an infinite scheduled retry loop.
-- Any three consecutive execution failures for the run's current stage block the run.

CREATE TRIGGER IF NOT EXISTS foundry_block_after_consecutive_stage_failures
AFTER INSERT ON foundry_events
WHEN NEW.kind IN ('scheduled_step_failed', 'step_failed')
BEGIN
  UPDATE foundry_runs
  SET status = 'blocked',
      updated_at = NEW.created_at
  WHERE run_id = NEW.run_id
    AND status = 'running'
    AND (
      SELECT COUNT(*)
      FROM (
        SELECT kind, message
        FROM foundry_events
        WHERE run_id = NEW.run_id
        ORDER BY created_at DESC, rowid DESC
        LIMIT 3
      ) AS recent
      WHERE recent.kind IN ('scheduled_step_failed', 'step_failed')
        AND LOWER(recent.message) LIKE '%stage ' || LOWER(foundry_runs.stage) || ' failed%'
    ) = 3;

  INSERT INTO foundry_events (event_id, run_id, kind, message, metadata_json, created_at)
  SELECT
    NEW.event_id || '_blocked',
    NEW.run_id,
    'stage_blocked',
    'Foundry blocked this run after three consecutive failures in stage ' || stage || '.',
    '{"reason":"consecutive_stage_failures","failures":3}',
    NEW.created_at
  FROM foundry_runs
  WHERE run_id = NEW.run_id
    AND status = 'blocked'
    AND updated_at = NEW.created_at
    AND NOT EXISTS (
      SELECT 1 FROM foundry_events
      WHERE event_id = NEW.event_id || '_blocked'
    );
END;
