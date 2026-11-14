# UX compliance — Málaga 2026 UX support guide

Compliance plan and audit against the **NASA Space Apps Challenge Málaga 2026 ·
UX support guide** ("Guía de apoyo · UX", Ladies That UX Málaga / Eliana
Crivaro, 4 pages, 7 requirements). The guide states that its examples are
orientative — there is more than one valid solution — but that its **minimum
values are the reference that should be met**.

This document is the shared contract for both machines:

- it records **what the guide requires** and **how the product complies**;
- it lists the **gaps** with measured evidence;
- it defines which **important changes require explicit permission** and the
  change-control process to request it.

> Source material: `resources_orig/[UX] NASA Space Apps Challenge Málaga/Guía de
> apoyo · UX.pdf` (event Drive folder, see `docs/data.md`).
> Scope: the product UI — landing page (`/`) and mission console (`/#/tool`) —
> including its states, copy and accessibility, in English and Spanish.

---

## 1. Compliance summary

| # | Requirement (guide) | Minimum values / criteria | Status | Approval / implementation |
| --- | --- | --- | --- | --- |
| 01 | **Purpose at a glance** — the product explains itself when opened: what it is, for whom, what can be done | Clear title, one sentence, one prominent button (vs. only a logo and "Start") | ✅ Compliant | — |
| 02 | **Main flow** — the path to the most important thing the product offers; every step leads to the next; no dead-ends | No screen without a way forward or back | ✅ Implemented | `CR-05` — three-step guide + first-run hint |
| 03 | **Hierarchy and patterns** — the eye goes first to what matters; the same elements repeat on every screen; one primary button | One primary action per screen; consistent components | ✅ Implemented | `CR-04` — single primary action per surface |
| 04 | **Readability** — readable by size and by words | Web body **16 px**, secondary **never below 12 px**; max 3 type families | ✅ Implemented | `CR-01` — minimum 12 px, body 16 px |
| 05 | **Contrast and colour** — light difference text/background; never colour as the only signal | Text **4.5:1**; large text, icons and borders **3:1**; verified with WebAIM Contrast Checker or grayscale | ✅ Implemented | `CR-03` — all measured pairs pass |
| 06 | **Tap/click targets** — the whole button responds, not only its text/icon | iOS 44×44 pt · Android 48×48 dp · Web **44×44 px (minimum 24)** · 8 px separation · no hover on mobile | ✅ Implemented | `CR-02` — 24 px minimum, 44 px on phones |
| 07 | **System response** — what happens after each action, during waits, and on errors/empty screens | Every step responds and says how it is going; no technical error without what to do next | ✅ Implemented | `CR-06` — plain-language errors with next action |

The product already meets the guide's **purpose, flow skeleton, component
consistency, colour-not-as-only-signal, loading/empty states and accessibility
infrastructure** (semantic landmarks, `:focus-visible`, `prefers-reduced-motion`,
`aria-live`, `role="alert"`). The gaps are concentrated in **type scale, touch
targets, contrast of one button style and technical error copy**.

---

## 2. Requirement-by-requirement audit

### 01 · Purpose at a glance — ✅ compliant

**Guide asks:** the product explains itself on open: what it is, for whom, what
you can do with it. Good: clear title, one sentence, one prominent button. Bad:
only a big logo and "Start".

**Product:** the landing page (`src/landing/LandingPage.vue`) opens with the
project title, a one-sentence subtitle ("Compare lunar south-pole landing sites
and dates…"), the event/challenge chips and one primary CTA ("Open the tool"),
with a secondary "Read the documentation". This is exactly the recommended
pattern.

**Evidence:** landing DOM at `/` contains title, subtitle and a single primary
button; the console is reachable from the CTA and from `/#/tool`.

**Note:** a direct `/#/tool` URL does not carry the one-sentence explanation; the
landing is the documented entry point (`README.md` → *Entry points*).

---

### 02 · Main flow — 🟡 partial

**Guide asks:** the path to the most important thing the product offers. Every
step leads to the next until the flow can be completed. Bad: a screen with no
way to continue or go back.

**Product:** flow is `landing → Open the tool → select a site → choose a date →
read horizon/power/comms → run autopilot → export JSON brief`. The console has a
persistent footer/back link "← Project overview"; the boot overlay reports
progress; the export completes the flow with a downloadable brief.

**Gap:** first-time users are not told the flow explicitly. There is no 3-step
"how it works" hint on the landing or on first entry, and the secondary panels
(diagnostics, worker status) can look like dead ends even though tabs and the
footer remain available.

**Action:** add a short three-step "How to use it" strip to the landing and a
one-line contextual hint on first entry to the console (`CR-05`).

---

### 03 · Hierarchy and patterns — 🟡 partial

**Guide asks:** order the screen so the eye goes first to what matters, and repeat
the same elements; **one primary button**; bad: buttons without hierarchy or a
different design on each screen.

**Product:** a component system is in place: `PanelCard`, `StatRow`, `TabBar`,
`Sparkline`, `ResizeHandle`, and the 13 panels share the same header/section
structure. The landing has exactly one primary CTA.

**Gap:** the console can show **two primary buttons at once** (header "Export JSON
brief" and, on the Custom tab, "Add custom site"), and control sizes are
inconsistent (11 px button labels vs. larger panel titles).

**Action:** define a single primary action per view and demote the second one to
secondary (`CR-04`).

---

### 04 · Readability — 🔴 gap

**Guide asks:** text readable by its size and by its words. Minimum values (the
reference to meet): **web body 16 px**, secondary text **never below 12 px**,
**up to 3 type families**. Bad: technical words and tiny letters.

**Measured in the product:** the type scale is much smaller than the minimum.
The stylesheet contains **12 declarations at 9 px**, 14 at 9.5 px, 14 at 10 px,
17 at 11 px, plus 8 px and 8.5 px values; the automated device matrix reports a
**minimum computed font size of 9 px on all 104 runs**. Two type families are
used (`--font-ui`, `--font-mono`), which satisfies the 3-family limit.

**Gap:** body text is typically 11–14 px (should be 16 px), and secondary labels
fall below the 12 px minimum.

**Action:** raise the design tokens: 16 px body, ≥12 px for every secondary label,
keeping the two families (`CR-01`). Re-run the device matrix and landing checks.

---

### 05 · Contrast and colour — 🔴 gap

**Guide asks:** enough light difference between text and background; never use
colour as the only signal. Minimum values: text **4.5:1**, large text/icons/borders
**3:1**; verify with WebAIM Contrast Checker or in grayscale.

**Measured (WCAG 2.1 formula, design tokens):**

| Pair | Ratio | Verdict |
| --- | ---: | --- |
| Primary text `#e5e9f0` on background `#080a0e` | 16.27:1 | ✅ |
| Primary text on surface `#0d1016` | 15.64:1 | ✅ |
| Secondary `#9aa4b5` on surface | 7.57:1 | ✅ |
| Faint `#697386` on surface | **3.99:1** | 🔴 below 4.5 (used for 9–11 px labels) |
| Accent `#5b8def` on surface | 5.90:1 | ✅ |
| OK `#4fa877` / warn `#c9973f` / danger `#d9645c` on surface | 6.53 / 7.24 / 5.38:1 | ✅ |
| **Primary button label `#f4f7ff` on accent `#5b8def`** | **3.01:1** | 🔴 fails 4.5 for normal-size text |
| UI border `#2a3342` on surface | 1.50:1 | 🔴 below 3:1 for component boundaries |

**Colour as the only signal:** ✅ does not happen for meaning — visibility states
are rendered with words ("Visible"/"Hidden"), chips carry labels, and chart
series have legends. Verify once in grayscale.

**Gap:** primary button contrast, faint text and control borders.

**Action:** darken the accent or switch button labels to a dark text colour
(≥4.5:1), raise the faint token (≥4.5:1), strengthen control borders (≥3:1)
(`CR-03`), then re-check with WebAIM and in grayscale.

---

### 06 · Tap/click targets — 🔴 gap

**Guide asks:** the responding area is the whole button, not just the text/icon.
Minimum values: iOS **44×44 pt**, Android **48×48 dp**, web **44×44 px (minimum
24)**, **8 px** separation; on mobile there is no hover.

**Measured:** the automated device matrix reports **20 target violations per run,
on 104/104 runs** — panel header toggles are **16–21 px** tall and several small
buttons/links are **14–17 px** tall (the stylesheet's base button is 11 px text
with `padding: 4px 9px`).

**Gap:** controls are below the 24 px minimum on every device class.

**Action:** enforce 44×44 px targets (never below 24×24) with 8 px separation,
and keep hover-only affordances out of mobile flows (`CR-02`). Re-run the device
matrix; the `@ui/interactive-targets` check must reach a pass.

---

### 07 · System response — 🟡 partial

**Guide asks:** what happens after each action, during waits, and on errors and
empty screens. Good: every step responds and says how it is going. Bad: technical
error with no indication of what to do.

**Product:** boot overlay with `role="status"`/`aria-live`, per-action busy states
("Computing…", "Running…", export busy), empty states for every panel ("No sites
match the search", "No ranking yet — run the autopilot"), retry buttons and toasts
with `role="alert"`.

**Gap:** several error paths render **raw technical strings** from the worker and
export layers (`state.worker.error`, `state.export.error`), without a plain-language
explanation or a next action.

**Action:** map errors to user-facing copy with a suggested action (retry / open
diagnostics), keep the technical detail in the diagnostics panel (`CR-06`).

**Support:** the guide offers the UX stand ("¿Os habéis atascado?" — Eliana
Crivaro) for a review; booking one review before the submission is recommended.

---

## 3. Important changes — explicit permission required

The following changes affect the visual system, navigation or submission-facing
copy. Per the team rule, **they must not be implemented or merged without
explicit approval from the Team Owner**, and they must be coordinated between the
two machines (one machine holds the repository lock while implementing).

| ID | Change | Why (guide) | Affected files | Risk / QA needed | Approval |
| --- | --- | --- | --- | --- | --- |
| `CR-01` | Type scale: 16 px body, ≥12 px secondary labels | 04 Readability | `src/styles/main.css`, components, landing | Layout reflow; re-run unit tests + device matrix + landing overflow checks | ✅ Implemented |
| `CR-02` | Touch targets: 44×44 px (min 24) + 8 px separation | 06 Tap targets | `src/styles/main.css`, panel/shell components | Denser screens; re-run device matrix (`@ui/interactive-targets`) | ✅ Implemented |
| `CR-03` | Contrast: primary button ≥4.5:1, faint text ≥4.5:1, borders ≥3:1 | 05 Contrast | `src/styles/main.css` (tokens) | Visual identity change; WebAIM + grayscale check | ✅ Implemented |
| `CR-04` | One primary action per screen; demote the second primary | 03 Hierarchy | `HeaderBar.vue`, `CustomSitePanel.vue`, landing | None functional; manual review EN/ES | ✅ Implemented |
| `CR-05` | First-run "how to use it" (3 steps) on landing + console hint | 02 Main flow | `LandingPage.vue`, i18n EN/ES, console shell | Copy must be accurate; EN/ES parity | ✅ Implemented |
| `CR-06` | Plain-language errors with a next action | 07 System response | error paths in console panels, i18n EN/ES | Behaviour unchanged; copy review | ✅ Implemented |
| `CR-07` | Book one review with the event UX stand | Support offer | none (process) | Scheduling only | Pending (external) |

**Recommendation:** implement in the order `CR-03` → `CR-02` → `CR-01` (tokens
first, layout after), each as a separate branch with its own device-matrix run.

---

## 4. Change-control process (both machines)

A change is **important** if it touches any of: the visual system/design tokens,
routes or navigation, submission-facing copy, dependencies, the data model, the
deployment configuration, or more than five files.

1. **Propose** — open an issue titled `[change] …` with the rationale, the guide
   reference, affected screens and expected impact.
2. **Ask permission** — request explicit approval from the Team Owner in the
   session log. No implementation before approval.
3. **Coordinate** — the implementing machine acquires the repository lock
   (`node scripts/machine-lock.mjs run --purpose "…" -- <command>`); the other
   machine does not push, deploy or use the shared test bench meanwhile.
4. **Implement** — on a short-lived branch (`feature/…`, `fix/…`), in English,
   with both EN/ES messages updated together.
5. **Verify** — `npm test`, `npm run build`, the QA device matrix
   (`node qa/ui/ui-matrix.mjs`) and, for copy changes, a manual EN/ES pass.
6. **Review and merge** — pull request describing the change and the verification;
   merge only with approval on record.
7. **Record** — note the decision in `docs/decisions.md` and, when relevant, in
   the impact/scalability or submission documents.

---

## 5. Pre-submission verification checklist

- [ ] **Contrast:** text ≥ 4.5:1 and large text/icons/borders ≥ 3:1 (WebAIM
      Contrast Checker); grayscale pass for every status colour.
- [ ] **Readability:** body 16 px web, secondary ≥ 12 px, ≤ 3 type families.
- [ ] **Targets:** 44×44 px web (never below 24), 8 px separation; no hover-only
      action on mobile.
- [ ] **Purpose:** landing opens with title + one sentence + one primary button.
- [ ] **Flow:** every screen offers a way forward and back; export completes the
      brief flow.
- [ ] **Hierarchy:** one primary action per screen; components consistent.
- [ ] **System response:** loading, empty and error states exist; errors are
      plain language and say what to do.
- [ ] **Accessibility:** semantic landmarks (`header`/`main`/`footer`), focus
      visible, `aria-live` on async status, reduced-motion respected, EN/ES parity.
- [ ] **Devices:** 320, 360, 390, 414, 768, 1024, 1440, 1920 px and no-WebGL
      fallback, with no horizontal overflow.
- [ ] **QA evidence:** device matrix and Monte Carlo bench re-run on the release
      commit; results recorded in `qa/REPORT.md`.

---

## 7. Implementation status (2026-11-14)

The fixes were implemented after explicit permission, in six logical commits on
`feature/ux-compliance`:

| CR | Change | Files |
| --- | --- | --- |
| `CR-03` | Contrast: dark label on the blue primary button (5.80:1), faint text `#808b9e` (5.54:1), control borders `#556176` (3.04:1) | `src/styles/main.css` |
| `CR-02` | Touch targets: 24 px minimum for every control, 44 px for buttons/segmented/locale on phones, 8 px separation, footer and landing links included | `src/styles/main.css`, `src/landing/LandingPage.vue` |
| `CR-01` | Type scale: every font size ≥12 px, body 16 px, landing reading text 16 px | `src/styles/main.css`, `src/landing/LandingPage.vue`, `src/Root.vue` |
| `CR-04` | One primary action per surface: the custom-site submit is now secondary | `src/components/panels/CustomSitePanel.vue` |
| `CR-05` | Three-step "How it works" on the landing and a first-run hint toast in the console | `src/landing/LandingPage.vue`, `src/App.vue`, `src/i18n/{en,es}.js` |
| `CR-06` | Plain-language worker/export errors with a next action; raw detail only as a tooltip | panels, `src/i18n/{en,es}.js` |

Additional layout fixes required by the larger type scale and targets:

- the console header scrolls horizontally on phones instead of widening the page;
- the timeline event chips shrink and wrap on narrow screens;
- the landing inline links are 24 px targets.

**Verification evidence**

| Check | Result |
| --- | --- |
| `npm test` | 108/108 tests passing |
| `npm run build` | green |
| Device matrix — tool `#/tool`, English, **all 51 boxes + 2 no-WebGL probes** | **53/53 pass**, all 7 `@ui/*` checks (no horizontal overflow, no console errors, boxes in viewport, panels rendered, **targets ≥ 24 px**, **fonts ≥ 12 px**) |
| Landing at 1440 / 390 / 320 px | no horizontal overflow, no console errors, targets ≥ 24 px, minimum font 12 px |
| Contrast after the change | primary button 5.80:1 · faint text 5.54:1 · control border 3.04:1 (all ≥ 4.5 or ≥ 3 as required) |
| QA harness | `panels-rendered` now matches the tabbed surfaces layout; slow screenshots are retried and recorded as notes, not console errors |

`CR-07` (a review with the event UX stand) remains optional and external.

## 6. Evidence sources

- UX support guide — `resources_orig/[UX] NASA Space Apps Challenge Málaga/Guía
  de apoyo · UX.pdf` (4 pages, 7 requirements).
- Design tokens and styles — `src/styles/main.css`; landing styles in
  `src/landing/LandingPage.vue`.
- Automated device matrix — `qa/ui/`, results in `qa/REPORT.md`
  (`@ui/interactive-targets`, `@ui/fonts-readable`, overflow checks).
- Contrast ratios computed from the token values with the WCAG 2.1 relative
  luminance formula.
- Accessibility infrastructure — `src/styles/main.css` (`:focus-visible`,
  `prefers-reduced-motion`), `src/App.vue` (`aria-live`, `role="alert"`).
