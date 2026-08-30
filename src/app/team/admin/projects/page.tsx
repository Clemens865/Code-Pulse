"use client";

import { useEffect, useState } from "react";
import { I } from "../../_components/icons";
import { Badge, Btn, cell } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { api, type ApiProject } from "../../_data/api";

type Toast = { kind: "ok" | "err"; text: string } | null;

export default function AdminProjectsPage() {
  const { openPalette } = useShell();
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  const [confirming, setConfirming] = useState<ApiProject | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeWinner, setMergeWinner] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.projects();
      setProjects(r.projects);
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Failed to load" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const onConfirm = async () => {
    if (!confirming) return;
    try {
      await api.confirmProject(confirming.id, renameValue.trim() || undefined);
      setToast({ kind: "ok", text: "Project confirmed" });
      setConfirming(null);
      setRenameValue("");
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Confirm failed" });
    }
  };

  const onArchive = async (p: ApiProject) => {
    if (!confirm(`Archive "${p.name}"? Events will keep flowing in but the project hides from the dashboard.`)) return;
    try {
      await api.updateProject(p.id, { status: "archived" });
      setToast({ kind: "ok", text: "Archived" });
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Archive failed" });
    }
  };

  const onMergeConfirm = async () => {
    if (!mergeWinner) return;
    const losers = [...selected].filter((id) => id !== mergeWinner);
    if (losers.length === 0) return;
    setMergeBusy(true);
    try {
      const r = await api.mergeProjects(mergeWinner, losers);
      setToast({
        kind: "ok",
        text: `Merged ${r.merged.length} project${r.merged.length === 1 ? "" : "s"} into the winner. Old canonical keys survive as aliases.`,
      });
      setMerging(false);
      setMergeWinner(null);
      clearSelection();
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Merge failed" });
    } finally {
      setMergeBusy(false);
    }
  };

  const selectedProjects = projects.filter((p) => selected.has(p.id));

  const needsReview = projects.filter((p) => p.needs_review);
  const confirmed = projects.filter((p) => !p.needs_review);

  return (
    <>
      <Topbar breadcrumbs={["Admin", "Projects"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Projects
          </h1>
          {needsReview.length > 0 && (
            <Badge kind="warn" icon={<I.flag />}>
              {needsReview.length} needs review
            </Badge>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>{projects.length} total</span>
        </div>
      </div>

      {toast && (
        <div
          style={{
            padding: "8px 24px",
            background: toast.kind === "ok" ? "var(--status-ok-bg)" : "var(--status-err-bg)",
            color: toast.kind === "ok" ? "var(--status-ok-fg)" : "var(--status-err-fg)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {toast.text}
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setToast(null)}
            type="button"
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, color: "var(--fg-faint)" }}>Loading…</div>
        ) : (
          <>
            {needsReview.length > 0 && (
              <ProjectSection
                title="Needs review"
                subtitle="Auto-created from incoming events. Confirm or archive."
                projects={needsReview}
                selected={selected}
                onToggleSelect={toggleSelected}
                onConfirm={(p) => {
                  setConfirming(p);
                  setRenameValue(p.name);
                }}
                onArchive={onArchive}
              />
            )}
            <ProjectSection
              title="Confirmed"
              subtitle={confirmed.length === 0 ? "None yet." : ""}
              projects={confirmed}
              selected={selected}
              onToggleSelect={toggleSelected}
              onArchive={onArchive}
            />
          </>
        )}
      </div>

      {selected.size >= 2 && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow-modal)",
            zIndex: 40,
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--fg-strong)", fontWeight: 500 }}>
            {selected.size} selected
          </span>
          <span style={{ color: "var(--fg-faint)", fontSize: 11.5 }}>
            Merge collapses them into one project — events re-point, old keys stay as aliases.
          </span>
          <Btn
            kind="primary"
            onClick={() => {
              const firstId = [...selected][0];
              setMergeWinner(firstId ?? null);
              setMerging(true);
            }}
          >
            Merge selected
          </Btn>
          <Btn kind="ghost" onClick={clearSelection}>
            Cancel
          </Btn>
        </div>
      )}

      {merging && (
        <MergeModal
          projects={selectedProjects}
          winnerId={mergeWinner}
          setWinnerId={setMergeWinner}
          busy={mergeBusy}
          onConfirm={onMergeConfirm}
          onCancel={() => {
            setMerging(false);
            setMergeWinner(null);
          }}
        />
      )}

      {confirming && (
        <ConfirmModal
          project={confirming}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onConfirm={onConfirm}
          onCancel={() => {
            setConfirming(null);
            setRenameValue("");
          }}
        />
      )}
    </>
  );
}

function ProjectSection({
  title,
  subtitle,
  projects,
  selected,
  onToggleSelect,
  onConfirm,
  onArchive,
}: {
  title: string;
  subtitle?: string;
  projects: ApiProject[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onConfirm?: (p: ApiProject) => void;
  onArchive: (p: ApiProject) => void;
}) {
  return (
    <section style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ padding: "12px 24px", display: "flex", alignItems: "baseline", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
        {subtitle && <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>{subtitle}</span>}
      </div>
      {projects.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 36, padding: "8px 8px 8px 24px", borderBottom: "1px solid var(--border)" }} />
              {["Project", "Repo", "Redaction", "Sessions (7d)", "Blockers", "Actions"].map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: i >= 3 && i <= 4 ? "right" : "left",
                    fontWeight: 500,
                    fontSize: 11,
                    color: "var(--fg-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    padding: "8px 14px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 8px 8px 24px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => onToggleSelect(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </td>
                <td style={cell({})}>
                  <div style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{p.name}</div>
                </td>
                <td style={cell({})}>
                  <code className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                    {p.repo}
                  </code>
                </td>
                <td style={cell({})}>
                  <Badge kind={p.redaction === "strict" ? "info" : "neutral"}>{p.redaction}</Badge>
                </td>
                <td style={cell({ right: true, num: true })}>{p.sessions7d}</td>
                <td style={cell({ right: true, num: true })}>
                  {p.blockers > 0 ? (
                    <span style={{ color: "oklch(0.55 0.16 28)" }}>{p.blockers}</span>
                  ) : (
                    <span style={{ color: "var(--fg-faint)" }}>—</span>
                  )}
                </td>
                <td style={cell({})}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {onConfirm && (
                      <Btn kind="primary" onClick={() => onConfirm(p)}>
                        Confirm
                      </Btn>
                    )}
                    <Btn kind="ghost" onClick={() => onArchive(p)}>
                      Archive
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function MergeModal({
  projects,
  winnerId,
  setWinnerId,
  busy,
  onConfirm,
  onCancel,
}: {
  projects: ApiProject[];
  winnerId: string | null;
  setWinnerId: (id: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const winner = projects.find((p) => p.id === winnerId);
  const losers = projects.filter((p) => p.id !== winnerId);
  return (
    <div
      onClick={busy ? undefined : onCancel}
      style={{ position: "fixed", inset: 0, background: "oklch(0.15 0.01 240 / 0.40)", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "10vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: 640,
          maxHeight: "80vh",
          overflowY: "auto",
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal)",
          padding: 18,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Merge {projects.length} projects</h2>
        <p style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 8, lineHeight: 1.5 }}>
          All event rows from the losers re-point to the winner — nothing is deleted. Each loser's
          canonical_key survives as an alias on the winner, so events still in flight under an old
          key resolve correctly. <strong>Pick the winner</strong> — the row that survives:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {projects.map((p) => (
            <label
              key={p.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "8px 10px",
                border: `1px solid ${p.id === winnerId ? "var(--accent)" : "var(--border)"}`,
                background: p.id === winnerId ? "var(--accent-soft)" : "transparent",
                borderRadius: 6,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <input
                type="radio"
                name="merge-winner"
                checked={p.id === winnerId}
                onChange={() => setWinnerId(p.id)}
                disabled={busy}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-strong)" }}>
                  {p.name}
                </div>
                <code className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                  {p.repo}
                </code>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-faint)", whiteSpace: "nowrap" }}>
                {p.sessions7d} sessions · {p.blockers} blocker{p.blockers === 1 ? "" : "s"}
              </div>
            </label>
          ))}
        </div>
        {winner && losers.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              background: "var(--bg-muted)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--fg-muted)",
            }}
          >
            <strong>{winner.name}</strong> will absorb {losers.length} loser{losers.length === 1 ? "" : "s"}:{" "}
            {losers.map((l) => l.name).join(", ")}.
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Btn kind="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn kind="primary" onClick={onConfirm} disabled={busy || !winnerId || losers.length === 0}>
            {busy ? "Merging…" : `Merge ${losers.length} into winner`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  project,
  renameValue,
  setRenameValue,
  onConfirm,
  onCancel,
}: {
  project: ApiProject;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "oklch(0.15 0.01 240 / 0.40)", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "12vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: 520,
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal)",
          padding: 18,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Confirm project</h2>
        <p style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 8 }}>
          {project.repo}
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--fg-muted)" }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
            Display name
          </span>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.currentTarget.value)}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 10px",
              fontFamily: "inherit",
              fontSize: 13,
              color: "var(--fg)",
            }}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Btn kind="ghost" onClick={onCancel}>
            Cancel
          </Btn>
          <Btn kind="primary" onClick={onConfirm}>
            Confirm
          </Btn>
        </div>
      </div>
    </div>
  );
}
