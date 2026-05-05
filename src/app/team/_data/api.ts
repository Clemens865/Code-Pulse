// Live API client for the team dashboard.
// Reads NEXT_PUBLIC_API_URL; falls back to localhost:8787.

import type { Insight, Member, Persona, Project, TimelineEvent } from "./sample";

const API_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) throw new ApiError(r.status, `GET ${path} → ${r.status}`);
  return (await r.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return (await r.json()) as T;
}

export type ApiOrg = { id: string; name: string; slug: string; plan: string };
export type ApiMember = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  last_seen: string | null;
  key_status: "active" | "none";
  hook_version: string | null;
  cloud_env: string | null;
};
export type ApiProject = {
  id: string;
  name: string;
  repo: string;
  status: "active" | "archived";
  needs_review: boolean;
  redaction: "standard" | "strict";
  sessions7d: number;
  blockers: number;
  last_activity: string;
};
export type ApiTimelineEvent = {
  id: string;
  kind: string;
  session_id: string | null;
  member_id: string;
  project_id: string;
  payload: Record<string, unknown>;
  hook_ts: string;
  received_at: string;
};

export type DevListOrg = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  members: Array<{ id: string; name: string; email: string; role: string; status: string }>;
};

export const api = {
  devLogin: (orgId: string, memberId: string) =>
    post<{ ok: boolean }>("/v1/auth/dev-login", { org_id: orgId, member_id: memberId }),
  devList: () => get<{ orgs: DevListOrg[] }>("/v1/auth/dev-list"),
  logout: () => post<{ ok: boolean }>("/v1/auth/logout", {}),
  me: () => get<{ member: ApiMember; org: ApiOrg }>("/v1/auth/me"),
  projects: () => get<{ projects: ApiProject[] }>("/v1/projects"),
  project: (id: string) =>
    get<{
      project: { id: string; name: string; repo: string; redaction: string; needs_review: boolean };
      recent_insights: Array<{
        id: string;
        type: Insight["type"];
        title: string;
        content: string;
        member_id: string;
        created_at: string;
      }>;
      hot_files: Array<{ path: string; edits: number }>;
    }>(`/v1/projects/${encodeURIComponent(id)}`),
  members: () => get<{ members: ApiMember[] }>("/v1/members"),
  timeline: (limit = 50, projectId?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (projectId) params.set("project", projectId);
    return get<{ events: ApiTimelineEvent[] }>(`/v1/timeline?${params}`);
  },
  insights: (opts: { q?: string; projects?: string[]; types?: string[] } = {}) => {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.projects && opts.projects.length > 0) params.set("projects", opts.projects.join(","));
    if (opts.types && opts.types.length > 0) params.set("types", opts.types.join(","));
    const qs = params.toString();
    return get<{
      insights: Array<{
        id: string;
        type: Insight["type"];
        title: string;
        content: string;
        member_id: string;
        project_id: string;
        created_at: string;
      }>;
    }>(`/v1/insights${qs ? `?${qs}` : ""}`);
  },
  reportsWeekly: () => get<ApiWeeklyReport>("/v1/reports/weekly"),
  reportsOverview: () => get<ApiOverviewReport>("/v1/reports/overview"),
  session: (id: string) => get<ApiSessionDetail>(`/v1/sessions/${encodeURIComponent(id)}`),
  // Admin
  inviteMember: (email: string, name: string | undefined, role: ApiRole) =>
    post<{ id: string; status: string; deduped: boolean }>("/v1/members/invite", { email, name, role }),
  updateMember: (id: string, patch: { role?: ApiRole; status?: "active" | "stale" | "deactivated"; name?: string }) =>
    request<{ ok: boolean }>("PATCH", `/v1/members/${id}`, patch),
  issueKey: (memberId: string, label?: string) =>
    post<{ id: string; label: string | null; last4: string; plaintext: string; created_at: string }>(
      `/v1/members/${memberId}/keys`,
      { label },
    ),
  listKeys: () =>
    get<{
      keys: Array<{
        id: string;
        memberId: string;
        label: string | null;
        last4: string;
        lastUsedAt: string | null;
        createdAt: string;
        revokedAt: string | null;
        status: "active" | "revoked";
      }>;
    }>("/v1/admin/api-keys"),
  revokeKey: (id: string) => request<{ ok: boolean }>("DELETE", `/v1/api-keys/${id}`),
  confirmProject: (id: string, name?: string) =>
    post<{ ok: boolean }>(`/v1/projects/${id}/confirm`, { name }),
  updateProject: (id: string, patch: { name?: string; needs_review?: boolean; status?: "active" | "archived" }) =>
    request<{ ok: boolean }>("PATCH", `/v1/projects/${id}`, patch),
  auditLog: () =>
    get<{
      entries: Array<{
        id: number;
        ts: string;
        actor_member_id: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        payload: Record<string, unknown>;
      }>;
    }>("/v1/audit-log"),
};

export type ApiRole = "owner" | "admin" | "lead" | "member";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`${API_URL}${path}`, init);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  return (await r.json()) as T;
}

export type ApiSessionDetail = {
  session: {
    id: string;
    project: { id: string; name: string; remoteUrl: string | null } | null;
    member: { id: string; name: string | null; email: string; role: string } | null;
    started_at: string;
    ended_at: string;
    duration_seconds: number;
    hostname: string | null;
    cloud_env: string | null;
    hook_version: string | null;
    os: string | null;
  };
  stats: {
    events: number;
    lines_added: number;
    lines_removed: number;
    net_lines: number;
    files: number;
    tools: number;
    bash_failures: number;
  };
  events: Array<{
    id: string;
    kind: string;
    member_id: string;
    payload: Record<string, unknown>;
    hook_ts: string;
    received_at: string;
  }>;
};

export type ApiOverviewReport = {
  generated_at: string;
  org: {
    sessions7d: number;
    decisions7d: number;
    open_blockers: number;
    lines_added7d: number;
    lines_removed7d: number;
    lines_net7d: number;
    active_members7d: number;
  };
  daily_activity: Array<{ date: string; count: number }>;
  top_projects: Array<{
    id: string;
    name: string;
    sessions7d: number;
    open_blockers: number;
    lines_added: number;
    lines_removed: number;
  }>;
  top_contributors: Array<{
    id: string;
    name: string;
    role: string;
    sessions7d: number;
    lines_added: number;
    lines_removed: number;
  }>;
};

export type ApiWeeklyReport = {
  range: { start: string; end: string };
  summary: {
    sessions: { value: number; delta_pct: number };
    decisions: { value: number; delta_pct: number };
    blockers: { value: number; delta_abs: number };
    lines_changed: { value: string; delta_pct: number };
    members_active: { value: string; delta_abs: number };
  };
  heatmap: {
    days: string[];
    members: Array<{ id: string; name: string; cells: number[]; total: number }>;
  };
  by_project: Array<{
    project_id: string;
    project_name: string;
    sessions: number;
    decisions: number;
    blockers: number;
    lines_changed: string;
    top_contributor_id: string | null;
  }>;
};

// ──────────────────── Adapters ────────────────────
// The dashboard's existing components are typed against the sample shapes.
// These adapters normalize API responses into those shapes so we can swap data
// sources without rewriting the UI.

export function adaptApiPersona(
  org: ApiOrg,
  apiMembers: ApiMember[],
  apiProjects: ApiProject[],
): Persona {
  const members: Member[] = apiMembers.map((m, idx) => {
    const init = (m.name || m.email).split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
    const hue = hueFromString(m.id, idx);
    return {
      id: m.id,
      name: m.name || m.email.split("@")[0]!,
      role: capRole(m.role),
      init,
      last: m.last_seen ? relativeTime(m.last_seen) : "—",
      hue,
      projects: [], // filled below
      status: m.status === "active" ? "active" : m.status === "deactivated" ? "stale" : (m.status as Member["status"]),
    };
  });

  const projects: Project[] = apiProjects.map((p, idx) => ({
    id: p.id,
    name: p.name,
    repo: p.repo,
    members: 0,
    sessions7d: p.sessions7d,
    blockers: p.blockers,
    lastActivity: relativeTime(p.last_activity),
    redaction: p.redaction,
    needsReview: p.needs_review,
    hue: hueFromString(p.id, idx),
  }));

  return {
    org: { name: org.name, short: org.slug.toUpperCase().slice(0, 3), plan: org.plan, logo: org.name.slice(0, 1).toUpperCase() },
    members,
    projects,
  };
}

export function adaptApiTimeline(events: ApiTimelineEvent[]): TimelineEvent[] {
  return events.map((e) => ({
    kind: mapEventKind(e.kind),
    t: relativeTime(e.received_at),
    member: e.member_id,
    project: e.project_id,
    text: extractText(e.payload),
    session_id: e.session_id ?? undefined,
    meta: extractMeta(e.kind, e.payload),
  }));
}

export function adaptApiInsights(
  apiInsights: Array<{
    id: string;
    type: Insight["type"];
    title: string;
    content: string;
    member_id: string;
    project_id: string;
    created_at: string;
  }>,
): Insight[] {
  return apiInsights.map((i) => ({
    type: i.type,
    project: i.project_id,
    member: i.member_id,
    t: relativeTime(i.created_at),
    title: i.title || i.content.slice(0, 80),
    text: i.content,
  }));
}

// ──────────────────── small helpers ────────────────────
const HUES = [212, 156, 28, 340, 268, 192, 86, 12];
function hueFromString(s: string, fallbackIdx: number): number {
  const code = s.charCodeAt(0) || fallbackIdx;
  return HUES[code % HUES.length] ?? 212;
}
function capRole(r: string): Member["role"] {
  const roles: Record<string, Member["role"]> = {
    owner: "Owner",
    admin: "Owner",
    lead: "Lead",
    member: "Engineer",
  };
  return roles[r.toLowerCase()] ?? "Engineer";
}
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
function mapEventKind(k: string): TimelineEvent["kind"] {
  if (k.startsWith("session.")) return k as TimelineEvent["kind"];
  if (k.startsWith("insight.")) return k as TimelineEvent["kind"];
  if (k === "blueprint.run") return "session.started";
  return "commit"; // tool events render as a generic activity row
}
function extractText(payload: Record<string, unknown>): string {
  if (typeof payload["file_path"] === "string") return `Edited ${payload["file_path"]}`;
  if (typeof payload["command"] === "string") return String(payload["command"]).slice(0, 200);
  if (typeof payload["content"] === "string") return String(payload["content"]).slice(0, 200);
  return "";
}
function extractMeta(kind: string, payload: Record<string, unknown>): TimelineEvent["meta"] {
  if (kind.startsWith("insight.")) {
    return { tag: kind.split(".")[1] as "decision" | "blocker" | "progress" };
  }
  return undefined;
}
