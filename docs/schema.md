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

`private.has_permission(organization_id, permission_code)` is a read-only, security-invoker helper. It relies on the caller's RLS-filtered active membership and effective role grant. Its private schema is not exposed through the Supabase Data API; execute is granted only to authenticated callers for use by subsequent invoker code. It does not grant scope to any record or authority to perform any command. Business commands must additionally enforce action scope and independent approval, and must not treat editable user metadata as authority.

Audit events and completed operation receipts are append-only: update/delete/truncate triggers reject changes, including from service code. Organization/actor/operation key uniqueness prevents duplicate completed receipts, but it does not itself implement transactional command execution or same-key/different-payload conflict handling. A retention/purge mechanism requires a separate authorized design.

Role grant history replaces the one-interval restriction with a GiST exclusion constraint. The half-open `[effective_from,effective_to)` ranges for the same organization, member and role may touch but cannot overlap, including open-ended grants. The migration uses PostgreSQL's `btree_gist` extension and is tested locally; deployment compatibility remains to be verified against Supabase.

The roles and permissions catalogs retain `requires_mfa` as compatibility metadata. The email/password migration clears previous values and sets the permission default to false. Authorization uses neither flag.

Resource reads additionally require the explicit action permission `<resource_type>.read` for the same organization, evaluated against effective role grants. Ownership alone is not sufficient. This initial policy permits own scope only; shares, team scope, all-organization scope and domain-specific tab visibility remain unimplemented and denied.

## Customer and manual lead intake

The initial accounts and leads tables use the registry ID as the record ID. Composite foreign keys enforce organization and resource type. Leads may link to a visible account in the same organization. Reads are gated by the existing ownership and effective permission policy. The browser cannot mutate these tables directly.

The authenticated create command derives the owner from active membership, checks the matching create permission, and accepts only its documented input fields. Registry row, record, audit event and receipt commit together. A retry with the same operation key and identical payload returns the prior ID. Different input with the same key conflicts. Lead references use a global sequence displayed within each organization, with per-organization/year numbering still pending. Only manual sources are accepted by the create command. CSV and IndiaMART ingestion are pending.

## Lead follow-up and initial staff provisioning

Lead rows now track first attempt, first successful contact, next action, disqualification reason and version. The command serializes writes on the lead, checks the expected version and adds audit and operation receipts. Contact attempts are append-only. Conversion requires an owned qualified lead and accessible linked account and creates one primary opportunity per lead. Stage transitions beyond initial qualification, separate follow-up tasks and additional opportunities per lead remain outstanding. Qualification updates the existing requirement text. Separate immutable storage for the original inbound message remains outstanding.

The private operator function can provision an existing Auth identity with the Intake Staff role. The command checks the exact permission bundle before assigning it and records the event without storing personal details in the audit payload. It does not create Auth identities or administer existing memberships.

## Open opportunity pipeline

Opportunities have a positive row version. A manual estimate uses an exact INR decimal, a whole-percent probability and a written reason. All three fields are absent when the estimate is unset. PostgreSQL computes and rounds weighted value to the nearest paise for open stages. A versioned command checks active ownership, read and edit permissions, writes an audit event, and records the result for safe retry. Won and Lost are outside this command. Authorized bookings, closure, reopen and product-line estimates remain outstanding.

## File validation foundation (no migration)

The initial byte-signature and size check was implemented in `packages/domain/file-validation.js` and has since moved to `supabase/functions/_shared/file-validation.js`. It accepts only declared PDF/JPEG/PNG types with matching leading signatures, with a 10 MiB receipt limit and 25 MiB business-document limit. It always returns pending scan; it does not parse file structure, detect polyglots or malware, enforce streaming limits, store objects, or authorize upload or retrieval. No file table, bucket, upload endpoint or scanning integration was added. The planned file schema and recovery design still require explicit field constraints, state transitions and migration review before implementation. Office formats remain unavailable until a safe scanning approach is in place.

### Planned private file staging registry, 2026-11-25

The initial additive migration introduces `private.file_upload_stages` as a fail-closed staging registry only; it exposes no upload, download, scan or finalize operation. Fields: UUID primary key; non-null organization, parent resource and uploader membership with same-organization composite foreign keys; server-generated UUID object token unique across rows; original display name trimmed/nonblank and 1–255 characters; purpose restricted to `receipt` or `business_document`; declared MIME restricted to PDF, PNG or JPEG; declared size positive and at most 10 MiB for receipts or 25 MiB for business documents; creation timestamp; and expiry strictly later than creation and no later than 24 hours afterward. Object token is not a filename or a permission. No arbitrary path, content type claim, or unverified scan result authorizes access. The append-only registry rejects update/delete/truncate, and has no PUBLIC, anon or authenticated grants. It stores no object bytes. No bucket, Storage policy or API grants are introduced.

Future commands must check active membership and action plus actual parent scope, reserve one immutable object key per version, enforce streaming size/type and checksum server-side, isolate pending scans, and atomically record scan/finalization evidence. The application must fail closed if the scanner is unavailable; signed URLs require current parent access and short lifetimes. Reconciliation must identify expired reservations and orphaned objects without exposing or deleting evidence used by finalized versions. No worker or file access may depend solely on this registry. Until then this table is unused and files remain unavailable.

Recovery: this migration is additive and holds no user data until future authorized code exists. In a disposable local stack reset/reapply migrations to roll back. In an environment containing records, disable the future feature and preserve/export metadata and objects; use a reviewed forward migration to repair or retire the table, never cascade-drop evidence or modify the Storage schema directly. Hosted application requires separate authorization and a rehearsed migration/restore plan.

### Private quarantine bucket, 2026-11-25

`avi-file-quarantine` is a Supabase Storage bucket with `id = name`, `public = false`, a 25 MiB maximum and a PDF/JPEG/PNG content-type allowlist. The allowlist checks request metadata. The staged receipt ceiling remains 10 MiB and must also be enforced on the actual uploaded bytes by the future upload service.

A restrictive policy on `storage.objects` excludes this bucket for anonymous and authenticated callers on every object operation, including when another permissive policy applies. Other buckets retain their existing policies. Only trusted operators or backend infrastructure with an authorized server credential can access quarantined bytes. This increment does not grant any runtime service permission, mint a signed link or add an upload endpoint. The reserved path for the future service is `<organization UUID>/<object token UUID>`, with both components derived from the immutable stage. The existing stage token uniqueness reserves a distinct path for each attempt. A duplicate bucket ID causes migration failure so that a preexisting bucket and its files are never silently adopted.

For rollback in the isolated synthetic environment, use a clean local reset at the prior migration version and remove synthetic objects through the Storage API if needed. For an environment with records, first stop writers and link issuance, retain the restrictive policy, preserve staged metadata and objects, and reconcile their association before making a forward repair. Use Storage APIs for object cleanup, never a SQL delete against Storage metadata. Any future uploader must acquire a valid stage and perform byte/size checks. A scanner must bind its verdict to the exact byte digest before promotion, and promotion must preserve the stage and verified object version. Keep quarantined bytes private throughout recovery.

## File stage reservation

The reservation transaction accepts an organization, parent resource, client operation UUID, display filename, purpose, allowlisted MIME type and declared byte count. It requires current active membership, parent ownership, a live parent, the parent read permission and the separate `file.stage` permission. Existing account, lead and opportunity resources can reserve business documents. Receipt reservations are scoped to expense resources and require their corresponding read permission. The migration grants no roles the new permission.

A stage expires one hour after creation, using database time. A rolling limit of 20 reservations per membership per hour bounds metadata creation. A membership-scoped lock serializes quota checks. Shared locks protect membership and parent state during the transaction. A fixed command name, canonical payload hash, existing receipt and the common operation lock enforce replay safety. The returned stage UUID identifies metadata only. Storage object tokens and filenames are excluded from audit details and API output.

The change is additive. If reservation must be suspended, revoke authenticated execution from the public wrapper and private command in a forward migration. Preserve immutable stages, receipts and audit events. Byte upload, expiry cleanup, scanner verdicts and file promotion require separate stages of implementation.

## Explicit customer and lead read shares

`private.crm_record_shares` stores one grant period for a resource and recipient membership, with same-organization foreign keys for the resource, granting owner and recipient. Sharing applies only to accounts and leads. Each grant has finite expiry and optional revocation time. A resource row lock serializes edits to grant periods. Audit events and operation receipts are append-only and written in the same transaction. No client can directly read or write the share table.

The read policy additionally requires the recipient's current module read permission and active membership. A grant loses effect on expiry, revocation, parent archival or ownership change, or deactivation of the owner or recipient. Existing owner-only mutations and file operations keep their current authorization boundaries. A forward recovery migration can drop the share read policy and revoke execute on the command while preserving share and audit history.

## Pilot super-admin bootstrap

The database operator can create one initial `super_admin` grant per organization for an existing Supabase Auth identity and give that membership the existing intake staff role. The bootstrap takes an organization lock, refuses any second bootstrap, and writes append-only audit events. The pilot admin role adds the organization staff directory and an audited membership deactivation command. The role is separate from hosting, database and provider operator access.

Deactivation locks the target and rejects self-deactivation, another active super administrator, and members with open owned resources while reassignment is unavailable. Deactivation invalidates active membership immediately across application policies. Disable the role by ending its grant via an authorized operator while preserving history. Provider session revocation, complete role administration and handover remain separate work.

## Private file quarantine and release

The trusted file handler uses the opaque reservation ID as the durable ID for a single immutable byte version. Its database broker, callable only by the server role, validates the verified user and live Auth session against the current resource owner and unarchived parent. Upload requires the original uploader, an unexpired reservation, `file.stage` and the parent read permission. Download requires the current owner, `file.download`, the parent read permission and a recorded clean scan. The new download permission is unassigned by default.

`private.file_upload_objects` is keyed by reservation and records one SHA-256 claim, stored timestamp, scan lease and terminal verdict with scanner version and timestamp. The database serializes claims on the reservation, rejects a different hash and audits first storage and terminal scan decisions in the same transaction. The immutable object key derives from organization and an opaque per-stage token. The server always uploads without upsert. If an upload response is uncertain, it reads the existing object and verifies its bytes against the bound hash. Pending, failed and rejected objects stay inaccessible to application roles. A short lease allows one worker to scan at a time and bounds recovery if a scanner call or worker fails. The release handler rechecks the hash and returns an authenticated attachment with private, no-store caching. It grants no direct Storage access or bearer URL.

Before live files, approve the scanner, storage and logging location, format policy and retention. To stop new file handling, disable the Edge function or revoke the application permissions. Preserve audit data, and reconcile orphaned bytes by stage and hash before any removal. There is no automated deletion in this increment.

## Staff reporting lines and CRM territory controls

`private.reporting_lines` stores at most one direct manager for each staff membership. Both memberships belong to the same organization. The audited write command serializes organization-level scope changes and rejects cycles, self-management and inactive members. A team read can follow active reporting lines through multiple levels.

`private.territories` defines organization-owned territory IDs and names. `private.territory_memberships` assigns any number of those territories to a membership. An optional composite foreign key on `public.resources.territory_id` ties CRM records to that same organization's territory. Existing records have no territory by default. Only accounts and leads use scope extensions in this migration.

A separate `staff.scope.manage` grant authorizes a manager assignment or removal, territory assignment or removal, and CRM territory changes. Each command writes an operation receipt and redacted audit entry. No staff bundle receives this permission automatically. Territory creation itself remains an operator action. A team, territory or organization-wide read requires its own scope permission and the domain read grant. No migration data configures a staff hierarchy or broadens an existing role. If needed, drop the scoped CRM read policy in a forward migration and disable the configuration command while preserving audit history.

## Audited staff role grants

Roles carry an operator-managed `delegable` flag that defaults to false. A member with an effective `staff.role.manage` grant can assign and revoke explicitly delegable roles for another active same-organization member. Super Administrator and roles with staff administration permissions are excluded independently of that flag. Application clients cannot set the flag or edit permission bundles. Authorization is checked before replay, target rows are serialized, and the existing non-overlap constraint protects effective intervals. Grants insert a new interval, revocations end the active interval, and both commit an immutable audit event and idempotency receipt. No existing roles or permissions are changed by the migration. Revoke access to the command as forward recovery while retaining the grant history.

## Staff offboarding with CRM handover

An authenticated administrator with both `staff.deactivate` and `staff.reassign` can transfer open account, lead and opportunity records to an explicitly selected active colleague before deactivation. Target and successor are distinct same-organization memberships. The successor must hold each affected module's base read grant. The operator cannot become the successor. Unknown resource types block transfer until their domain workflows have an explicit handover rule.

Membership locks serialize handover with ordinary CRM commands. Ownership changes, per-record audit, deactivation and the idempotency receipt commit together or roll back together. Existing guardrails still protect the acting administrator and other active super administrators. Archived records and original activity authors are retained. Old shares are inactive when the original owner changes. Provider sessions for other organization memberships remain separate. Forward recovery can revoke command execution and restore individual record ownership only after verifying the recorded transfer history.

## CRM attachment list

The authenticated attachment list exposes only reservation IDs, display names, dates and progress for business documents on a currently owned account or lead. It requires a live Auth session, the parent read grant and at least one of the two file actions. Released rows require download authority, and pending rows require staging authority. The list never returns a bucket key, digest or scanner details. Use the trusted upload and download handler for content.

## Expense policy and tender approval settings

Super Administrators with a live Auth session can publish organization-owned expense and tender policy snapshots. Each section has one ordered append-only version history and an effective date in the organization's time zone. Publishing an edit requires the current revision ID and is serialized per organization and section. An immutable audit event and operation receipt commit with the new snapshot. An invalid or stale form cannot overwrite a saved revision.

Expense snapshots contain category rules and optional travel, manager and finance routes. Rules carry category, grade, geography and travel-type selectors, calculation type, exact-decimal rate/cap/receipt threshold, and policy flags. Tender snapshots hold bid, submission and waiver routes. A route has an optional staff subject, distinct active primary and alternate approvers, and an optional amount limit in the organization's base currency. An empty limit records unrestricted amount in the configured route. Financial fields are bounded decimal strings in these configuration snapshots. Business workflows must re-validate membership, independent approval, action permission and applicability, and persist the selected policy ID on submission. Configuration alone conveys no approval authority. No default policies are seeded.

Forward recovery preserves policy versions and audit. Publish a correcting version with its own effective date or revoke the settings commands temporarily.

### Sales and field workspace

`private.sales_field_records` stores the pilot site, contact, equipment, catalogue, task, visit plan, attendance, visit, external quotation revision, operational sales reference, demo and personal target records. The record and its optional parent share an organization-bound resource foreign key. The command validates the parent type and actor access, and uses a locked membership, expected record version, operation receipt and redacted audit event. `private.sales_field_events` preserves each accepted version and the original check-in/check-out evidence. Unique indexes enforce one open visit and attendance session, catalogue codes, external quotation revisions and external sales references. Scanned documents and financial approvals use their own command boundaries.

### Lead Management

Extend the existing lead and resource records in place. Keep their identifiers and legacy lifecycle semantics for existing dashboards, lists, imports and opportunity conversion. Store append-only product revisions, immutable events, notification delivery state and organization-specific lead settings separately. Configure territory ownership with same-organization membership and territory foreign keys. Mutations use expected versions, audit events and operation receipts. Merge archives the duplicate and retains its identifier, intake, products, ownership/stage events and links. Opposing opportunity links require explicit resolution so the merge cannot double-count bookings or overwrite commercial records. Forward recovery uses an additive migration and the previous UI while keeping the original and new records.

### Customer and contact master

Extend account IDs in place with stable human-readable numbers and versioned master data. Groups normalize names within an organization and branches keep their own account IDs. Contacts retain their field-record IDs and primary account. Additional organization links carry the relevant department and same-organization foreign keys. Writes use expected versions, operation receipts and redacted audit events. Customer history reads apply independent visibility rules to each related module. Recovery uses a forward correction while the previous account and contact schemas remain readable.

The lead console derives KPI and facet data from visible lead records. Scheduled demos are append-only lead events with explicit times, version checks and audited writes. The current schedule comes from the latest scheduling event per lead. City tiers are shown only when an accessible linked customer has an explicit tier classification. A forward correction can change aggregation or presentation while preserving schedule history.

### Visiting-card lead intake

The configurable `visiting_card` source uses the existing lead create command. The lead stores reviewed card fields and an optional contact ID alongside the account link. Original card sides are staged under an authenticated user and organization prefix in the private `lead-cards` bucket and bound to the lead in the same transaction as creation. A side can be bound only once. Original bytes remain quarantined and the Documents tab shows the attachment metadata. There is no direct browser storage access. A private rate table bounds extraction and upload requests. Deployment is additive. If the scanner is disabled, existing leads, committed attachment metadata and stored originals remain intact. Fix forward and do not drop the bucket or linked data.
