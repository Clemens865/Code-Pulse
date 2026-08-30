-- Claude Code's Stop hook fires after EVERY assistant turn, not at session
-- end. The hook used to map Stop → session.end, so with first-end-wins
-- derivation every multi-turn session was recorded as ending after its first
-- reply (30k+ tool events sat after ended_at).
--
-- The hook now maps Stop → turn.end (summary refresh only) and Claude Code's
-- real SessionEnd hook → session.end. deriveSessionEnd becomes last-wins with
-- GREATEST(ended_at), which also repairs sessions from older hooks that still
-- emit session.end per turn.

ALTER TYPE event_kind ADD VALUE IF NOT EXISTS 'turn.end';
