"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { I } from "./icons";
import { Kbd } from "./primitives";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "oklch(0.15 0.01 240 / 0.40)",
          backdropFilter: "blur(2px)",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 80,
          left: "50%",
          transform: "translateX(-50%)",
          width: 620,
          maxHeight: 540,
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <I.search />
          <input
            ref={inputRef}
            placeholder="Type a command, search, or jump to…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--fg-strong)",
              fontFamily: "inherit",
              fontSize: 14,
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ overflow: "auto", padding: "6px 0" }}>
          <Section label="Jump to">
            <CmdRow icon={<I.projects />} title="Acme · Storefront" sub="Project" hue={212} active />
            <CmdRow icon={<I.projects />} title="Acme · Storefront → Insights" sub="Project tab" hue={212} />
            <CmdRow icon={<I.members />} title="Maya Iversen" sub="Member" />
          </Section>
          <Section label="Insights">
            <CmdRow icon={<I.decision />} title="Adopt RFC-9457 problem details" sub="Decision · Acme · Storefront" />
            <CmdRow icon={<I.blocker />} title="Stripe webhook signing key rotation" sub="Blocker · Acme · Storefront" />
          </Section>
          <Section label="Actions">
            <CmdRow icon={<I.plus />} title="Bind a new project" sub="Admin → Projects" kbd={["B"]} />
            <CmdRow icon={<I.flag />} title="Mark all needs-review as confirmed" sub="Bulk action" />
            <CmdRow icon={<I.download />} title="Export weekly report" sub="Reports" />
          </Section>
          <Section label="Navigate">
            <CmdRow icon={<I.timeline />} title="Timeline" kbd={["G", "T"]} />
            <CmdRow icon={<I.projects />} title="Projects" kbd={["G", "P"]} />
            <CmdRow icon={<I.insights />} title="Insights" kbd={["G", "I"]} />
          </Section>
        </div>
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 11,
            color: "var(--fg-muted)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> Move
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Kbd>↵</Kbd> Open
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> Open in new tab
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          padding: "6px 14px",
          fontSize: 10.5,
          color: "var(--fg-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function CmdRow({
  icon,
  title,
  sub,
  kbd,
  hue,
  active,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  kbd?: string[];
  hue?: number;
  active?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 14px",
        background: active ? "var(--bg-active)" : "transparent",
        borderLeft: "2px solid " + (active ? "var(--accent)" : "transparent"),
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 5,
          background: hue !== undefined ? `oklch(0.92 0.04 ${hue})` : "var(--bg-muted)",
          color: hue !== undefined ? `oklch(0.35 0.13 ${hue})` : "var(--fg-muted)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--fg-strong)", fontWeight: 450 }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>{sub}</div>}
      </div>
      {kbd && (
        <span style={{ display: "inline-flex", gap: 3 }}>
          {kbd.map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </span>
      )}
    </div>
  );
}
