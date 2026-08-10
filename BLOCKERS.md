# BakeFlow — Blockers

Human decision or external action required. Agents must never guess past these.
Unrelated safe work may continue.

---

## BLOCKER-001 · Invitation delivery has no transport
**Status:** OPEN · **Affects:** B6 · **Type:** missing infrastructure

`create_organization_invite()` mints tokens correctly, but `supabase/functions/`
contains only `import_map.json` and zero functions are deployed. Minting a token is
not delivering an invitation, so inviting a user cannot be completed end-to-end.
Also absent: `pg_cron`, `pg_net`, any notification tables.

**Needed:** approval of an email provider and deployment of the first Edge Function.

---

## BLOCKER-002 · Migration files are not reproducible from the repository
**Status:** OPEN · **Affects:** repository integrity · **Type:** environment + decision

`supabase db pull` fails with `LegacyDbPullMigrationConflictError`: 14 local `.sql`
files were never applied, and the remote holds migrations the repo lacks.
`supabase db dump` requires Docker, which is not installed.

The CLI suggests `migration repair --status applied` on the 14 stale files. **Do not
run it** — that records never-executed migrations as applied, so `db reset` would
build a different schema than production.

**Needed:** a decision on the 14 stale files, then either install Docker and dump a
baseline, or delete the stale files and re-run `db pull`.

---

## BLOCKER-003 · Financial rules are unspecified
**Status:** OPEN · **Affects:** B9, B10 · **Type:** business rule

No approved rules exist for tax, pricing, discounts, rounding, refunds, invoice
finalisation, or financial reporting. Agents must not invent any of them.

**Needed:** written rules before B9 begins.

---

## BLOCKER-004 · EAS project ID is a placeholder
**Status:** OPEN · **Affects:** first native build · **Type:** project setup

`apps/mobile/app.json` carries `extra.eas.projectId: "REPLACE_WITH_EAS_PROJECT_ID"`.
No real ID exists anywhere in the repository. It must not be invented.

**Needed:** the EAS project ID, or `eas init`.

---

## Template

```
## BLOCKER-00N · <one-line title>
**Status:** OPEN | RESOLVED · **Affects:** <tasks> · **Type:** <category>
<what is unknown and why guessing is unsafe>
**Needed:** <the specific decision or action>
```
