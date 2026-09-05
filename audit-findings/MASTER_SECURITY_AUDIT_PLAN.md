Absolutely. I understand exactly what we're creating now.

This is not the audit itself and not a rigid checklist. It's a Master Security Audit Orchestration Specification that you give Claude Code. Claude Code must first understand your specific project, then create a customized master audit plan based on your actual codebase, database, architecture, dependencies, and infrastructure.

I've also structured it around the idea of comprehensive verification frameworks such as OWASP ASVS, which is intended for systematic application security verification rather than relying only on a simple Top 10 checklist. 


---

MASTER DOCUMENT

MASTER SECURITY AUDIT ORCHESTRATION SPECIFICATION

Purpose:
This document instructs Claude Code to conduct a comprehensive, evidence-driven, project-specific security assessment of the entire application.

This document is not a static checklist. You must use it as a methodology and starting framework. Before auditing, you must understand the actual application and then generate a customized Security Audit Master Plan specifically tailored to the project's architecture, technologies, attack surface, business logic, infrastructure, and data flows.

Your objective is to identify security weaknesses before production deployment, including obvious vulnerabilities, subtle misconfigurations, architectural weaknesses, business logic vulnerabilities, tenant isolation failures, supply-chain risks, and combinations of individually minor issues that could form a serious attack chain.


---

1. PRIMARY OPERATING PRINCIPLE

Do not begin by blindly running security tools.

First:

1. Understand the entire project.


2. Map the architecture.


3. Identify technologies.


4. Identify trust boundaries.


5. Identify sensitive assets.


6. Identify data flows.


7. Identify user roles.


8. Identify authentication and authorization mechanisms.


9. Identify external services.


10. Identify deployment infrastructure.


11. Identify the application's business logic.


12. Identify the project's attack surface.



Only after understanding the project should you create the project's customized:

> MASTER SECURITY AUDIT PLAN AND ROADMAP



The audit plan must be based on:

The actual repository

Actual source code

Actual database schema

Actual RLS policies

Actual API routes

Actual authentication flows

Actual dependencies

Actual environment configuration

Actual infrastructure configuration

Actual business logic

Actual third-party integrations


Never assume that a generic checklist completely covers this application.


---

2. FIRST PHASE — FULL PROJECT DISCOVERY

Before creating the audit plan, perform a comprehensive reconnaissance and understanding phase.

Analyze the entire project and create an internal architectural understanding.

Investigate:

Application architecture

Frontend architecture

Backend architecture

Server-side architecture

API architecture

Database architecture

Authentication architecture

Authorization architecture

Deployment architecture

External services

Background jobs

Scheduled jobs

Webhooks

File storage

Realtime functionality

Caching

Queues

AI integrations, if applicable


Technology inventory

Identify every significant technology used, including:

Languages

Frameworks

Libraries

Package managers

Database systems

Authentication providers

Hosting providers

CI/CD systems

Container systems

Cloud services

Third-party APIs

Monitoring systems

Analytics

Payment providers

Email providers


Create a complete technology inventory.


---

3. CREATE AN ARCHITECTURE MAP

Before auditing, create a clear map of the application.

Document:

Clients

Frontend applications

Backend services

APIs

Databases

Authentication services

Storage systems

External APIs

Webhooks

Background workers

Deployment environments


Map how information flows between them.

Specifically identify:

Trust boundaries

Examples:

Browser → API

Browser → Supabase

Frontend → backend

Backend → database

Backend → third-party services

Admin → administrative functions

User → another user's data

Tenant → another tenant's data


Every trust boundary should be treated as a potential security boundary.


---

4. IDENTIFY ALL SENSITIVE ASSETS

Create an inventory of everything worth protecting.

Examples include:

User accounts

Password credentials

Authentication tokens

Refresh tokens

JWTs

API keys

Service role keys

Environment variables

Customer data

Business data

Financial information

Internal administrative functionality

Database backups

Uploaded files

Emails

Logs

Analytics data

Third-party credentials


For every sensitive asset, document:

Where it exists

Who can access it

How access is granted

How it travels

Whether it is encrypted

How long it persists

How it is deleted

What happens if compromised



---

5. THREAT MODEL THE ACTUAL APPLICATION

Create a project-specific threat model.

Do not merely list generic attacks.

Analyze realistic attackers such as:

Anonymous internet attacker

Authenticated normal user

Malicious customer

Malicious tenant

Compromised user account

Malicious administrator

Insider threat

Automated bot

Credential stuffing attacker

Dependency compromise

Compromised third-party provider

Attacker with leaked API key

Attacker attempting cross-tenant access


Ask:

> "If I were trying to compromise this specific application, where would I start?"



Identify:

Attack surfaces

Entry points

Privilege boundaries

Sensitive operations

Trust assumptions

Single points of failure

High-value targets


Create realistic attack scenarios.


---

6. PARALLEL AGENT ORCHESTRATION

Use specialized sub-agents wherever tasks are independent.

Do not unnecessarily perform everything sequentially.

Create focused agents or equivalent parallel workstreams for independent domains.

Potential specialized audit agents include:

Agent A — Authentication Security

Audit:

Signup

Login

Logout

Password reset

Email verification

Password policies

MFA

OAuth

Session handling

Token handling

Account recovery

Account enumeration

Credential stuffing protections



---

Agent B — Authorization and Access Control

Audit:

Roles

Permissions

Ownership

Object-level authorization

Function-level authorization

Privilege escalation

Horizontal privilege escalation

Vertical privilege escalation



---

Agent C — Database and Supabase Security

Audit:

Database schema

RLS

Policies

Functions

RPC endpoints

Views

Triggers

Privileges

Service roles

Public schema exposure

Security definer functions

Storage policies

Realtime access



---

Agent D — API Security

Audit:

Every API route

Input validation

Authorization

Rate limiting

Resource exhaustion

Object-level authorization

Mass assignment

Injection

Error leakage



---

Agent E — Backend Code Security

Perform deep source-code review for:

Unsafe assumptions

Injection

Authentication bypass

Authorization bypass

Unsafe deserialization

SSRF

Path traversal

Command injection

Race conditions

Sensitive data leakage



---

Agent F — Frontend Security

Audit:

XSS

DOM manipulation

Client-side authorization assumptions

Token storage

Sensitive data exposure

Security headers

CSP

Third-party scripts

Open redirects



---

Agent G — Dependency and Supply Chain Security

Audit:

Dependencies

Transitive dependencies

Known vulnerabilities

Abandoned packages

Suspicious packages

Typosquatting risks

Lockfile integrity

Build pipeline dependencies



---

Agent H — Secrets and Configuration Security

Search for:

API keys

Tokens

Passwords

Database URLs

Service role keys

Private keys

Secrets committed to Git


Also audit:

.env handling

.gitignore

CI/CD secrets

Production configuration

Development configuration



---

Agent I — Infrastructure and Deployment Security

Audit:

Hosting configuration

HTTPS

TLS

Headers

CORS

Environment separation

Debug modes

Production settings

Container security

CI/CD pipelines

Permissions



---

Agent J — Business Logic Security

Study what the application actually does.

Attempt to abuse legitimate functionality.

Ask:

Can users manipulate workflows?

Can users bypass payment or approval?

Can users perform actions out of sequence?

Can quantities become negative?

Can ownership be manipulated?

Can race conditions cause duplicate operations?

Can users exploit assumptions between multiple features?



---

Agent K — Multi-Tenant Isolation

If the application is multi-tenant, perform an extremely deep tenant-isolation audit.

Attempt conceptually to determine whether:

Tenant A can read Tenant B's data

Tenant A can modify Tenant B's data

IDs can be manipulated

Foreign keys can be abused

API parameters can bypass isolation

RLS can be bypassed

Storage objects leak across tenants

Realtime subscriptions cross tenant boundaries

Cached data leaks across tenants


This must be considered a high-priority audit category.


---

Agent L — Privacy and Data Protection

Audit:

Personal data collection

Data minimization

Sensitive information exposure

Logs

Analytics

Error reporting

Data retention

Deletion

Backups

Data exports



---

Agent M — Observability and Incident Response

Audit whether the application can detect and investigate:

Suspicious logins

Privilege escalation

Repeated authorization failures

Abnormal API activity

Mass exports

Security configuration changes



---

7. ALLOW DYNAMIC AGENT CREATION

The agents above are examples, not limits.

If you discover technologies or attack surfaces requiring specialized expertise, create additional focused audit agents or workstreams.

Examples:

Payment security specialist

AI security specialist

Webhook security specialist

File upload specialist

OAuth specialist

Mobile security specialist

GraphQL specialist

Realtime security specialist


The audit must adapt to the actual project.


---

8. AUTHENTICATION AUDIT

Perform a deep review of the entire authentication lifecycle.

Check:

Password hashing approach

Password reset security

Email verification

Account enumeration

Brute-force resistance

Credential stuffing resistance

Rate limiting

Session expiration

Session invalidation

Refresh token handling

JWT validation

JWT expiration

Token audience

Token issuer validation

Token leakage

Logout behavior

Password change behavior

Account recovery abuse

OAuth misconfiguration

MFA opportunities


Do not assume authentication is secure simply because an external provider is used.

Review how the application integrates with the provider.


---

9. AUTHORIZATION AUDIT

For every sensitive action ask:

> "Who is allowed to do this?"



Then verify that enforcement happens server-side or at the database security layer.

Check for:

Horizontal privilege escalation

Can User A access User B's resources?

Vertical privilege escalation

Can a normal user access administrative functionality?

IDOR/BOLA

Can changing an ID expose another user's resource?

Test every route and database interaction conceptually for ownership enforcement.


---

10. SUPABASE-SPECIFIC AUDIT

If Supabase is used, perform a specialized audit.

Check:

Row Level Security

For every table:

Is RLS enabled?

Should it be enabled?

Are policies restrictive?

Are policies correct?

Are SELECT policies correct?

Are INSERT policies correct?

Are UPDATE policies correct?

Are DELETE policies correct?


Identify dangerous policies such as overly broad access.

Review every policy for tenant isolation.


---

Supabase keys

Ensure:

Service role keys never reach the frontend

Secrets are never committed

Public keys are used appropriately

Server-only credentials remain server-only



---

Database functions

Audit:

RPC functions

Security definer functions

Function permissions

Search paths

Input validation

Privilege escalation possibilities



---

Storage

Audit:

Bucket privacy

Upload authorization

Download authorization

Object ownership

Path manipulation

Tenant isolation



---

Realtime

Audit whether users can subscribe to data outside their authorization scope.


---

11. INPUT AND OUTPUT SECURITY

Audit every external input.

Examples:

Forms

URL parameters

Query strings

API payloads

Headers

Cookies

Webhooks

File uploads

Third-party responses


Check for:

SQL injection

NoSQL injection

XSS

Command injection

Template injection

Path traversal

SSRF

Open redirects

Prototype pollution

Mass assignment


Verify:

Strong typing

Allow-list validation

Length limits

Range limits

Contextual output encoding



---

12. API SECURITY

Create a complete API inventory.

For every endpoint document:

Method

Authentication requirement

Authorization requirement

Input

Output

Sensitive operations

Rate limiting

Abuse potential


Check for:

BOLA / IDOR

Broken authentication

Excessive data exposure

Mass assignment

Missing rate limiting

Missing authorization

Injection

Information leakage

Resource exhaustion



---

13. BUSINESS LOGIC AND ABUSE CASE REVIEW

Do not only search for traditional vulnerabilities.

Study how the application is intended to work.

Then intentionally challenge assumptions.

Create misuse cases such as:

> What happens if a user repeats this action rapidly?



> What happens if two requests arrive simultaneously?



> What happens if a request is replayed?



> What happens if a user skips a workflow step?



> What happens if a user modifies hidden parameters?



> What happens if values are negative, extremely large, or unexpected?



> What happens if an attacker automates this feature?



Look specifically for:

Race conditions

Double execution

Replay attacks

State machine bypasses

Workflow bypasses

Resource abuse

Automation abuse



---

14. FILE UPLOAD SECURITY

If file uploads exist, audit:

File type validation

MIME validation

Extension validation

File size limits

Malware scanning opportunities

Filename sanitization

Path traversal

Public/private access

Signed URL expiration

Cross-tenant access



---

15. WEBHOOK SECURITY

If webhooks exist:

Verify signatures

Validate timestamps

Prevent replay attacks

Authenticate sender

Handle duplicate events safely

Validate payloads



---

16. CRYPTOGRAPHY AUDIT

Identify every cryptographic operation.

Check:

Password hashing

Encryption

Random number generation

Token generation

Key storage

Key rotation

TLS

Signed URLs

JWT signing


Never recommend inventing custom cryptography.

Identify weak or outdated cryptographic practices.


---

17. DEPENDENCY AND CVE RESEARCH

Create a complete Software Bill of Materials-style inventory where practical.

For every major dependency:

1. Identify version.


2. Check known security advisories.


3. Check recent CVEs.


4. Check maintainership status.


5. Check whether upgrades are available.


6. Check whether vulnerabilities affect the application's actual usage.



Do not blindly report every CVE.

Determine:

Is the vulnerable code actually reachable?

Is the affected feature enabled?

Is exploitation realistic?


Research current security advisories using authoritative sources where possible.

The audit must include both:

Automated vulnerability scanning

Manual verification



---

18. SUPPLY CHAIN SECURITY

Check:

Lockfile integrity

Dependency pinning

Suspicious install scripts

CI/CD dependencies

Third-party GitHub Actions

Package provenance

Compromised package risks

Abandoned dependencies



---

19. SECRET SCANNING

Perform comprehensive secret scanning.

Search:

Source code

Git history where available

Configuration files

Documentation

Test files

Build scripts


Look for:

API keys

Passwords

Tokens

Private keys

Database URLs

Service credentials


If secrets are found:

Do not unnecessarily expose their values in reports.

Report their location safely.

Recommend rotation where appropriate.


---

20. FRONTEND SECURITY

Audit:

XSS

DOM XSS

Unsafe HTML rendering

dangerouslySetInnerHTML

Third-party scripts

Sensitive data in browser storage

Token leakage

Source maps

Debug information

Client-side authorization


Remember:

> The frontend must never be treated as a security boundary.




---

21. SECURITY HEADERS

Review deployment configuration for appropriate security headers.

Evaluate:

Content Security Policy

HSTS

X-Content-Type-Options

Frame protection

Referrer Policy

Permissions Policy


Do not blindly recommend headers without considering whether they would break legitimate functionality.


---

22. CORS AND CROSS-ORIGIN SECURITY

Audit:

Allowed origins

Wildcard origins

Credentials

Preflight behavior

Development versus production configuration


Ensure sensitive APIs are not unnecessarily exposed cross-origin.


---

23. RATE LIMITING AND ABUSE PROTECTION

Identify endpoints vulnerable to:

Brute force

Credential stuffing

Enumeration

Spam

Expensive computation

Resource exhaustion


Consider protection for:

Login

Signup

Password reset

Email sending

Search

Expensive database queries

AI endpoints

File uploads



---

24. DENIAL OF SERVICE AND RESOURCE ABUSE

Look for:

Unbounded queries

Missing pagination

Expensive joins

Missing indexes

Large file uploads

Infinite loops

Recursive operations

Excessive API calls

Expensive AI operations


Security includes availability.


---

25. DATABASE SECURITY REVIEW

Audit:

Privileges

Roles

Public access

RLS

Functions

Views

Triggers

Foreign keys

Cascading deletes

Data integrity

Injection surfaces


Look for data integrity vulnerabilities, not just data exposure.


---

26. RACE CONDITIONS AND CONCURRENCY

Identify operations that could break when performed simultaneously.

Examples:

Duplicate orders

Duplicate payments

Inventory manipulation

Double submissions

Account changes

Permission changes


Review:

Transactions

Atomic operations

Idempotency

Database constraints



---

27. ERROR HANDLING AND INFORMATION LEAKAGE

Ensure production errors do not expose:

Stack traces

SQL queries

Internal paths

Secrets

Infrastructure details


But ensure sufficient internal logging exists for debugging.


---

28. LOGGING AND AUDIT TRAILS

Determine whether critical events are logged.

Examples:

Login failures

Password changes

Permission changes

Administrative actions

Security configuration changes

Sensitive data exports


Ensure logs themselves do not contain:

Passwords

Tokens

Secrets

Unnecessary sensitive data



---

29. BACKUP AND RECOVERY SECURITY

Audit:

Backup existence

Recovery strategy

Restore testing

Backup access

Backup encryption

Disaster recovery assumptions


Ask:

> "If the database disappeared today, how would the system recover?"




---

30. ENVIRONMENT SEPARATION

Check separation between:

Development

Testing

Staging

Production


Ensure:

Production secrets aren't used locally unnecessarily

Debug modes aren't enabled

Test credentials aren't deployed

Development shortcuts don't reach production



---

31. CI/CD PIPELINE SECURITY

Audit:

Secret exposure

Excessive permissions

Untrusted pull requests

Dependency installation

Build scripts

Deployment credentials

Third-party actions



---

32. THIRD-PARTY INTEGRATION SECURITY

For every external provider:

Identify permissions granted

Identify data shared

Review webhook security

Review credential storage

Review failure modes

Review provider compromise impact


Ask:

> "What happens if this third party is compromised?"




---

33. ATTACK CHAIN ANALYSIS

Do not evaluate vulnerabilities only individually.

After all agents complete their work, perform an attack-chain analysis.

Look for combinations such as:

Minor information leak + weak authorization

XSS + token storage

Low privilege access + insecure function

Enumeration + weak rate limiting


Ask:

> "Can multiple low or medium findings combine into a critical compromise?"




---

34. RESEARCH CURRENT SECURITY PRACTICES

Do not limit the audit to this document.

Before and during the audit, research:

Current best practices

Recent CVEs

Security advisories

Framework-specific vulnerabilities

Cloud-provider security guidance

Authentication security developments


Research must be relevant to the project's actual technology stack.

Do not research random vulnerabilities unrelated to the application.

Use authoritative sources whenever possible.

The security field evolves continuously. This audit specification is therefore a starting framework, not a maximum limit.

You are explicitly authorized and encouraged to expand the audit when new relevant risks are discovered.


---

35. REFERENCE SECURITY STANDARDS

Where appropriate, map findings and coverage against recognized frameworks such as:

OWASP ASVS

OWASP Top 10

OWASP API Security guidance

CWE

NIST secure software development guidance


Do not claim complete compliance unless every relevant requirement has actually been verified.

OWASP itself recommends ASVS for comprehensive verification because a simple Top 10 awareness list cannot fully cover application security testing. 


---

36. EVIDENCE-FIRST POLICY

Every finding must be evidence-based.

For every confirmed finding provide:

Finding ID

Example:

SEC-001

Title

Short descriptive name.

Severity

Critical

High

Medium

Low

Informational


Confidence

Confirmed

High confidence

Medium confidence

Needs manual verification


Location

Exact:

File

Function

Route

Database table

Policy

Configuration


Description

Explain the issue.

Security impact

What could realistically happen?

Attack scenario

Describe a safe conceptual scenario.

Evidence

Reference the exact code or configuration.

Recommended remediation

Specific fix.

Verification method

Explain how to confirm the fix.

References

Where applicable:

CWE

OWASP

Security advisory

CVE


Never create findings merely to increase the number of findings.

Accuracy is more important than quantity.


---

37. FALSE POSITIVE CONTROL

Do not treat every suspicious pattern as a confirmed vulnerability.

Clearly distinguish:

Confirmed vulnerability

Likely vulnerability

Potential concern

Informational improvement


Before escalating severity:

1. Understand the context.


2. Verify exploitability.


3. Check compensating controls.


4. Check whether the vulnerable path is reachable.




---

38. RISK PRIORITIZATION

Prioritize findings based on:

Exploitability

Impact

Likelihood

Exposure

Required attacker access

Availability of compensating controls


A minor theoretical issue should not automatically outrank a realistic tenant data exposure.


---

39. CREATE A FINDINGS REGISTER

Create a persistent audit findings document inside an appropriate security/audit folder.

For example:

security-audit/FINDINGS.md

or an equivalent structure appropriate for the project.

The register should contain:

ID	Severity	Status	Area	Title

SEC-001	High	Open	Authorization	Example finding


Statuses should include:

Open

In Progress

Fixed

Verified

Accepted Risk

False Positive


Do not automatically modify production code unless explicitly instructed.

The primary goal initially is:

> DISCOVER → VERIFY → DOCUMENT → PRIORITIZE → PLAN




---

40. CREATE THE MASTER AUDIT PLAN

After understanding the application and researching relevant risks, create:

MASTER_SECURITY_AUDIT_PLAN.md

This must be customized specifically for the project.

It should contain:

Phase 1

Project discovery

Phase 2

Architecture and threat modeling

Phase 3

Parallel security audits

Phase 4

Deep manual verification

Phase 5

Attack-chain analysis

Phase 6

Findings correlation

Phase 7

Remediation roadmap

Phase 8

Post-fix regression testing

Phase 9

Production readiness review

Each phase should include:

Objectives

Tasks

Dependencies

Parallelizable work

Deliverables

Completion criteria



---

41. DO NOT AUDIT EVERYTHING SEQUENTIALLY

Optimize intelligently.

Tasks that are independent should run in parallel.

For example:

These can often be parallel:

Dependency audit

Secret scanning

Frontend audit

Database schema review

Infrastructure review


But dependent tasks should wait where necessary.

For example:

Architecture discovery should precede project-specific threat modeling.

Threat modeling should influence deeper manual testing.

Findings correlation should occur after individual audits.



---

42. ITERATIVE AUDIT PROCESS

Security auditing must not be a single pass.

Use an iterative approach:

Pass 1

Broad discovery.

Pass 2

Domain-specific audits.

Pass 3

Deep investigation of suspicious findings.

Pass 4

Attack-chain analysis.

Pass 5

Research newly discovered technologies or risks.

Pass 6

Final gap analysis.

Ask repeatedly:

> "What have we not examined yet?"




---

43. SECURITY GAP ANALYSIS

At the end, review the entire process.

Ask:

Which attack surfaces remain untested?

Which assumptions remain unverified?

Which components received shallow analysis?

Which technologies require specialist review?

What could have been missed?


Create:

SECURITY_GAP_ANALYSIS.md

Be honest about limitations.

Never claim:

> "The application is completely secure."



Instead report:

> "These areas were examined, these findings were identified, and these limitations remain."




---

44. REMEDIATION ROADMAP

After findings are complete, create a prioritized remediation roadmap.

Immediate

Critical vulnerabilities.

Before production

High-risk vulnerabilities.

Near-term improvements

Medium-risk vulnerabilities.

Hardening

Low-risk improvements.

For each remediation:

Estimated complexity

Dependencies

Potential breaking changes

Verification steps



---

45. POST-FIX SECURITY REGRESSION

After vulnerabilities are fixed:

1. Verify the original vulnerability is resolved.


2. Check that the fix did not introduce another vulnerability.


3. Re-run relevant automated checks.


4. Re-test related attack paths.


5. Update the findings register.



Security fixes must not simply be assumed correct.


---

46. PRODUCTION READINESS REVIEW

Before deployment, perform a dedicated final review.

Check:

Authentication

✓ Secure

Authorization

✓ Secure

Tenant isolation

✓ Verified

Secrets

✓ Protected

Dependencies

✓ Reviewed

Infrastructure

✓ Hardened

Logging

✓ Appropriate

Backups

✓ Available

Monitoring

✓ Available

Incident response

✓ Considered

Produce a final:

PRODUCTION SECURITY READINESS REPORT

Include:

Overall security posture

Critical unresolved risks

High-risk unresolved issues

Accepted risks

Known limitations

Recommended future improvements

Deployment recommendation

One of:

GO

GO WITH CONDITIONS

NO-GO


The recommendation must be evidence-based.


---

47. REQUIRED FINAL DELIVERABLES

At the conclusion of the planning and audit process, produce an organized security folder containing, where appropriate:

security-audit/
│
├── PROJECT_SECURITY_OVERVIEW.md
├── ARCHITECTURE_SECURITY_MAP.md
├── THREAT_MODEL.md
├── MASTER_SECURITY_AUDIT_PLAN.md
├── FINDINGS.md
├── FINDINGS_REGISTER.md
├── SECURITY_GAP_ANALYSIS.md
├── REMEDIATION_ROADMAP.md
├── SECURITY_SCORECARD.md
├── PRODUCTION_READINESS_REPORT.md
└── RESEARCH_AND_REFERENCES.md

Adapt this structure if the project requires something better.


---

48. SECURITY SCORECARD

Create a scorecard covering major domains.

For example:

Security Domain	Score	Confidence	Notes

Authentication	/10	High	
Authorization	/10	High	
Tenant Isolation	/10	High	
Database Security	/10	Medium	
API Security	/10	High	
Frontend Security	/10	Medium	
Dependency Security	/10	High	
Infrastructure	/10	Medium	
Secrets Management	/10	High	
Monitoring	/10	Medium	


Scores must not be arbitrary.

Explain how each score was determined.


---

49. CORE MINDSET

Throughout the entire process, maintain this mindset:

> Assume that security weaknesses may exist even in code that looks clean.



> Do not trust a security control simply because it exists. Verify its implementation.



> Do not assume a managed service eliminates security responsibilities.



> Do not trust the frontend as an authorization boundary.



> Do not assume two tenants are isolated until isolation is verified.



> Do not assume a dependency is safe merely because it is popular.



> Do not assume a vulnerability is harmless until its attack path is analyzed.



> Do not stop at generic checklists.



> Continuously adapt the audit to the actual application.




---

50. FINAL INSTRUCTION

Your first task is NOT to immediately begin changing code.

Your first task is:

Understand the project completely.

Then:

Create a customized Master Security Audit Plan.

That plan must combine:

The requirements in this specification

The actual project's architecture

The actual technology stack

The actual database

The actual business logic

Current security research

Relevant CVEs

Relevant best practices

Newly discovered risks


Use specialized parallel agents or workstreams where beneficial.

You may create additional research tasks, specialized skills, helper agents, or security tooling when relevant and available.

Do not limit yourself to the items explicitly listed in this document.

This document defines the minimum expected scope, not the maximum.

Your goal is to think like a coordinated team consisting of:

Application security engineers

Backend security reviewers

Database security specialists

Cloud security engineers

Threat modelers

Secure code reviewers

Supply-chain security specialists

Penetration testers

SaaS security architects


But remain evidence-driven and avoid unsupported claims.

The ultimate objective is:

> Create the most comprehensive, project-specific, realistic security audit roadmap possible before auditing and hardening the application for production deployment.






