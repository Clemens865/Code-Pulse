// Sample data for the Claude Pulse Team mocks.
// Ported from the Claude Design HTML prototype (data.js).
// Three personas — agency is the default.

export type MemberStatus = "active" | "stale" | "invited";
export type Role = "Owner" | "Lead" | "Engineer" | "Designer";

export type Member = {
  id: string;
  name: string;
  role: Role;
  init: string;
  last: string;
  hue: number;
  projects: string[];
  status: MemberStatus;
};

export type Project = {
  id: string;
  name: string;
  repo: string;
  members: number;
  sessions7d: number;
  blockers: number;
  lastActivity: string;
  redaction: "standard" | "strict";
  needsReview: boolean;
  hue: number;
};

export type Org = {
  name: string;
  short: string;
  plan: string;
  logo: string;
};

export type Persona = {
  org: Org;
  members: Member[];
  projects: Project[];
};

export type TimelineEventKind =
  | "session.started"
  | "session.ended"
  | "insight.decision"
  | "insight.blocker"
  | "insight.progress"
  | "commit"
  | "project.created";

export type InsightTag = "decision" | "blocker" | "progress";

export type TimelineEvent = {
  kind: TimelineEventKind;
  t: string;
  member: string;
  project: string;
  text: string;
  session_id?: string;
  meta?: {
    tag?: InsightTag;
    sha?: string;
    files?: number;
    plus?: number;
    minus?: number;
  };
};

export type Insight = {
  type: InsightTag;
  project: string;
  member: string;
  t: string;
  title: string;
  text: string;
};

export const personas: Record<"agency" | "startup" | "bigorg", Persona> = {
  agency: {
    org: { name: "Northbeam Studio", short: "NB", plan: "Studio · 12 seats", logo: "N" },
    members: [
      { id: "m1", name: "Maya Iversen", role: "Owner", init: "MI", last: "2m", hue: 212, projects: ["acme", "helio", "mercer"], status: "active" },
      { id: "m2", name: "Ravi Shah", role: "Lead", init: "RS", last: "11m", hue: 156, projects: ["acme", "helio"], status: "active" },
      { id: "m3", name: "Joon Park", role: "Engineer", init: "JP", last: "34m", hue: 28, projects: ["acme"], status: "active" },
      { id: "m4", name: "Elena Voss", role: "Engineer", init: "EV", last: "1h", hue: 340, projects: ["mercer", "helio"], status: "active" },
      { id: "m5", name: "Theo Whitman", role: "Engineer", init: "TW", last: "3h", hue: 268, projects: ["mercer"], status: "active" },
      { id: "m6", name: "Priya Rao", role: "Designer", init: "PR", last: "5h", hue: 192, projects: ["acme", "mercer"], status: "active" },
      { id: "m7", name: "Sasha Kohl", role: "Engineer", init: "SK", last: "2d", hue: 86, projects: ["helio"], status: "stale" },
      { id: "m8", name: "Lin Wei", role: "Engineer", init: "LW", last: "4d", hue: 12, projects: [], status: "invited" },
    ],
    projects: [
      { id: "acme", name: "Acme · Storefront", repo: "northbeam/acme-store", members: 4, sessions7d: 132, blockers: 2, lastActivity: "2m", redaction: "standard", needsReview: false, hue: 212 },
      { id: "helio", name: "Helio Health · Portal", repo: "northbeam/helio-portal", members: 3, sessions7d: 87, blockers: 0, lastActivity: "11m", redaction: "strict", needsReview: false, hue: 156 },
      { id: "mercer", name: "Mercer · Pricing v3", repo: "northbeam/mercer-pricing", members: 4, sessions7d: 64, blockers: 1, lastActivity: "1h", redaction: "standard", needsReview: false, hue: 28 },
      { id: "auto1", name: "unbound-cli", repo: "—", members: 1, sessions7d: 4, blockers: 0, lastActivity: "3h", redaction: "standard", needsReview: true, hue: 268 },
    ],
  },
  startup: {
    org: { name: "Driftbase", short: "DB", plan: "Team · 6 seats", logo: "D" },
    members: [
      { id: "m1", name: "Cal Reyes", role: "Owner", init: "CR", last: "1m", hue: 212, projects: ["core", "infra"], status: "active" },
      { id: "m2", name: "Nora Lin", role: "Engineer", init: "NL", last: "4m", hue: 340, projects: ["core"], status: "active" },
      { id: "m3", name: "Tomás Rivas", role: "Engineer", init: "TR", last: "22m", hue: 156, projects: ["infra", "core"], status: "active" },
      { id: "m4", name: "Aki Tanaka", role: "Engineer", init: "AT", last: "1h", hue: 28, projects: ["core"], status: "active" },
      { id: "m5", name: "Gem Okafor", role: "Engineer", init: "GO", last: "6h", hue: 192, projects: ["infra"], status: "active" },
    ],
    projects: [
      { id: "core", name: "driftbase/core", repo: "driftbase/core", members: 4, sessions7d: 218, blockers: 1, lastActivity: "1m", redaction: "standard", needsReview: false, hue: 212 },
      { id: "infra", name: "driftbase/infra", repo: "driftbase/infra", members: 3, sessions7d: 71, blockers: 0, lastActivity: "22m", redaction: "strict", needsReview: false, hue: 156 },
    ],
  },
  bigorg: {
    org: { name: "Patera Labs", short: "PL", plan: "Enterprise · 64 seats", logo: "P" },
    members: (() => {
      const names = ["Alex Park", "Jordan Wu", "Sam Ortega", "Riley Chen", "Morgan Diaz", "Avery Singh", "Casey Bauer", "Dana Khoury"];
      const last = ["1m", "7m", "15m", "42m", "1h", "2h", "3h", "5h"];
      const hue = [212, 156, 28, 340, 268, 192, 86, 12];
      return names.map((n, i) => ({
        id: "m" + (i + 1),
        name: n,
        role: (i === 0 ? "Owner" : i < 3 ? "Lead" : "Engineer") as Role,
        init: n.split(" ").map((s) => s[0]).join(""),
        last: last[i],
        hue: hue[i],
        projects: ["platform", "growth", "data"].slice(0, (i % 3) + 1),
        status: "active" as MemberStatus,
      }));
    })(),
    projects: [
      { id: "platform", name: "platform", repo: "patera/platform", members: 8, sessions7d: 412, blockers: 3, lastActivity: "1m", redaction: "strict", needsReview: false, hue: 212 },
      { id: "growth", name: "growth-services", repo: "patera/growth-services", members: 5, sessions7d: 188, blockers: 1, lastActivity: "15m", redaction: "standard", needsReview: false, hue: 28 },
      { id: "data", name: "data-pipeline", repo: "patera/data-pipeline", members: 4, sessions7d: 96, blockers: 0, lastActivity: "42m", redaction: "strict", needsReview: false, hue: 156 },
    ],
  },
};

export const timelineSeed: TimelineEvent[] = [
  { kind: "session.started", t: "2m", member: "m1", project: "acme", text: "Started session in storefront/checkout — refining payment intent retry logic." },
  { kind: "insight.decision", t: "8m", member: "m2", project: "helio", text: "Decided to fold patient-record sync into a single nightly job, drop the streaming path.", meta: { tag: "decision" } },
  { kind: "insight.blocker", t: "14m", member: "m3", project: "acme", text: "Stripe webhook signing key rotation needs Acme ops — blocked on access.", meta: { tag: "blocker" } },
  { kind: "commit", t: "22m", member: "m4", project: "mercer", text: "feat(pricing): plan-tier matrix uses computed currencies", meta: { sha: "a8f1c92", files: 6, plus: 142, minus: 48 } },
  { kind: "insight.progress", t: "37m", member: "m2", project: "helio", text: "Portal SSO end-to-end works against staging Okta — 3 of 4 user shapes covered.", meta: { tag: "progress" } },
  { kind: "session.ended", t: "52m", member: "m6", project: "acme", text: "Wrapped 41-min session, 2 decisions, 1 blocker logged." },
  { kind: "insight.decision", t: "1h", member: "m4", project: "mercer", text: "Pricing surface stays server-rendered for v3 — defer client-side pricing to v4.", meta: { tag: "decision" } },
  { kind: "commit", t: "1h", member: "m1", project: "acme", text: "fix(checkout): guard against missing line_items on Apple Pay path", meta: { sha: "4d2e007", files: 2, plus: 18, minus: 6 } },
  { kind: "insight.progress", t: "2h", member: "m5", project: "mercer", text: "Migrated five legacy plan rows; tests green; awaiting product sign-off on rounding rule.", meta: { tag: "progress" } },
  { kind: "project.created", t: "3h", member: "m5", project: "auto1", text: 'Auto-created project from new repo "unbound-cli" — needs review.' },
  { kind: "insight.blocker", t: "4h", member: "m7", project: "helio", text: "PHI redaction rule strips trial cohort IDs we need; requesting policy exemption.", meta: { tag: "blocker" } },
  { kind: "commit", t: "5h", member: "m2", project: "helio", text: "chore(redaction): tighten phone/SSN regex, allow study-id passthrough", meta: { sha: "b71e3a4", files: 3, plus: 41, minus: 22 } },
  { kind: "session.started", t: "6h", member: "m6", project: "mercer", text: "Started session — design pass on plan picker densities." },
  { kind: "insight.decision", t: "8h", member: "m1", project: "acme", text: "Adopted RFC-9457 problem details for all checkout error responses.", meta: { tag: "decision" } },
  { kind: "insight.progress", t: "11h", member: "m3", project: "acme", text: "Cart abandonment job ported off Sidekiq onto durable queue; 0 dropped events overnight.", meta: { tag: "progress" } },
];

export const insights: Insight[] = [
  { type: "decision", project: "acme", member: "m1", t: "8h", title: "Adopt RFC-9457 problem details", text: "All checkout error responses now use application/problem+json; clients updated in same PR." },
  { type: "decision", project: "helio", member: "m2", t: "8m", title: "Consolidate patient-record sync to nightly", text: "Streaming path removed in favor of a single deterministic batch job; rollback documented." },
  { type: "blocker", project: "acme", member: "m3", t: "14m", title: "Stripe webhook signing key rotation", text: "Need Acme ops to provision the new signing secret in their account; blocking checkout deploy." },
  { type: "blocker", project: "helio", member: "m7", t: "4h", title: "PHI redaction strips trial cohort IDs", text: "Current regex is over-broad; requesting policy exemption for study-id namespace." },
  { type: "blocker", project: "mercer", member: "m5", t: "2d", title: "Plan rounding rule undecided", text: "Awaiting product sign-off on banker's rounding vs. always-up for plan migrations." },
  { type: "progress", project: "helio", member: "m2", t: "37m", title: "SSO covers 3/4 user shapes", text: "End-to-end against staging Okta works for clinician, admin, and family-account roles. Patient role pending." },
  { type: "progress", project: "mercer", member: "m5", t: "2h", title: "Migrated five legacy plan rows", text: "All tests green. Awaiting product sign-off on rounding rule before remaining 18." },
  { type: "progress", project: "acme", member: "m3", t: "11h", title: "Cart abandonment job moved to durable queue", text: "Sidekiq retired for this path. Zero dropped events in the overnight window." },
  { type: "decision", project: "mercer", member: "m4", t: "1h", title: "Server-render pricing for v3", text: "Defer client-side pricing to v4; matrix lives behind a feature flag for staged rollout." },
];

export const defaultPersona: Persona = personas.agency;

export function memberById(persona: Persona, id: string): Member | undefined {
  return persona.members.find((m) => m.id === id);
}

export function projectById(persona: Persona, id: string): Project | undefined {
  return persona.projects.find((p) => p.id === id);
}

// ──────────────────── Activity series ────────────────────
// Deterministic per-id daily session counts, suitable for the 90-day heatmap.
// Generated client-side from the seed so SSR + hydration agree.

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ActivityDay = { date: string; count: number };

export function lastNDaysActivity(
  scope: "project" | "member",
  id: string,
  days = 91,
  endDate: Date = new Date(),
): ActivityDay[] {
  const rand = mulberry32(hashSeed(`${scope}:${id}`));
  // Per-id baseline so different projects/members feel distinct.
  const baseline = 1 + Math.floor(rand() * 4); // 1..4
  const peak = baseline + 4 + Math.floor(rand() * 6); // baseline+4..baseline+9
  // ~6 random "surge" days in the window.
  const surgeDays = new Set<number>();
  while (surgeDays.size < 6) surgeDays.add(Math.floor(rand() * days));

  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const out: ActivityDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;

    let count = 0;
    if (rand() < (isWeekend ? 0.35 : 0.92)) {
      const noise = rand();
      const base = isWeekend ? Math.floor(baseline * 0.3) : baseline;
      count = base + Math.floor(noise * (peak - baseline));
    }
    if (surgeDays.has(days - 1 - i)) count = peak + Math.floor(rand() * 4);

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push({ date: `${y}-${m}-${dd}`, count });
  }
  return out;
}

export function orgDailyActivity(persona: Persona, days = 91, endDate: Date = new Date()): ActivityDay[] {
  const seriesByProject = persona.projects.map((p) => lastNDaysActivity("project", p.id, days, endDate));
  if (seriesByProject.length === 0) return [];
  const out: ActivityDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = seriesByProject[0][i]?.date ?? "";
    let count = 0;
    for (const series of seriesByProject) count += series[i]?.count ?? 0;
    out.push({ date, count });
  }
  return out;
}

export type WeekStats = { sessions: number; linesAdded: number; linesRemoved: number };

function weekStatsFromSeries(series: ActivityDay[], rand: () => number): WeekStats {
  const last7 = series.slice(-7);
  const sessions = last7.reduce((acc, d) => acc + d.count, 0);
  const addedPerSession = 22 + Math.floor(rand() * 30); // 22..51
  const removedPerSession = 6 + Math.floor(rand() * 12); // 6..17
  return {
    sessions,
    linesAdded: sessions * addedPerSession,
    linesRemoved: sessions * removedPerSession,
  };
}

export function projectWeekStats(persona: Persona, projectId: string): WeekStats {
  const rand = mulberry32(hashSeed(`pweek:${projectId}`));
  const series = lastNDaysActivity("project", projectId);
  return weekStatsFromSeries(series, rand);
}

export function memberWeekStats(persona: Persona, memberId: string): WeekStats {
  const m = memberById(persona, memberId);
  if (!m) return { sessions: 0, linesAdded: 0, linesRemoved: 0 };
  // Distribute project sessions across project members with a hashed per-member bias.
  const rand = mulberry32(hashSeed(`mweek:${memberId}`));
  let sessions = 0;
  for (const pid of m.projects) {
    const p = projectById(persona, pid);
    if (!p) continue;
    const share = 0.55 + rand() * 0.55; // 0.55..1.10
    sessions += Math.max(0, Math.round((p.sessions7d / Math.max(1, p.members)) * share));
  }
  const addedPerSession = 20 + Math.floor(rand() * 32);
  const removedPerSession = 5 + Math.floor(rand() * 13);
  return {
    sessions,
    linesAdded: sessions * addedPerSession,
    linesRemoved: sessions * removedPerSession,
  };
}

export type OrgStats7d = {
  sessions: number;
  decisions: number;
  blockers: number;
  linesAdded: number;
  linesRemoved: number;
  linesNet: number;
  activeMembers: number;
};

export function orgStats7d(persona: Persona): OrgStats7d {
  const projectTotals = persona.projects.map((p) => projectWeekStats(persona, p.id));
  const sessions = projectTotals.reduce((acc, s) => acc + s.sessions, 0);
  const linesAdded = projectTotals.reduce((acc, s) => acc + s.linesAdded, 0);
  const linesRemoved = projectTotals.reduce((acc, s) => acc + s.linesRemoved, 0);
  const blockers = persona.projects.reduce((acc, p) => acc + p.blockers, 0);
  const decisions = insights.filter((i) => i.type === "decision").length;
  const activeMembers = persona.members.filter((m) => m.status === "active").length;
  return {
    sessions,
    decisions,
    blockers,
    linesAdded,
    linesRemoved,
    linesNet: linesAdded - linesRemoved,
    activeMembers,
  };
}
