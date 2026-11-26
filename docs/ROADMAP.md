# Phase 1 development roadmap

Authority: [SRS](SRS.md) and the later [master development request](MASTER-DEVELOPMENT-PROMPT-2026-11-26.md); the latter takes precedence where they conflict. The original M1 security gate and SRS safeguards remain mandatory. The numbered sections below are existing engineering increments, not a reduction of the nine milestones in the later request. See [scope reconciliation](scope-reconciliation.md). Existing implementations from later milestones are retained but do not waive earlier gates. The [backlog](backlog.md) tracks individual requirement IDs; the [acceptance matrix](acceptance-matrix.md) tracks release scenarios. Each task below requires schema details, tests and documentation before completion. Status as of 2026-11-26: Milestone 0 baseline established; Milestone 1 in progress and not verified.

## M0 — Baseline

- M0.1 Preserve the full source specification and its precedence; map every requirement and acceptance scenario. Acceptance: source is complete; backlog and matrix have explicit status and evidence. Migration: none.
- M0.2 Record architecture, routes, permissions, logical schema, unresolved business decisions and reproducible setup. Acceptance: references exist and distinguish implemented from proposed. Migration: inventory existing migration versions and reconcile against a disposable environment; do not alter hosted state without authorization.
- M0.3 Create this dependency-ordered roadmap and durable session handoff. Acceptance: every milestone identifies tasks, dependencies, migration requirements and gates. Migration: none.

## M1 — Foundation (depends on M0; gate for M2–M7)

Local checks now cover real Auth with MFA, own-scope API permissions, and a private quarantine bucket. File reservation metadata is now checked by signed-in tests. Byte upload and release, the complete authorization matrix and audited administration remain open. See [progress](PROGRESS.md) for exact evidence.

- M1.1 Identity and membership: sign-in, recovery, invite-only provisioning, active membership on every request, deactivation and privileged MFA. Acceptance: real Auth journeys and stale-session denial pass for each relevant role and organization. Migration: reconcile identity, memberships, role grants and safe administrative commands; enforce same-organization relationships and audit.
- M1.2 Role/action/scope enforcement: own, team, territory, assigned and organization scopes, effective grant history, field and operation restrictions. Acceptance: direct API and command tests deny cross-tenant, unauthorized action, privilege changes, revoked membership and insufficient MFA; permitted permutations succeed. Migration: catalog, grant/scope tables and explicit grants/RLS; document exact constraints.
- M1.3 Resources and private files: atomic typed registry creation, file versions, size/type validation, staged upload/finalization and parent-scoped reads. Acceptance: direct Storage/API tests deny forged parent, cross-tenant, unauthorized upload/download and stale membership; retry and orphan recovery pass. Migration: registry constraints, file/version metadata and private bucket policies; no public URLs.
- M1.4 Command envelope, audit and bootstrap: authenticated actor, atomic idempotency receipt, request hash, redacted append-only audit and safe synthetic fixtures. Acceptance: concurrent retries produce one result; changed payload conflicts; rollback leaves no partial writes; audit cannot be altered; clean setup contains no real data. Migration: receipt/audit constraints and command infrastructure; isolated seed only.
- M1.5 Delivery and verification: locked dependencies, CI, migration reset/type generation, security review and operational setup. Acceptance: clean install/build/tests and security review pass, migrations reset and reapply on a full disposable Supabase stack, types match, hosted-equivalent Auth/API/Storage denial and advisor checks pass; record results. Migration: verify all existing migrations in order and forward recovery. A PGlite-only test or anonymous-only hosted test cannot satisfy this gate.

## M2 — Customers and unified leads (depends on M1)

- M2.1 Accounts, sites, contacts, equipment, catalogue and approved library: persisted scoped CRUD and relationship history. Acceptance: validation, ownership, duplicate and inaccessible-link tests pass, with complete accessible states. Migration: typed resources, same-organization FKs, constraints, RLS and document references.
- M2.2 Shared intake, CSV, duplicate review, ownership, qualification, attempts, tasks, SLA and conversion. Acceptance: AC scenarios and transaction/concurrency/unauthorized variants pass; conversion is atomic and replay-safe. Migration: lead/source/activity/task records, indexes, constraints and atomic audited commands.
- M2.3 IndiaMART adapter Disabled/Mock/Live and manual/CSV fallback. Acceptance: fixture replay, quarantine, health, failure and deduplication tests pass; live remains disabled until entitlement and contract tests are verified. Migration: private provider configuration, source events, receipts and worker/outbox records; no secrets in exposed tables.

## M3 — Opportunities and field (depends on M1 and relevant M2 records)

- M3.1 Opportunities, stages, line requirements, quote/revision references, booking evidence and discount requests. Acceptance: scoped transitions, immutable revisions, attribution, approvals and unauthorized/concurrent transitions pass. Migration: opportunity, evidence, revision and approval relations with version and snapshot constraints.
- M3.2 Attendance, visit plans, GPS events/exceptions, reports and limited offline drafts/sync. Acceptance: airplane-mode/reconnect, two-device conflict, deactivation and GPS-denied scenarios pass. Migration: attendance, visits, immutable events, report/task links and sync receipts with tenant constraints.

## M4 — Tenders (Phase 1; depends on M1 and applicable M2/M3 resources)

- M4.1 Register tenders/lots, bid decisions, versioned dates, compliance, deviations, checklists, waivers and prebid queries. Acceptance: assignment/tab permissions and deadline replacement/outbox cancellation pass. Migration: tender, lot, date history, checklist and scoped access tables.
- M4.2 Submission, evaluation, partial awards, EMD/PBG, execution and collection follow-up. Acceptance: immutable submission snapshot, lot-level outcomes and unresolved obligations survive closure; AC two-lot and unauthorized scenarios pass. Migration: immutable snapshots, evidence, award, security and obligation ledgers with same-tenant FKs and audited commands.

## M5 — Expenses (Phase 1; depends on M1; policy/authority configuration may gate approval)

- M5.1 Version policies and implement travel requests, receipts, claims/revisions and duplicate warnings. Acceptance: calculations and snapshot/version invalidation pass, files remain private and unconfigured policy fails closed. Migration: immutable policies and claim versions, lines, receipt links and transactional commands.
- M5.2 Independent manager/finance routing, reductions/exceptions, advances, partial reimbursement, reversals and export/reconciliation. Acceptance: no self-approval, exact-version decisions, decimal precision, locking, concurrent balance checks and replay-safe reversals pass; reimbursement is not bank payout. Migration: approval and append-only financial ledgers, constraints, operation receipts and locks. Obtain required business decisions rather than invent policy.

## M6 — Readiness (depends on M1–M5)

- M6.1 Scoped reports, defined metrics, notifications/outbox, CSV and operations screens. Acceptance: role/denominator/export safety and alert cancellation tests pass. Migration: outbox, report-supporting indexes/views with security-invoker or equivalent checks.
- M6.2 Complete AC-01–AC-25, end-to-end unauthorized variants, accessibility, performance, security, clean migration dry-run, backup/file restore drill and runbooks. Acceptance: evidence and owners recorded for every release gate; unresolved issues block release. Migration: tested forward recovery and reproducible reset; no unreviewed production data migration.

## M7 — Pilot (depends on M6 and business authorization)

- M7.1 Conduct role-based UAT and document owners, decisions and operational handover. Acceptance: approved UAT evidence and remaining constraints recorded. Migration: approved production migration plan and rehearsal; no deployment or external data mutation without authorization.
- M7.2 Validate IndiaMART live contract/recovery only with authorized access and samples. Acceptance: live protocol, replay, failure and reconciliation evidence, or explicitly blocked status; manual/CSV remains available. Migration: enable provider configuration only after authorized review. Zoho integration, distributor access, demonstration tracking and requested communications are Phase 1 scope under the later request; live activation and external writes remain subject to credentials, approved mappings, verified provider capabilities and explicit authorization.

## Additional Phase 1 scope from the later request

The original increments above must be expanded, not substituted for the later request's nine-milestone sequence. After M1 security passes, follow the request's order: CRM; field sales; commercial operations (including product catalogue, quotations, sales orders, distributors and demonstrations); tenders; expenses; integrations; management/reporting; production readiness. M3.1 commercial work follows field sales where dependencies allow. The existing later slices do not count as completed milestones.

- Implement distributor-restricted access and demonstration equipment tracking with custody and return workflows; prove access isolation and avoid exposing internal pricing.
- Implement the requested Zoho Books synchronization architecture and configuration, Maps, email notifications and optional WhatsApp integration. Verify provider contracts and capabilities; do not report mock or disabled adapters as live. Zoho write actions require explicit authorization and approved financial mappings.
- Include sales targets, all requested management dashboards, reports, exports and global search, with real authorized data and defined metrics.
- Complete Netlify configuration, PWA, requested documentation, accessibility, browser testing, staging, UAT and recovery verification. No deployment or hosted database changes without authorization.
- Track the full request by section and acceptance scenario in [scope reconciliation](scope-reconciliation.md); detailed requirement-level mapping remains to be completed before declaring any milestone verified.
