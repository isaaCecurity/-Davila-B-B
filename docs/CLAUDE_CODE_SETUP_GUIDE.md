# BAKEFLOW — CLAUDE CODE SETUP GUIDE

## Beginner's Guide to Building the BakeFlow Engineering System

This guide explains how to set up the Claude Code engineering system described in `MASTER_PROMPT.md`.

You do **not** need to understand every part of Claude Code before starting.

Follow the steps in order.

---

# 1. WHAT YOU ARE BUILDING

You are setting up an engineering workflow around your existing BakeFlow project.

The system will contain:

```text
                    ┌──────────────────────┐
                    │      ORCHESTRATOR    │
                    │  Plans + coordinates  │
                    └──────────┬───────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
             ▼                 ▼                 ▼
       Database Agent      Backend Agent    Security Agent
             │                 │                 │
             └─────────────────┼─────────────────┘
                               ▼
                       Testing / Review
                               │
                               ▼
                         Quality Gates
                               │
                    ┌──────────┴──────────┐
                    │                     │
                  PASS                  FAIL
                    │                     │
                    ▼                     ▼
              Mark Complete          Fix + Retest
```

The important principle is:

**Claude Code should coordinate work, not allow independent agents to make uncontrolled changes.**

You want automation, but with gates.

---

# 2. IMPORTANT: DO NOT START BY CREATING EVERYTHING MANUALLY

The `MASTER_PROMPT.md` file is designed to tell Claude Code what the final engineering system should accomplish.

This guide explains how to configure the Claude Code side of that system.

Claude Code's available features and directory conventions can change between versions. Therefore, before creating custom skills, agents, hooks, or commands, have Claude Code inspect the current project and the installed Claude Code capabilities.

Do not blindly copy an old internet tutorial if your installed Claude Code version uses a different convention.

---

# 3. BEFORE YOU START

Make sure you already have:

- Your BakeFlow project.
- The repository opened in your terminal.
- Claude Code available in the project.
- Your existing folder structure.
- Your existing database/schema work.
- Your installed dependencies.
- Git initialized and preferably committed before this setup.

## Recommended first safety step

Create a Git commit before allowing Claude Code to make structural changes.

Example:

```bash
git status
git add .
git commit -m "chore: checkpoint before Claude Code engineering system"
```

If you do not have a clean working tree, do not blindly commit unrelated changes.

Ask Claude Code to explain what is currently modified first.

---

# 4. OPEN CLAUDE CODE IN THE BAKEFLOW PROJECT

Open your terminal.

Navigate to the actual BakeFlow project directory.

For example:

```bash
cd path/to/BakeFlow
```

Then start Claude Code using the command appropriate for your installed version.

The exact command can vary by installation/version.

The important thing is that Claude Code's working directory must be the **root of the BakeFlow repository**.

---

# 5. FIRST PROMPT — LET CLAUDE INSPECT THE ENVIRONMENT

Before installing or creating custom automation, give Claude Code this prompt:

```text
Before making any changes, inspect this repository and determine:

1. What Claude Code configuration directories/files already exist.
2. What agent/sub-agent mechanisms are available in this installation.
3. What skill mechanisms are available.
4. What hook mechanisms are available.
5. What command/custom-command mechanisms are available.
6. What project-level configuration files already exist.
7. Whether any existing Claude Code configuration could conflict with the BakeFlow engineering system.

Do not modify anything yet.

Explain the current Claude Code capabilities available in this project and recommend the correct project-local structure for:

- skills
- agents/sub-agents
- hooks
- commands
- project instructions

Use the conventions supported by the installed Claude Code version rather than assuming an outdated directory structure.

Wait for my confirmation before creating the files.
```

### Why do this?

Because you don't want to build your automation around an outdated Claude Code convention.

Let Claude inspect itself first.

---

# 6. PROJECT CONTROL FILES

Your master prompt requires these files:

```text
BACKEND_ROADMAP.md
CURRENT_TASK.md
BLOCKERS.md
NOTIFICATIONS.md
ARCHITECTURE_DECISIONS.md
TECHNICAL_DEBT.md
IMPLEMENTATION_LOG.md
```

These are not Claude Code "skills."

They are the project's **engineering state**.

Think of them like the project's control panel.

### BACKEND_ROADMAP.md

The master to-do list.

### CURRENT_TASK.md

What is being worked on right now.

### BLOCKERS.md

Problems requiring a decision or intervention.

### NOTIFICATIONS.md

The attention/alert log.

### ARCHITECTURE_DECISIONS.md

Important technical decisions.

### TECHNICAL_DEBT.md

Known problems that are intentionally deferred.

### IMPLEMENTATION_LOG.md

Historical record of completed work.

---

# 7. ASK CLAUDE CODE TO CREATE THE CONTROL FILES

After Claude has inspected the repository, give it:

```text
Using the MASTER_PROMPT.md that I am providing, create the required project control files.

Before creating them:

1. Inspect the repository.
2. Reuse existing documentation where appropriate.
3. Do not overwrite valuable existing documentation.
4. Do not invent completed work.
5. Clearly distinguish existing implementation from planned implementation.

Create/update:

- BACKEND_ROADMAP.md
- CURRENT_TASK.md
- BLOCKERS.md
- NOTIFICATIONS.md
- ARCHITECTURE_DECISIONS.md
- TECHNICAL_DEBT.md
- IMPLEMENTATION_LOG.md

Then produce a summary showing:

- What already exists.
- What is incomplete.
- What the first backend milestone should be.
- What tasks are blocked.
- What tasks can safely run in parallel.

Do not start implementing production features yet.
```

---

# 8. UNDERSTAND SKILLS VS AGENTS VS HOOKS

This distinction is important.

## SKILL

A skill is reusable knowledge/instructions for performing a type of work.

For example:

```text
database-engineering
```

can teach Claude how BakeFlow expects database changes to be handled.

A skill does not necessarily mean a separate AI worker.

---

## AGENT / SUB-AGENT

An agent is a specialized worker with a defined responsibility.

Examples:

```text
database-engineer
security-engineer
test-engineer
code-reviewer
```

The orchestrator can assign a specific task to the appropriate specialist.

---

## HOOK

A hook is automation that runs when a supported Claude Code event occurs.

For example, a hook could help enforce checks after changes.

Do not use hooks to replace engineering judgment.

Use them for deterministic checks such as:

```text
format
lint
typecheck
tests
```

---

## COMMAND

A custom command is a convenient way to invoke a repeatable workflow.

For example:

```text
backend-status
```

could summarize:

- current milestone
- current task
- blockers
- notifications
- recent implementation
- next task

The exact command mechanism should follow the Claude Code version installed in your project.

---

# 9. RECOMMENDED BAKEFLOW SKILLS

Do not create 20 tiny skills.

Start with a small number of high-value skills.

Recommended:

```text
database-engineering
backend-engineering
security-engineering
testing-engineering
code-review
financial-domain-engineering
documentation
```

Each skill should have a narrow purpose.

---

# 10. DATABASE ENGINEERING SKILL

Create a project-local database engineering skill using the Claude Code-supported skill format.

The skill should contain instructions similar to:

```text
# BakeFlow Database Engineering

You are responsible for safe PostgreSQL/Supabase database engineering.

Rules:

1. Inspect the existing schema before changing it.
2. Never assume a table does not exist.
3. Never modify production-facing schema without a migration.
4. Prefer additive migrations when possible.
5. Protect referential integrity with appropriate constraints.
6. Use indexes based on actual query patterns.
7. Review RLS policies for every protected table.
8. Test RLS behavior for allowed and denied access.
9. Never expose sensitive fields unnecessarily.
10. Do not silently delete columns/tables/data.
11. Destructive changes require explicit justification and approval.
12. Preserve financial data integrity.
13. Use transactions where multiple changes must succeed or fail together.
14. Document important schema decisions.
15. Update the roadmap and implementation log after completed work.
16. If a business rule is unknown, create a blocker instead of guessing.
```

Do not copy this blindly if your existing project requirements define stricter rules.

---

# 11. BACKEND ENGINEERING SKILL

Suggested content:

```text
# BakeFlow Backend Engineering

Build maintainable, type-safe backend functionality.

Rules:

1. Inspect existing services before creating new ones.
2. Keep business logic out of UI code.
3. Validate inputs at trusted boundaries.
4. Never rely solely on client-side validation.
5. Use consistent error handling.
6. Keep authorization server-side.
7. Avoid duplicated business rules.
8. Keep financial calculations deterministic.
9. Use transactions for atomic operations.
10. Write tests for success and failure paths.
11. Do not silently swallow exceptions.
12. Follow existing project architecture unless a documented decision changes it.
13. Document significant architectural decisions.
14. Do not invent business rules.
```

---

# 12. SECURITY ENGINEERING SKILL

Suggested content:

```text
# BakeFlow Security Engineering

Treat security as a first-class requirement.

Check:

- Authentication
- Authorization
- Supabase RLS
- Organization/business isolation
- Role permissions
- Privilege escalation
- Input validation
- Secret handling
- Sensitive data exposure
- Logging
- Auditability

Rules:

1. Never rely solely on frontend authorization.
2. Verify access at the backend/database boundary.
3. Test both allowed and denied access.
4. Do not expose secrets.
5. Do not log sensitive information unnecessarily.
6. Treat financial data as sensitive.
7. Report security uncertainty as a blocker.
8. Never disable security controls simply to make tests pass.
```

---

# 13. TESTING ENGINEERING SKILL

Suggested content:

```text
# BakeFlow Testing Engineering

Testing must verify behavior, not merely code execution.

For relevant functionality test:

1. Normal success cases.
2. Invalid inputs.
3. Unauthorized access.
4. Missing data.
5. Boundary values.
6. Failure conditions.
7. Transaction rollback behavior where applicable.
8. Financial calculation edge cases.
9. Regression scenarios.

Never claim a test passed unless it was actually executed.

When a test fails:

1. Investigate root cause.
2. Fix the implementation or test.
3. Re-run the relevant test.
4. Run affected regression tests.
5. Record unresolved failures.
```

---

# 14. CODE REVIEW SKILL

Suggested content:

```text
# BakeFlow Code Review

Review code for:

- Correctness
- Security
- Maintainability
- Type safety
- Duplication
- Complexity
- Error handling
- Test coverage
- Performance
- Architecture consistency

Do not approve code merely because it compiles.

Identify:

- Critical issues
- High-risk issues
- Medium issues
- Low-risk improvements

Do not modify code unless explicitly assigned to implement the review findings.
```

---

# 15. FINANCIAL DOMAIN SKILL

This skill is particularly important for BakeFlow.

Suggested content:

```text
# BakeFlow Financial Domain Engineering

Financial behavior must be explicit and deterministic.

Rules:

1. Never invent financial rules.
2. Never silently change prices, taxes, discounts, or totals.
3. Define rounding behavior explicitly.
4. Validate financial totals server-side.
5. Preserve auditability.
6. Avoid unsafe floating-point monetary calculations.
7. Test edge cases.
8. Protect historical financial records.
9. Use database transactions for atomic financial operations.
10. Treat changes to financial calculations as high-risk.
11. Create a blocker when a required financial business rule is unclear.
```

---

# 16. DOCUMENTATION SKILL

Suggested content:

```text
# BakeFlow Documentation Engineering

Keep documentation synchronized with implementation.

Update documentation when:

- Architecture changes.
- Database schema changes.
- API/service contracts change.
- Authentication changes.
- Important business behavior changes.
- Deployment procedures change.

Do not create documentation that claims functionality exists when it does not.
```

---

# 17. SPECIALIST AGENTS

After creating the skills, configure specialist agents using the Claude Code mechanism supported by your installed version.

Recommended agents:

```text
orchestrator
database-engineer
backend-engineer
security-engineer
test-engineer
code-reviewer
documentation-engineer
release-engineer
```

Each agent should reference the relevant skill rather than duplicating every instruction.

---

# 18. ORCHESTRATOR AGENT

The orchestrator is the most important component.

Its job is to:

1. Read the roadmap.
2. Read the current task.
3. Check blockers.
4. Check dependencies.
5. Determine what can run.
6. Assign specialist work.
7. Review results.
8. Trigger testing/review.
9. Enforce quality gates.
10. Update project control files.
11. Notify the project owner when required.
12. Select the next valid task.

The orchestrator should **not** blindly delegate everything in parallel.

It must respect dependencies.

---

# 19. HOW THE ORCHESTRATOR SHOULD CHOOSE WORK

Use this logic:

```text
Read roadmap
     ↓
Find incomplete tasks
     ↓
Check prerequisites
     ↓
Check blockers
     ↓
Check file/resource conflicts
     ↓
Identify safe parallel tasks
     ↓
Assign specialist agents
     ↓
Collect results
     ↓
Run quality gates
     ↓
Fix failures
     ↓
Retest
     ↓
Mark completed tasks
     ↓
Update roadmap
     ↓
Select next work
```

---

# 20. BLOCKER BEHAVIOR

When an agent encounters a decision it cannot safely make:

```text
Agent discovers uncertainty
          ↓
Create BLOCKER
          ↓
Create NOTIFICATION
          ↓
Tell user ACTION REQUIRED
          ↓
Pause affected task
          ↓
Continue independent work
```

Example:

```text
ACTION REQUIRED: BLOCKER-004

Question:
Should staff users be allowed to edit finalized invoices?

Why this matters:
The answer changes authorization rules and audit behavior.

Recommended option:
Prevent editing finalized invoices and require a correction workflow.

Paused:
Invoice editing authorization.

Continuing:
Customer read APIs and reporting tests.
```

This is exactly the type of interruption you want.

---

# 21. DO NOT LET AGENTS GUESS BUSINESS RULES

Agents may make normal engineering decisions.

They must not invent business requirements.

Examples of decisions that may require you:

- Who can change finalized financial records?
- Whether a refund changes revenue reports.
- How taxes should be calculated.
- Whether staff can access another branch.
- Whether prices can be changed retroactively.
- What happens to an order after cancellation.
- Whether deleted customers remain in financial history.

Create a blocker.

---

# 22. HOOKS

Use hooks only for deterministic automation supported by your Claude Code installation.

Good candidates:

```text
TypeScript typecheck
Lint
Formatting
Unit tests
Integration tests
Migration validation
```

Do not create a hook that automatically approves business decisions.

Do not create a hook that automatically marks a task complete without verifying the required gates.

---

# 23. QUALITY-GATE COMMAND

Create a repeatable quality-gate workflow.

It should run the checks appropriate to the project, such as:

```text
typecheck
lint
format check
unit tests
integration tests
database tests
```

The actual commands must be discovered from the existing package.json and project configuration.

Do not invent commands.

If a required check does not exist, document that gap.

---

# 24. STATUS COMMAND

Create a convenient project status workflow.

It should read:

```text
BACKEND_ROADMAP.md
CURRENT_TASK.md
BLOCKERS.md
NOTIFICATIONS.md
IMPLEMENTATION_LOG.md
```

and report:

```text
Current milestone:
Current task:
Progress:
Completed:
In progress:
Blocked:
Unread notifications:
Recent changes:
Next recommended task:
```

---

# 25. REVIEW COMMAND

Create a repeatable review workflow.

It should:

1. Inspect the current task.
2. Inspect changed files.
3. Review implementation.
4. Run applicable tests.
5. Check security implications.
6. Identify issues.
7. Recommend fixes.
8. Do not claim completion until gates pass.

---

# 26. DO NOT AUTOMATICALLY INSTALL RANDOM TOOLS

Do not install packages, plugins, skills, MCP servers, or external tooling simply because they might be useful.

Before installing anything:

1. Explain what it does.
2. Explain why it is needed.
3. Explain the security implications.
4. Explain whether it modifies the repository.
5. Explain whether it introduces maintenance overhead.
6. Ask for approval if it is not clearly necessary.

Prefer existing project capabilities.

---

# 27. GIT SAFETY

Use Git as a safety mechanism.

Before significant architectural changes:

```text
Check git status
Review changed files
Create a checkpoint when appropriate
```

Never:

- Force-reset the repository.
- Delete unrelated user work.
- Rewrite history unnecessarily.
- Commit secrets.
- Commit environment files containing credentials.

---

# 28. ENVIRONMENT AND SECRETS

Never print or expose secret values.

When inspecting environment variables:

- Inspect names.
- Do not display secret values.
- Never commit `.env` secrets.
- Follow the existing environment convention.

If required credentials are missing, create a blocker.

---

# 29. DATABASE MIGRATION SAFETY

Before a migration:

1. Inspect current schema.
2. Determine affected tables.
3. Determine affected RLS policies.
4. Determine affected indexes.
5. Determine affected application code.
6. Determine whether existing data is compatible.
7. Test the migration where possible.
8. Document destructive operations.
9. Do not execute destructive production operations casually.

---

# 30. HOW TO HANDLE PARALLEL AGENTS

Suppose the roadmap contains:

```text
TASK-010 Database indexes
TASK-011 Customer validation
TASK-012 Reporting tests
```

If they are independent, they may run in parallel.

But if:

```text
TASK-020 Invoice API
depends on TASK-015 Invoice schema
```

then TASK-020 must wait.

Never prioritize concurrency over dependency correctness.

---

# 31. AGENT FILE CONFLICTS

If two agents need to modify the same critical files:

Do not allow uncontrolled simultaneous editing.

Instead:

1. Identify the conflict.
2. Sequence the tasks.
3. Let one agent complete.
4. Review.
5. Then allow the next agent to work.

---

# 32. WHEN A TASK FAILS

Do not immediately create a blocker for every failed test.

First attempt normal engineering resolution.

Use:

```text
Failure
 ↓
Investigate
 ↓
Fix
 ↓
Retest
 ↓
Review
```

Create a blocker when the issue cannot be safely resolved without a decision, access, missing requirement, or external dependency.

---

# 33. WHEN TO STOP AUTONOMOUS EXECUTION

Stop affected work when:

- Business requirements conflict.
- A financial rule is unknown.
- Security behavior is ambiguous.
- Data-loss risk exists.
- A destructive migration is required.
- An external API contract is unclear.
- Credentials/access are unavailable.
- Architecture must fundamentally change.
- Tests reveal an unresolved product requirement.

Do not stop unrelated safe tasks unnecessarily.

---

# 34. RELEASE READINESS

Do not call the backend production-ready merely because:

```text
"It works."
```

Require evidence.

At minimum:

- Required tests pass.
- Typecheck passes.
- Lint passes.
- Security review passes.
- RLS is tested.
- Database migrations are validated.
- Financial logic is tested.
- No critical/high unresolved blockers.
- Documentation is current.
- Known technical debt is reviewed.

---

# 35. BEGINNER-SAFE OPERATION

If you are uncertain about what Claude Code is about to do, ask it to explain:

```text
Before executing this step, explain:

1. What you are going to change.
2. Which files will change.
3. Why those files need to change.
4. Whether database changes are involved.
5. Whether any destructive operation is involved.
6. Whether any new dependency will be installed.
7. What tests will be run afterward.
```

You can use this whenever you want extra visibility.

---

# 36. FIRST EXECUTION PROMPT

After this setup is complete, your first major instruction to Claude Code should be:

```text
Read MASTER_PROMPT.md and all existing project instructions.

Do not implement a feature yet.

First:

1. Inspect the complete repository.
2. Inspect the existing database/schema/migrations.
3. Inspect dependencies.
4. Inspect existing backend implementation.
5. Inspect tests.
6. Inspect existing documentation.
7. Identify existing Claude Code configuration.
8. Create the project control files required by MASTER_PROMPT.md.
9. Build BACKEND_ROADMAP.md from the actual repository state.
10. Identify prerequisites and safe parallel tasks.
11. Identify blockers and uncertainties.
12. Select the first valid backend task.

Do not mark anything complete unless it is actually verified.

At the end, give me:

- Project assessment
- Backend roadmap summary
- First task
- Dependencies
- Safe parallel tasks
- Blockers
- Actions requiring my decision

Do not begin implementation until the roadmap has been created and reviewed.
```

---

# 37. RECOMMENDED BUILD ORDER

Once the roadmap has been reviewed, the system should generally progress through:

```text
Repository assessment
        ↓
Architecture validation
        ↓
Database foundation
        ↓
Authentication
        ↓
Authorization/RLS
        ↓
Business/organization isolation
        ↓
Core domain models
        ↓
Validation
        ↓
Core backend services
        ↓
Orders
        ↓
Sales
        ↓
Products/pricing
        ↓
Customers
        ↓
Invoices
        ↓
Expenses/payments
        ↓
Financial calculations
        ↓
Reports
        ↓
Audit logging
        ↓
Security hardening
        ↓
Performance review
        ↓
Automated testing
        ↓
Documentation
        ↓
Release readiness
```

This is a guide, not a rigid sequence. The actual dependency graph in the repository takes priority.

---

# 38. DO NOT MIX FRONTEND AND BACKEND ROADMAPS YET

The immediate focus is backend.

Once the backend reaches an appropriate stability point, create a separate frontend roadmap.

Do not allow frontend work to obscure unresolved backend architecture.

---

# 39. TROUBLESHOOTING

## Claude starts coding immediately

Tell it:

```text
Stop implementation.

Return to planning mode.

Inspect the repository and create/update BACKEND_ROADMAP.md first.

Do not implement production features until dependencies and acceptance criteria are defined.
```

## Claude keeps asking unnecessary questions

Tell it:

```text
Only stop for decisions that affect business rules, security, financial behavior, data integrity, architecture, or missing external dependencies.

Make routine engineering decisions autonomously and document them when significant.
```

## Claude marks tasks complete too early

Tell it:

```text
A task is not complete until its acceptance criteria and applicable quality gates have been verified with actual evidence.

Re-open the task and run the required checks.
```

## Agents conflict

Tell it:

```text
Stop parallel work that touches conflicting files.

Recalculate task dependencies and sequence the conflicting work.
```

## Claude guesses a business rule

Tell it:

```text
Do not guess this business rule.

Create a BLOCKER and NOTIFICATION with the exact decision required.
```

---

# 40. THE MOST IMPORTANT RULE

The system should optimize for:

```text
Safe autonomy
+
Explicit dependencies
+
Automated verification
+
Human control over business-critical decisions
```

Not:

```text
Maximum number of agents
```

Five agents are not automatically better than three.

Use the smallest number of specialist agents that gives good separation of responsibility.

---

# 41. FINAL CHECKLIST

Before considering your Claude Code engineering system operational, verify:

- [ ] MASTER_PROMPT.md exists.
- [ ] Claude Code has inspected the repository.
- [ ] Project-level Claude configuration has been identified.
- [ ] BACKEND_ROADMAP.md exists.
- [ ] CURRENT_TASK.md exists.
- [ ] BLOCKERS.md exists.
- [ ] NOTIFICATIONS.md exists.
- [ ] ARCHITECTURE_DECISIONS.md exists.
- [ ] TECHNICAL_DEBT.md exists.
- [ ] IMPLEMENTATION_LOG.md exists.
- [ ] Database engineering skill exists.
- [ ] Backend engineering skill exists.
- [ ] Security engineering skill exists.
- [ ] Testing engineering skill exists.
- [ ] Code review skill exists.
- [ ] Financial domain skill exists.
- [ ] Documentation skill exists.
- [ ] Orchestrator exists.
- [ ] Specialist agents are configured.
- [ ] Agents have clearly separated responsibilities.
- [ ] Dependency rules are enforced.
- [ ] Blocker workflow is tested.
- [ ] Notification workflow is tested.
- [ ] Quality gates are defined.
- [ ] Git safety practices are in place.
- [ ] Secrets are protected.
- [ ] Claude has demonstrated that it can stop safely when a decision is required.

Once these are verified, begin backend implementation from the roadmap rather than jumping between unrelated features.
