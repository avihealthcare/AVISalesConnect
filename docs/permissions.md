# Permissions — partial foundation

> Some entries below describe earlier increments and may be superseded by later entries. For the current gate and session handoff, see [PROGRESS.md](PROGRESS.md) and [ROADMAP.md](ROADMAP.md).

Deny by default. Every online read and command must check active membership, organization, action and record scope, including old and new rows. Role management does not imply commercial, financial or self-approval authority. Sales Operations intake scope does not grant receipt access; Accounts reimbursement authority does not grant manager approval or editing visit GPS. Tender access is assignment and tab scoped. Customer access derives from assignment or scoped linkage. No claimant may approve their own claim, including an administrator or MD. Unconfigured authority means no approval.

Implement explicit grants plus RLS, protected columns/command-only sensitive writes, private file parent checks, fixed search paths for privileged routines, and audit. Direct API, storage, views, functions, inactive membership and cross-organization denial must be tested before business features are exposed. The first migration enforces active-member self reads and owned-resource reads; subsequent migrations restrict profile edits and require an explicit resource read permission in addition to ownership. Tests in tests/db/foundation.test.js exercise same-organization and cross-organization isolation, deactivation and denied direct writes in PGlite. This describes the initial RLS policy. Later migrations extend it with action permissions, file policies, administrative commands and audit.


The foundation tests exercise limited profile updates, effective role grants, expired grants, grant tampering and append-only audit records using simulated claims. The current application accepts an authenticated email/password session for all staff and administrators. Authorization still requires the relevant active membership, effective grants, record scope and command checks. Sensitive file and policy settings operations also verify a live provider session.

On 2026-11-25 the resource read policy was tightened to require an effective `<resource_type>.read` permission as well as active ownership; the database test rejects ownership without permission. Hosted policy presence and security advisor were checked, but direct API, signed-in user and storage tests are still outstanding.

2026-11-25: Preliminary file byte validation grants no permissions and exposes no file path or upload endpoint. All future file operations remain denied until parent-scoped authorization, staged upload, validation, scanning, finalize and recovery are implemented and tested against actual Storage. A signature match is not a safe-file determination.

2026-11-25: `private.file_upload_stages` has RLS enabled and no PUBLIC, anonymous or authenticated table privileges or policies. Its immutable records are not an authorization mechanism. The migration does not create a bucket or grant any file access; all upload/download/listing and scan/finalization paths remain unimplemented and unavailable.

2026-11-25: The `avi-file-quarantine` bucket is private. Anonymous and authenticated roles are denied every object operation there, even if a broad permissive policy applies. There is no exception for the uploader, parent owner or an authenticated application session. Trusted local Storage access is used in testing to prove that an object actually exists behind the access boundary. Upload authorization, scanning, file version release and parent-scoped retrieval remain pending.

## File reservation permission

| Operation | Required authority |
| --- | --- |
| Reserve business document metadata | Active organization membership, ownership of an unarchived account, lead or opportunity, its read permission, and `file.stage` |
| Reserve receipt metadata | Active organization membership, ownership of an unarchived expense resource, its read permission, and `file.stage` |
| Read stage metadata or access quarantine objects as an application user | Denied |

`file.stage` is unassigned by default. The stage UUID provides no file access. The reservation command checks the same permissions on retries.

## Explicit customer and lead shares

An active owner with the module's read permission and its separate `account.share` or `lead.share` action can grant or revoke temporary read access to that exact CRM record for another member of the same organization. The permissions are unassigned by default. The recipient must have active membership and current module read access. Sharing a lead grants visibility to its existing contact-attempt records through the lead policy. It grants no access to the linked account, opportunities, files or editing commands. Account sharing similarly does not grant access to linked leads. Team, territory and distributor permissions remain separate work.

## Pilot Super Administrator

This role can view the organization's staff directory and deactivate eligible staff. Direct browser writes to memberships are denied. The operator bootstraps at most one initial administrator per organization. Deactivation is audited and is rejected for the acting administrator, another active super administrator, a different organization and members who own open records requiring reassignment.

## Team, territory and staff lifecycle controls

Customer and lead scope expansion requires a base read grant and a separate scope permission. A reporting-chain read follows active memberships. A territory read needs both a member assignment and a record assignment for the same organization. Organization-wide read is explicitly separate for each module. These scopes confer no write or financial authority and do not let shared or scoped readers retrieve files.

Delegation and scope administration require separate privileges. Scope administrators cannot grant themselves a territory or make themselves the recipient of a reporting change. Changing another owner's record territory requires organization-wide read for its module. Only operator-marked roles with no staff administration permission can be granted or revoked through the application command. Handing over CRM records requires both reassignment and deactivation authority, an active successor with the required module grants, and audit for every transferred record.

## Private attachment access

File staging, scanned download and the parent read permission are separate grants. Attachment lists require the current parent owner and a live Auth session. The trusted server checks those permissions again before serving any bytes and rechecks the session after reading Storage. The server and scanner authenticate to each other. Direct Storage access and access to unscanned or rejected bytes remain denied.

## Policy settings

The organization's Super Administrator can read and save expense policy and tender approval revisions with a live Auth session. This grants no ability to approve an expense or tender. The server rejects out-of-organization staff, inactive approvers, repeated approval routes, explicitly scoped self-approval and competing expense rules. A later approval command must independently validate the actor and record the exact policy revision used.

### Pilot sales and field modules

The Super Administrator receives the pilot workspace permissions. The separate delegable Field Sales role grants own attendance, visits, planning and tasks, scoped CRM reads, visible parent site/contact access, and read access to the product catalogue. Each workspace command requires an active member with its module permission and validates parent access. GPS events and personal sales targets are scoped to their owner. Tenders and expenses additionally use independently assigned approval routes, which enforce actor separation in their command handlers.

### Lead Management

Intake staff retain own-record creation and write access through their existing lead grants. Team, territory and explicit share grants provide read access. Lead managers can assign and review duplicates across their organization. Reopening and detailed export use separate permissions. Super Administrators receive the workflow, export, and settings permissions. Lead notifications go to the affected memberships and the response queue only displays records the viewer can read. Private documents retain the existing independently scoped file permissions.
