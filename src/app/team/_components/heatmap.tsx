import type { CSSProperties } from "react";

export type HeatmapDay = { date: string; count: number };

const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const WEEKS = 13;
const TOTAL_DAYS = WEEKS * 7;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  if (r >= 0.75) return 4;
  if (r >= 0.5) return 3;
  if (r >= 0.25) return 2;
  return 1;
}

function colorFor(level: 0 | 1 | 2 | 3 | 4, hue: number): string {
  if (level === 0) return "var(--bg-muted)";
  const lightness = [0, 0.86, 0.74, 0.62, 0.5][level];
  const chroma = [0, 0.06, 0.1, 0.14, 0.17][level];
  return `oklch(${lightness} ${chroma} ${hue})`;
}

export function Heatmap({
  days,
  hue,
  title,
  endDate,
}: {
  days: HeatmapDay[];
  hue: number;
  title?: string;
  endDate?: Date;
}) {
  const end = endDate ?? new Date();
  const endNoon = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // Anchor the right column on the week containing endNoon. Each column is a calendar week (Sun..Sat).
  const endDow = endNoon.getDay();
  const lastColEnd = new Date(endNoon);
  lastColEnd.setDate(endNoon.getDate() + (6 - endDow));
  const firstDay = new Date(lastColEnd);
  firstDay.setDate(lastColEnd.getDate() - (TOTAL_DAYS - 1));

  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const cells: { date: Date; count: number; future: boolean }[] = [];
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const d = new Date(firstDay);
    d.setDate(firstDay.getDate() + i);
    const key = isoDate(d);
    cells.push({
      date: d,
      count: byDate.get(key) ?? 0,
      future: d.getTime() > endNoon.getTime(),
    });
  }

  const max = Math.max(1, ...cells.map((c) => c.count));
  const total = cells.reduce((acc, c) => acc + (c.future ? 0 : c.count), 0);

  const monthMarkers: { col: number; label: string }[] = [];
  for (let col = 0; col < WEEKS; col++) {
    const firstOfCol = cells[col * 7].date;
    const prev = col > 0 ? cells[(col - 1) * 7].date : null;
    if (!prev || firstOfCol.getMonth() !== prev.getMonth()) {
      monthMarkers.push({ col, label: MONTH_LABELS[firstOfCol.getMonth()] });
    }
  }

  const gridWidth = WEEKS * STEP - GAP;
  const gridHeight = 7 * STEP - GAP;
  const labelGutter = 22;
  const monthRow = 14;

  return (
    <div>
      {title && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
            {total.toLocaleString()} sessions · last 90 days
          </span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, overflow: "hidden" }}>
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "relative",
              height: monthRow,
              width: gridWidth,
              marginLeft: labelGutter,
            }}
          >
            {monthMarkers.map((m) => (
              <span
                key={`${m.col}-${m.label}`}
                style={{
                  position: "absolute",
                  left: m.col * STEP,
                  fontSize: 10,
                  color: "var(--fg-faint)",
                  letterSpacing: "0.02em",
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div style={{ display: "flex" }}>
            <div
              style={{
                width: labelGutter,
                height: gridHeight,
                position: "relative",
                fontSize: 9.5,
                color: "var(--fg-faint)",
              }}
            >
              {[
                [1, "Mon"],
                [3, "Wed"],
                [5, "Fri"],
              ].map(([row, label]) => (
                <span
                  key={String(label)}
                  style={{
                    position: "absolute",
                    top: (row as number) * STEP,
                    right: 6,
                    lineHeight: `${CELL}px`,
                  }}
                >
                  {label as string}
                </span>
              ))}
            </div>
            <svg
              width={gridWidth}
              height={gridHeight}
              role="img"
              aria-label={title ?? "Activity heatmap"}
              style={{ display: "block" }}
            >
              {cells.map((c, i) => {
                const col = Math.floor(i / 7);
                const row = i % 7;
                const x = col * STEP;
                const y = row * STEP;
                if (c.future) {
                  return (
                    <rect
                      key={i}
                      x={x}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx={2}
                      fill="transparent"
                      stroke="var(--border)"
                      strokeDasharray="1 1"
                    />
                  );
                }
                const lvl = levelFor(c.count, max);
                const fill = colorFor(lvl, hue);
                return (
                  <rect
                    key={i}
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={fill}
                    stroke="oklch(0 0 0 / 0.04)"
                  >
                    <title>{`${formatLabel(c.date)} — ${c.count} session${c.count === 1 ? "" : "s"}`}</title>
                  </rect>
                );
              })}
            </svg>
          </div>
        </div>
        <Legend hue={hue} />
      </div>
    </div>
  );
}

function Legend({ hue }: { hue: number }) {
  const swatch: CSSProperties = {
    width: CELL,
    height: CELL,
    borderRadius: 2,
    display: "inline-block",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        color: "var(--fg-faint)",
        marginTop: 18,
      }}
    >
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} style={{ ...swatch, background: colorFor(l as 0 | 1 | 2 | 3 | 4, hue) }} />
      ))}
      <span>More</span>
    </div>
  );
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
