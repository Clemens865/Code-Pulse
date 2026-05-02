# Claude Pulse Team — Design PRD

*Status: Draft v0.1 — 2026-05-02*
*For: design lead / designer agent producing the v1 visual + interaction system*
*Companion: `docs/team-saas/PRD.md` (product/technical scope)*

---

## 1. What we're designing

A multi-tenant SaaS web app with two surfaces:

1. **Team Dashboard** — daily working surface for engineering managers, agency leads, and developers who want to peek at team activity.
2. **Admin Console** — settings, members, projects, API keys, redaction policies, audit log, billing.

Both live behind OAuth at `app.claude-pulse-team.com` (working title). The product also ships a CLI and a hook script — those are out of scope for this design pass except where they need onboarding screens.

## 2. Brand positioning

**Move away from the open-source Claude Pulse aesthetic.**

The existing single-user Pulse is a developer tool: dark background, violet accents, monospaced typography, density tuned for solo power users. The team product is a different category. Buyers are heads of engineering, agency owners, and (eventually) their clients. They are evaluating it next to Linear, Datadog, Stripe Dashboard, and GitHub Enterprise — not next to Vim plugins.

**Positioning words:**
- Calm, confident, trustworthy.
- Quiet sophistication — not "exciting" or "playful."
- Dense enough for power users; clean enough to show a client.
- Enterprise-credible without looking corporate-stale.

**Anti-positioning (avoid):**
- The dev-tool look: pure black bg, neon accents, monospace headers, terminal motifs.
- The consumer-SaaS look: oversized hero illustrations, gradient buttons, bouncy micro-animations.
- The retro-terminal look: scanlines, ASCII, fake CRT effects.

## 3. Reference set

**Primary references:**
- **Linear** — typography, density, calm motion, command palette, keyboard-first feel.
- **Stripe Dashboard** — enterprise-credible polish, data table excellence, restrained color.
- **Vercel Dashboard** — clean light/dark switching, hierarchical navigation, status communication.
- **Height** — timeline + filtering UX, sidebar density.
- **Datadog (newer surfaces)** — observability density without being scary.

**Secondary references:**
- **GitHub Enterprise** — for the audit log, member management, RBAC patterns.
- **Notion (admin pages only)** — for settings architecture clarity.

**Explicitly NOT references:**
- The current Claude Pulse dashboard (`src/app/page.tsx`, etc. in this repo).
- Heroku-era CLIs, Posthog's playful aesthetic, anything with Comic Sans irony.

## 4. Audiences and modes

| Audience | Frequency | Density tolerance | Key tasks |
|----------|-----------|-------------------|-----------|
| Engineering manager / agency lead | Daily | High | Scan team activity, spot blockers, run reports |
| Developer | Occasional | High | Check what teammates did, search insights |
| Org admin | Weekly | Medium | Invite/remove members, bind projects, set policies |
| Auditor / compliance | Quarterly | High | Read audit log, export data |
| Client (read-only, v1.5) | Monthly | Low | Read sanitized engagement summary |

The app should default to high-density layouts; the client/auditor modes get a quieter, lower-density variant of the same components.

## 5. Information architecture

Top-level navigation (left sidebar, collapsible to icons):

- **Timeline** — live team activity feed (default landing page)
- **Projects** — project list + per-project drill-down
- **Members** — member list + per-member drill-down
- **Insights** — cross-project search of decisions/blockers/progress
- **Reports** — date-range aggregations + export
- **Admin** — only visible to admins
  - Members & roles
  - Projects (binding, redaction)
  - API keys
  - Audit log
  - Org settings
  - Billing

Top bar: org switcher (left), search (center, ⌘K command palette), notifications, user menu.

Breadcrumbs on detail pages. Keyboard shortcuts everywhere — Linear-grade.

## 6. Screens to design (v1)

Numbered for the designer's deliverable list.

### Dashboard surfaces

1. **Timeline (landing)** — live feed of sessions and insights across the org. Filter chips (member, project, event type, date range). Infinite scroll. Each row: who, what, when, project, optional expand for details.
2. **Project list** — table of projects with columns: name, members active, sessions (7d), open blockers, last activity, redaction policy. Sort + filter. "Needs review" badge on auto-created projects.
3. **Project detail** — header (name, repo, members, redaction). Tabs: Overview, Timeline, Insights, Members, Files, Settings. Overview shows summary cards + recent insights + hotspot files.
4. **Member list** — table of org members: avatar, name, role, last seen, projects active, API key status.
5. **Member detail** — recent activity, projects, contributions, sync status.
6. **Insights search** — full-text + faceted search across all insight types. Result rows show type badge, project, member, content excerpt, timestamp.
7. **Reports** — configurable date range + project filter. Renders summary cards (sessions, decisions, blockers, lines changed, members active) + per-project breakdown table + per-member breakdown table. Export CSV.

### Admin surfaces

8. **Members & roles** — invite member modal, role dropdown, deactivate, rotate API key.
9. **Projects (admin)** — bind project, set redaction policy, manage member access, archive.
10. **Needs Review queue** — auto-created projects awaiting confirmation. Bulk actions.
11. **API keys** — per-member keys, last-used, scope, revoke.
12. **Audit log** — append-only table of admin actions, filterable, exportable.
13. **Org settings** — name, billing email, retention, default redaction policy.
14. **Billing** — plan, seat count, invoices.

### Onboarding & system

15. **Sign in** — OAuth (Google/GitHub) buttons, no email/password.
16. **First-run org setup** — name org, invite first members, bind first project.
17. **Empty states** — every list (no projects, no members, no insights yet, no events from this member yet) needs a designed empty state, not a generic "nothing here."
18. **Error states** — API down, key revoked, project access denied, sync stale.
19. **Doctor view** — admin-facing screen showing per-member sync health (mirror of CLI output, web-rendered).

## 7. Interaction patterns

- **Command palette (⌘K)** — global navigation, search insights, jump to project/member, run admin actions. Linear-grade.
- **Keyboard shortcuts** — `g + t` timeline, `g + p` projects, `/` focus search, `j/k` navigate rows, `?` help overlay.
- **Filters as URL state** — every filterable view encodes state in the URL so links are shareable.
- **Live updates via SSE** — timeline auto-prepends new rows; do *not* re-render the whole list; subtle "new" badge that fades.
- **Bulk actions** — select rows with checkbox, bulk-action bar slides up from bottom.
- **Inline editing** — for member roles, project redaction policies, etc., where it doesn't risk a wrong click.
- **Confirmation modals** — only for destructive/irreversible actions (revoke API key, archive project, delete member).
- **Toasts** — for non-blocking confirmations and async results.

## 8. Density

Density is a feature, not a mistake.

- Default row height: ~36–40 px on tables, not 56–64 px.
- Side padding generous, vertical padding tight.
- Show ~25 rows above the fold on a 1440×900 viewport.
- Avatars small (20 px) by default; larger only on detail headers.
- Icons over text labels where ambiguity is low.
- Optional "comfortable" toggle in user settings for those who want a calmer view.

## 9. Visual direction

**Defaults to lock in (designer can refine):**

- **Mode:** Light primary, dark secondary. The original Pulse is dark-only; team product needs both, with light as default for shareability and screenshot-in-a-deck use cases.
- **Type:** Geometric grotesque sans for UI (Inter, Söhne, or Geist). System monospace only inside code/diff/insight excerpt blocks. No display serif.
- **Color:** Restrained neutral palette (grayscale base) + one credible accent (deep blue or teal — *not* violet, to break from open-source Pulse) + semantic colors (green/amber/red) reserved exclusively for status.
- **Spacing:** 4 px base unit, 8 px common rhythm. Page padding ≥24 px desktop.
- **Corners:** 6–8 px radius for cards/inputs/buttons; 4 px for table rows. Avoid pill buttons.
- **Shadows:** minimal — one elevated layer for popovers/modals, none on cards in normal state.
- **Motion:** purposeful, ≤200 ms. No bounce, no spring on layout. Easing: standard Material/iOS curves. Live updates fade rather than slide.
- **Iconography:** stroked icons (Lucide or similar), 16 / 20 / 24 px sizes. Consistent stroke weight.

The designer should produce a tokens file (color, type, spacing, radius, shadow, motion) before building components.

## 10. Component library expectations

Build on top of an existing primitives library (Radix UI or shadcn/ui) — do not draw bespoke. Designer's job is the visual + interaction layer, not reinventing menus.

Core components needed in v1:

- Buttons (primary, secondary, ghost, destructive, icon-only).
- Inputs (text, search, select, multi-select, date range picker).
- Tables (sortable headers, sticky first column, row selection, expandable rows, pagination + infinite scroll variants).
- Cards (default, with header, with footer actions).
- Tabs (pill and underlined variants).
- Avatars + avatar stacks.
- Status badges (colored, semantic).
- Toasts.
- Modals + drawers.
- Command palette.
- Empty states (illustrated, not photographic).
- Skeleton loaders.
- Code/diff blocks.
- Timeline / activity feed component.
- Filter chip rows.
- Sidebars (collapsible).

## 11. State coverage

For every screen, the designer must produce:

- Default state.
- Loading / skeleton state.
- Empty state (with constructive next action).
- Error state.
- Permission-denied state (e.g. non-admin sees "Admin required").
- "Needs review" state where relevant.
- Stale-data state (when sync is lagging).

Don't ship a screen without all seven.

## 12. Accessibility

- WCAG 2.1 AA minimum. AAA where cheap (text contrast on body copy).
- Keyboard navigable end-to-end. Every action reachable without a mouse.
- Focus rings visible — do not suppress them in light mode.
- Respect `prefers-reduced-motion`.
- Color is never the sole carrier of meaning (status badges always have text + icon).
- Screen-reader landmarks on every page.
- Form errors associated with inputs, not just floating tooltips.

This matters for enterprise procurement, not just ethics.

## 13. White-label & theming

Out of scope for v1 *implementation*, but **design must accommodate it**:

- Color tokens must be themeable (logo color, primary accent).
- Logo placement must support customer-uploaded marks.
- Email templates and report PDFs must be themeable.

Producing a co-branded light theme as a worked example would help.

## 14. Mobile

Light support only:

- Dashboard timeline + project view + insights search + reports must be readable on phone (iOS Safari, Android Chrome).
- Admin surfaces are desktop-only — show a graceful "Use desktop for admin" message on small viewports.
- No native app in v1.

## 15. Out of scope for design v1

- Marketing site / landing page.
- Public client portal (designed for, not designed in v1).
- Mobile native app.
- Email template visual design (placeholder only).
- Onboarding video / illustrated walkthrough.
- Internationalization (English-only v1, but copy lengths assume German/French expansion later — leave breathing room).

## 16. Deliverables expected

1. **Tokens file** — color, type, spacing, radius, shadow, motion. As Figma variables and exported JSON.
2. **Component library in Figma** — all primitives in §10, with variants.
3. **Screen designs** — all 19 screens in §6, all seven states in §11.
4. **Interactive prototype** — clickable end-to-end for the four key flows (J1, J3, J5, J6 from PRD §6).
5. **Spec docs** — interaction notes per screen, keyboard shortcut map, motion specs.
6. **Asset export** — icons, illustrations, logo treatments, ready for engineering.
7. **Light + dark themes** for every screen, plus one co-branded example theme.

## 17. Decision-quality checklist for the designer

Before handing off, the designer should be able to answer yes to:

- Could a manager onboard their team and run a weekly report without watching a tutorial?
- Does a developer who has never seen the product understand the timeline view in <30 seconds?
- Does the product look credible next to Linear, Stripe, and GitHub Enterprise in a side-by-side screenshot?
- Are all seven states designed for every screen?
- Is the keyboard map complete and consistent?
- Could an agency screenshot the dashboard into a client deck without embarrassment?

## 18. Risks the designer should push back on

- **Over-density.** Power-user density is the goal, but if a screen needs a magnifying glass, push back.
- **Too many filters.** If the timeline has more than 6 filter dimensions visible by default, push back — move the rest into a collapsed advanced panel.
- **Generic empty states.** "No data yet" is not a design. Empty states must teach the user the next action.
- **Skeuomorphic enterprise tropes.** No fake stamped seals, no fake briefcases, no stock photo handshakes.

---

*Companion docs: `docs/team-saas/PRD.md` for product scope, the open-source Claude Pulse repo for the aesthetic to differentiate from.*
