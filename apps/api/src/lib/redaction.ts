// Stub redaction pipeline. Applies size cap + diff drop based on the project's policy.
// Regex-based redaction and prompt scrubbing are deferred (see PRD §12).

export type Policy = {
  dropDiffs: boolean;
  hashFilePaths: boolean;
  dropPrompts: boolean;
  regexRedactions: unknown;
  maxPayloadBytes: number;
};

export type RedactionResult<T> = {
  payload: T;
  applied: { droppedDiff?: boolean; truncated?: boolean; sizeBefore?: number; sizeAfter?: number };
  rejected?: { reason: string; detail: string };
};

const DEFAULT_POLICY: Policy = {
  dropDiffs: true,
  hashFilePaths: false,
  dropPrompts: true,
  regexRedactions: [],
  maxPayloadBytes: 65536,
};

export function applyRedaction(
  payload: Record<string, unknown>,
  policy: Policy | null,
): RedactionResult<Record<string, unknown>> {
  const p = policy ?? DEFAULT_POLICY;
  const applied: RedactionResult<unknown>["applied"] = {};

  let result = { ...payload };

  if (p.dropDiffs && "diff" in result) {
    delete (result as Record<string, unknown>).diff;
    applied.droppedDiff = true;
  }

  if (p.dropPrompts && "prompt" in result) {
    delete (result as Record<string, unknown>).prompt;
  }

  const before = JSON.stringify(result).length;
  applied.sizeBefore = before;

  if (before > p.maxPayloadBytes) {
    return {
      payload: result,
      applied,
      rejected: {
        reason: "redaction_policy_violation",
        detail: `payload size ${before}B exceeds policy limit ${p.maxPayloadBytes}B`,
      },
    };
  }

  applied.sizeAfter = before;
  return { payload: result, applied };
}
