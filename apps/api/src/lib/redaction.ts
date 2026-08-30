// Server-side redaction pipeline, applied before any durable write.
//
// Layers, in order:
//   1. Null-byte scrub          — always (Postgres jsonb rejects U+0000)
//   2. Secret-pattern pass      — ALWAYS, regardless of policy (API keys,
//                                 tokens, private keys, connection strings)
//   3. Sensitive-path body drop — always: content of .env*/keys/credential
//                                 files never persists (hook drops it too;
//                                 this is defense in depth)
//   4. Policy: dropDiffs        — strips edit/write bodies (old_string /
//                                 new_string / content / diff), keeping
//                                 line counts computed before the strip
//   5. Policy: dropPrompts      — strips prompt text
//   6. Policy: regexRedactions  — org-defined patterns, applied to strings
//   7. Policy: hashFilePaths    — file_path → sha256 prefix (strict mode)
//   8. Size cap                 — rejects payloads over maxPayloadBytes

import { createHash } from "node:crypto";

export type Policy = {
  dropDiffs: boolean;
  hashFilePaths: boolean;
  dropPrompts: boolean;
  regexRedactions: unknown; // jsonb: array of pattern strings
  maxPayloadBytes: number;
};

export type RedactionResult<T> = {
  payload: T;
  applied: {
    droppedDiff?: boolean;
    droppedSensitiveFile?: boolean;
    secretsMasked?: number;
    truncated?: boolean;
    sizeBefore?: number;
    sizeAfter?: number;
    strippedNullBytes?: boolean;
    hashedFilePaths?: boolean;
  };
  rejected?: { reason: string; detail: string };
};

const DEFAULT_POLICY: Policy = {
  dropDiffs: true,
  hashFilePaths: false,
  dropPrompts: true,
  regexRedactions: [],
  maxPayloadBytes: 65536,
};

// ─────────────────────────── secrets ───────────────────────────
// Built-in patterns masked in EVERY payload, whatever the policy says.
// Deliberately high-precision (prefixed token formats, key blocks,
// credential-in-URL) — false positives here destroy real content.
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // GitHub
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g, // GitLab
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /cpt_[a-z0-9]{20,}/g, // our own workstation keys
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@[^\s"']+/g, // creds in URL
  /\b(?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*["']?[A-Za-z0-9_\-/+.]{16,}["']?/gi, // KEY=value
  /Bearer\s+[A-Za-z0-9_\-.=+/]{20,}/g,
];

export function maskSecrets(s: string): { value: string; hits: number } {
  let hits = 0;
  let out = s;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      hits++;
      // Keep a recognizable stub: kind of match, first 4 chars, length.
      return `[REDACTED:${m.slice(0, 4)}…${m.length}ch]`;
    });
  }
  return { value: out, hits };
}

function walkStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => walkStrings(x, fn));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walkStrings(val, fn);
    }
    return out;
  }
  return v;
}

// ─────────────────────────── sensitive paths ───────────────────────────
// Body content of these files never persists, in any policy mode.
const SENSITIVE_PATH_RE =
  /(^|\/)\.env(\.[^/]*)?$|\.pem$|\.key$|(^|\/)id_(rsa|ed25519|ecdsa)[^/]*$|(^|\/)(credentials|\.netrc|\.npmrc|\.pypirc)$|\.p12$|\.pfx$|\.keystore$/;

export function isSensitivePath(p: string): boolean {
  return SENSITIVE_PATH_RE.test(p);
}

// Keys that carry file/edit/prompt bodies.
const BODY_KEYS = ["content", "new_string", "old_string", "new_str", "old_str", "diff"] as const;

function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

// ─────────────────────────── null bytes ───────────────────────────
// Postgres jsonb can't store literal U+0000 (error 22P05). Substitute with
// U+FFFD so the rest of the payload survives.
function stripNullBytes(v: unknown, ctx: { hit: boolean }): unknown {
  return walkStrings(v, (s) => {
    if (!s.includes("\u0000")) return s;
    ctx.hit = true;
    return s.replaceAll("\u0000", "�");
  });
}

// ─────────────────────────── pipeline ───────────────────────────
export function applyRedaction(
  payload: Record<string, unknown>,
  policy: Policy | null,
): RedactionResult<Record<string, unknown>> {
  const p = policy ?? DEFAULT_POLICY;
  const applied: RedactionResult<unknown>["applied"] = {};

  // 1. Null bytes — before anything else so later passes see clean strings.
  const nullCtx = { hit: false };
  let result = stripNullBytes({ ...payload }, nullCtx) as Record<string, unknown>;
  if (nullCtx.hit) applied.strippedNullBytes = true;

  // 2. Secret masking — always on.
  let secretHits = 0;
  result = walkStrings(result, (s) => {
    const r = maskSecrets(s);
    secretHits += r.hits;
    return r.value;
  }) as Record<string, unknown>;
  if (secretHits > 0) applied.secretsMasked = secretHits;

  // 3. Sensitive-path body drop — always on. Path identity survives.
  const filePath = typeof result.file_path === "string" ? result.file_path : null;
  if (filePath && isSensitivePath(filePath)) {
    for (const k of BODY_KEYS) {
      if (k in result) delete result[k];
    }
    result.sensitive_content_dropped = true;
    applied.droppedSensitiveFile = true;
  }

  // 4. dropDiffs — strip bodies but keep line counts for the derive layer.
  if (p.dropDiffs) {
    const newBody = typeof result.new_string === "string" ? result.new_string : typeof result.content === "string" ? result.content : null;
    const oldBody = typeof result.old_string === "string" ? result.old_string : null;
    let dropped = false;
    if (newBody !== null || oldBody !== null || "diff" in result) {
      if (typeof result.lines_added !== "number") result.lines_added = countLines(newBody ?? "");
      if (typeof result.lines_removed !== "number") result.lines_removed = countLines(oldBody ?? "");
      for (const k of BODY_KEYS) {
        if (k in result) {
          delete result[k];
          dropped = true;
        }
      }
    }
    if (dropped) applied.droppedDiff = true;
  }

  // 5. dropPrompts.
  if (p.dropPrompts && "prompt" in result) {
    delete result.prompt;
  }

  // 6. Org-defined regex redactions.
  const orgPatterns = Array.isArray(p.regexRedactions)
    ? (p.regexRedactions as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (orgPatterns.length > 0) {
    const compiled: RegExp[] = [];
    for (const pat of orgPatterns) {
      try {
        compiled.push(new RegExp(pat, "g"));
      } catch {
        // invalid org pattern — skip, never fail ingest over it
      }
    }
    if (compiled.length > 0) {
      result = walkStrings(result, (s) => {
        let out = s;
        for (const re of compiled) out = out.replace(re, "[REDACTED]");
        return out;
      }) as Record<string, unknown>;
    }
  }

  // 7. hashFilePaths (strict mode): stable pseudonym, keeps the extension so
  // language stats survive.
  if (p.hashFilePaths && filePath) {
    const ext = filePath.includes(".") ? "." + filePath.split(".").pop() : "";
    result.file_path = "sha256:" + createHash("sha256").update(filePath).digest("hex").slice(0, 16) + ext;
    applied.hashedFilePaths = true;
  }

  // 8. Size cap.
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
