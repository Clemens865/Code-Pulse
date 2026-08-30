"use client";

// Generic multi-select filter dropdown — used by Timeline, Projects, Insights.
// Click the chip → opens a popover with checkboxes. Apply on every check
// (no separate "Apply" button — Linear/Stripe pattern).

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { I } from "./icons";

export type FilterOption = {
  id: string;
  label: string;
  hint?: string;
  /** Visual color hue for a leading dot (project / member). Optional. */
  hue?: number;
};

export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  emptyText = "No options",
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const visible = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const clear = () => onChange([]);

  const hasValue = selected.length > 0;
  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label} · ${options.find((o) => o.id === selected[0])?.label ?? "1"}`
        : `${label} · ${selected.length}`;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 12,
          fontFamily: "inherit",
          background: hasValue ? "var(--bg-active)" : "transparent",
          color: hasValue ? "var(--fg-strong)" : "var(--fg-muted)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        {summary} <I.chevron />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            minWidth: 240,
            maxHeight: 360,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-modal)",
            padding: 4,
            fontSize: 12.5,
          }}
        >
          {options.length > 8 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              autoFocus
              style={{
                margin: 4,
                padding: "5px 8px",
                fontSize: 12,
                fontFamily: "inherit",
                border: "1px solid var(--border)",
                borderRadius: 4,
                outline: "none",
              }}
            />
          )}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {visible.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "var(--fg-faint)" }}>{emptyText}</div>
            ) : (
              visible.map((o) => {
                const checked = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "6px 8px",
                      background: checked ? "var(--bg-active)" : "transparent",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--fg)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12.5,
                      fontFamily: "inherit",
                    }}
                  >
                    <CheckboxIcon checked={checked} />
                    {o.hue != null && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: `oklch(0.65 0.13 ${o.hue})`,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {o.label}
                    </span>
                    {o.hint && (
                      <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>{o.hint}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "4px 6px",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={clear}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--fg-muted)",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckboxIcon({ checked }: { checked: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 13,
        height: 13,
        borderRadius: 3,
        border: "1px solid " + (checked ? "var(--accent)" : "var(--border)"),
        background: checked ? "var(--accent)" : "var(--bg)",
        color: "var(--fg-on-accent)",
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

// Single-select chip group (range, status, etc.). Same visual shell.
export function FilterRangeChip<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const summary = `${label} · ${options.find((o) => o.id === value)?.label ?? value}`;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 12,
          fontFamily: "inherit",
          background: "var(--bg-active)",
          color: "var(--fg-strong)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        {summary} <I.chevron />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 30,
            minWidth: 140,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-modal)",
            padding: 4,
          }}
        >
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  textAlign: "left",
                  background: active ? "var(--bg-active)" : "transparent",
                  color: active ? "var(--fg-strong)" : "var(--fg)",
                  fontWeight: active ? 500 : 400,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
