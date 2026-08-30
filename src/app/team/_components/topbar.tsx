"use client";

import { Fragment, type ReactNode } from "react";
import { I } from "./icons";
import { Kbd } from "./primitives";

export function Topbar({
  breadcrumbs = [],
  right,
  onOpenPalette,
}: {
  breadcrumbs?: string[];
  right?: ReactNode;
  onOpenPalette?: () => void;
}) {
  return (
    <header
      style={{
        height: 44,
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          color: "var(--fg-muted)",
        }}
      >
        {breadcrumbs.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && <I.chevR style={{ color: "var(--fg-faint)" }} />}
            <span
              style={{
                color:
                  i === breadcrumbs.length - 1
                    ? "var(--fg-strong)"
                    : "var(--fg-muted)",
                fontWeight: i === breadcrumbs.length - 1 ? 500 : 400,
              }}
            >
              {b}
            </span>
          </Fragment>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onOpenPalette}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
          padding: "4px 10px 4px 8px",
          borderRadius: 6,
          color: "var(--fg-faint)",
          fontFamily: "inherit",
          fontSize: 12,
          cursor: "pointer",
          minWidth: 240,
        }}
      >
        <I.search />
        <span style={{ flex: 1, textAlign: "left" }}>
          Search insights, members, projects…
        </span>
        <Kbd>⌘K</Kbd>
      </button>
      <button
        type="button"
        aria-label="Notifications"
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg-muted)",
          position: "relative",
        }}
      >
        <I.bell />
        <span
          style={{
            position: "absolute",
            top: 5,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "oklch(0.7 0.15 28)",
          }}
        />
      </button>
      {right}
    </header>
  );
}
