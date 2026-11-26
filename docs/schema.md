# Schema outline — design only

> Some entries below describe earlier increments and may be superseded by later entries. For the current gate and session handoff, see [PROGRESS.md](PROGRESS.md) and [ROADMAP.md](ROADMAP.md).

The complete logical dictionary is in sections 12A–12H of requirements.md. No schema has been migrated or verified. Before implementation resolve each field's nullability, allowed states, uniqueness and foreign keys here and validate against the SRS.

All business entities use UUIDs and organization ownership, with composite organization/id foreign keys for every organization-owned relationship. Membership IDs are distinct from auth-user IDs. Mutable records have version and actor metadata; snapshots, audit and ledger entries are append-only. Money uses numeric(18,2), quantities numeric(12,3), instants timestamptz. A resources registry must be created atomically with each generic target and enforce its domain type.

Planned groups: identity (organizations, members, roles, permissions, scopes); accounts (accounts, sites, contacts, equipment, catalogue); leads (shared leads, sources, source events, assignment and activities); opportunities (requirements, revisions, bookings); field (attendance, plans, visits, reports, offline receipts); tenders (lots, date versions, compliance, checklist, snapshots, awards, securities, execution); expenses (policies, trips, claim versions/lines, approvals, advances, reimbursements/reversals); platform (resources, files, tasks, audit, operation receipts, outbox). Private integration configuration and worker state must not be exposed through the API.

Transactions and constraints must enforce immutable submissions, exact-version approvals, nonnegative balances, idempotency and concurrent writes. A preliminary in-memory calculation cannot provide these guarantees.

## Foundation increment: exact implemented columns

The first migration is a deliberately narrow, read-only foundation, not the full dictionary above. All identifiers are UUID. `organizations`: id primary key, nonblank name (1–200 characters), timezone text (IANA validation is not yet enforced), currency uppercase three letters, financial year month 1–12, created_at. `profiles`: auth user id primary key referencing auth.users without cascading delete, display_name 1–200 characters, optional phone at most 40 characters. `memberships`: id, organization_id, auth user id, Active/Inactive status, optional employee_code (1–100 chars); unique organization/id, organization/user and organization/employee_code; created_at. `resources`: id, organization_id, resource_type from an explicit set, owner_membership_id nullable with composite same-organization FK, archived_at, created_at, unique organization/id. Registry rows are not yet exposed for mutation; registry/domain atomicity requires later domain migrations and commands. Manager hierarchy, grants, role scopes, shares, audit and file tables remain unimplemented.

RLS allows active users to see only their own membership, their organizations, their own profile when they have an active membership, and resources owned by their active membership. No authenticated table mutation is granted. The resource table is not a general permission model: shared, territory and team access remains unavailable until implemented and tested. No private files or business tables exist yet.

## Role foundation increment

`roles`: UUID id, organization_id, nonblank code and name, requires_mfa boolean; unique organization/id and organization/code. `permissions`: static code and description. `role_permissions`: organization_id, role_id, permission_code; same-organization role FK and unique organization/role/permission. `member_roles`: UUID id, organization_id, membership_id, role_id, effective_from and optional effective_to (strictly later); composite organization FKs to role and membership, unique organization/member/role. The initial migration uses one interval per member/role; a later migration replaces that constraint with non-overlapping grant history. Audited administrative commands remain pending; no production grants should be provisioned until those are implemented.

`private.audit_events` and `private.operation_receipts` are service-only staging structures: UUID id, organization_id, actor membership FK; audit has action, optional resource with same-organization FK, request id, timestamp and explicitly redacted JSON; receipts have operation key, command type, request hash, response snapshot, completed timestamp and unique organization/actor/key. Neither table has browser grants. No command writes them yet, so atomic auditing/idempotency are not implemented. Profiles may update only display_name and phone with active membership; auth id and membership authority cannot be modified.

`private.has_permission(organization_id, permission_code)` is a read-only, security-invoker helper. It relies on the caller's RLS-filtered active membership and effective role grant and requires the signed JWT AAL2 claim when that role requires MFA. Its private schema is not exposed through the Supabase Data API; execute is granted only to authenticated callers for use by subsequent invoker code. It does not grant scope to any record or authority to perform any command. Business commands must additionally enforce action scope and independent approval, and must not treat editable user metadata as authority.

Audit events and completed operation receipts are append-only: update/delete/truncate triggers reject changes, including from service code. Organization/actor/operation key uniqueness prevents duplicate completed receipts, but it does not itself implement transactional command execution or same-key/different-payload conflict handling. A retention/purge mechanism requires a separate authorized design.

Role grant history replaces the one-interval restriction with a GiST exclusion constraint. The half-open `[effective_from,effective_to)` ranges for the same organization, member and role may touch but cannot overlap, including open-ended grants. The migration uses PostgreSQL's `btree_gist` extension and is tested locally; deployment compatibility remains to be verified against Supabase.

Permission catalog entries carry `requires_mfa boolean NOT NULL DEFAULT true`; a permission or role can require AAL2, so a privileged permission remains protected even if a role's flag is false. Lowering this protection is a privileged configuration decision, not a client action; catalog administration and mandatory audit are not yet implemented. Existing catalog rows default to MFA-required when this migration applies.

Resource reads additionally require the explicit action permission `<resource_type>.read` for the same organization, evaluated against the effective role and MFA rules. Ownership alone is not sufficient. This initial policy permits own scope only; shares, team scope, all-organization scope and domain-specific tab visibility remain unimplemented and denied.

## Customer and manual lead intake

The initial accounts and leads tables use the registry ID as the record ID. Composite foreign keys enforce organization and resource type. Leads may link to a visible account in the same organization. Reads are gated by the existing ownership and effective permission policy. The browser cannot mutate these tables directly.

The authenticated create command derives the owner from active membership, checks the matching create permission and MFA requirements, and accepts only its documented input fields. Registry row, record, audit event and receipt commit together. A retry with the same operation key and identical payload returns the prior ID. Different input with the same key conflicts. Lead references use a global sequence displayed within each organization, with per-organization/year numbering still pending. Only manual sources are accepted by the create command. CSV and IndiaMART ingestion are pending.

## Lead follow-up and initial staff provisioning

Lead rows now track first attempt, first successful contact, next action, disqualification reason and version. The command serializes writes on the lead, checks the expected version and adds audit and operation receipts. Contact attempts are append-only. Conversion requires an owned qualified lead and accessible linked account and creates one primary opportunity per lead. Stage transitions beyond initial qualification, separate follow-up tasks and additional opportunities per lead remain outstanding. Qualification updates the existing requirement text. Separate immutable storage for the original inbound message remains outstanding.

The private operator function can provision an existing Auth identity with the MFA-required Intake Staff role. The command checks the exact permission bundle before assigning it and records the event without storing personal details in the audit payload. It does not create Auth identities or administer existing memberships.

## Open opportunity pipeline

Opportunities have a positive row version. A manual estimate uses an exact INR decimal, a whole-percent probability and a written reason. All three fields are absent when the estimate is unset. PostgreSQL computes and rounds weighted value to the nearest paise for open stages. A versioned command checks active ownership, read and edit permissions, writes an audit event, and records the result for safe retry. Won and Lost are outside this command. Authorized bookings, closure, reopen and product-line estimates remain outstanding.

## File validation foundation (no migration)

A preliminary byte-signature and size check exists in `packages/domain/file-validation.js`. It accepts only declared PDF/JPEG/PNG types with matching leading signatures, with a 10 MiB receipt limit and 25 MiB business-document limit. It always returns pending scan; it does not parse file structure, detect polyglots or malware, enforce streaming limits, store objects, or authorize upload or retrieval. No file table, bucket, upload endpoint or scanning integration was added. The planned file schema and recovery design still require explicit field constraints, state transitions and migration review before implementation. Office formats remain unavailable until a safe scanning approach is in place.

### Planned private file staging registry, 2026-11-25

The initial additive migration introduces `private.file_upload_stages` as a fail-closed staging registry only; it exposes no upload, download, scan or finalize operation. Fields: UUID primary key; non-null organization, parent resource and uploader membership with same-organization composite foreign keys; server-generated UUID object token unique across rows; original display name trimmed/nonblank and 1–255 characters; purpose restricted to `receipt` or `business_document`; declared MIME restricted to PDF, PNG or JPEG; declared size positive and at most 10 MiB for receipts or 25 MiB for business documents; creation timestamp; and expiry strictly later than creation and no later than 24 hours afterward. Object token is not a filename or a permission. No arbitrary path, content type claim, or unverified scan result authorizes access. The append-only registry rejects update/delete/truncate, and has no PUBLIC, anon or authenticated grants. It stores no object bytes. No bucket, Storage policy or API grants are introduced.

Future commands must check active membership and action plus actual parent scope, reserve one immutable object key per version, enforce streaming size/type and checksum server-side, isolate pending scans, and atomically record scan/finalization evidence. The application must fail closed if the scanner is unavailable; signed URLs require current parent access and short lifetimes. Reconciliation must identify expired reservations and orphaned objects without exposing or deleting evidence used by finalized versions. No worker or file access may depend solely on this registry. Until then this table is unused and files remain unavailable.

Recovery: this migration is additive and holds no user data until future authorized code exists. In a disposable local stack reset/reapply migrations to roll back. In an environment containing records, disable the future feature and preserve/export metadata and objects; use a reviewed forward migration to repair or retire the table, never cascade-drop evidence or modify the Storage schema directly. Hosted application requires separate authorization and a rehearsed migration/restore plan.

### Private quarantine bucket, 2026-11-25

`avi-file-quarantine` is a Supabase Storage bucket with `id = name`, `public = false`, a 25 MiB maximum and a PDF/JPEG/PNG content-type allowlist. The allowlist checks request metadata. The staged receipt ceiling remains 10 MiB and must also be enforced on the actual uploaded bytes by the future upload service.

A restrictive policy on `storage.objects` excludes this bucket for anonymous and authenticated callers on every object operation, including when another permissive policy applies. Other buckets retain their existing policies. Only trusted operators or backend infrastructure with an authorized server credential can access quarantined bytes. This increment does not grant any runtime service permission, mint a signed link or add an upload endpoint. The reserved path for the future service is `<organization UUID>/<object token UUID>`, with both components derived from the immutable stage. The existing stage token uniqueness reserves a distinct path for each attempt. A duplicate bucket ID causes migration failure so that a preexisting bucket and its files are never silently adopted.

For rollback in the isolated synthetic environment, use a clean local reset at the prior migration version and remove synthetic objects through the Storage API if needed. For an environment with records, first stop writers and link issuance, retain the restrictive policy, preserve staged metadata and objects, and reconcile their association before making a forward repair. Use Storage APIs for object cleanup, never a SQL delete against Storage metadata. Any future uploader must acquire a valid stage and perform byte/size checks. A scanner must bind its verdict to the exact byte digest before promotion, and promotion must preserve the stage and verified object version. Keep quarantined bytes private throughout recovery.

## File stage reservation

The reservation transaction accepts an organization, parent resource, client operation UUID, display filename, purpose, allowlisted MIME type and declared byte count. It requires current active membership, parent ownership, a live parent, the parent read permission and the separate MFA-required `file.stage` permission. Existing account, lead and opportunity resources can reserve business documents. Receipt reservations are scoped to expense resources and require their corresponding read permission. The migration grants no roles the new permission.

A stage expires one hour after creation, using database time. A rolling limit of 20 reservations per membership per hour bounds metadata creation. A membership-scoped lock serializes quota checks. Shared locks protect membership and parent state during the transaction. A fixed command name, canonical payload hash, existing receipt and the common operation lock enforce replay safety. The returned stage UUID identifies metadata only. Storage object tokens and filenames are excluded from audit details and API output.

The change is additive. If reservation must be suspended, revoke authenticated execution from the public wrapper and private command in a forward migration. Preserve immutable stages, receipts and audit events. Byte upload, expiry cleanup, scanner verdicts and file promotion require separate stages of implementation.

## Explicit customer and lead read shares

`private.crm_record_shares` stores one grant period for a resource and recipient membership, with same-organization foreign keys for the resource, granting owner and recipient. Sharing applies only to accounts and leads. Each grant has finite expiry and optional revocation time. A resource row lock serializes edits to grant periods. Audit events and operation receipts are append-only and written in the same transaction. No client can directly read or write the share table.

The read policy additionally requires the recipient's current module read permission, active membership and MFA. A grant loses effect on expiry, revocation, parent archival or ownership change, or deactivation of the owner or recipient. Existing owner-only mutations and file operations keep their current authorization boundaries. A forward recovery migration can drop the share read policy and revoke execute on the command while preserving share and audit history.

## Pilot super-admin bootstrap

The database operator can create one initial `super_admin` grant per organization for an existing Supabase Auth identity and give that membership the existing intake staff role. The bootstrap takes an organization lock, refuses any second bootstrap, and writes append-only audit events. The pilot admin role requires AAL2 and adds the organization staff directory and an audited membership deactivation command. The role is separate from hosting, database and provider operator access.

Deactivation locks the target and rejects self-deactivation, another active super administrator, and members with open owned resources while reassignment is unavailable. Deactivation invalidates active membership immediately across application policies. Disable the role by ending its grant via an authorized operator while preserving history. Provider session revocation, complete role administration and handover remain separate work.
