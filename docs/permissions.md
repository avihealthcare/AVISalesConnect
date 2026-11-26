# Permissions — partial foundation

> Some entries below describe earlier increments and may be superseded by later entries. For the current gate and session handoff, see [PROGRESS.md](PROGRESS.md) and [ROADMAP.md](ROADMAP.md).

Deny by default. Every online read and command must check active membership, organization, action and record scope, including old and new rows. Role management does not imply commercial, financial or self-approval authority. Sales Operations intake scope does not grant receipt access; Accounts reimbursement authority does not grant manager approval or editing visit GPS. Tender access is assignment and tab scoped. Customer access derives from assignment or scoped linkage. No claimant may approve their own claim, including an administrator or MD. Unconfigured authority means no approval.

Implement explicit grants plus RLS, protected columns/command-only sensitive writes, private file parent checks, fixed search paths for privileged routines, and audit. Direct API, storage, views, functions, inactive membership and cross-organization denial must be tested before business features are exposed. The first migration enforces active-member self reads and owned-resource reads; subsequent migrations restrict profile edits and require an explicit resource read permission in addition to ownership. Tests in tests/db/foundation.test.js exercise same-organization and cross-organization isolation, deactivation and denied direct writes in PGlite. Role/action scope, MFA, file policies, administrative commands, audit and real Supabase API/storage tests remain unimplemented. This narrow policy must not be treated as the full authorization model.


The subsequent local migrations add read-only effective role grants, a private permission helper that requires AAL2 for roles marked MFA-required, limited profile updates and protected audit/receipt structures. Tests cover MFA, expired grants, grant tampering and append-only records using simulated JWT claims. A later migration makes each permission MFA-required by default, independent of the role flag. These tests do not establish that production catalog changes are authorized and audited, implement command-specific or row-scope authorization, or validate actual Supabase Auth, Storage or API behavior. Audit and operation receipts are not yet written by business commands.

On 2026-11-25 the resource read policy was tightened to require an effective `<resource_type>.read` permission as well as active ownership; the database test rejects ownership without permission. Hosted policy presence and security advisor were checked, but direct API, signed-in user and storage tests are still outstanding.

2026-11-25: Preliminary file byte validation grants no permissions and exposes no file path or upload endpoint. All future file operations remain denied until parent-scoped authorization, staged upload, validation, scanning, finalize and recovery are implemented and tested against actual Storage. A signature match is not a safe-file determination.

2026-11-25: `private.file_upload_stages` has RLS enabled and no PUBLIC, anonymous or authenticated table privileges or policies. Its immutable records are not an authorization mechanism. The migration does not create a bucket or grant any file access; all upload/download/listing and scan/finalization paths remain unimplemented and unavailable.

2026-11-25: The `avi-file-quarantine` bucket is private. Anonymous and authenticated roles are denied every object operation there, even if a broad permissive policy applies. There is no exception for the uploader, parent owner or an MFA-verified application session. Trusted local Storage access is used in testing to prove that an object actually exists behind the access boundary. Upload authorization, scanning, file version release and parent-scoped retrieval remain pending.

## File reservation permission

| Operation | Required authority |
| --- | --- |
| Reserve business document metadata | Active organization membership, ownership of an unarchived account, lead or opportunity, its read permission, and MFA-verified `file.stage` |
| Reserve receipt metadata | Active organization membership, ownership of an unarchived expense resource, its read permission, and MFA-verified `file.stage` |
| Read stage metadata or access quarantine objects as an application user | Denied |

`file.stage` is unassigned by default. The stage UUID provides no file access. The reservation command checks the same permissions on retries.
