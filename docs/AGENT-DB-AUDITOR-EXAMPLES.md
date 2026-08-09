**DB Auditor — Usage Examples**

Purpose: quick prompts and usage patterns for the `DB Auditor` agent (defined in `.agent.md`).

- **Run a full audit (read-only)**: "Audit the database and report high-risk findings."
- **Run tests explicitly**: "TEST"  
  - Single-word trigger (case-insensitive) runs `pytest` and SQL checks.
- **Check a specific migration**: "Inspect `supabase/migrations/20260809_live_schema.sql` for tenant-scoping problems."
- **Suggest fixes for a failing test**: "When a DB test fails, propose a minimal patch to fix the RLS policy."
- **Create a non-destructive patch**: "Suggest a patch to fix missing `tenant_id` defaults; do not apply—just show the diff."
- **Apply low-risk fixes after confirmation**: "Apply the suggested patch named `fix-tenant-id-default` and re-run tests."  
  - Agent will ask for confirmation before applying.

Trigger notes:
- Use exactly `TEST` (case-insensitive) to run the test suite. The agent will not run tests otherwise.

Suggested next customizations:
- Add CI integration notes (how the agent should run in CI).  
- Allow a short alias like `RUN TESTS` if you prefer human-friendly phrases.
- Add a preflight checklist to require a virtualenv or `.venv` to be active.

Where to find the agent file: `.agent.md` (repo root).
