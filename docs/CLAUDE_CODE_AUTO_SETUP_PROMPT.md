# BakeFlow — ONE-SHOT CLAUDE CODE AGENCY SETUP PROMPT

## What you do

I am going to place the complete Agency agent repository/folder in the root of this BakeFlow project.

I do **not** want to manually configure the Agency agents.

Your job is to inspect the Agency folder, keep only the useful specialist agents listed below, configure them for Claude Code, connect them to the BakeFlow project rules, and prepare the project for autonomous backend implementation.

I will also provide `MASTER_PROMPT.md` in the project root.

Do not start implementing BakeFlow features during this setup.

---

# 1. FIRST: INSPECT, DO NOT IMPLEMENT

Before changing anything:

1. Confirm the current working directory is the BakeFlow repository root.
2. Confirm `MASTER_PROMPT.md` exists.
3. Find the Agency folder in the project root.
4. Inspect the Agency folder's directory/file names only.
5. Do **not** open/read every agent.
6. Do **not** spend tokens analyzing agents that are not relevant.
7. Find only the specific agents listed in Section 3.
8. Read the Agency repository's own Claude Code installation/integration instructions if they are necessary to determine the correct installation method.
9. Inspect the existing BakeFlow Claude Code configuration, if any.
10. Inspect the repository status with Git.

Do not modify project code yet.

---

# 2. SAFETY RULE FOR THE AGENCY FOLDER

The Agency folder may contain many agents that BakeFlow does not need.

After you have successfully identified, copied/configured, and verified the required agents:

- Remove the unused Agency agent files from the project **only if they are inside the Agency folder that I explicitly placed for this setup**.
- Do not delete anything outside that Agency folder.
- Do not delete the original selected agents before their installation/configuration has been verified.
- Do not delete the Agency repository's installation documentation until you have extracted whatever information is required for the setup.
- If you are uncertain whether a file is safe to delete, do not delete it. Report it to me instead.
- Do not delete Git files, project files, `.env` files, source code, migrations, package files, or unrelated documentation.

The goal is to reduce unnecessary files/context, not to risk the BakeFlow project.

---

# 3. ONLY USE THESE AGENCY SPECIALISTS

Find the exact current filenames/locations for these agents by listing the Agency directory.

Required:

1. Agents Orchestrator
2. Backend Architect
3. Database Optimizer
4. Software Architect
5. Application Security Engineer
6. Code Reviewer
7. API Tester
8. Git Workflow Master
9. Technical Writer

Do not read unrelated agent files.

Save these for later and do not install them now:

- Mobile App Builder
- Performance Benchmarker
- SRE
- Reality Checker

If one of the required agents does not exist under exactly that name, search only the Agency directory names for the closest clearly equivalent agent.

Do not substitute an unrelated agent merely because its name sounds similar.

If you cannot determine the correct replacement, create a blocker and ask me.

---

# 4. DETERMINE THE CORRECT CLAUDE CODE INSTALLATION METHOD

Use the Agency repository's current documentation and the installed Claude Code capabilities to determine:

- Where project-local agents belong.
- Whether these agents should be installed as agents, skills, or another supported Claude Code mechanism.
- How the orchestrator is invoked.
- Whether project-level instructions are required.
- Whether hooks/commands are supported and useful.

Do not assume an outdated Claude Code directory convention.

Do not install external plugins, packages, MCP servers, or other tooling unless it is clearly required.

If Claude Code supports the Agency agents directly, use the native supported mechanism.

---

# 5. BAKEFLOW MUST CONTROL THE AGENCY AGENTS

The Agency agents are generic specialists.

They must operate under BakeFlow's project rules.

Read:

```text
MASTER_PROMPT.md
```

before configuring the orchestration layer.

The priority order is:

1. Approved BakeFlow business requirements
2. Approved BakeFlow architecture decisions
3. BakeFlow security/data rules
4. MASTER_PROMPT.md
5. Agency specialist expertise
6. Individual agent preferences

If a generic Agency recommendation conflicts with an approved BakeFlow decision, the BakeFlow decision wins.

If two BakeFlow requirements conflict, create a blocker rather than guessing.

---

# 6. CREATE/VERIFY THE BAKEFLOW CONTROL FILES

Create or update these project-root files:

```text
BACKEND_ROADMAP.md
CURRENT_TASK.md
BLOCKERS.md
NOTIFICATIONS.md
ARCHITECTURE_DECISIONS.md
TECHNICAL_DEBT.md
IMPLEMENTATION_LOG.md
```

Rules:

- Do not claim existing work is completed unless repository evidence proves it.
- Clearly distinguish existing, planned, approved, implemented, tested, and blocked work.
- Preserve useful existing versions of these files if they already exist.
- Do not overwrite existing project decisions without evidence.

---

# 7. CONFIGURE THE ORCHESTRATOR

Use the Agency `Agents Orchestrator` as the primary orchestration mechanism.

Do not build a duplicate orchestrator unless the Agency orchestrator cannot perform a required function.

The orchestrator must:

1. Read `MASTER_PROMPT.md`.
2. Read `BACKEND_ROADMAP.md`.
3. Read `CURRENT_TASK.md`.
4. Read `BLOCKERS.md`.
5. Read `NOTIFICATIONS.md`.
6. Check dependencies before starting tasks.
7. Delegate work to the appropriate specialist.
8. Allow parallel work only when tasks are genuinely independent.
9. Prevent conflicting agents from modifying the same critical files simultaneously.
10. Run review/testing gates.
11. Retry fixable failures.
12. Stop affected work when a human decision is required.
13. Continue unrelated safe work when possible.
14. Update the control files after meaningful progress.
15. Never mark work complete without evidence.

---

# 8. HUMAN DECISION / BLOCKER SYSTEM

A major requirement of BakeFlow is controlled autonomy.

If an agent encounters:

- an unknown business rule
- a financial rule that is not specified
- a security decision
- a destructive migration
- data-loss risk
- an architecture conflict
- a missing external dependency/access
- an ambiguous authorization rule

it must NOT guess.

It must:

1. Add a clear entry to `BLOCKERS.md`.
2. Add a corresponding entry to `NOTIFICATIONS.md`.
3. Mark the affected task as blocked.
4. Tell me that action is required.
5. Continue unrelated safe tasks if they do not depend on the blocker.

Example notification:

```text
ACTION REQUIRED: BLOCKER-004

Question:
Should staff users be allowed to edit finalized invoices?

Affected:
Invoice authorization

Status:
BLOCKED

Unrelated work may continue.
```

---

# 9. SPECIALIST RESPONSIBILITIES

Configure the agents so responsibilities are clear.

### Agents Orchestrator
Coordinates the workflow.

### Backend Architect
Backend architecture, service boundaries, business-logic placement, API/service design.

### Database Optimizer
PostgreSQL/Supabase schema, migrations, constraints, indexes, RLS considerations.

### Software Architect
Cross-system architectural decisions.

### Application Security Engineer
Authentication, authorization, RLS, privilege escalation, sensitive data exposure, security review.

### Code Reviewer
Independent implementation review.

### API Tester
Backend/API/service behavior and failure-path testing.

### Git Workflow Master
Safe Git workflow and change management.

### Technical Writer
Documentation and implementation records.

Do not give multiple agents overlapping ownership without a reason.

---

# 10. BAKEFLOW-SPECIFIC RULES

The project layer must enforce these principles:

## Backend first

Do not start broad frontend implementation while backend foundations are unresolved.

## Supabase security

Authorization must be enforced at trusted backend/database boundaries.

Never rely only on frontend checks.

## RLS

RLS behavior must be reviewed and tested for protected data.

## Financial data

Never invent:

- taxes
- pricing rules
- discounts
- rounding rules
- refund behavior
- invoice finalization behavior
- financial reporting rules

Unclear financial behavior becomes a blocker.

## Database changes

Use migrations.

Inspect existing schema before modifying it.

Avoid duplicate authorization models.

Do not perform destructive changes casually.

## Testing

Never claim a test passed unless it was actually executed.

## Documentation

Do not document planned functionality as completed functionality.

---

# 11. TASK DEPENDENCIES

The roadmap must be a dependency graph, not just a checklist.

Example:

```text
Database foundation
        ↓
Authentication
        ↓
Authorization/RLS
        ↓
Core domain services
        ↓
Orders/Sales/Invoices
        ↓
Financial reporting
```

A task cannot start until its prerequisites are complete.

Independent tasks may run concurrently.

Do not maximize the number of concurrent agents just for speed.

Correctness is more important than concurrency.

---

# 12. QUALITY LOOP

Every implementation task should follow:

```text
PLAN
  ↓
IMPLEMENT
  ↓
TEST
  ↓
SECURITY REVIEW
  ↓
CODE REVIEW
  ↓
FIX
  ↓
RETEST
  ↓
QUALITY GATE
  ↓
DOCUMENT
  ↓
COMPLETE
```

Use the project's actual configured commands for:

- typecheck
- lint
- formatting
- unit tests
- integration tests
- database tests

Do not invent commands.

Inspect `package.json` and existing configuration to determine the correct commands.

---

# 13. DO NOT CREATE UNNECESSARY CUSTOM AGENTS

Do not create custom replacements for:

- Backend Architect
- Database Optimizer
- Security Engineer
- Code Reviewer
- API Tester
- Technical Writer
- Orchestrator

unless the Agency implementation is genuinely insufficient.

If a BakeFlow-specific capability is missing, document the gap first.

---

# 14. DO NOT INSTALL RANDOM DEPENDENCIES

Do not install packages or external tools merely because they seem useful.

Before installing anything new:

- explain what it does
- explain why it is necessary
- explain the security/maintenance implications
- ask for approval unless it is clearly required by the existing project setup

---

# 15. FINAL SETUP VERIFICATION

Before declaring setup complete, verify:

- [ ] The correct Agency agents were found.
- [ ] Only the selected agents were installed/configured.
- [ ] The Agency orchestrator is available.
- [ ] BakeFlow project instructions are active.
- [ ] `MASTER_PROMPT.md` is being referenced.
- [ ] All seven control files exist.
- [ ] Agent responsibilities are separated.
- [ ] Task dependency handling is defined.
- [ ] Blocker handling is defined.
- [ ] Notification handling is defined.
- [ ] Testing/quality gates are defined.
- [ ] Git status is understood.
- [ ] No unrelated BakeFlow files were modified or deleted.
- [ ] Unused Agency files were removed only from the Agency folder and only after verification.
- [ ] No secrets were exposed or committed.

---

# 16. DO NOT IMPLEMENT BAKEFLOW YET

This prompt is a setup operation.

Do not start implementing backend features during this setup.

After setup is complete, stop.

Then provide me with a concise report containing exactly:

```text
SETUP COMPLETE

Agency agents installed:
- ...

Files created/updated:
- ...

Unused Agency files removed:
- ...

Claude Code configuration created:
- ...

Skills/configuration created:
- ...

How to start the BakeFlow orchestrator:
- ...

How to run a specific specialist:
- ...

How to check current task/status:
- ...

Blocker/notification workflow:
- ...

Anything that could not be automated:
- ...

Anything requiring my decision:
- ...
```

Do not give me a long explanation.

Most importantly, include the **exact commands/prompts I should use next** to start the BakeFlow backend implementation workflow.

---

# 17. AFTER SETUP

Once you have completed the setup and stopped, I will review your report.

Do not continue into backend implementation automatically.

The next implementation session will use:

```text
MASTER_PROMPT.md
+
BACKEND_ROADMAP.md
+
BakeFlow project instructions
+
Agency specialist agents
+
Agents Orchestrator
```

The goal is a controlled autonomous engineering loop, not uncontrolled agent activity.
