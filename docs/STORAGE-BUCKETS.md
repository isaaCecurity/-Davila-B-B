# STORAGE-BUCKETS.md

## Purpose

This document is the source of truth for BakeFlow's Supabase Storage architecture.

It defines the production rules for:
- the four existing storage buckets
- object path conventions
- tenant isolation
- branch/user ownership boundaries
- upload authorization
- read authorization
- signed URLs
- public versus private objects
- URL columns stored in PostgreSQL
- object lifecycle
- cleanup after soft deletion
- cleanup after permanent deletion
- replacement/versioning
- orphan detection
- offline behavior
- file validation
- size limits
- MIME/type validation
- security
- RLS/storage policies
- application/backend responsibilities

Claude Code MUST inspect the live Supabase Storage configuration before changing it.

Do not create additional buckets simply because a feature needs a file unless the storage boundary genuinely requires a new security/lifecycle policy.

The current deployed design has four live buckets, four corresponding policy areas, and four database URL/path columns. Their exact live names and table-column mappings MUST be read from the live database before implementation.

---

# 1. Storage architecture principles

BakeFlow uses Supabase Storage for application-managed files.

Storage is NOT a general-purpose public file server.

The default security posture is:

```text
PRIVATE BUCKET
+
AUTHENTICATED ACCESS
+
SERVER/DB AUTHORIZATION
+
STORAGE RLS/POLICIES
+
SIGNED URL WHEN TEMPORARY ACCESS IS NEEDED
```

Public buckets should only exist where the product explicitly requires public unauthenticated access.

Do not make a bucket public merely because doing so makes frontend development easier.

---

# 2. Four live buckets

The deployed system currently contains four live buckets.

Claude Code MUST first inspect and record:

```text
bucket name
bucket ID
public/private status
file size limit
allowed MIME types
created_at
associated database columns
associated policies
```

The four buckets must be mapped to their domain purpose in the implementation documentation.

Do not rename, delete, or repurpose a live bucket without checking:
- database URL/path columns
- existing objects
- application references
- storage policies
- migrations
- backup/restore implications

If a bucket is currently used by production data, migration must preserve existing object paths.

---

# 3. Bucket-to-domain ownership

Every stored object must have a clearly defined owner.

The owner may be:

```text
organization
branch
user
entity/record
```

depending on the bucket.

The ownership model must be deterministic.

Do not rely on a URL column alone to establish authorization.

Example:

```text
database record
    |
    +-- organization_id
    +-- branch_id
    +-- created_by
    |
    +-- storage object path
```

The database relationship and storage policy together establish access.

---

# 4. Tenant isolation

BakeFlow is multi-tenant.

A storage object belonging to Organization A must never be accessible to a user who only belongs to Organization B.

Storage paths must therefore encode enough tenant context for policy enforcement.

Preferred conceptual structure:

```text
{organization_id}/...
```

Where branch-specific isolation is required:

```text
{organization_id}/branches/{branch_id}/...
```

Do not use:

```text
/company-name/...
/bakery-name/...
```

as the primary tenant boundary.

Names can change.

UUID identifiers provide a stable security boundary.

---

# 5. Path convention

Every bucket MUST use a documented object path convention.

Paths should be deterministic, scoped, and collision-resistant.

Recommended structure:

```text
{organization_id}/{domain}/{entity_id}/{object_id}.{ext}
```

For branch-specific resources:

```text
{organization_id}/branches/{branch_id}/{domain}/{entity_id}/{object_id}.{ext}
```

For user-owned resources:

```text
{organization_id}/users/{user_id}/{domain}/{object_id}.{ext}
```

The exact path must be chosen according to the bucket's domain.

Do not use user-controlled filenames as the full object key.

Bad:

```text
customer-uploaded-name.pdf
```

Better:

```text
org_uuid/domain/entity_uuid/object_uuid.pdf
```

The original filename may be stored separately as metadata if required.

---

# 6. Path segments are authorization inputs

Storage policies may inspect object paths.

Therefore path structure is security-sensitive.

The application must generate paths server-side or through trusted application code.

Do not allow a client to arbitrarily select:

```text
organization_id
branch_id
user_id
```

inside an object path and assume the path itself proves authorization.

The policy must verify that the authenticated user is actually authorized for the organization/branch represented by the path.

---

# 7. Object naming

Object IDs should be generated independently from user-supplied filenames.

Prefer:

```text
UUIDv7/UUID
```

or another collision-resistant identifier.

File extensions should be derived from validated content/type rather than blindly trusting a user-supplied extension.

Do not permit path traversal strings such as:

```text
../
./
```

or equivalent malformed paths.

The application should normalize/reject unsafe path components before upload.

---

# 8. Original filename

If the original filename is useful to users, store it as metadata or in a database column.

Do not use the original filename as the security boundary.

Example:

```text
storage object:
org_id/catalog/product_id/uuid.pdf

metadata:
original_filename = "Chocolate-Cake-Recipe.pdf"
```

This provides a stable object identity even if the user renames the file.

---

# 9. URL columns

The deployed schema contains four URL/path columns associated with storage objects.

Claude Code MUST identify all four live columns and document:

```text
table
column
data type
nullable?
bucket
path format
who writes it
who can read it
whether it stores:
    - object path
    - public URL
    - signed URL
    - external URL
```

Do not assume a column called:

```text
*_url
```

should contain a permanently valid URL.

---

# 10. Prefer object paths over permanent URLs

For private Supabase Storage, database records should preferably store the canonical object path rather than a generated signed URL.

Recommended:

```text
storage_path
```

rather than:

```text
signed_url
```

because signed URLs expire.

If the existing live schema has URL-named columns, preserve compatibility where necessary, but the application should treat private storage references as object paths unless the column's established contract explicitly says otherwise.

A signed URL should generally be generated at read time.

---

# 11. Why permanent signed URLs must not be stored

Signed URLs expire.

If a database stores:

```text
https://.../object?token=...
```

the value may become invalid.

This creates:
- broken links
- stale database values
- unnecessary token persistence
- difficult token rotation
- confusing synchronization behavior

Therefore:

```text
DB -> canonical storage path
API -> generate signed URL when needed
client -> consume URL temporarily
```

is the preferred model for private objects.

---

# 12. Public URL policy

A public URL may only be used for content intentionally designed to be publicly accessible.

Examples might include:
- explicitly public catalog assets
- public marketing assets

It must NOT be used for:
- invoices
- financial documents
- internal reports
- customer records
- employee documents
- private business files
- audit evidence

If a bucket is private, do not construct a public URL manually.

---

# 13. Signed URL policy

Private objects should be accessed through short-lived signed URLs.

Recommended lifecycle:

```text
authenticated request
        |
        v
server verifies access
        |
        v
generate signed URL
        |
        v
client downloads/displays object
```

The signed URL should have the shortest practical expiry compatible with the UX.

Do not use multi-day or permanent signed URLs when minutes are sufficient.

The exact expiry should be defined per domain.

---

# 14. Signed URL generation must be authorized

Generating a signed URL is itself a privileged operation.

The server must verify:
- authenticated user
- organization membership
- branch access where applicable
- record ownership/access
- object belongs to the requested domain
- requested path belongs to that record

Do not expose an endpoint such as:

```text
/sign-url?path=<arbitrary-path>
```

without authorization.

That becomes a storage path traversal/data exposure primitive.

---

# 15. Storage policy versus application checks

Both layers matter.

Application checks provide:
- domain context
- friendly errors
- record-level authorization

Storage policies provide:
- database-level enforcement
- protection against direct Storage API access
- defense against compromised/misbehaving clients

Never remove Storage policies merely because the application already checks permissions.

---

# 16. Four live policy areas

The deployed system currently has four Storage policy areas.

Claude Code MUST inspect each policy and document:

```text
bucket
policy name
operation
roles
USING expression
WITH CHECK expression
path/tenant validation
```

Do not assume a policy is safe simply because it exists.

A policy that says:

```sql
auth.role() = 'authenticated'
```

may still allow cross-tenant access.

Tenant/ownership checks are required.

---

# 17. Upload authorization

Before an object can be uploaded, verify:
- user is authenticated
- user belongs to the target organization
- user has access to the target branch if applicable
- user has the required domain permission
- path matches the expected structure
- entity referenced by the path exists where required
- file type is allowed
- file size is within limit

Do not allow arbitrary authenticated users to upload into an organization's namespace.

---

# 18. Read authorization

Reading an object must require authorization appropriate to its domain.

Examples:

```text
organization-level file
-> organization membership

branch-level file
-> organization membership + branch access

user-private file
-> matching user ID

financial/audit file
-> financial/audit permission
```

The exact rule must match the domain.

Never use a single broad rule for all buckets if their data sensitivity differs.

---

# 19. Update/overwrite authorization

Uploads and overwrites are different security operations.

A user who can upload a new object should not automatically be able to overwrite an existing object.

For sensitive domains, prefer immutable object keys.

Instead of:

```text
invoice.pdf
```

use:

```text
invoice/{invoice_id}/{object_uuid}.pdf
```

If replacement is required:
- create a new object
- update the database reference
- mark the old object for cleanup according to retention rules

This improves auditability.

---

# 20. Delete authorization

Storage deletion must be restricted.

No generic authenticated user should have unrestricted delete access.

Deletion must respect BakeFlow's soft-delete-first architecture.

Important:

> Soft-deleting a database record does not necessarily mean immediately deleting its Storage object.

Files may be required for:
- audit
- restoration
- legal/financial retention
- historical reporting

---

# 21. Soft-delete relationship

The application's standard lifecycle is:

```text
ACTIVE
  |
  v
SOFT-DELETED / ARCHIVED
  |
  v
RETENTION PERIOD
  |
  v
PERMANENT DELETION
```

Storage lifecycle must follow the same principle.

Do not immediately remove files just because:

```text
deleted_at IS NOT NULL
```

unless that specific file class is explicitly defined as disposable.

---

# 22. Cleanup-on-delete rule

Every database column that references a Storage object must have an explicit cleanup policy.

For each of the four URL/path columns, document one of:

```text
RETAIN
ARCHIVE
DELETE_AFTER_RETENTION
DELETE_IMMEDIATELY
NEVER_DELETE
```

The default for BakeFlow should be:

```text
RETAIN UNTIL AUTHORIZED PERMANENT DELETION
```

for business/financial/audit evidence.

---

# 23. Do not use database CASCADE for Storage objects

PostgreSQL foreign-key cascades do not automatically delete Supabase Storage objects.

Therefore:

```text
DELETE database row
```

does not imply:

```text
DELETE storage object
```

Storage cleanup must be handled explicitly.

Do not assume an FK cascade provides file cleanup.

---

# 24. Cleanup architecture

Storage cleanup should be handled by a trusted backend process.

Possible pattern:

```text
record permanently deleted
        |
        v
storage cleanup job
        |
        v
delete object
```

For soft deletion:

```text
record soft-deleted
        |
        v
retain object
```

The cleanup worker should be idempotent.

If the object is already gone:

```text
NOT_FOUND
```

should not cause an endless retry loop.

---

# 25. Permanent deletion and manager challenge

BakeFlow uses a high-friction destructive deletion model.

Permanent deletion is exceptional.

The Storage object must not be permanently deleted merely because an ordinary client issues a delete request.

Where the parent record requires a destructive deletion challenge:
- the challenge must be completed first
- authorization must be verified server-side
- the deletion must be auditable
- the cleanup must be tied to the authorized deletion operation

Do not expose a direct Storage delete path that bypasses the database deletion workflow.

---

# 26. Deletion ordering

For records with associated Storage objects, prefer:

```text
1. validate permanent deletion authority
2. validate deletion challenge
3. record deletion/audit event
4. transition/delete authoritative database record according to policy
5. enqueue storage cleanup
6. cleanup object
7. record cleanup result
```

Do not make file cleanup the only evidence that deletion occurred.

The audit trail must survive Storage cleanup.

---

# 27. Orphan objects

An orphan is a Storage object that no longer has a valid database reference.

Orphans can occur because:
- upload succeeded but DB insert failed
- DB record was deleted unexpectedly
- user abandoned an upload
- client crashed
- network failed between Storage and DB
- migration changed paths
- object replacement left the old object behind

The system must detect and handle orphan objects.

---

# 28. Upload transaction reality

Storage uploads and PostgreSQL transactions are not automatically one atomic transaction.

Therefore this sequence is unsafe:

```text
BEGIN DB transaction
upload storage object
DB insert fails
ROLLBACK
```

The Storage upload may remain.

Similarly:

```text
upload
DB write
network failure
```

can produce an uncertain state.

The application must use explicit reconciliation.

---

# 29. Upload staging

For complex uploads, use a staging state.

Conceptually:

```text
UPLOAD_PENDING
        |
        v
STORAGE_OBJECT_CREATED
        |
        v
DB_REFERENCE_CREATED
        |
        v
ACTIVE
```

If the DB reference is never created, a cleanup process can remove stale staged objects.

Do not expose staged objects as normal business assets.

---

# 30. Orphan cleanup

A periodic trusted job should identify:
- objects with no corresponding database reference
- stale staged uploads
- replaced objects past retention
- objects belonging to deleted entities whose retention period expired

Cleanup must be conservative.

Do not delete an object solely because a crawler cannot immediately find a matching record.

Allow for:
- eventual consistency
- recent uploads
- migration windows
- in-flight transactions

Use an explicit grace period.

---

# 31. Storage garbage collection

A future maintenance job may perform:

```text
scan storage
      |
      v
identify candidates
      |
      v
verify against database
      |
      v
apply grace period
      |
      v
delete only authorized candidates
```

The job must be idempotent.

Do not make garbage collection part of every user request.

---

# 32. Replacement/versioning

When a file is replaced, prefer creating a new object rather than overwriting an old object when audit/history matters.

Example:

```text
document/
  record_id/
    object_A.pdf
    object_B.pdf
```

The database points to the current object.

The old object can be:
- retained
- archived
- deleted after retention

according to the domain policy.

This prevents accidental loss of historical evidence.

---

# 33. File validation

Every upload must validate:
- maximum size
- MIME type
- file extension
- file signature/magic bytes where practical
- expected domain type

Do not trust:

```text
Content-Type
```

from the client as the sole validation mechanism.

Example:

```text
filename = invoice.pdf
Content-Type = application/pdf
```

does not prove the content is actually a PDF.

---

# 34. Malware/content scanning

If BakeFlow later accepts arbitrary user documents, consider an asynchronous malware/content scanning stage.

For the MVP, Claude Code should not introduce a complex scanning platform unless required by the actual accepted file types.

However, the storage architecture should leave room for:

```text
UPLOADED
SCANNING
APPROVED
REJECTED
```

for high-risk file classes.

---

# 35. File size limits

Each bucket should have an explicit maximum file size.

Do not leave limits unlimited.

The limits should reflect the actual domain.

Example conceptual policy:

```text
small image assets
-> smaller limit

documents
-> larger limit

reports/export artifacts
-> larger but bounded limit
```

The live bucket configuration must be inspected before changes are made.

---

# 36. MIME allowlists

Each bucket should have an explicit allowlist where practical.

Avoid:

```text
*/*
```

unless the bucket genuinely requires arbitrary file types.

If a domain only needs:

```text
image/png
image/jpeg
application/pdf
```

restrict it accordingly.

Do not allow executable or script formats without a compelling product requirement.

---

# 37. SVG caution

SVG can contain active content depending on how it is processed/rendered.

Do not automatically allow SVG simply because it is an image format.

If SVG is required, sanitize it before rendering in security-sensitive contexts.

---

# 38. Image processing

If the application generates thumbnails or resized images:
- store generated variants separately
- never trust client-supplied dimensions
- limit processing size
- avoid decompression-bomb style payloads
- preserve source object according to retention rules

Generated assets should have deterministic relationships to their source record.

---

# 39. Storage metadata

Metadata may include:
- original filename
- content type
- size
- checksum/hash
- uploaded_by
- uploaded_at
- entity ID

Do not put sensitive authorization information into metadata and assume Storage policies will enforce it.

Authorization belongs in database/policy logic.

---

# 40. Checksums

For important documents, consider storing a checksum such as SHA-256.

This can help detect:
- corrupted files
- accidental replacement
- duplicate content
- migration problems

A checksum is integrity metadata, not authorization.

---

# 41. Offline uploads

Offline capability does not mean raw files must always be immediately uploaded.

For offline-created records:

```text
encrypted local file
        +
local object reference
        +
outbox operation
```

can remain local until connectivity returns.

The local file must be protected by the same encrypted-storage policy as other sensitive offline data.

---

# 42. Offline file synchronization

A file upload operation must be idempotent.

Use a stable operation/object identifier.

If upload succeeds but the response is lost, retrying must not create uncontrolled duplicate objects.

Possible pattern:

```text
operation_id
object_id
expected_path
checksum
```

The server/backend can use these to detect an already-created object.

---

# 43. Offline URL columns

Do not write temporary signed URLs into synchronized database URL columns.

Offline clients should store:
- canonical object path
- local file URI
- synchronization status

The server should generate signed URLs when the object is available remotely.

Example conceptual state:

```text
local_uri
remote_storage_path
upload_status
```

The exact schema belongs to the local/offline implementation.

---

# 44. Local file lifecycle

For an offline upload:

```text
CAPTURED
  |
  v
ENCRYPTED_LOCAL
  |
  v
QUEUED
  |
  v
UPLOADING
  |
  v
REMOTE_CONFIRMED
  |
  v
LOCAL_CLEANUP_ELIGIBLE
```

Do not delete the local encrypted file immediately after the upload request begins.

Only clean it after the server has confirmed successful synchronization and the application no longer needs the local copy.

---

# 45. Failed offline upload

If upload fails:
- retain encrypted local data
- retain outbox operation
- record error
- retry if transient
- stop retrying if permanently invalid
- surface actionable status

Never silently delete the only copy of a business document because a network request failed.

---

# 46. URL caching

Signed URLs may be cached briefly in memory for UX/performance.

Do not persist long-lived signed URLs unnecessarily.

When expired:

```text
request fresh signed URL
```

Do not treat URL expiry as data loss.

---

# 47. Access after record soft deletion

For a soft-deleted record, the application must decide whether authorized users can still retrieve associated files.

Default:

```text
soft-deleted record
-> file retained
-> normal user access restricted according to record lifecycle
-> authorized archive/audit access may remain
```

Do not expose archived financial evidence to every user simply because the object still exists.

---

# 48. Access after permanent deletion

After permanent deletion:

```text
record
+
storage object
```

should no longer be available to normal application users.

Cleanup may be asynchronous, so a short period can exist where the object physically remains.

Storage access must not rely solely on eventual deletion for security.

Authorization should immediately prevent normal access once the record is no longer eligible.

---

# 49. Database reference integrity

Each URL/path column must have a clear relationship to its source record.

The application must prevent:
- a record referencing another organization's object
- a record referencing an object in another bucket
- a record referencing an unexpected path
- a deleted entity retaining an accidentally reused path

Where feasible, enforce object-path construction in trusted backend code rather than letting arbitrary clients populate URL columns.

---

# 50. Never trust client-supplied bucket names

The client should not be allowed to say:

```text
bucket = "sensitive-bucket"
```

and choose where to upload.

The application operation determines the bucket from the domain.

Example:

```text
catalog image operation
-> known catalog bucket

invoice attachment operation
-> known finance bucket
```

Bucket selection is application logic, not user input.

---

# 51. Cross-bucket access

A user authorized for one domain must not automatically gain access to another bucket.

Examples:

```text
catalog access
!=
financial document access

customer access
!=
internal audit access
```

Policies must reflect domain permissions.

---

# 52. Service role

The Supabase service role bypasses normal RLS/storage policy protections.

It must never be exposed to:
- React Native
- browser JavaScript
- public API payloads
- client configuration
- local storage

Use service-role capabilities only in trusted server-side functions/jobs where required.

---

# 53. Anon role

Anonymous users should not have access to private BakeFlow storage.

If a bucket is public, verify that this is intentional.

Do not grant:

```text
anon -> read
```

for sensitive buckets.

---

# 54. Authenticated role

Authenticated access still requires authorization.

This is not sufficient:

```sql
auth.role() = 'authenticated'
```

A correct policy should additionally establish:
- organization membership
- branch access
- domain permission
- path/entity relationship

---

# 55. Storage policy recursion

Storage policies should avoid unsafe recursive dependencies.

If a Storage policy queries a table, ensure that:
- the query is safe under RLS
- it does not cause policy recursion
- it cannot be manipulated through user-controlled path values
- performance is acceptable

Where a trusted helper function is required, review its `SECURITY DEFINER`, `search_path`, and EXECUTE permissions carefully.

---

# 56. Policy performance

Storage policies execute during file operations.

Avoid unnecessarily expensive queries.

Membership checks should use indexed columns such as:

```text
organization_id
user_id
branch_id
```

Do not scan large business tables on every upload/download.

---

# 57. Indexes supporting storage authorization

Where policies repeatedly check:

```text
organization_id + user_id
organization_id + branch_id
user_id + organization_id
```

appropriate indexes should exist.

Storage policy performance is part of database performance.

---

# 58. Migration safety

Storage configuration is part of the deployed system.

Any change to:
- bucket name
- bucket privacy
- file size limit
- MIME allowlist
- Storage policy
- object path convention

must be represented in migration/deployment documentation.

Do not make a manual dashboard change and leave the repository unaware.

---

# 59. Existing object migration

If the path convention changes, do not simply change application code.

Migration plan must include:

```text
old paths
    |
    v
new paths
    |
    v
database reference updates
    |
    v
verification
    |
    v
old object cleanup after grace period
```

Do not delete old objects until every database reference has been migrated and verified.

---

# 60. URL column migration

If an existing URL column stores a full URL but the architecture moves to object paths:

1. inspect current values
2. determine whether they are public URLs, signed URLs, or paths
3. extract canonical object paths
4. migrate values
5. update application code
6. regenerate types
7. verify reads/writes
8. only then consider renaming the column

Do not blindly replace URL strings.

---

# 61. Storage naming convention

Repository code should use semantic constants rather than scattering bucket names throughout the codebase.

Example:

```ts
STORAGE_BUCKETS.catalog
STORAGE_BUCKETS.documents
STORAGE_BUCKETS.finance
STORAGE_BUCKETS.profile
```

The exact names must come from the live deployment.

Do not duplicate literal bucket names across dozens of components.

---

# 62. API abstraction

Storage operations should go through a shared service/package.

Recommended responsibilities:

```text
upload
download
createSignedUrl
remove
getMetadata
validatePath
```

Feature code should not directly construct arbitrary Storage paths everywhere.

This centralizes:
- security
- naming
- retries
- error normalization
- signed URL handling

---

# 63. React Native considerations

The mobile app must account for:
- interrupted uploads
- app suspension
- background limitations
- network transitions
- local encrypted storage
- file URI differences
- retrying after process termination

Do not assume an upload started by the app will complete if the app is backgrounded.

The sync system must treat upload state as durable state, not in-memory state.

---

# 64. Web considerations

The deferred web application should use the same storage contract.

Do not create separate bucket/path conventions for web.

Shared package responsibilities should cover:
- bucket identifiers
- path construction
- API wrappers
- validation

The web app may have broader administrative capabilities, but it must still respect Storage policies.

---

# 65. Error handling

Storage errors should be normalized into application-level categories.

Examples:

```text
STORAGE_UNAUTHORIZED
STORAGE_NOT_FOUND
STORAGE_TOO_LARGE
STORAGE_INVALID_TYPE
STORAGE_UPLOAD_FAILED
STORAGE_SIGNED_URL_FAILED
STORAGE_DELETE_FORBIDDEN
STORAGE_ORPHANED
```

Do not expose raw internal Storage errors unnecessarily to users.

---

# 66. Audit logging

Sensitive storage actions should be auditable.

Where appropriate, record:
- upload
- replacement
- signed URL generation for sensitive files
- archive
- permanent deletion
- cleanup

The audit record should include:
- actor
- organization
- branch where applicable
- object/entity
- timestamp
- operation/result

Do not store signed URL tokens in audit logs.

---

# 67. Financial evidence

Financial documents should have stronger retention controls than ordinary images.

Examples:
- invoices
- receipts
- audit evidence
- financial reports

These should not be deleted merely because a parent record was soft-deleted.

Permanent deletion must follow the project's destructive deletion and retention rules.

---

# 68. Customer-related files

Customer files must remain tenant-scoped.

A Driver's access should be limited to the customer information and files required for operational work.

Do not assume that because a user can see a customer record, they can automatically download every customer-associated document.

Use domain-specific authorization.

---

# 69. Catalog assets

Catalog images are typically less sensitive than financial documents, but still belong to the organization.

The application may choose public access for explicitly public catalog assets, but this must be intentional.

Do not expose private internal product/recipe files just because product images are public.

Keep public assets and internal assets in distinct security boundaries where necessary.

---

# 70. Recipes and internal documents

Recipe files and operational documents should default to private.

Their access should follow organization/branch/role permissions.

Do not make them public merely because they are associated with catalog records.

---

# 71. Profile/avatar assets

If the application supports avatars:
- determine whether they are public or private
- use stable object paths
- avoid embedding sensitive information in filenames
- restrict upload size
- validate image types

A profile image does not automatically justify making an entire user bucket public.

---

# 72. Cleanup and soft-delete interaction

Storage cleanup must align with `SOFT-DELETE-AND-RETENTION.md`.

That document defines the repo-wide deletion philosophy.

This document defines how that philosophy applies to Storage.

The combined rule is:

```text
soft delete
-> retain object

archive
-> retain object

permanent deletion
-> cleanup according to retention policy

hard delete without approved workflow
-> forbidden
```

---

# 73. Restore behavior

If a record is restored from soft deletion:
- the original Storage object should remain usable if retained
- the database reference should remain unchanged where possible
- do not upload a duplicate file merely because the record was restored

If the object was already permanently removed, restoration must report that the attachment is unavailable rather than silently creating an empty reference.

---

# 74. Backup and disaster recovery

Database backups and Storage backups are separate concerns.

The engineering documentation must account for both.

A database restore without corresponding Storage objects can leave broken references.

A Storage restore without the corresponding database state can create orphan objects.

Disaster recovery testing should verify:

```text
DB state
+
Storage state
+
object references
```

remain consistent.

---

# 75. Security review checklist

Before approving Storage changes:

- [ ] all four live buckets identified
- [ ] all four policies identified
- [ ] all four URL/path columns identified
- [ ] bucket privacy verified
- [ ] MIME restrictions verified
- [ ] file-size restrictions verified
- [ ] path convention documented
- [ ] organization ID included where required
- [ ] branch ID included where required
- [ ] object IDs are non-user-controlled
- [ ] authenticated access is not treated as sufficient authorization
- [ ] cross-organization access tested
- [ ] cross-branch access tested
- [ ] anon access reviewed
- [ ] service role is never exposed
- [ ] signed URL policy defined
- [ ] signed URLs are not persisted as permanent database references
- [ ] soft-delete behavior defined
- [ ] permanent-delete behavior defined
- [ ] cleanup-on-delete behavior defined
- [ ] orphan cleanup defined
- [ ] upload staging/recovery considered
- [ ] replacement/versioning defined
- [ ] file validation defined
- [ ] payload limits defined
- [ ] sensitive files remain private
- [ ] Storage policies are indexed/performance-safe
- [ ] existing object paths considered before migration
- [ ] offline upload behavior defined
- [ ] audit requirements defined

---

# 76. Claude Code implementation workflow

Before changing Storage:

1. Inspect the live Supabase Storage buckets.
2. Record the exact four bucket names.
3. Record public/private status.
4. Record file-size limits.
5. Record MIME restrictions.
6. Inspect all Storage policies.
7. Inspect all four database URL/path columns.
8. Search the repository for every bucket name.
9. Search for every URL/path column.
10. Search for `createSignedUrl`, `getPublicUrl`, `upload`, `remove`, and `download`.
11. Search for direct Storage API usage outside the shared storage service.
12. Map every database reference to its bucket/object path.
13. Compare live configuration against migrations.
14. Do not redesign the live buckets without identifying existing objects.
15. Implement path conventions centrally.
16. Implement signed URL generation centrally.
17. Implement authorization at both application and Storage-policy layers.
18. Implement cleanup through trusted server-side workflows.
19. Add orphan/reconciliation handling.
20. Add tests for cross-tenant access before calling the work complete.

---

# 77. Required tests

### Tenant isolation

```text
User A / Organization A
attempts to read Organization B object
-> rejected
```

### Branch isolation

```text
Branch A user
attempts Branch B object
-> rejected
```

### Unauthorized upload

```text
authenticated user
attempts upload to another organization
-> rejected
```

### Path tampering

```text
valid user
modifies organization_id in object path
-> rejected
```

### Signed URL authorization

```text
authorized user
requests valid private object
-> signed URL generated

unauthorized user
requests same object
-> rejected
```

### Expiration

```text
signed URL expires
-> access denied
-> fresh authorized URL can be generated
```

### Soft delete

```text
record soft-deleted
-> object retained
-> ordinary access restricted according to lifecycle
```

### Permanent deletion

```text
approved destructive deletion
-> DB lifecycle completes
-> cleanup job removes object
-> audit record remains
```

### Orphan

```text
upload succeeds
DB reference fails
-> object enters orphan/staging cleanup path
```

### Retry

```text
upload response lost
retry
-> no uncontrolled duplicate object
```

### Offline

```text
offline file
-> encrypted local persistence
-> queued
-> reconnect
-> upload
-> server confirmation
-> safe local cleanup
```

### Cross-organization URL reference

```text
Organization A DB record
references Organization B object
-> rejected by backend/domain validation
```

---

# 78. Non-negotiable rules

The following rules MUST NOT be violated:

1. Do not expose private buckets publicly for convenience.
2. Do not treat `authenticated` as sufficient authorization.
3. Do not trust client-supplied organization or branch IDs.
4. Do not use user-controlled filenames as security boundaries.
5. Do not store expiring signed URLs as permanent database references.
6. Do not directly hard-delete Storage objects when a database record is merely soft-deleted.
7. Do not bypass the permanent deletion workflow.
8. Do not assume PostgreSQL cascades delete Storage objects.
9. Do not expose the service role to clients.
10. Do not let a client choose arbitrary bucket names.
11. Do not allow cross-tenant object access.
12. Do not silently overwrite sensitive objects without an explicit replacement policy.
13. Do not silently lose offline files after failed uploads.
14. Do not make orphan cleanup aggressive enough to delete legitimate recent uploads.
15. Do not change live object paths without a migration plan.
16. Do not leave Storage configuration changes undocumented in migrations/repository configuration.
17. Do not duplicate bucket/path logic throughout feature code.
18. Do not allow Storage policy gaps to be hidden behind frontend authorization.
19. Do not permanently delete audit/financial evidence without the project's retention/destructive-deletion rules.
20. Do not assume a database URL column is authoritative until its actual live semantics have been verified.

---

# 79. Final storage contract

BakeFlow's storage model is:

```text
DOMAIN RECORD
    |
    v
CANONICAL OBJECT PATH
    |
    v
PRIVATE STORAGE BY DEFAULT
    |
    v
TENANT + BRANCH AUTHORIZATION
    |
    v
STORAGE POLICY
    |
    v
SIGNED URL WHEN TEMPORARY ACCESS IS REQUIRED
    |
    v
SOFT DELETE / ARCHIVE
    |
    v
RETENTION
    |
    v
AUTHORIZED PERMANENT DELETION
    |
    v
IDEMPOTENT STORAGE CLEANUP
```

The four live buckets are not interchangeable.

Each bucket must have:
- a documented domain purpose
- a path convention
- an ownership model
- an access policy
- an upload policy
- a signed-URL policy where applicable
- a deletion policy
- a retention policy
- an orphan-cleanup policy
- offline behavior where applicable

The four live URL/path columns must each have:
- a defined semantic meaning
- a canonical bucket
- a canonical path format
- a writer
- a reader
- a lifecycle
- a cleanup rule

The four live Storage policies must each be verified against:
- organization isolation
- branch isolation
- role/permission requirements
- direct Storage API access
- path tampering
- RLS interactions
- performance

Any implementation that contradicts this document must be treated as an architectural change requiring explicit review and corresponding updates to:
- database migrations
- Storage configuration
- API contracts
- generated Supabase types
- shared storage service
- frontend feature code
- tests
- engineering documentation

This document is intentionally designed to sit alongside `SOFT-DELETE-AND-RETENTION.md` and `OFFLINE-SYNC-MODEL.md`.

Storage lifecycle, deletion lifecycle, and offline synchronization must remain consistent with one another.
