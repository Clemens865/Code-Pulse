// GET /v1/reports/weekly
// Computes the Reports page payload from event_log + insights.
// Range defaults to the trailing 7 days. Compares to the previous 7 days for deltas.

import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dashboardAuth } from "../auth/session.js";
import { problem } from "../lib/errors.js";

export const reports = new Hono();

reports.use("/reports/*", dashboardAuth);

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function rangeFromQuery(c: { req: { query: (k: string) => string | undefined } }) {
  const startStr = c.req.query("start");
  const endStr = c.req.query("end");
  const end = endStr ? new Date(endStr) : new Date();
  const start = startStr ? new Date(startStr) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end };
}

function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return Math.round(((curr - prev) / prev) * 100);
}

function compactNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

// New focused endpoint for the Overview page. Returns everything the page
// needs in one round-trip so we can stop falling back to synthetic
// per-project series in the dashboard.
//
// ?range=24h|7d|30d|90d shapes the KPI window (heatmap is always 91 days
// regardless of range — it's a visual baseline, not a metric).
const RANGE_TO_SQL: Record<string, string> = {
  "24h": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

reports.get("/reports/overview", async (c) => {
  const session = c.get("session");
  const orgId = session.org_id;
  const rangeParam = c.req.query("range") ?? "7d";
  const intervalSql = RANGE_TO_SQL[rangeParam] ?? RANGE_TO_SQL["7d"]!;

  const [orgStats, dailyActivity, topProjects, topContributors] = await Promise.all([
    fetchOrgStats(orgId, intervalSql),
    fetchDailyActivity(orgId, 91),
    fetchTopProjects(orgId, 5, intervalSql),
    fetchTopContributors(orgId, 5, intervalSql),
  ]);

  return c.json({
    generated_at: new Date().toISOString(),
    range: rangeParam,
    org: orgStats,
    daily_activity: dailyActivity,
    top_projects: topProjects,
    top_contributors: topContributors,
  });
});

async function fetchOrgStats(orgId: string, intervalSql: string) {
  // intervalSql is whitelisted (RANGE_TO_SQL) — safe to inline.
  const interval = sql.raw(`INTERVAL '${intervalSql}'`);
  const r = (await db.execute<{
    sessions7d: string;
    decisions7d: string;
    open_blockers: string;
    lines_added7d: string;
    lines_removed7d: string;
    active_members7d: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::text FROM sessions WHERE org_id = ${orgId} AND started_at > NOW() - ${interval}) AS sessions7d,
      (SELECT COUNT(*)::text FROM insights WHERE org_id = ${orgId} AND type = 'decision' AND created_at > NOW() - ${interval}) AS decisions7d,
      (SELECT COUNT(*)::text FROM insights WHERE org_id = ${orgId} AND type = 'blocker' AND resolved_at IS NULL) AS open_blockers,
      (SELECT COALESCE(SUM(lines_added), 0)::text FROM tool_events WHERE org_id = ${orgId} AND ts > NOW() - ${interval}) AS lines_added7d,
      (SELECT COALESCE(SUM(lines_removed), 0)::text FROM tool_events WHERE org_id = ${orgId} AND ts > NOW() - ${interval}) AS lines_removed7d,
      (SELECT COUNT(DISTINCT member_id)::text FROM tool_events WHERE org_id = ${orgId} AND ts > NOW() - ${interval}) AS active_members7d
  `)) as unknown as Array<{
    sessions7d: string;
    decisions7d: string;
    open_blockers: string;
    lines_added7d: string;
    lines_removed7d: string;
    active_members7d: string;
  }>;
  const row = r[0] ?? {
    sessions7d: "0", decisions7d: "0", open_blockers: "0",
    lines_added7d: "0", lines_removed7d: "0", active_members7d: "0",
  };
  const linesAdded = parseInt(row.lines_added7d, 10);
  const linesRemoved = parseInt(row.lines_removed7d, 10);
  return {
    sessions7d: parseInt(row.sessions7d, 10),
    decisions7d: parseInt(row.decisions7d, 10),
    open_blockers: parseInt(row.open_blockers, 10),
    lines_added7d: linesAdded,
    lines_removed7d: linesRemoved,
    lines_net7d: linesAdded - linesRemoved,
    active_members7d: parseInt(row.active_members7d, 10),
  };
}

async function fetchDailyActivity(orgId: string, days: number) {
  const r = (await db.execute<{ d: string; n: string }>(sql`
    WITH window_days AS (
      SELECT generate_series(
        (CURRENT_DATE - (${days - 1}::int) * INTERVAL '1 day')::date,
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS d
    )
    SELECT to_char(window_days.d, 'YYYY-MM-DD') AS d,
           COUNT(s.id)::text AS n
      FROM window_days
      LEFT JOIN sessions s
        ON s.org_id = ${orgId}
       AND DATE(s.started_at) = window_days.d
     GROUP BY window_days.d
     ORDER BY window_days.d ASC
  `)) as unknown as Array<{ d: string; n: string }>;
  return r.map((row) => ({ date: row.d, count: parseInt(row.n, 10) }));
}

async function fetchTopProjects(orgId: string, limit: number, intervalSql: string) {
  const interval = sql.raw(`INTERVAL '${intervalSql}'`);
  const r = (await db.execute<{
    id: string;
    name: string;
    sessions7d: string;
    open_blockers: string;
    lines_added: string;
    lines_removed: string;
  }>(sql`
    SELECT p.id,
           p.name,
           (SELECT COUNT(*)::text FROM sessions s
             WHERE s.project_id = p.id
               AND s.started_at > NOW() - ${interval}) AS sessions7d,
           (SELECT COUNT(*)::text FROM insights i
             WHERE i.project_id = p.id
               AND i.type = 'blocker'
               AND i.resolved_at IS NULL) AS open_blockers,
           (SELECT COALESCE(SUM(lines_added), 0)::text FROM tool_events te
             WHERE te.project_id = p.id
               AND te.ts > NOW() - ${interval}) AS lines_added,
           (SELECT COALESCE(SUM(lines_removed), 0)::text FROM tool_events te
             WHERE te.project_id = p.id
               AND te.ts > NOW() - ${interval}) AS lines_removed
      FROM projects p
     WHERE p.org_id = ${orgId}
       AND p.status = 'active'
     ORDER BY (
       SELECT COUNT(*) FROM sessions s2
        WHERE s2.project_id = p.id
          AND s2.started_at > NOW() - ${interval}
     ) DESC,
     p.name ASC
     LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    name: string;
    sessions7d: string;
    open_blockers: string;
    lines_added: string;
    lines_removed: string;
  }>;
  return r.map((row) => ({
    id: row.id,
    name: row.name,
    sessions7d: parseInt(row.sessions7d, 10),
    open_blockers: parseInt(row.open_blockers, 10),
    lines_added: parseInt(row.lines_added, 10),
    lines_removed: parseInt(row.lines_removed, 10),
  }));
}

async function fetchTopContributors(orgId: string, limit: number, intervalSql: string) {
  const interval = sql.raw(`INTERVAL '${intervalSql}'`);
  const r = (await db.execute<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    sessions7d: string;
    lines_added: string;
    lines_removed: string;
  }>(sql`
    SELECT m.id, m.name, m.email, m.role::text AS role,
           (SELECT COUNT(*)::text FROM sessions s
             WHERE s.member_id = m.id
               AND s.started_at > NOW() - ${interval}) AS sessions7d,
           (SELECT COALESCE(SUM(lines_added), 0)::text FROM tool_events te
             WHERE te.member_id = m.id
               AND te.ts > NOW() - ${interval}) AS lines_added,
           (SELECT COALESCE(SUM(lines_removed), 0)::text FROM tool_events te
             WHERE te.member_id = m.id
               AND te.ts > NOW() - ${interval}) AS lines_removed
      FROM members m
     WHERE m.org_id = ${orgId}
       AND m.status IN ('active', 'stale')
     ORDER BY (
       SELECT COUNT(*) FROM sessions s2
        WHERE s2.member_id = m.id
          AND s2.started_at > NOW() - ${interval}
     ) DESC,
     m.name ASC
     LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    sessions7d: string;
    lines_added: string;
    lines_removed: string;
  }>;
  return r.map((row) => ({
    id: row.id,
    name: row.name ?? row.email,
    role: row.role,
    sessions7d: parseInt(row.sessions7d, 10),
    lines_added: parseInt(row.lines_added, 10),
    lines_removed: parseInt(row.lines_removed, 10),
  }));
}

reports.get("/reports/weekly", async (c) => {
  const session = c.get("session");
  const range = rangeFromQuery(c);
  if (!range) return problem(c, 400, "bad_request", "Invalid start/end");
  const { start, end } = range;
  const periodMs = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - periodMs);
  const startStr = start.toISOString();
  const endStr = end.toISOString();
  const prevStartStr = prevStart.toISOString();

  const orgId = session.org_id;

  // Summary aggregates over [start, end]
  type SummaryRow = {
    sessions: number;
    decisions: number;
    blockers: number;
    lines_added: number;
    lines_removed: number;
    members_active: number;
  };
  const summaryRows = (await db.execute<SummaryRow>(sql`
    SELECT
      (SELECT count(*) FROM event_log
        WHERE org_id = ${orgId} AND event_kind = 'session.start'
          AND received_at >= ${startStr} AND received_at < ${endStr})::int AS sessions,
      (SELECT count(*) FROM insights
        WHERE org_id = ${orgId} AND type = 'decision'
          AND created_at >= ${startStr} AND created_at < ${endStr})::int AS decisions,
      (SELECT count(*) FROM insights
        WHERE org_id = ${orgId} AND type = 'blocker'
          AND created_at >= ${startStr} AND created_at < ${endStr})::int AS blockers,
      COALESCE((SELECT sum(GREATEST(
          length(payload->>'new_string')
            - length(replace(payload->>'new_string', E'\n', '')), 0))::int
        FROM event_log
        WHERE org_id = ${orgId} AND event_kind = 'tool.edit'
          AND received_at >= ${startStr} AND received_at < ${endStr}), 0) AS lines_added,
      COALESCE((SELECT sum(GREATEST(
          length(payload->>'old_string')
            - length(replace(payload->>'old_string', E'\n', '')), 0))::int
        FROM event_log
        WHERE org_id = ${orgId} AND event_kind = 'tool.edit'
          AND received_at >= ${startStr} AND received_at < ${endStr}), 0) AS lines_removed,
      (SELECT count(DISTINCT member_id) FROM event_log
        WHERE org_id = ${orgId}
          AND received_at >= ${startStr} AND received_at < ${endStr})::int AS members_active
  `)) as unknown as SummaryRow[];
  const curr = summaryRows[0];

  const prevRows = (await db.execute<SummaryRow>(sql`
    SELECT
      (SELECT count(*) FROM event_log
        WHERE org_id = ${orgId} AND event_kind = 'session.start'
          AND received_at >= ${prevStartStr} AND received_at < ${startStr})::int AS sessions,
      (SELECT count(*) FROM insights
        WHERE org_id = ${orgId} AND type = 'decision'
          AND created_at >= ${prevStartStr} AND created_at < ${startStr})::int AS decisions,
      (SELECT count(*) FROM insights
        WHERE org_id = ${orgId} AND type = 'blocker'
          AND created_at >= ${prevStartStr} AND created_at < ${startStr})::int AS blockers,
      COALESCE((SELECT sum(GREATEST(
          length(payload->>'new_string')
            - length(replace(payload->>'new_string', E'\n', '')), 0))::int
        FROM event_log
        WHERE org_id = ${orgId} AND event_kind = 'tool.edit'
          AND received_at >= ${prevStartStr} AND received_at < ${startStr}), 0) AS lines_added,
      COALESCE((SELECT sum(GREATEST(
          length(payload->>'old_string')
            - length(replace(payload->>'old_string', E'\n', '')), 0))::int
        FROM event_log
        WHERE org_id = ${orgId} AND event_kind = 'tool.edit'
          AND received_at >= ${prevStartStr} AND received_at < ${startStr}), 0) AS lines_removed,
      (SELECT count(DISTINCT member_id) FROM event_log
        WHERE org_id = ${orgId}
          AND received_at >= ${prevStartStr} AND received_at < ${startStr})::int AS members_active
  `)) as unknown as SummaryRow[];
  const prev = prevRows[0];

  // Org member roster (denominator for "members_active")
  const totalMembersRows = (await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM members
    WHERE org_id = ${orgId} AND status IN ('active', 'stale')
  `)) as unknown as Array<{ n: number }>;
  const totalMembers = totalMembersRows[0]?.n ?? 0;

  // Heatmap: member × day (Mon..Sun localized to UTC for v1)
  const heatRows = (await db.execute<{
    member_id: string;
    day: number;
    n: number;
  }>(sql`
    SELECT
      member_id,
      EXTRACT(DOW FROM received_at)::int AS day,
      count(*)::int AS n
    FROM event_log
    WHERE org_id = ${orgId} AND event_kind = 'session.start'
      AND received_at >= ${startStr} AND received_at < ${endStr}
    GROUP BY member_id, day
  `)) as unknown as Array<{ member_id: string; day: number; n: number }>;

  // Member labels
  const memberRows = await db.query.members.findMany({
    where: (m, { eq }) => eq(m.orgId, orgId),
    columns: { id: true, name: true, email: true },
  });

  // Build heatmap matrix in member-row order, then DAY_LABELS order (Mon=1..Sun=0 → reorder)
  const dowToCol = (d: number) => (d === 0 ? 6 : d - 1); // Sun=0 → col 6 (Sun); Mon=1 → col 0
  const heatMap = new Map<string, number[]>();
  for (const m of memberRows) heatMap.set(m.id, [0, 0, 0, 0, 0, 0, 0]);
  for (const row of heatRows) {
    const arr = heatMap.get(row.member_id);
    if (!arr) continue;
    arr[dowToCol(row.day)] = (arr[dowToCol(row.day)] ?? 0) + row.n;
  }

  // Per-project breakdown
  const byProjectRows = (await db.execute<{
    project_id: string;
    project_name: string;
    sessions: number;
    decisions: number;
    blockers: number;
    lines_added: number;
    lines_removed: number;
    top_contributor: string | null;
  }>(sql`
    WITH events_in_range AS (
      SELECT * FROM event_log
      WHERE org_id = ${orgId}
        AND received_at >= ${startStr} AND received_at < ${endStr}
    ),
    insights_in_range AS (
      SELECT * FROM insights
      WHERE org_id = ${orgId}
        AND created_at >= ${startStr} AND created_at < ${endStr}
    ),
    project_totals AS (
      SELECT
        p.id   AS project_id,
        p.name AS project_name,
        (SELECT count(*) FROM events_in_range e WHERE e.project_id = p.id AND e.event_kind = 'session.start')::int AS sessions,
        (SELECT count(*) FROM insights_in_range i WHERE i.project_id = p.id AND i.type = 'decision')::int AS decisions,
        (SELECT count(*) FROM insights_in_range i WHERE i.project_id = p.id AND i.type = 'blocker')::int AS blockers,
        COALESCE((
          SELECT sum(GREATEST(length(payload->>'new_string') - length(replace(payload->>'new_string', E'\n', '')), 0))::int
          FROM events_in_range e
          WHERE e.project_id = p.id AND e.event_kind = 'tool.edit'
        ), 0) AS lines_added,
        COALESCE((
          SELECT sum(GREATEST(length(payload->>'old_string') - length(replace(payload->>'old_string', E'\n', '')), 0))::int
          FROM events_in_range e
          WHERE e.project_id = p.id AND e.event_kind = 'tool.edit'
        ), 0) AS lines_removed,
        (
          SELECT e2.member_id::text
          FROM events_in_range e2
          WHERE e2.project_id = p.id
          GROUP BY e2.member_id
          ORDER BY count(*) DESC
          LIMIT 1
        ) AS top_contributor
      FROM projects p
      WHERE p.org_id = ${orgId}
    )
    SELECT * FROM project_totals
    WHERE sessions > 0 OR decisions > 0 OR blockers > 0 OR lines_added > 0 OR lines_removed > 0
    ORDER BY sessions DESC, decisions DESC
    LIMIT 50
  `)) as unknown as Array<{
    project_id: string;
    project_name: string;
    sessions: number;
    decisions: number;
    blockers: number;
    lines_added: number;
    lines_removed: number;
    top_contributor: string | null;
  }>;

  const c1 = curr ?? { sessions: 0, decisions: 0, blockers: 0, lines_added: 0, lines_removed: 0, members_active: 0 };
  const p1 = prev ?? { sessions: 0, decisions: 0, blockers: 0, lines_added: 0, lines_removed: 0, members_active: 0 };
  const linesNow = (c1.lines_added ?? 0) + (c1.lines_removed ?? 0);
  const linesPrev = (p1.lines_added ?? 0) + (p1.lines_removed ?? 0);

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    summary: {
      sessions:      { value: c1.sessions,    delta_pct: pctDelta(c1.sessions, p1.sessions) },
      decisions:     { value: c1.decisions,   delta_pct: pctDelta(c1.decisions, p1.decisions) },
      blockers:      { value: c1.blockers,    delta_abs: c1.blockers - p1.blockers },
      lines_changed: { value: compactNumber(linesNow), delta_pct: pctDelta(linesNow, linesPrev) },
      members_active:{ value: `${c1.members_active}/${totalMembers}`, delta_abs: c1.members_active - p1.members_active },
    },
    heatmap: {
      days: DAY_LABELS as unknown as string[],
      members: memberRows.map((m) => ({
        id: m.id,
        name: m.name ?? m.email,
        cells: heatMap.get(m.id) ?? [0, 0, 0, 0, 0, 0, 0],
        total: (heatMap.get(m.id) ?? []).reduce((a, b) => a + b, 0),
      })),
    },
    by_project: byProjectRows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      sessions: r.sessions,
      decisions: r.decisions,
      blockers: r.blockers,
      lines_changed: compactNumber((r.lines_added ?? 0) + (r.lines_removed ?? 0)),
      top_contributor_id: r.top_contributor ?? null,
    })),
  });
});
