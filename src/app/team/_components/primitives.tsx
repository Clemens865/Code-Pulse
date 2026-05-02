import type { CSSProperties, ReactNode } from "react";
import type { Member } from "../_data/sample";

// ──────────────────── Avatar ────────────────────
export function Avatar({ m, size = 20 }: { m: Member; size?: number }) {
  const bg = `oklch(0.62 0.13 ${m.hue})`;
  return (
    <span
      title={m.name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        fontSize: size <= 20 ? 9.5 : size <= 28 ? 11 : 13,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        letterSpacing: 0,
      }}
    >
      {m.init}
    </span>
  );
}

export function AvatarStack({
  ms,
  max = 4,
  size = 20,
}: {
  ms: Member[];
  max?: number;
  size?: number;
}) {
  const shown = ms.slice(0, max);
  const extra = ms.length - shown.length;
  return (
    <span style={{ display: "inline-flex" }}>
      {shown.map((m, i) => (
        <span
          key={m.id}
          style={{
            marginLeft: i === 0 ? 0 : -6,
            border: "1.5px solid var(--bg)",
            borderRadius: "50%",
            display: "inline-flex",
          }}
        >
          <Avatar m={m} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          style={{
            marginLeft: -6,
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--bg-muted)",
            color: "var(--fg-muted)",
            border: "1.5px solid var(--bg)",
            fontSize: 9,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// ──────────────────── Badge ────────────────────
export type BadgeKind =
  | "ok"
  | "warn"
  | "err"
  | "info"
  | "neutral"
  | "stale"
  | "accent";

const BADGE_MAP: Record<BadgeKind, { bg: string; fg: string; bd: string }> = {
  ok: { bg: "var(--status-ok-bg)", fg: "var(--status-ok-fg)", bd: "var(--status-ok-border)" },
  warn: { bg: "var(--status-warn-bg)", fg: "var(--status-warn-fg)", bd: "var(--status-warn-border)" },
  err: { bg: "var(--status-err-bg)", fg: "var(--status-err-fg)", bd: "var(--status-err-border)" },
  info: { bg: "var(--status-info-bg)", fg: "var(--status-info-fg)", bd: "var(--status-info-border)" },
  neutral: { bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)", bd: "var(--status-neutral-border)" },
  stale: { bg: "var(--status-stale-bg)", fg: "var(--status-stale-fg)", bd: "var(--status-stale-border)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--accent-soft-fg)", bd: "transparent" },
};

export function Badge({
  kind = "neutral",
  icon,
  children,
}: {
  kind?: BadgeKind;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const c = BADGE_MAP[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: "18px",
        borderRadius: 4,
        color: c.fg,
        background: c.bg,
        border: `1px solid ${c.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </span>
  );
}

// ──────────────────── Button + Kbd ────────────────────
export type BtnKind = "primary" | "secondary" | "ghost" | "soft";

export function Btn({
  children,
  kind = "secondary",
  size = "sm",
  icon,
  onClick,
  style,
  type = "button",
}: {
  children?: ReactNode;
  kind?: BtnKind;
  size?: "sm" | "md";
  icon?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  type?: "button" | "submit";
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid transparent",
    borderRadius: 6,
    fontFamily: "inherit",
    fontSize: 12.5,
    fontWeight: 500,
    padding: size === "sm" ? "4px 10px" : "6px 12px",
    height: size === "sm" ? 26 : 30,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition:
      "background var(--dur-fast) var(--ease-std), border-color var(--dur-fast) var(--ease-std)",
  };
  const variants: Record<BtnKind, CSSProperties> = {
    primary: { background: "var(--accent)", color: "var(--fg-on-accent)" },
    secondary: {
      background: "var(--bg)",
      color: "var(--fg)",
      borderColor: "var(--border-strong)",
    },
    ghost: { background: "transparent", color: "var(--fg-muted)" },
    soft: { background: "var(--bg-muted)", color: "var(--fg)", borderColor: "var(--border)" },
  };
  return (
    <button type={type} onClick={onClick} style={{ ...base, ...variants[kind], ...style }}>
      {icon}
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 4px",
        borderRadius: 4,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-subtle)",
        color: "var(--fg-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

// ──────────────────── Filter chip ────────────────────
export function Chip({
  children,
  active,
  hasValue,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  hasValue?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        height: 24,
        borderRadius: 5,
        border:
          "1px solid " +
          (active || hasValue ? "var(--border-strong)" : "var(--border)"),
        background: hasValue ? "var(--bg-active)" : "var(--bg)",
        color: hasValue ? "var(--fg-strong)" : "var(--fg-muted)",
        fontFamily: "inherit",
        fontSize: 12,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

// ──────────────────── Sparkline ────────────────────
export function Sparkline({
  data,
  w = 80,
  h = 18,
  stroke = "var(--accent)",
}: {
  data: number[];
  w?: number;
  h?: number;
  stroke?: string;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(max - min, 1);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

// Shared table-cell style helper (rows pick up density vars from the wrapper)
export function cell({
  right,
  num,
  pad,
}: {
  left?: boolean;
  right?: boolean;
  num?: boolean;
  pad?: string;
} = {}): CSSProperties {
  return {
    padding: pad || "var(--row-pad-y) var(--row-pad-x)",
    fontVariantNumeric: num ? "tabular-nums" : "normal",
    textAlign: right ? "right" : "left",
    verticalAlign: "middle",
  };
}
