# Acceptance matrix

All scenarios are release gates and remain unverified. The unit rules below do not substitute for database, integration, concurrency or end-to-end tests. Run: `npm run check`, 2026-11-25: 6 domain tests and 1 isolated database test passed (updated role, MFA, expiry, non-overlap and append-only checks). The database test uses a mocked auth.uid and does not exercise the Supabase API or Storage.

| Scenario | Status | Evidence / outstanding |
|---|---|---|
| AC-01 | In Progress | Partial RLS and grants exercised in tests/db/foundation.test.js; complete API, domain and storage scenario outstanding |
| AC-02 | In Progress | Partial RLS and grants exercised in tests/db/foundation.test.js; complete API, domain and storage scenario outstanding |
| AC-03 | Not Started | Executable scenario and run evidence outstanding |
| AC-04 | Not Started | Executable scenario and run evidence outstanding |
| AC-05 | Not Started | Partial domain assertions in tests/unit/domain.test.js; full scenario outstanding |
| AC-06 | Not Started | Executable scenario and run evidence outstanding |
| AC-07 | Not Started | Executable scenario and run evidence outstanding |
| AC-08 | Not Started | Executable scenario and run evidence outstanding |
| AC-09 | Not Started | Executable scenario and run evidence outstanding |
| AC-10 | Not Started | Executable scenario and run evidence outstanding |
| AC-11 | Not Started | Executable scenario and run evidence outstanding |
| AC-12 | Not Started | Executable scenario and run evidence outstanding |
| AC-13 | Not Started | Partial domain assertions in tests/unit/domain.test.js; full scenario outstanding |
| AC-14 | Not Started | Executable scenario and run evidence outstanding |
| AC-15 | Not Started | Partial domain assertions in tests/unit/domain.test.js; full scenario outstanding |
| AC-16 | Not Started | Executable scenario and run evidence outstanding |
| AC-17 | In Progress | Real local Storage denies direct access to quarantined objects. Authorized receipt downloads and signed-link expiry remain unverified. |
| AC-18 | In Progress | Partial RLS and grants exercised in tests/db/foundation.test.js; complete API, domain and storage scenario outstanding |
| AC-19 | Not Started | Executable scenario and run evidence outstanding |
| AC-20 | Not Started | Partial domain assertions in tests/unit/domain.test.js; full scenario outstanding |
| AC-21 | Not Started | Executable scenario and run evidence outstanding |
| AC-22 | Not Started | Partial domain assertions in tests/unit/domain.test.js; full scenario outstanding |
| AC-23 | Not Started | Executable scenario and run evidence outstanding |
| AC-24 | Not Started | Executable scenario and run evidence outstanding |
| AC-25 | Not Started | Executable scenario and run evidence outstanding |


Hosted foundation check, 2026-11-25: six migrations applied; eight public tables show RLS enabled; Supabase security advisor reports no findings. This does not verify AC-01, AC-02, AC-17 or AC-18 through actual Auth, API and Storage, which remain incomplete.


2026-11-25: web sign-in, active-membership check, TOTP challenge and fail-closed error states compile successfully; no real Auth, browser, accessibility or end-to-end verification has been performed. No acceptance scenario is considered passed on this basis.

2026-11-25: password recovery navigation was checked locally; real recovery email, password changes, MFA, invitations and access checks have not been exercised with a real account. Resource read-permission migration applied to Supabase; security advisor reports no findings.

Customer and lead intake increment, 2026-11-25. Customer and manual lead capture plus scoped lists are implemented for own records. The database test exercises permission checks, cross-organization rejection, inaccessible account links, rejected client-supplied ownership, deactivation, source and contact validation, audit and exact retry behavior. The browser build passes. Hosted schema verification confirms row-level security and intended table/function grants. This is partial evidence for AC-01, AC-02, AC-03 and AC-18. Hosted signed-in browser/API journeys, CSV and provider intake, concurrency across connections, and all remaining workflow criteria still need evidence.

Lead follow-up and staff provisioning increment, 2026-11-25. Local database assertions cover contact attempt replay, first attempt versus first successful contact, stale version rejection, qualification validation, scoped opportunity conversion and replay, cross-user isolation, operator-only provisioning and MFA-required authorization. The web build passed. Both migrations are installed on AVI Sales Connect and Supabase security advisor returned no findings. Hosted checks confirmed browser users cannot provision staff and anonymous users cannot progress leads. This is partial evidence for AC-01, AC-02, AC-06 and AC-07. Concurrent connections, assignment and SLA alerts, complete conversion and real Auth browser/API journeys remain outstanding.

Opportunity pipeline increment, 2026-11-25. The database test exercises authorization, open-stage movement in both directions, exact decimal weighting, stale-version rejection, replay and changed-payload conflicts, and rejection of a direct update or a Won transition. This is partial evidence for AC-08 and AC-19. The two opt-in hosted HTTP tests passed against AVI Sales Connect under `npm run test:hosted`: anonymous table reads and pipeline command calls were denied. Signed-in browser journeys, closure and verified bookings, role coverage and aggregate reports remain open.

2026-11-25 foundation review: `npm run check` passed. Local assertions now inspect every migrated public table for RLS and anonymous privilege denial, inspect security-definer functions for private schema/fixed search path/anonymous denial, test editable metadata denial, and verify rollback after a failed intake. Hosted read-only catalog inspection found 12 public tables with RLS and no anonymous table privileges, three private security-definer functions with fixed search paths and anonymous execution denied, and no security advisor findings. The two hosted anonymous API checks passed after enabling network access. AC-01, AC-02 and AC-18 remain In Progress: signed-in role/scope, real Auth, Storage and full scenario evidence is still missing.

2026-11-25 local full-stack increment: the disposable Supabase stack reset and reapplied all 11 migrations. `tests/integration/local-auth.test.js` passed using real local Auth, TOTP, API and PostgreSQL, covering AAL1 denial, same-organization ownership isolation, a cross-organization command denial, direct write denial, three simultaneous identical retries, changed-payload conflict and deactivation with an existing token. This strengthens partial AC-01/02/18 evidence only; the broad role and scope matrix, Storage/private files, real hosted sessions, audit administration and complete scenario coverage remain outstanding. Initial execution failed because generated local TOTP enrollment was disabled; it passed after enabling enrollment and verification in the temporary local configuration. No hosted setting was changed.

2026-11-25: `tests/unit/file-validation.test.js` covers allowed signatures, MIME mismatches, truncated headers, unsupported purpose and both size boundaries. It is a preliminary validation helper only: AC-17 and SEC-03/05 remain unverified because there is no file lifecycle, scanner or Storage policy. The local Auth test additionally verified that simultaneous conflicting payloads using one operation key result in one success, one error and a single receipt for identical retries, and that a browser user cannot query the private audit schema. This is partial evidence, not complete concurrency or audit security coverage.

2026-11-25 file metadata increment: a disposable local reset reapplied all 12 migrations; local security advisor returned no warnings. Database tests verify same-organization parent/uploader references, size and expiry constraints, immutable staging metadata and authenticated denial. The real local Auth/API test verifies metadata is not API-exposed, oversized metadata is rejected, and staged metadata cannot be deleted. These checks do not exercise an actual object or establish AC-17, SEC-03 or SEC-05: bucket policies, scans, authorized upload/download and signed URL expiry remain outstanding. No hosted change was made.

2026-11-25 quarantine increment: All 13 migrations reapplied on the disposable Supabase stack, and the local security advisor returned no warnings. The real local Storage test verified a private bucket, the MIME allowlist, rejection of a disallowed upload MIME, denial of public and authenticated reads and user-minted links, hidden listings, denied direct writes, and retained bytes after denied changes. The PostgreSQL fixture also showed that a broad permissive policy does not override quarantine. AC-01, AC-17, SEC-03 and SEC-05 have partial foundation evidence. Authorized upload, structural validation and scanning, versioned release, parent-scoped downloads, recovery and hosted verification remain outstanding.

2026-11-26: Real local Auth and API tests verified that private file reservation requires MFA, the separate action grant and access to an unarchived owned parent. They also verified cross-user and cross-organization denial, wrong-purpose and invalid-input rejection, concurrent replay and quota enforcement, a single redacted audit event and receipt, and denial after deactivation. Unit tests verified size-bounded chunk handling, type signatures and SHA-256 over the exact returned bytes. These results extend partial AC-17 and SEC-03/05 evidence. Upload, scanning, release, authorized download and recovery remain pending.

2026-11-26: The end-to-end browser test passed under Chrome at desktop (1440×900), tablet (768×1024) and phone (360×780) viewport sizes against full local Supabase. It covers synthetic staff sign-in, authenticator enrollment and verification, linked customer and lead creation, persistence across refresh and sign-out. It checks horizontal reflow at those sizes. Full device/browser, recovery and remaining workflow coverage are pending.

2026-11-26: Real local Supabase verified temporary CRM read sharing between two MFA-verified staff memberships. The test exercises disallowed cross-organization recipients, AAL1 denial, denied nonowner grants and editing, concurrent retry with one grant, different-payload rejection, expiry, revocation, audit history and loss of recipient access after owner deactivation. This is partial AC-01/02/18 evidence. Team and territory scope, full role administration and hosted signed-in acceptance remain open.

2026-11-26: A local end-to-end invite led to password setup, MFA verification and staff administration. Signed-in API tests verified that regular staff and AAL1 administrator sessions cannot access the directory, cross-organization actions are denied, deactivation protects existing open work and removes access for an eligible staff member with a still-valid token, and retries produce one audit event. Full hosted logged-in verification and complete offboarding remain pending.

2026-11-26: Local signed-in API/browser checks cover CRM hierarchy and territory grants, cross-organization rejection, role expiry, ownership handover, client denial to private file storage, authenticated attachment quarantine and downloads, digest-bound test scanner decisions, and deactivation with an existing token. The actual local Edge endpoint exercises upload, CORS and pending-file denial. A separate ClamAV 1.5.5 test exercised a clean fixture and inert positive diagnostic against the real engine. This extends AC-01/02/17/18 evidence. Hosted scanner deployment, retention and restore verification, additional domain types, and the full tender, expense and field acceptance cases are still pending.

2026-11-26: Synthetic Super Administrator settings checks verified editable expense and tender approval configuration, immutable previous versions, conflicting edits, invalid decimal amounts and scope overlaps, excluded self-routing and cross-organization staff, and one audit event per operation. Chrome tests verified the setting forms and responsive shell search/navigation. This is configuration evidence. Tender and expense workflow acceptance, policy consumption and live approvals remain open.

2026-11-26 — Email/password sign-in supersedes prior authenticator acceptance. `npm run check` passed 11 tests and the production build. The database fixture verifies current permissions with password-only claims, blocks a different organization's policy settings, and denies access through an expired provider session. The updated local Auth and browser tests exercise staff and administrator sign-in, invitation setup and role and scope restrictions without an authenticator. Real local and hosted execution of those revised browser journeys requires separate evidence.

### Expanded pilot verification

Local browser acceptance covers email/password staff and administrator sign-in and invitation setup. The expanded migration and workflow tests cover catalogue deduplication and version conflicts, single open attendance and exception status, tender approval/version separation and submission, and travel/claim approval, reimbursement and reconciliation. CSV import uses row validation and same-member replay protection. Full duplicate merge, offline review/synchronization, scanned live attachments, invoice synchronization, automated alerts and approved live integrations remain open.

### Lead Management workflow extension

The lead data tests now cover source and stage configuration, idempotent itemized capture, inquiry reference uniqueness, assignment and territory routing, notification ownership, atomic bulk changes, permission and tenant scope, first-response escalation, lost and reopened leads, matching, merge provenance, and authorized export. Browser tests exercise the lead dialog, linked customers, list, pipeline, product and activity details, and CSV intake. External provider ingestion and live private attachment scanning are still pending.
