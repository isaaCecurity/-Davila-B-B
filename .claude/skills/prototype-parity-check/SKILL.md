---
name: prototype-parity-check
description: Run the mandatory prototype-fidelity parity workflow from CLAUDE.md against one RN screen — identify the exact prototype reference, reproduce it, compare states, and record the result in bakeflow-frontend/docs/PROTOTYPE-PORT.md. Invoke with /prototype-parity-check <screen-name-or-route>.
metadata:
  type: workflow
  argument-hint: <screen-name-or-route>
disable-model-invocation: true
---

# Prototype Parity Check

Runs the 6-step parity workflow that `CLAUDE.md` mandates for every mobile screen
("Prototype fidelity — mandatory frontend rule"). This is the checklist, not a new
process — it exists so that steps 4 and 5 (screenshot comparison, sign-off) actually
happen instead of getting skipped when a screen "looks close enough."

**Source of truth:** `# BakeFlow frontend design/export/bakeflow-frontend/` (read-only).
**Port log:** `bakeflow-frontend/docs/PROTOTYPE-PORT.md` — every run of this skill ends
with an entry appended there, in the file's existing per-screen report format.

## Inputs

The screen name or route passed as `$ARGUMENTS`. If not given, ask which screen.

## Workflow

### 1. Identify the exact reference
Find the prototype screen file(s) for `$ARGUMENTS` under
`# BakeFlow frontend design/export/bakeflow-frontend/`. Pin down: role (owner / branch
manager / cashier / baker / driver / supervisor / admin), theme (light/dark), the
390 × 844 phone viewport vs. desktop studio presentation, and which data state is being
compared (empty / loading / error / populated). Read the prototype's HTML/JS/CSS for
that screen before touching the RN code — do not work from memory of a similar screen.

### 2. Find or build the RN counterpart
Locate the nearest existing RN implementation under `bakeflow-frontend/apps/mobile` and
follow its existing patterns (navigation, NativeWind usage, hooks). If the screen doesn't
exist yet, reproduce it with fixture data first when live Supabase data would obscure the
visual comparison; wire live data afterward without changing the approved composition.

### 3. Compare at matching states
For each state relevant to this screen (empty / loading / error / populated / dark theme
if applicable), compare prototype vs. RN side by side at the phone viewport. Check, in
order: shell/chrome (safe areas, app bar, tab bar) → layout geometry and content density →
typography, colors, icons, shadows, radii → motion → responsive behavior at the supported
desktop width. Use screenshots — a description of "looks the same" is not a comparison.

### 4. Record every difference
For each visual mismatch found: either fix it, or record it in
`bakeflow-frontend/docs/PROTOTYPE-PORT.md` with the exact difference and the platform or
backend reason it's not fixed (e.g. a native-only safe-area behavior, a font unavailable
on RN). An unexplained mismatch blocks sign-off — "functionally equivalent" is never
sufficient per `CLAUDE.md`.

### 5. Verify behavior, not just visuals
Confirm the screen's data and actions actually work (the behavior tests for this phase,
per `docs/TESTING-STRATEGY.md`). Visual parity without working behavior, or working
behavior without visual parity, are both incomplete — both must pass together.

### 6. Append the port log entry
Append a report to `bakeflow-frontend/docs/PROTOTYPE-PORT.md` following its existing
per-screen entry format: screen, role, states checked, differences found and their
resolution/reason, and pass/fail per state. Do not mark a screen complete in that log
unless steps 3–5 above were actually run in this session — do not record a state as
checked from assumption.

## Non-negotiables (from CLAUDE.md, do not override)

- The prototype wins on visual values if it disagrees with a derived design doc
  (e.g. `docs/DESIGN-TOKENS.md`) — see `PROTOTYPE-PORT.md` decision D1 for the standing
  precedent on this repo.
- Never substitute a generic component, new color, default font, or redesigned
  navigation for the prototype's without explicit owner approval — flag it and stop
  instead of guessing.
