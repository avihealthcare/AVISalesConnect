AVI SALESCONNECT STANDALONE CODEX DEVELOPMENT PROMPT
Version 1.0 | 25 November 2026

HOW TO USE
Paste this entire file into a Codex development chat opened in the intended repository. The complete SRS is included after the execution instructions; no previous conversation, attachment, source file or chat access is required. This prompt requests implementation of an application, not another planning-only response. External documentation links are technical references, not prerequisites for understanding the requirements. Business configuration and live provider access remain explicit gates.

YOUR ASSIGNMENT
Build AVI SalesConnect for AVI Healthcare systematically from the full specification below. Deliver working, tested vertical slices in the defined sequence, maintain the requirement-to-test matrix, and continue through all unblocked Phase 1 work. Do not stop after a UI mockup, database outline, todo list, scaffold or first screen. Do not describe a mock integration or a manual fallback as a working live connection. Do not claim production readiness if Phase 1 tenders, expenses, security or financial controls are missing.

Read repository instructions such as AGENTS.md first. Inspect existing code, dependencies, migrations and tests before selecting implementation details. Reuse compatible architecture and components. If there is no repository yet, establish the proposed structure locally. Treat the embedded SRS as the functional baseline and record any unavoidable deviations in docs/decisions.md. Explicit instructions from the user in the implementation chat supersede this prompt; surface material scope changes in the requirements register.

NONNEGOTIABLE PRODUCT SCOPE
1. IndiaMART is a source in one shared Lead Management module. Use shared leads, ownership, duplicate review, activities, qualification, tasks, conversion, reporting and permissions. There is no separate IndiaMART sales module, table family, pipeline or dashboard destination. A provider adapter and source-event records are permitted.
2. Tender Management and Expense Management are complete Phase 1 modules. Do not postpone them to a future MVP. Phase 1 internal increments are engineering milestones, not permission to remove required modules.
3. Exclude all AI Sales Intelligence and AI data-entry features. Do not add AI SDKs, external AI APIs, predictive scoring, forecasting, assistant chat, OCR, speech transcription, generated messages or summaries. Deterministic reports, manually assigned probabilities and policy calculations are permitted.
4. Build responsive web/PWA first. Native Android/iOS, serialized demo inventory, external distributor portal, incentives, route optimization, live Zoho document issuance and automated communication connectors are later-phase work unless the user explicitly changes scope.
5. No patient records, clinical decision support, payroll, accounting ledger, bank payouts, tender portal submission, background GPS tracking or automatic customer messaging. Manual evidence and labels must accurately describe what the application has verified.

ARCHITECTURE AND REPOSITORY
Default proposal: React + TypeScript PWA, Supabase Auth/PostgreSQL/private Storage, authenticated server commands and worker adapters, static hosting on Netlify, GitHub CI. Verify official documentation and choose compatible supported versions at execution time; commit a lockfile. Do not assume credentials, a production project, a hosting plan or a particular API edition already exists.

Use a modular monolith organized by identity/access, customers, leads, opportunities, field, tenders, expenses, reporting and integrations. Keep domain validation, money calculations and transition rules separate from UI. External provider schemas stay in adapters. Read queries may use authenticated database APIs under tested RLS. Sensitive transitions use server/database command boundaries; no client-owned approvals or balances. Place private worker/configuration tables outside the exposed API surface.

Suggested structure:
apps/web
packages/domain
supabase/migrations
supabase/functions
tests/unit
tests/db
tests/integration
tests/e2e
docs/requirements.md
docs/schema.md
docs/permissions.md
docs/decisions.md
docs/acceptance-matrix.md
docs/integrations.md
docs/runbooks.md

Use existing equivalent directories if appropriate. Generate database types from migrations. Include reproducible setup, environment variable names with safe placeholder values, migration/seed/reset steps, local synthetic fixtures and CI commands. Never place credentials, actual customer records, employee receipts, bank details or patient data in source control or demo seeds.

IMPLEMENTATION DISCIPLINE
Begin by creating a concise architecture decision record, domain/schema outline, route map, permissions map and ordered requirement backlog tied to the embedded IDs. Then implement, rather than waiting for approval of routine coding choices. Do not ask the user to restate requirements already present. Ask only for missing choices that materially change business authority, financial treatment, credentials, production access or third-party behavior; continue independent local development while answers are pending.

For reversible interface details choose a simple accessible enterprise layout with a plain AVI SalesConnect wordmark until approved assets are supplied. Do not invent branding, official product prices, statutory rates, user identities, corporate certifications or regulatory claims. All synthetic data must be visibly synthetic in development and absent from production bootstrap.

Keep a requirement status for each numbered requirement and acceptance test: Not Started, In Progress, Implemented, Verified, Blocked or Deferred by Explicit Scope. An implemented but untested requirement is not Verified. Record test location, date/run, result and outstanding issue. Every Phase 1 module must have real persisted data, validation, loading/empty/error states and authorized actions, not dead buttons or placeholder-only screens.

DATA AND SECURITY RULES
Use the embedded data dictionary as the logical schema. Before migrations, resolve exact field types, NOT NULL conditions, unique constraints and state values in docs/schema.md. Keep every business relation inside its organization with composite foreign keys or equivalent enforced constraints. Separate employee membership IDs from auth-user IDs consistently; document FK types. Use UUIDs and independent display numbers. Use the resources registry to give generic tasks/files/shares/approvals a real FK target; enforce matching domain resource type and atomic creation.

All exposed tables require explicit grants and deny-by-default RLS for each permitted operation. Prevent forbidden field changes with column grants or command-only mutation; row scope alone is insufficient. Never trust user-editable metadata for authorization. Views, reporting functions, RPCs, signed file URLs and workers must preserve the same organization, role, state and scope checks. Do not bypass a failing permission test by turning off RLS, using broad policies or sending service secrets to a browser.

Keep service keys, provider tokens and OAuth refresh tokens in server-side secret storage. Enforce active membership on every online request even if an old access token is still valid. MFA is required for privileged roles. Privileged database functions need restricted execution, fixed search path and explicit actor checks. All business files are private and versioned, with checked parent scope, type/size validation and a safe upload/finalization flow.

Implement immutable snapshots for submitted tender bids, issued quote revisions, claim versions and approved policy versions. Approvals bind to exact target hashes and cannot survive a material revision. Financial records use decimal arithmetic, locks, operation receipts and append-only corrections/reversals. Validate invariants in the database and command layer, not only in UI forms. Audit high-value changes with redacted fields; never log secrets or full attachments.

IMPLEMENT IN THIS ORDER
Milestone 0 Baseline: repository inspection, requirements map, ADRs, schema, permissions, screen routes and decision register. Preserve the full source specification in docs/requirements.md or an equivalent repository document.
Milestone 1 Foundation: identity, organization membership, role/scope rules, resources registry, private files, audit, command envelope/idempotency, CI and synthetic bootstrap. Prove denied access before loading business features.
Milestone 2 Customers and unified leads: accounts/sites/contacts/equipment, basic catalogue/library, shared capture/import, duplicate review, assignment, attempts, follow-ups and conversion. Add IndiaMART Disabled/Mock/Live adapter modes with replay-safe fixture tests and manual/CSV fallback. Keep live mode disabled until actual access is validated.
Milestone 3 Opportunities and field: sales stages, evidence-backed booking/quote reference tracking, discount requests, attendance, visit plans, reports, GPS exception review and limited offline sync. Rehearse airplane-mode capture and reconnect, two-device visit conflicts and rejected writes after deactivation.
Milestone 4 Tenders in Phase 1: lots, bid decisions, current/versioned dates, compliance/deviations, checklist/waivers, prebid queries, immutable submission evidence, evaluation/rank, partial awards, EMD/PBG and execution/collection follow-up. Tender closure must leave unresolved obligations visible.
Milestone 5 Expenses in Phase 1: policy versions, travel approvals, claim revisions/receipts, duplicate warnings, independent manager and finance routing, reductions/exceptions, advances, partial reimbursements, reversals and export/reconciliation. Do not turn expense posting into bank payout or claim payment implicitly.
Milestone 6 Readiness: scoped dashboards and metric definitions, outbox alerts, CSV export, operations screens, migration dry-run, performance/accessibility/security tests, restore drill and UAT evidence. Complete all Phase 1 gates.
Milestone 7 Pilot: run role-based UAT and conditional live IndiaMART contract/recovery tests with authorized real samples. Explicitly list blocked live access and later-phase capabilities. No production deployment or external data mutation without authorization from the implementation session.

After each milestone, run its meaningful tests and update docs/acceptance-matrix.md, schema/decision notes and runbooks. Fix failures before proceeding where they invalidate the next layer. Continue other independent work when an integration credential or policy choice is blocked. Summarize progress in business terms and do not leave the user without an update during extended work.

REQUIRED TEST STRATEGY
Unit: money precision/rounding, date/timezone normalization, SLA calculations, source identity, geofence/accuracy classification, stage transitions, policy selection, allowances, advance balances, booking attribution and metric denominators.
Database: constraints, organization isolation, RLS grants/policies, forbidden field updates, role/scope permutations, private files, view/RPC/report access, self-approval denial, immutable records and revoked membership.
Integration: transactional lead conversion, deadline replacement/outbox cancellation, report-to-task creation, claim-version approval invalidation, duplicate inbound events, provider timeouts/rate limits/dead letters, exact-once operation receipts, staged file retries and reconciliation after uncertain external outcomes.
Concurrency: duplicate conversion/assignment, simultaneous starts across devices, claim approval against stale version, concurrent reimbursements and reversal replay. Verify commit/rollback behavior and balances, not only HTTP responses.
End to end: Sales Operations intake to field follow-up to confirmed booking; mobile visit with denied GPS and offline retry; two-lot tender with partial award and outstanding security; travel/claim with cap exception, finance return, advance and partial reimbursement. Run unauthorized versions of these journeys too.
Accessibility and operations: keyboard/screen-reader core flows, mobile layouts and supported browsers, representative data/load metrics, dependency/security review, migration repeatability, database plus file restore and failure runbooks.

Implement the AC-01 through AC-25 scenarios in the embedded specification with executable assertions and a traceability matrix. Run appropriate checks once changes are complete; repeat only for new changes, failures or unresolved concerns. Do not claim tests passed if they were not executed. If a browser, external provider or restore environment is unavailable, record the exact unverified gate and provide an executable procedure.

INTEGRATION EXECUTION RULES
Consult current official IndiaMART and Zoho documentation before live implementation. Discover actual API entitlement, field identity, authentication, timezone, rate limits, polling windows, data-center URLs and edition capability rather than guessing. Do not hardcode undocumented endpoints or intervals. A validated fixture is sufficient for local development but not for a live gate.

IndiaMART intake must persist before acknowledging per protocol, deduplicate Push/Pull/replay through one source identity, retain provenance, quarantine malformed events and expose lag/health with no secret leakage. Fallback manual/CSV leads stay in the same module. A missing credential must not break the rest of the app.

Phase 1 Zoho capability is manual external references and finance exports. Later live issuance/posting is adapter work behind disabled flags until Accounts approves customers/items/taxes/account/category/employee-advance mappings and tests. Zoho owns issued financial numbers/tax/payment state; SalesConnect owns CRM notes/workflow. A provider timeout after creation requires reconciliation before retry. No silent duplicate orders or expenses.

Communication links are user initiated in Phase 1; no external emails, WhatsApp messages or SMS are sent automatically. In-app notifications are authoritative. Maps/geocoding are optional and have manual coordinate/GPS-exception fallbacks. Do not add authenticated tender scraping or portal submission.

COMPLETION CONDITIONS
Phase 1 is complete only when the required workflows persist correctly, all acceptance gates pass, security denies prohibited actions through direct APIs as well as UI, tender/expense invariants hold under concurrency, offline limits are visible, and the project can be reproduced from repository instructions. Readiness additionally needs the business decisions, UAT, operational owners and restore evidence required by the SRS.

At handover report what works, the meaningful executed checks and their results, the exact remaining decisions or missing credentials, and which features are manual, mock, live or later-phase. Include start/build/test/migrate instructions, the test matrix and operational runbooks. Do not call incomplete work production-ready, hide failed tests, invent approvals or overwrite immutable financial evidence to simplify a demo.

FULL EMBEDDED SOFTWARE REQUIREMENTS SPECIFICATION
The following SRS is part of this prompt and contains the screen designs, data model, workflows, architecture, security, integration boundaries and test register. Implement it together with the execution instructions above. It is included in full so this prompt is standalone.

======================================================================


# AVI SalesConnect Software Requirements Specification
Version 1.0 | 25 November 2026 | AVI Healthcare

## 1 Purpose and requirement authority
AVI SalesConnect shall give AVI Healthcare one controlled record of incoming inquiries, hospital relationships, field activity, sales opportunities, government tenders and employee expense claims. The application shall help employees act on the next task and help management see ownership, delays and outcomes without collecting separate spreadsheets or WhatsApp reports.

This specification is the proposed implementation baseline for product owners, developers and testers. “Shall” denotes a required capability within the phase stated. “Proposed default” denotes a configurable starting rule, not an approved AVI policy. Requirements are identified by module prefixes; the acceptance register in Section 19 is the release traceability baseline.

The business source is the referenced conversation Suggest App Features, including the latest scope correction. The latest user decisions take priority: IndiaMART inquiries belong in unified Lead Management; AI Sales Intelligence is excluded; Tender Management and Expense Management belong in Phase 1. Other workflow details below are proposed product design decisions to make development executable. They require business validation during the pilot, particularly approval limits, personnel scopes and expense policy.

Product families mentioned earlier include ventilators, infant warmers, Bubble CPAP, phototherapy units and transport incubators. Seed these only as editable illustrative categories, without invented models, certifications, specifications or prices. No patient records, clinical decision support or medical device control shall be implemented.

## 2 Scope and phased delivery
Phase 1 is a usable production pilot covering the full core lead, field sales, tender and expense workflows. The engineering increments in the delivery sequence belong to the same Phase 1 release; tenders and expenses cannot be deferred to a later product phase.

| Capability | Phase 1 requirement | Later delivery boundary |
| Unified lead management | All sources, manual and CSV capture, allocation, qualification, pipeline, follow-ups, duplicate review, IndiaMART adapter and fallback | Additional website forms and communication connectors |
| Hospital and contact master | Accounts, sites, stakeholder contacts, installed equipment and relationship timeline | Advanced account planning |
| Field sales | Attendance events, visit plans, GPS visit events, visit reports, daily activity, limited offline drafts | Native mobile apps and stronger offline support |
| Products and quotations | Approved document library, basic price visibility, quotation reference and revision tracking, discount requests, order and invoice reference tracking | Live Zoho estimate generation, order and invoice sync after mapping validation |
| Tender management | Registration, lots, dates, bid decision, compliance, documents, submission, evaluation, award, EMD and PBG, execution and collection follow-up | Automated discovery and portal integrations |
| Expense management | Travel requests, policy calculation, receipts, monthly claims, manager and finance review, reimbursement register and reconciliation | Validated Zoho expense posting adapter |
| Management and control | Team territories, basic targets, scoped dashboards, deterministic alerts, audit, user administration and exports | Incentives, advanced analytics and configurable report builder |
| IndiaMART integration | Server adapter, replay protection, operations monitor and shared lead screens; live enablement conditional on API access | More source adapters using the same intake contract |
| Demos and distributors | Account type distributor, channel attribution and document links only | Serialized demo inventory, reservations, custody and distributor login portal |

Phase 1 shall not include an IndiaMART-only module, AI lead scoring, AI forecasts, AI assistants, AI summaries, generative drafting, speech transcription, card scanning or receipt OCR. Manual notes and file attachments replace automated extraction. Deterministic probabilities, reminders, duplicate rules and arithmetic reports are allowed. AI features are outside this specification, with no planned AI phase or hidden AI dependencies.

Full accounting, payroll, statutory expense treatment, banking payouts, purchase and inventory accounting, service-ticket management, tender portal submission, e-signing, background employee tracking and route optimization are outside Phase 1. A manual operational status shall never be represented as a verified bank payment, legal approval, portal submission or accounting posting.

## 3 Users and operating assumptions
The initial deployment shall serve AVI as a single organization. Every business record shall carry organization_id to preserve boundaries and future expansion; this is not a public multi-tenant SaaS onboarding project. Users are invited employees. Public signup and distributor logins shall be disabled in Phase 1.

Proposed defaults: English interface; INR as the Phase 1 transaction currency; Asia/Kolkata for display and business dates; UTC timestamptz for instants; financial year April to March with selectable calendar reporting. Non-INR opportunities may store a separately labeled indicative value, but cannot be mixed into INR totals without an explicitly stored rate and valuation date. International accounting support is deferred.

One person may hold multiple roles, but additive permissions must not bypass separation of duties. A manager shall never approve their own claim or discount request. An alternate authorized approver is mandatory. Sales ownership, reporting hierarchy and territory scope are distinct concepts. A person's job title alone shall not grant access.

Proposed configurable defaults include a 24 elapsed-hour first-action SLA, seven elapsed-day stale-lead alert, a 200-metre visit geofence, 100-metre maximum acceptable GPS accuracy and tender reminders seven days, three days and one day before the deadline. These are pilot settings. Expense rates, allowance amounts and financial approval limits shall start unconfigured; affected calculations or approvals are blocked with a setup instruction until an authorized user configures them.

## 4 Role permissions and scope rules
Permission evaluation shall combine active organization membership, action permission, row scope, record state and any approval limit. Deny by default. Scope is O own or explicitly shared records, T assigned territory or reporting team, A all organization records, and P specifically assigned process records. Read access to a hospital does not imply access to all linked financial, tender or employee records.

| Role | Sales and field scope | Tender and expense rights | Administration and export |
| Managing Director | A read; reassignment and commercial approvals within configured authority | A tender decisions; final expense escalation; own claims routed elsewhere | A reports and explicit export; business policy approval |
| National Sales Head | A sales read and allocation; commercial approval limit | Tender oversight when granted; sales team claim approval | Targets, territories, sales export permission |
| Regional Sales Manager | T sales, visit review and allocation | T claims as designated manager; assigned tender collaboration | T reports; export only when granted |
| Area Sales Manager | T or O sales according to assigned scope | Assigned tender tasks; designated subordinate claim approval only | Scope reports; no default bulk export |
| Field Sales Executive | O leads, opportunities, tasks, visits and assigned customer sites | Own travel and claims; assigned tender task updates only | Own activity report; no bulk customer export |
| Sales Operations Executive | A intake queue and lead allocation; scoped customer/contact maintenance | Assigned tender support; own travel and claims | Import and duplicate review permissions; no finance approval |
| Tender Executive | P tenders and required accounts/products | Own assigned tenders, compliance and security tracking; own claims | Tender exports only when granted; cannot self-authorize bid commitments |
| Accounts Team | Read authorized quote/order/invoice references; sensitive commercial data by explicit grant | Finance review, approved payment recording and reconciliation; EMD/PBG financial updates | Finance reports and finance exports; no HR administration |
| Service Team | P visit and installation coordination context | Assigned execution milestone updates; own claims | No pipeline, pricing or broad customer exports |
| System Administrator | User setup and technical configuration; no automatic pricing or claim authority | No automatic business approval | Memberships, system health, configuration and audit access |
| Distributor | No Phase 1 login | None | Future portal restricted to own authorized records |

PER-01: Authorize individual actions: create, read, edit, assign, transition, approve, reject, return, export, archive and manage configuration. System Administrator and Managing Director are separate permission bundles. Administrators able to modify roles shall have all such changes audited and monitored; production support access requires an explicit temporary grant.

PER-02: Sales Operations may read all intake records for routing, but shall not receive employee receipt access or unrestricted tender commercial visibility. Tender collaborators see only assigned tenders and permitted tabs. Accounts cannot edit salesperson visit GPS or approve claims at the manager stage merely because they can reimburse them.

PER-03: Customer/site access derives from an explicit account assignment or a scoped lead, opportunity, visit or tender linkage. Contacts inherit their permitted account linkage. Child records inherit the parent scope plus field restrictions. Shared tasks never grant access to unrelated parent tabs.

PER-04: Offboarding shall deactivate membership immediately, revoke sessions, transfer open leads/tasks/visits and remove pending approval assignments. Data and original author attribution remain company property. Existing access tokens must fail subsequent online business requests through an active-membership check. Already downloaded files cannot be recalled; local cache behavior is specified in Section 8.

## 5 Information architecture and screen conventions
Desktop navigation shall contain Home, Leads, Customers, Opportunities, Activities, Field Visits, Products and Documents, Quotations and Orders, Tenders, Expenses, Reports and Administration. Show only permitted destinations. IndiaMART appears as a lead source filter and an integration configuration entry, never as a separate sales module. Mobile navigation shall expose Today, Leads, Visits, Expenses and More.

All lists shall have scoped search, saved filters, sortable columns, server pagination, empty state, loading state, retryable error and a visible filtered record count. Search/export results obey the same access checks as record detail. Default lists show 25 rows. Mobile lists use readable cards and filter sheets. Forms shall indicate required fields, preserve drafts, validate inline and show unsaved changes. Success states must distinguish “saved on server” from “pending sync”.

Desktop shell layout
```text
AVI SalesConnect        Search permitted records      Alerts  Profile
Navigation  | Page title              Scope  Date range   New record
            | Filters and saved views                 Export if allowed
            | Summary indicators with definitions and freshness
            | Main list or board with pagination
            | Detail page or drawer with actions and history
```

Mobile Today layout
```text
AVI SalesConnect                   Sync status   Alerts
Today     Attendance status        Check in or Check out
Overdue follow-ups   Today's visits   Claims awaiting action
Next visit card      Hospital   Time   Open map
Quick actions        Add lead   Start visit   Add expense
Today      Leads      Visits      Expenses      More
```

## 6 Screen specifications
SC-01 Sign in and account recovery. Invite-based email login, password recovery, MFA challenge where required, session timeout message and help contact. No open registration. A disabled employee sees an access-disabled message without organizational data. Profile permits name, phone and notification preferences but not roles, territory or approval authority.

SC-02 Home and management dashboard. Role-dependent cards show leads awaiting first action, overdue tasks, today's visits, pipeline, tender deadlines and pending approvals. Managers add target versus actual, source funnel and team coverage. Filters: date basis, period, territory, owner, product and source. Every card opens its underlying scoped records and displays metric definition and source freshness. No fabricated live metrics in an empty deployment.

SC-03 Unified lead workspace. Tabs All, Unassigned, New, Overdue, My Leads and Duplicate Review; source is a filter including IndiaMART. Columns: lead number, received time, source, account/contact, phone, requested products, owner, qualification, lifecycle, next action and SLA state. Actions: add, import, assign, log call, create task, qualify, disqualify, merge and create opportunity subject to permissions. A list/board toggle groups by lead lifecycle; opportunity sales stages are a separate board.

SC-04 Lead detail and capture. Header shows lead number, lifecycle, source, owner and response timer. Main form: customer/site, contact or free-text prospect, mobile/email, products, quantity, request text, indicative budget, intended purchase date, territory and Hot/Warm/Cold classification. Tabs: Overview, Timeline, Tasks, Opportunities, Documents and Source Metadata. Source metadata is read-only and token-free. Timeline records calls, notes, assignments, status changes and merge events. Contact buttons open dialer/email client; a click is not an automatic completed contact.

SC-05 Import and duplicate review. Three-step upload, mapping, preview/commit; support UTF-8 CSV and a downloadable template. Preview shows valid, invalid, exact-source repeats and possible customer duplicates. Show row errors and allow corrected reimport. Duplicate review compares candidate fields side by side, permits link-to-existing contact/site, keep separate or merge, and requires a reason. Mask records outside the reviewer's scope; route cross-scope candidates to Sales Operations without leaking details.

SC-06 Customer and site workspace. Search list of hospitals, institutions, distributors and other customer types. Detail header: account name, site, territory, owner and location. Tabs: sites, contacts, installed equipment, opportunities, visits, tenders and documents, each independently permission-filtered. Site form includes address, PIN code, state/district/city, latitude/longitude, geocode confidence, type/ownership, total/ICU/NICU beds and departments. Contact form includes name, designation, specialty, role in buying, phone, email and communication preference. Equipment entries include manufacturer/model, category, quantity, installation estimate, warranty dates, source and verification date; unknown values remain unknown.

SC-07 Opportunity board and detail. Stages Qualified, Requirement Confirmed, Proposal, Negotiation, Won and Lost. Cards show customer, product summary, value, probability, close date, owner and next action. Detail tabs: requirements, stakeholders, quotes, activity and outcome. Demo and quotation evidence are optional linked activities, never mandatory sequential stages. A win dialog requests booked value, order reference or provisional evidence, booking date and attribution. A loss dialog requires a reason, optional competitor and notes.

SC-08 Activities and calendar. Own/team day, week and list views for tasks, calls, visit plans and tender milestones. Form: subject, action type, owner, due instant, related record and reminder. Completion requires outcome and next action or an explicit no-follow-up reason. Rescheduling stores old/new dates and reason. Display source timezone for externally entered tender deadlines.

SC-09 Field Today and visit planning. Date, attendance state, planned sequence, pending reports and sync banner. Planning form: site, purpose, expected time and linked opportunity; optional manager review is configurable. A day plan can contain unplanned visits, shown as such. Route action opens an external map for a selected destination; no route optimization promise.

SC-10 Attendance and visit report. Attendance actions capture event time, GPS and accuracy or exception reason. Visit start presents hospital/site, distance, GPS permission state and Start Visit. Visit finish shows start/end, meeting contacts, meeting purpose, outcome, products/quantities, requirements, competitor observations, optional photos, next action and follow-up date. Save draft and submit are separate. A pending-review badge appears for GPS exceptions or offline capture. GPS cannot prove meeting quality or prevent all spoofing.

SC-11 Product and document library. Category/model search; detail shows specifications, allowed price-list visibility, active brochures, images, videos and certificate validity. Only authorized catalogue managers publish versions. Expired documents are visibly marked and excluded from new tender/quote selection unless an authorized exception is recorded. No automated claim of product regulatory compliance.

SC-12 Quotations and order references. List grouped by opportunity with quote number, revision, date, validity, amount, discount approval and local/provider status. Detail shows item snapshot, attachments, terms, external ID, system of record and synchronization state. Actions: request discount approval, attach externally issued quote, supersede revision and link accepted quote/order/invoice reference. Phase 1 does not issue accounting or tax documents. Future Zoho issuance actions remain disabled until credentials, mappings and contract tests pass.

SC-13 Tender register and calendar. Columns: authority, bid number, portal, owner, closing instant, stage, bid decision, value, security deadlines and checklist completion. Filters by product, geography, date, stage and owner. Calendar shows pre-bid, clarification, submission, opening and security-expiry dates. New tender form includes portal URL, reference, authority account, procurement site(s), publication date, submission timezone, deadline, fees and lots.

SC-14 Tender workspace. Header: reference, owner, bid decision, lifecycle, countdown and version. Tabs: Overview, Lots and Products, Dates and Corrigenda, Compliance, Checklist, Prebid Queries, Securities, Submission and Evaluation, Award and Execution, Financial Follow-up and Audit. Checklist rows show mandatory flag, owner, due date, document/version, expiry and verification. Compliance rows show requirement, offered model, evidence, response Compliant/Deviation/Not Compliant/Not Assessed and reviewer. Submission dialog requires acknowledgement evidence and actual submission time; it cannot submit to GeM or another portal.

SC-15 Tender securities and execution. EMD/PBG register shows amount, instrument number, bank, issue/expiry dates, custody, status, release due date and receipt/reference. Bank/account details are restricted to Accounts and explicit authorized users. Execution grid by award line shows ordered, dispatched, installed and accepted quantities with dated evidence. Financial follow-up shows invoice references, due dates, outstanding and collection owner; verified accounting values appear only from their declared source.

SC-16 Expense dashboard and travel request. Employee cards: draft, returned, under review, approved, partly reimbursed and paid. Claim list has period, purpose, total claimed, allowed, rejected, reimbursed and pending. Travel form: dates, destinations, purpose, estimated spend, advance requested and related sites/tender. Manager view shows pending travel and claims; finance view shows verification and unpaid balances. Advances are a register of issued funds with references, not a payment facility.

SC-17 Expense claim editor. Header: claim number, period, employee, status and policy version. Lines: date, category, purpose, site/visit/trip link, mode, distance/rate or amount, receipt and exception explanation. Live totals show claimed, policy allowance, requested exception, approved, advance applied and payable. A receipt drawer previews files and flags probable duplicates. Submit runs validation and freezes a revision. No OCR or automatic receipt data extraction.

SC-18 Expense review and reimbursement. Side-by-side claim snapshot, receipt preview and policy results. Manager actions approve, return or reject with mandatory comments for exceptions. Finance records allowed amount per line, reason for reductions and advance adjustments; additional allowance requires a new manager approval. Reimbursement dialog captures amount, paid date, reference and evidence, supports partial payments, and prevents total reimbursement above outstanding. Corrections use reversal entries. The claimant cannot approve any stage of their own claim.

SC-19 Reports and exports. Standard reports: lead response and source funnel, opportunity pipeline and wins/losses, visit compliance and daily activity, target achievement, tender deadlines and conversion, EMD/PBG exposure, expense ageing and approved expense by territory. Each has definition, date basis, scoped filters, data freshness and drilldown. CSV export is permission-controlled, audited and spreadsheet-formula safe; receipt bulk download is separately restricted.

SC-20 Administration and operations. Users, roles, team hierarchy, territories, product categories, sources, stage defaults, SLA rules, approval limits, expense policies, reminder rules and integrations. Integration screen shows mode Disabled/Mock/Live, last success, lag, error category and retry queue; never display secret values. Audit viewer filters actor/action/entity/date. Deactivation wizard transfers work and checks alternate approvers.

## 7 Unified leads and opportunity business logic
LEAD-01 Intake lifecycle shall be New, Assigned, Contacted, Qualified, Disqualified or Converted. Converted means a lead is linked to at least one opportunity, not that a sale occurred. Source and qualification temperature are independent attributes. All sources share the same table, permissions, SLA and workflow. Assignment is also recorded as an event even when lifecycle changes.

LEAD-02 Capture requires source, received_at, owner or unassigned queue, customer/contact identity text and at least one usable contact route or documented missing-contact reason. Requirement/product may be unresolved at intake. Retain original message and provider received time separately from local ingestion time. A user shall not rewrite first received time or source identifiers to improve response performance.

LEAD-03 Server normalization shall preserve originals and store comparable phone/email values. Normalize known Indian numbers with explicit country context; do not blindly add +91 to all numbers. Exact provider ID repeats are ingestion retries, not new leads. Same phone/email is a customer/contact match candidate, not sufficient proof that two inquiries are the same buying requirement. Fuzzy hospital-name/address matches produce review suggestions, never automatic merges.

LEAD-04 IndiaMART natural idempotency key is organization, provider account and provider inquiry ID after validating the actual API payload. Missing IDs are quarantined or use a documented deterministic event fingerprint with collision review. Multiple sources can link the same contact but retain their own inquiry provenance. A merge preserves canonical lead, aliases, source events, assignments, notes, tasks and opportunity links in one transaction; the losing lead redirects to the canonical lead. Cannot merge across organizations. Managers can resolve distinct opportunities explicitly; no automatic opportunity deletion.

LEAD-05 Proposed allocation order: explicit authorized manual assignment; otherwise active territory/product rule with highest priority; then eligible round-robin; otherwise unassigned Sales Operations queue. Rule ties use stable rule ID ordering. Employee absence/deactivation and eligibility are checked transactionally. Assignment history captures actor/rule, previous/new owner and timestamp. Reassignment does not reset the original response clock. No silent automatic reassignment by default; SLA alerts request review.

LEAD-06 First action is a deliberately saved call/contact attempt with outcome and timestamp, not opening a record, clicking a phone link or adding an internal note. Track first_attempt_at and first_successful_contact_at separately. Proposed SLA uses elapsed time from provider received_at, with ingestion delay separately reported; no business-hour holiday logic is assumed. Imported historic records are labeled and excluded from current SLA breaches unless opted in. One escalation per lead/rule/breach interval prevents alert storms.

LEAD-07 Qualification requires named requirement or product category, customer/site or justified prospect identity, owner and next action. Disqualification requires reason. Conversion transaction creates or links account/contact/site, creates one or more scoped opportunities, links lead_opportunities and closes intake tasks only when deliberately resolved. Repeated conversion requests with the same operation key return the same result. Subsequent opportunities may be added without duplicating the original conversion.

OPP-01 Stages may move forward or backward with audit. Reopening Won/Lost requires manager permission and reason. Demo and quote tracking are independent events. Won requires a booking record with evidence; provisional wins are shown separately and excluded from confirmed booked-sales metrics. Lost requires a configured reason. On a close, open tasks must be resolved or explicitly retained with a reason.

OPP-02 Expected value equals sum of opportunity requirement quantity multiplied by expected unit net price, or an authorized manual estimate labeled as such. Probability is manually selected from stage defaults or explicitly overridden with reason, always 0 to 100. Weighted pipeline equals open opportunity net value multiplied by probability divided by 100. This is arithmetic, not predictive AI. Final quoted/invoiced totals and tax are separate; never present net pipeline as GST-inclusive revenue.

OPP-03 Confirmed booking amount, order date and external/manual evidence define sales credit; an accepted quotation alone does not. Keep one attribution basis per metric and prevent the same order reference from counting twice. Split sales credit, where permitted, must total 100 percent. Tender awards linked to an opportunity contribute through the same booking records and are not added again as independent sales.

QUOTE-01 Phase 1 tracks quotes issued outside SalesConnect. A quote revision is immutable once marked issued; revisions supersede prior versions without deleting them. Discounts are computed from an explicit price snapshot. A request above an employee limit routes to an independent approver, and changes to items, quantity, prices, discount or terms invalidate approval. Unconfigured limits prohibit approval, rather than implying unlimited authority. Phase 1 financial status is labeled manually recorded unless verified by a connected provider.

## 8 Field sales and offline behavior
FIELD-01 Attendance and visits are independent. One open attendance session per employee/business date, and one active visit per employee across devices, enforced on the server. Attendance does not automatically start/end visits. Overnight checkout closes the originating session and flags a date exception. Historical correction is a request with reason and reviewer, never an overwrite of raw GPS.

FIELD-02 Event coordinates shall be captured only on attendance or visit actions after a clear notice. Store latitude, longitude, accuracy_metres, captured_at, server_received_at, event type, capture mode and permission state. Compare distance to the site's saved coordinates using a deterministic spherical distance calculation. Geofence passed means distance within configured radius and reported accuracy acceptable. Missing site coordinates, inaccurate location, denied permission or outside-radius events create a reviewable exception; allow a report so staff are not forced to invent GPS.

FIELD-03 GPS reports indicate evidence quality only. Never call a location “verified” if location is missing, inaccurate or submitted offline without review. Visit end must be after start; device clock drift and overlapping offline visits are review flags. Duration reports use approved start/end instants, show pending exceptions separately and do not infer productive work from attendance hours.

FIELD-04 A submitted visit requires site or prospect site draft, purpose, meeting result, at least one contact or “contact unavailable” reason, narrative and next action/due date or explicit no-action reason. Planned visits can be Completed, Cancelled, Rescheduled or Missed. Submit creates linked follow-up tasks atomically. Managers may return reports for correction while retaining submitted revisions.

FIELD-05 Phase 1 PWA offline support shall be deliberately limited to new lead drafts, customer/contact drafts, visit events/reports and expense drafts/receipt queues created by the logged-in user. Approvals, merges, assignment changes, final claim submission, tender submission recording and accounting operations require an online server check. Cache only minimum records needed for today's assigned work, not the entire customer database. Browser background sync and push are convenience features, not guarantees.

FIELD-06 Outbox entries use client-generated UUID, operation type, payload schema version, base server version, device timestamp and sync state. On reconnect the server rechecks current membership and scope, accepts each operation once and returns canonical IDs. Parent drafts synchronize before child records/files. Append-only notes may append; conflicting edits return a conflict response for explicit resolution, never last-write-wins for ownership, finance or tender deadlines. Receipts upload with stable file keys and retry safely. Show pending, uploading, failed and conflict counts and allow retry or export of the user's unsynced draft text.

FIELD-07 Do not cache authenticated API responses through the generic service worker. Keep user cache namespaces isolated; clear on logout, account switch and detected deactivation. Offline app access locks after 24 hours without online membership validation, a proposed maximum configurable downward. A user offline cannot be guaranteed immediate revocation. Avoid caching approval queues and sensitive tender prices. Warn before removing unsynced drafts on logout and provide a draft recovery option appropriate to a shared device. Do not represent browser storage as secure against a compromised device.

## 9 Tender workflow and controls
TEND-01 Each tender has a unique organization, portal and reference key; each lot has a unique lot number within the tender. Separate workflow dimensions: bid decision Pending/Go/No Go; lifecycle Identified/Preparing/Submitted/Under Evaluation/Closed/Cancelled; and evaluation by lot Not Assessed/Technical Pending/Technical Qualified/Technical Rejected/Financial Opened/Awarded/Lost. L1 is an observed rank, never equivalent to award. A tender may have mixed lot results and partial awards.

TEND-02 Registration requires authority, reference, portal, owner and submission deadline with timezone; value/products may be unknown. Owner records bid decision, decision maker and rationale. A Go decision requires authorized manager approval. No Go requires reason and closes preparation reminders. Preparing requires Go. Cancelled requires authority evidence or internal cancellation reason. Reopening is controlled and audited.

TEND-03 Tender dates are versioned records for publication, prebid, clarification, submission, opening and extensions. A corrigendum creates a new version with attachment and reason; previous values remain visible. Changing a deadline cancels obsolete reminder jobs and schedules new ones using the new version. Reject malformed times and show timezone/IST conversion before save. Late submission cannot be silently marked on time; store actual submitted_at and exception evidence.

TEND-04 Mandatory checklist rows require current document versions and reviewer verification. Compliance rows explicitly record model, evidence and deviations; product catalogue metadata alone cannot certify compliance. Authorized bid reviewers may approve documented waivers, except restrictions marked non-waivable by policy. Expired documents fail readiness. A readiness check returns blocking items, risks and approvals; it does not state that a portal accepted the bid.

TEND-05 Recording Submitted requires Go, completed mandatory checklist, reviewed compliance/deviations, approved waivers, submission timestamp, submitted by and acknowledgement file/reference. Authorized late recording is allowed with explanation, but no portal submission is performed by the app. Freeze a submission snapshot of lot offerings, compliance, checklist and document hashes. Subsequent corrections are an addendum with preserved original snapshot. No private signing keys, portal passwords or digital-signature tokens shall be stored.

TEND-06 EMD/PBG records track instrument type, amount/currency, issuer, reference, issue/expiry/release dates, tender or award, exemption evidence and current state. Allowed transitions: Draft, Submitted, Active, Release Requested, Released or Forfeited; cancellation before submission is separate. Released requires dated receipt/reference; Expired is a derived flag, not proof of refund. PBG extension adds a version/event. Expiry and refund follow-up reminders are independent of tender closure. No automatic bank instructions or movement of funds.

TEND-07 Awards are recorded per lot with awarded customer/contract reference, quantity, value, date and evidence; mixed success is supported. Create confirmed bookings only with order evidence under OPP-03. Execution milestones track supply, installation and acceptance by line, including partial deliveries. Cumulative accepted quantity cannot exceed installed, installed cannot exceed dispatched, dispatched cannot exceed awarded quantity absent an approved contract amendment. Payment follow-ups link invoice references and due dates, with payment amounts sourced or manually evidenced. Closing a tender does not suppress unreleased securities, outstanding execution or collection alerts.

TEND-08 Prebid queries track specification issue, requested change, responsible person, submission and authority response. Competitor entries are manually observed information with source/date and confidence; they are never AI-generated intelligence. External URLs are untrusted and must be validated for safe navigation. Uploads shall not auto-execute scripts or embedded macros.

## 10 Travel and expense workflow
EXP-01 Travel requests progress Draft, Submitted, Approved, Returned, Rejected, Cancelled and Closed. Approval precedes travel where policy requires it; emergency retrospective requests require an exception reason and independent approval. Approved trips are revised through a new version if dates, destination, budget or advance request changes. A travel approval does not approve a future expense claim.

EXP-02 Claim workflow is Draft, Submitted, Manager Approved, Finance Review, Approved for Payment, Partly Reimbursed and Reimbursed. Returned, Rejected and Cancelled are explicit states. Submission freezes a claim version and assigns a manager independent of claimant. A manager may approve, return or reject; finance may approve allowed values, return or reject after manager approval. A material line addition or increase requires manager review again. A return creates a new editable version with history; all final approvals bind to a version hash. Paid claims cannot be edited or deleted.

EXP-03 Policy rules are effective-dated by category, employee grade, geography and travel type. One unambiguous matching rule is required. Preserve the policy version applied to each line using expense service date. Policy updates do not recalculate approved historical claims. Mileage allowance equals approved kilometres multiplied by applicable rate. Daily allowance uses configured full/partial day eligibility with no invented statutory rates. For actual-cost categories, policy allowance equals the lower of eligible amount and cap, unless a separately approved exception permits more. Category rules specify tax inclusion; the app does not infer tax deductibility.

EXP-04 All line amounts use decimal arithmetic. Validate nonnegative amounts and distance; quantity/rate required for mileage; travel dates consistent; receipts required above configured thresholds; future service dates blocked unless category explicitly permits prepaid expenses. A receipt exemption requires reason and approval. File-hash reuse plus employee/date/amount/vendor/reference checks flag probable duplicates, but different legitimate expenses are not automatically rejected. Every expense line belongs to one current claim only. Return/revision does not create a second reimbursement entitlement.

EXP-05 Claim totals: claimed_total is sum of submitted line amounts; allowed_total is sum of finance-approved line amounts; rejected_total is claimed_total minus allowed_total for the approved version. Advance applied cannot exceed both available employee trip advance balance and allowed_total. Net payable equals allowed_total minus applied advance. Outstanding payable equals net payable minus non-reversed reimbursements. Report unused advances separately as employee advance balance or return due. Never silently net unrelated advances or show a negative reimbursement as a payout.

EXP-06 Reimbursement requires Approved for Payment, independent finance permission, positive amount not exceeding outstanding payable, paid date, payment reference and evidence. Partial reimbursements are permitted. Unique operation keys and transaction locking prevent double recording under concurrent requests. A manually recorded payment must be labeled as such until reconciled. Bank payout initiation is out of scope. Reversal entries require reason and finance authority and restore the outstanding balance; originals remain immutable. Bank account details need not be stored in SalesConnect; use the finance system as the source.

EXP-07 Approval routing uses explicit designated managers, effective dates, permitted limits and alternate approvers. No user may act as approver on their own claim, including MD and administrators. If no eligible approver exists, hold as Pending Routing and notify an administrator; never auto-approve. Escalation does not imply approval. Delegations have start/end dates, exclude claimant and are audited.

EXP-08 Approved claims shall support finance CSV export with claim/version/line IDs, category, cost center, approved amount, advance and reference. A future Zoho adapter shall map the correct accounting object and employee/advance treatment with Accounts; a Books expense endpoint alone is not proof that employee reimbursement and advance settlement are supported as required. Exported, Posted and Reimbursed remain different states. Integration errors never turn a claim into paid.

## 11 Reporting and notifications
REP-01 Lead response is first_attempt_at minus received_at for valid nonhistorical leads, reporting unanswered leads separately. Successful contact response uses first_successful_contact_at. Source conversion uses a received-date lead cohort and distinct converted leads divided by eligible cohort count; show denominator and cut-off date. Multiple opportunities do not inflate converted-lead count.

REP-02 Open pipeline is net opportunity value for open stages as of the reporting time. Confirmed booked sales use booking date and evidence status, excluding cancellations and applying explicit adjustments/reversals. Target achievement equals confirmed credited bookings divided by the configured matching target, with N/A for missing/zero target. Do not label bookings as invoiced revenue. Collection uses verified/manual-labeled receipt records; expense-to-sales uses approved expenses and confirmed bookings for the same declared period/basis and shows N/A for zero denominator.

REP-03 Visit completion is completed submitted visits divided by due planned visits, excluding cancelled plans and displaying unplanned visits separately. Missing location and unresolved review flags remain visible. Tender win rate reports award outcomes by lot and separately by tender with explicit mixed-result treatment. Securities exposure is unreleased, non-exempt instrument amount, showing expired and release-overdue subsets. Expense ageing uses submission, approval and payment dates separately.

NOT-01 Required in-app alerts: assignment, first-action SLA breach, overdue follow-up, stale lead, returned report, tender date reminder/change, security expiry/refund follow-up, travel/claim action, approval return and reimbursement recorded. Email delivery is optional at pilot if no provider configured; in-app queues remain authoritative. WhatsApp, push and SMS connectors are later opt-in capabilities. No alert shall be considered a completed customer communication.

NOT-02 Jobs use an outbox and a unique recipient/entity/rule/version/scheduled-time key. Workers use leases, bounded retry, backoff and a dead-letter queue. Acknowledging an alert does not complete its task. On owner/deadline change, cancel stale jobs and re-evaluate recipient permissions at delivery. Display undelivered counts to operations and provide controlled retry. No secrets or restricted customer information in external notification previews.

## 12 Database conventions and relationships
DB-01 PostgreSQL is the system of record for CRM and operational workflows. UUID primary keys, not sequential display IDs, identify records. Except auth.users and static permission codes, organization-owned tables carry organization_id and timestamps. Mutable entities carry created_by, updated_by and integer row_version; change commands compare row_version. Immutable event/snapshot/ledger tables carry actor_id and occurred_at. Display numbers are generated atomically and unique per organization/entity/year, without promising gap-free numbering.

DB-02 Every foreign key between organization-owned tables shall enforce the same organization through a composite foreign key on (organization_id, id), or an equivalently enforced database constraint. Unique (organization_id, id) keys support these constraints. Do not rely only on application filtering. Business hard deletion is restricted; use archived_at for masters and reversible state changes for workflow records. Posted financial records, submission snapshots, approvals and audit events are append-only. Audit-preserving correction and retention purge are separate controlled operations.

DB-03 Type notation: id is uuid; text is bounded by validation where appropriate; money is numeric(18,2); quantity/distance numeric(12,3); percentage numeric(5,2); dates date; instants timestamptz; flags boolean. Use lookup tables or constrained values for states and source/category codes. JSONB is allowed for immutable snapshots, provider payloads and configuration, not as a substitute for relational line items, money or permissions. Blank and unknown values use NULL where meaningful, never fabricated zeroes.

The following dictionary lists domain fields in addition to these common fields. Required input conditions are defined in the corresponding workflow and shall also be enforced server-side. Required structural links, state, amount and natural keys shall be NOT NULL; optional details may be NULL until the appropriate transition. Migrations shall document nullability and allowed values field by field before UI implementation.

### 12A Identity and access tables
organizations: name text, timezone text, base_currency char(3), financial_year_start_month smallint. Single seeded AVI organization in Phase 1.
profiles: id uuid referencing auth.users, display_name text, phone text. No user-writable authorization fields.
memberships: user_id uuid, status Active/Inactive, employee_code text, grade_code text, manager_user_id uuid optional. Unique organization/user and organization/employee_code; reject reporting cycles and managers outside organization. Auth-user deletion must not cascade-delete business history.
roles: code text, name text; permissions: code text, description text; role_permissions: role_id, permission_code. Role code unique per organization; permission catalog uses globally unique static codes.
member_roles: membership_id, role_id, effective_from timestamptz, effective_to optional. Unique nonoverlapping grants for member/role. Role grants cannot be made through self-service profile updates.
territories: name, parent_id optional, type Region/State/District/Custom, active boolean. Hierarchy must be acyclic. territory_members: territory_id, membership_id, scope_mode, valid_from, valid_to. Do not infer all geographic access from free-text state names.
record_shares: resource_id, membership_id, permission_set, expires_at, reason. Explicit least-privilege sharing, authorized by resource owner scope.
approval_routes: process_type, subject_member_id or scope_rule, approver_member_id, alternate_id, limit_amount, effective_from/to. Reject self-routing and ambiguous overlapping matches.

### 12B Customer and catalogue tables
accounts: resource_id, name, account_type, parent_account_id optional, owner_id, territory_id, normalized_name, tax_identifier optional, status. Account type includes Hospital, Institution, Distributor and Other. Names are not unique customer keys.
account_assignments: account_id, membership_id or territory_id, assignment_type, effective_from/to. Exactly one member/territory target per row. Records explicit account coverage.
sites: resource_id, account_id, name, address fields, country_code, state/district/city, postal_code, latitude/longitude, location_source, geocode_confidence, hospital_type, ownership, bed counts, departments text[]. Latitude -90..90, longitude -180..180, bed counts nonnegative.
contacts: resource_id, name, phone_raw, phone_normalized, email_raw, email_normalized, designation, specialty, communication_preference, status. Normalized phone/email indexed but not globally unique.
contact_accounts: contact_id, account_id, site_id optional, buying_role, is_primary, valid_from/to. Contact may belong to multiple institutions; site must belong to linked account.
installed_equipment: site_id, category_id, manufacturer, model, quantity, installed_date optional, approximate_age optional, warranty_end, source, verified_at. Quantity positive; estimated dates labeled estimated.
product_categories: name, active; products: resource_id, category_id, code, name/model, specifications JSONB, active. Unique organization/product code; do not invent regulatory attributes.
price_lists: name, audience, currency, effective_from/to; price_list_items: price_list_id, product_id, unit_price, revision. Read access restricted by audience permissions. Historical quotations retain their own price snapshots.
documents: resource_id, title, category, product_id optional, active_version_id optional, approval_status. document_versions: document_id, file_id, version_number, valid_from/to, published_by/at, checksum. Unique document/version. Published versions immutable.

### 12C Leads and sales tables
lead_sources: code, name, active, is_external. One IndiaMART source, not a separate domain table.
leads: resource_id, display_number, source_id, received_at, ingested_at, contact_id/account_id/site_id optional, prospect_name, phone/email snapshots, requirement_text, budget, intended_purchase_date, owner_id optional, territory_id optional, temperature, lifecycle, first_attempt_at, first_successful_contact_at, next_action_due_at, canonical_lead_id optional, historical_import boolean. Primary lifecycle and owner changes use controlled commands.
lead_items: lead_id, product_id or category_id, description, quantity, indicative_unit_price optional. Require product/category/description; quantity positive when known.
lead_source_events: lead_id optional, integration_account_id optional, source_id, external_inquiry_id, external_event_id optional, received_at, payload_hash, private_payload JSONB, processing_status. Unique organization/provider account/inquiry identity for normalized inquiries; delivery IDs deduplicate inbound events separately. Raw deliveries can reference the same normalized inquiry via integration_events. Quarantine events may lack lead_id.
allocation_rules: priority, territory_id optional, product/category criteria, eligible_member_ids or team rule, mode, active. assignment_events: lead_id, previous_owner_id, new_owner_id, rule_id optional, reason, assigned_at. Immutable.
lead_merges: canonical_lead_id, merged_lead_id, reason, merged_by/at, snapshot. Unique merged lead; prevent cycles and self-merge. lead_opportunities: lead_id, opportunity_id; unique pair.
opportunities: resource_id, display_number, account_id, site_id optional, primary_contact_id optional, owner_id, territory_id, stage, estimated_net_value, value_basis, probability, expected_close_date, closed_at optional, lost_reason_id optional, competitor_notes. Nonnegative value; probability 0..100.
opportunity_items: opportunity_id, product_id/category_id, description, quantity, expected_unit_price. opportunity_stakeholders: opportunity_id, contact_id, buying_role. opportunity_stage_events: opportunity_id, from_stage, to_stage, reason, actor, occurred_at.
activities: resource_id, parent_resource_id, activity_type Call/Note/EmailLog/Meeting, outcome, summary, occurred_at, contact_id optional, is_contact_attempt boolean. Append corrections as linked events. tasks: resource_id, parent_resource_id, owner_id, type, subject, due_at, status, completed_at, outcome, next_task_id optional. parent_resource must exist and be readable; task scope does not widen parent access.
quotations: resource_id, opportunity_id, quote_number, source_system, external_quote_id optional, status, current_revision_id. quotation_revisions: quotation_id, revision_number, valid_until, net_amount, tax_amount, gross_amount, item_snapshot JSONB, terms_snapshot, file_id, issued_at, approval_id optional, supersedes_id. Unique quotation/revision; immutable issued snapshot.
discount_requests: resource_id, quote_revision_id, requested_discount, reason, requested_by, status, approval_id. Changing quote hash invalidates approval.
bookings: resource_id, opportunity_id optional, tender_award_id optional, order_reference_id, booked_on, confirmed_net_amount, evidence_status, adjustment_of_id optional. One canonical booking may reference both opportunity and award. Require at least one sales context; deduplicate order/line through a unique source key.
booking_credits: booking_id, membership_id or territory_id, percentage. Enforce total 100 percent at finalization; select one credit dimension per report to avoid double counting.
financial_references: resource_id, parent_resource_id, reference_type Quote/Order/Invoice/Receipt, source_system, external_id, number, document_date, due_date optional, net/tax/gross_amount, paid_amount, verification_status, last_synced_at, file_id optional. Unique organization/source/type/external_id when populated; manual numbers require duplicate review. These are operational mirrors, not a general ledger.
targets: period_start/end date, membership_id or territory_id, product_category_id optional, metric_code, amount. Exactly one ownership dimension; no overlapping targets for identical dimensions and metric.

### 12D Field tables
visit_plans: resource_id, employee_id, site_id optional, prospect_site_text optional, planned_start/end, purpose, opportunity_id optional, status, plan_version. End after start; reschedule history retained in plan_events.
plan_events: visit_plan_id, event_type, previous_snapshot, new_snapshot, reason, occurred_at. Immutable.
attendance_sessions: resource_id, employee_id, business_date, start_at, end_at optional, review_status. Unique open session per employee/date. attendance_events: session_id, event_kind In/Out/CorrectionRequest/CorrectionDecision, geo_event_id optional, reason, reviewer_id optional. Raw In/Out immutable.
visits: resource_id, plan_id optional, employee_id, site_id, opportunity_id optional, start_at, end_at optional, status, review_status, is_unplanned. Partial unique index prevents multiple open visits per employee. Offline conflicting events stay in review rather than overwriting accepted visits.
geo_events: employee_id, attendance_session_id or visit_id, event_kind, latitude/longitude optional, accuracy_metres optional, captured_at, received_at, capture_mode, permission_state, distance_metres optional, geofence_result, exception_reason. Exactly one session/visit parent; retain raw evidence unchanged.
visit_report_versions: visit_id, version_number, contacts_snapshot, outcome, notes, product_requirements JSONB, next_action, next_due_at, no_action_reason optional, submitted_at, review_result. Unique visit/version; submitted versions immutable. Customer/product updates from reports use separately validated domain commands.

### 12E Tender tables
tenders: resource_id, reference, portal_code, portal_url, authority_account_id, owner_id, territory_id optional, title, estimated_value optional, currency, bid_decision, lifecycle, submission_deadline_at, date_version, decision_approval_id optional. Unique organization/portal/reference. Submission deadline is a maintained projection of the current tender_date record.
tender_lots: tender_id, lot_number, description, product_id/category_id optional, requested_quantity, estimated_value optional, evaluation_state, observed_rank optional. Unique tender/lot number; quantities positive.
tender_dates: tender_id, event_type, scheduled_at, source_timezone, version, supersedes_id optional, corrigendum_file_id optional, reason. Unique tender/event/version; exactly one current version per event. tender_sites: tender_id, site_id; unique pair.
tender_checklist_items: tender_id, lot_id optional, requirement_text, mandatory, non_waivable, owner_id, due_at, document_version_id optional, state, verified_by/at, waiver_approval_id optional.
tender_compliance: tender_id, lot_id, requirement_text, offered_product_id optional, response, deviation, evidence_file_id/document_version_id optional, reviewer_id, reviewed_at. Both lot and product constrained to organization; response required before readiness approval.
tender_queries: tender_id, requirement_reference, requested_change, owner_id, submitted_at, response_text, response_file_id optional, status.
tender_submissions: tender_id, revision, submitted_by/at, recorded_at, acknowledgement_file_id, acknowledgement_reference, snapshot JSONB, snapshot_hash, late_reason optional. Immutable, unique tender/revision. tender_evaluation_events: tender_id, lot_id optional, event_type, result, observed_rank, evidence_file_id, occurred_at.
tender_securities: resource_id, tender_id, award_id optional, type EMD/PBG, amount, currency, instrument_reference, bank_name, issued_on, expires_on, release_due_on, status, exemption_file_id optional. security_events: security_id, event_type, effective_date, amount optional, reference, evidence_file_id, reason. Ledger-like immutable history; current state derived transactionally.
tender_awards: resource_id, tender_id, lot_id, contract_reference, awarded_on, quantity, net_amount, evidence_file_id, amendment_of_id optional. tender_execution_events: award_id, site_id optional, event_type Dispatch/Installation/Acceptance/Correction, quantity, occurred_on, reference, evidence_file_id, reverses_id optional. Totals enforce sequence and contracted quantity in a locked transaction.

### 12F Expense tables
travel_requests: resource_id, employee_id, purpose, start/end dates, destination_snapshot, estimated_amount, requested_advance, status, current_version, approval_id optional. travel_request_versions: request_id, version, snapshot JSONB, hash, submitted_at.
expense_categories: code, name, calculation_type Actual/Mileage/Allowance, active. expense_policy_versions: name, version, effective_from/to, approval_state, published_by/at. expense_policy_rules: policy_version_id, category_id, grade_code, geography_code, travel_type, rate, cap, receipt_threshold, allowance_unit, partial_day_rule, exception_allowed. Prevent ambiguous effective rule matches; published versions immutable.
expense_claims: resource_id, number, employee_id, period_start/end, travel_request_id optional, purpose, status, current_version_id, active_finance_assessment_id optional, submitted_at, manager_approved_at optional, finance_approved_at optional. expense_claim_versions: claim_id, version, snapshot_hash, claimed_total, submitted_at. Immutable on submission; unique claim/version. Post-submission decisions and settlement totals live in separate records, never mutate the frozen submitted snapshot.
expense_lines: claim_version_id, stable_line_id uuid, service_date, category_id, visit_id/site_id optional, purpose, vendor, reference, amount_claimed, distance optional, rate optional, computed_allowance, policy_rule_id, receipt_exemption_reason, exception_reason. Unique version/stable_line_id; stable lineage across revisions prevents double entitlements. Receipt linkage uses resource_files on claim resource with expense_line_id metadata constrained to that claim version. Submitted lines are immutable.
expense_finance_assessments: claim_version_id, revision, status Draft/Final/Superseded, allowed_total, applied_advance_total, net_payable, assessed_by/at, approval_id. expense_line_decisions: assessment_id, expense_line_id, amount_allowed, reduction_reason, exception_approval_id optional. Unique assessment/line; line must belong to the assessment's claim version. Final assessments and decisions are immutable; corrections produce a superseding assessment and any required reapproval. Reimbursements bind to the active final assessment and claim version; no assessment replacement after payment without explicit reversal and reconciliation.
travel_advances: resource_id, employee_id, travel_request_id, issued_on, amount, reference, verification_status. advance_entries: advance_id, claim_version_id optional, entry_type Issue/Apply/Return/Reverse, amount, effective_date, reference, reverses_id optional. Immutable; Apply cannot exceed remaining balance; reverse entries cannot reverse twice.
reimbursements: resource_id, claim_id, claim_version_id, finance_assessment_id, amount, paid_on, reference, verification_status, evidence_file_id, operation_key, reversal_of_id optional, reversal_reason optional. Unique organization/operation_key; positive magnitude with direction derived from reversal type. Lock claim balance during posting and reversal.

### 12G Shared platform tables
resources: id, organization_id, resource_type, owner_id optional, territory_id optional, archived_at. Each securable domain table has a unique resource_id and database enforcement that resource_type matches its domain type. This registry gives tasks, files, shares, approvals and integrations a real FK target instead of unenforced entity_type/entity_id pairs. Domain creation and registry creation are atomic; orphan resources are forbidden. Parent/child scope helpers use the domain's actual relations, not client-supplied owner values.
files: id, organization_id, bucket, object_key, original_name, detected_mime, size_bytes, checksum, upload_status, scan_status, uploaded_by. Unique bucket/object_key. resource_files: resource_id, file_id, purpose, domain_line_id optional. Validate any line linkage against the parent domain. Files used by published documents or submitted claims cannot be overwritten.
approval_requests: resource_id, process_type, target_version, target_hash, requested_by, current_step, status. approval_steps: approval_request_id, step_number, assigned_approver_id, authority_limit_snapshot, state, acted_at, comment, delegation_id optional. Unique request/step; decision events append-only; approval function checks claimant/requester conflict and hash.
approval_delegations: principal_id, delegate_id, process_type, effective_from/to, reason, granted_by. Cannot extend principal authority or permit self-approval.
notifications: resource_id optional, recipient_id, event_key, type, title, body, created_at, read_at, delivery_state. notification_deliveries: notification_id, channel, attempt, provider_id optional, error_code, next_attempt_at. Redact sensitive bodies in generic notification logs.
integration_accounts: provider, provider_account_reference, mode, status, secret_reference, configuration JSONB, last_success_at. integration_events: integration_account_id, direction, provider_event_id, dedupe_key, payload_hash, private_payload, received_at, state, error_code, mapped_resource_id optional. Unique integration/dedupe_key. Secret values never stored in client-visible tables.
external_mappings: integration_account_id, resource_id, provider_entity_type, external_id, last_synced_at, provider_version. Unique integration/type/external_id and integration/resource/type.
job_outbox: job_type, resource_id optional, idempotency_key, payload, available_at, lease_until, attempt_count, state, last_error_code. Unique organization/idempotency_key. Worker-only mutation except authorized retry command.
operation_receipts: actor_id, operation_key, command_type, request_hash, response_snapshot, completed_at. Unique organization/actor/operation_key; same key with different request hash is a conflict.
audit_events: actor_id optional, actor_type, action, resource_id optional, request_id, timestamp, redacted_before/after JSONB, reason, source_ip metadata under retention policy. Append-only; organization-readable only with audit permission. Provider payloads, passwords, tokens and full receipt images never copied into audit.
configuration_versions: key, version, value JSONB, effective_from, changed_by, reason. Validate schemas for SLA, geofence, roles and alert settings; sensitive secrets excluded.
import_batches: source, uploaded_file_id, submitted_by, mapping_snapshot, state, totals. import_rows: batch_id, row_number, normalized_payload, errors JSONB, resulting_resource_id optional, row_hash, state. Unique batch/row; committed row receipt prevents repeat creation.

### 12H Relationship and index summary
An organization has memberships, territories and every business record. Accounts have sites and installed equipment; contacts join accounts/sites through contact_accounts. Leads have source events, items and assignments and join opportunities many-to-many. Opportunities have items, stakeholders, quotes and bookings. Tasks/activities/files attach through a resource FK. Visits link employee, site, optional plan and opportunity; geo events and report versions belong to visits. Tenders have lots, dates, compliance, checklists, submissions, securities and awards; awards have execution events and can link the same canonical booking as a sales opportunity. Claims have immutable versions and lines; advance applications and reimbursements reference the approved version. Approval requests reference a securable resource and exact version/hash.

Indexes shall include organization plus owner/territory/state/due date on work queues; leads(source_id, received_at); contacts(normalized phone/email); normalized account/site names for search; tasks(owner_id, status, due_at); visits(employee_id, start_at); tenders(submission_deadline_at, lifecycle); securities(status, expires_on, release_due_on); claims(employee_id, status, submitted_at); integration dedupe keys; resource shares; and all foreign keys used in RLS joins. Use partial indexes for open tasks and active sessions. Benchmark RLS queries and server pagination with representative data before adding speculative indexes.

## 13 Application architecture and command boundaries
ARCH-01 Recommended stack is a React and TypeScript responsive PWA, Supabase Auth, PostgreSQL and private Storage, server-side functions for integration adapters and business commands, Netlify for static frontend hosting, and GitHub for version control and CI. This follows the earlier recommendation and is a proposed architecture, not an assertion that AVI infrastructure is configured. Pin compatible supported dependencies after checking current official documentation; no fixed package versions are prescribed here.

ARCH-02 Use a modular monolith with feature folders for identity, accounts, leads, opportunities, field, tenders, expenses, reporting and integrations. Share typed domain schemas, design components and command contracts. Keep external-provider DTOs inside adapters. UI state is not business authorization. UI reads may use the authenticated database API under RLS; complex transitions must use server commands and database transactions. Do not allow direct client updates to approved amounts, state, owner, policy version or ledger projections.

ARCH-03 Logical flow is PWA to authenticated API/read policies to domain commands and PostgreSQL. Domain commands write events and job outbox in the same transaction. Workers deliver notifications and synchronize providers outside the transaction. Storage uploads use authorized staged object keys; a finalize-file command checks metadata, parent scope and scan result. Realtime updates improve freshness but are never required for transaction correctness; reconnect triggers a fresh scoped query.

ARCH-04 Mutating commands take an operation key and expected row version and return request_id, canonical resource IDs, new version, status and warnings. Standard responses: 400 invalid input, 401 unauthenticated, 403 unauthorized, 404 unavailable/not in scope without revealing existence, 409 version/idempotency conflict, 422 invalid business transition, 429 throttled and retryable 5xx. Same key/same payload returns prior result. A command and its audit event commit atomically; external API calls do not occur while holding financial database locks.

| Command group | Required transactional commands |
| Intake and sales | import preview/commit, capture lead, assign lead, record contact, merge lead, convert lead, transition opportunity, request/decide discount, record booking |
| Field | open/close attendance, start/end visit, submit/return visit report, resolve GPS exception, synchronize offline batch |
| Tender | decide bid, revise tender date, review compliance, approve waiver, record submission, record evaluation, record award, record execution, update security with evidence |
| Expense | submit/revise travel, decide travel, submit claim, manager decision, finance decision, apply advance, record/reverse reimbursement |
| Platform | invite/deactivate employee, grant/revoke role/share, publish policy/document, finalize file, retry job, export scoped report |

ARCH-05 Repository deliverables shall include apps/web, packages/domain, supabase/migrations, supabase/functions, tests/unit, tests/db, tests/integration, tests/e2e and docs. Equivalent existing repository structure is acceptable if documented. Include .env.example with names only, lockfile, reproducible setup, seeded synthetic data, generated database types and a requirement-to-test register. Test data must never use real patient or employee receipt information.

## 14 Security privacy and operational controls
SEC-01 Enforce active-membership, organization and action/row scope on every online request. Enable RLS on all exposed tables with explicit least-privilege grants; private worker/secret tables are not exposed to browsers. RLS shall check old and new rows for updates. Protect fields through column grants or command-only mutation, because row policies alone do not prevent changing an allowed row's approval fields. Scope-safe views and report functions must not bypass caller permissions. Database authorization must not depend on user-editable profile metadata. These controls follow the platform's documented grants and RLS model [R2].

SEC-02 Browser receives only the public project URL and publishable key; service/secret keys, OAuth refresh tokens and IndiaMART keys stay in server secret storage. Restrict privileged functions, validate actor membership and scope inside them, set explicit search paths, revoke public execute grants and audit their use. Do not “fix” authorization failures by disabling RLS or adding broad allow-all policies. Test direct API, RPC, view and storage access, not only hidden UI buttons.

SEC-03 All business file buckets shall be private with parent-resource authorization. Signed links are short-lived bearer links, proposed five-minute maximum; do not place them in permanent external communications. Authorize upload, download, listing, overwrite and removal separately. Published or submitted files use immutable versioned object keys. The platform documents that public URLs bypass download authorization and signed URLs depend on authorization when created [R3]; therefore recheck scope before issuing each URL.

SEC-04 Require MFA for administrators, finance and approvers; enable MFA for other roles where practical. Use invitation validation, configurable session expiry, server-side membership checks and recovery procedures. Protect endpoints against brute force and excessive import/file/API volume. Escape displayed content, validate URLs, sanitize generated exports, apply a restrictive content security policy and avoid unsafe HTML rendering. Use explicit allowed origins; verify webhook authenticity using the provider's supported mechanism. If a source lacks cryptographic signatures, document the limitation and use a secret endpoint token, network controls where available and strict replay/dedupe validation.

SEC-05 Proposed upload policy: PDF/JPEG/PNG receipts, maximum 10 MB per receipt; PDF/JPEG/PNG and approved office formats for business documents, maximum 25 MB. Validate actual MIME and magic bytes, reject executable/macro-enabled formats, isolate pending scans and prevent download before safe status. Scan provider and availability must be chosen before accepting office documents in production; if unavailable, restrict production to approved safe file types and record the remaining risk. No public file buckets.

SEC-06 Audit assignment, scope changes, merges, transitions, evidence edits, policy publication, approvals, exports, reimbursements, integration replay and user deactivation. Keep request correlation IDs and redacted structured logs. Application roles cannot update/delete audit rows. Monitor privileged database access outside app logs. Do not log access tokens, external keys, full provider payloads, bank details or attachment contents.

SEC-07 Collect employee location only for explicit events with notice and a documented business purpose. Do not track background location. No patient names, health records or clinical imagery should be requested; give upload guidance and a restricted incident/removal workflow for accidental sensitive uploads. Communication preferences and contact provenance must be recorded; connector activation requires the appropriate business consent and templates where applicable. This document specifies product controls, not a legal compliance certification.

SEC-08 Before production AVI shall approve retention periods for contact history, GPS, employee claims, tender documents, raw provider payloads and audit events; legal/accounting retention and access-request handling need qualified review. Pilot shall use synthetic data until this is recorded. Retention jobs must preserve required financial/audit references, support holds and avoid deleting linked evidence inadvertently. Proposed technical defaults: raw integration payloads 30 days and GPS coordinates 90 days, subject to approved policy; no arbitrary default retention for financial records.

SEC-09 Separate development, staging and production projects/secrets. Use sanitized fixtures outside production. Backups shall cover both database and stored objects, with documented restore dependency ordering. Proposed pilot RPO 24 hours and RTO 8 hours; validate against purchased capabilities with an actual restore exercise. Monitor failed logins, denied cross-scope requests, integration lag, outbox failures, orphaned uploads, security expiry and reimbursement discrepancies. Alerts need an assigned operational owner and runbook.

## 15 Integration boundaries and degraded operation
INT-01 IndiaMART is an intake adapter, not a parallel CRM. Official documentation describes Pull and Push options and paid/access conditions [R4, R5]. Confirm AVI entitlement, provider account, payload fields, authentication, permitted polling intervals, historical windows, limits and timezone semantics before implementing a live connector. Do not invent endpoints, credentials or rate limits. Choose Push or Pull according to actual access; do not enable both without shared deduplication.

INT-02 Ingest privately, validate and store source event, enqueue processing, normalize, deduplicate and create/update source provenance linked to a shared lead. Acknowledge only according to the provider protocol after durable receipt. Pull windows use persisted checkpoints plus a bounded overlap and resume only after durable storage. Push retries and Pull overlap must create one normalized inquiry. Retry transient failures with backoff, quarantine invalid events, redact payload logs and expose lag/failure counts. CSV/manual intake remains available when API entitlement or credentials are absent. Disabled/Mock/Live modes must be visibly distinct. Phase 1 pilot acceptance may use mock/CSV, but live IndiaMART acceptance is a separate gate and must be reported as incomplete until tested.

INT-03 Zoho Books is the intended financial system of record. Official API documentation includes Estimates, Expenses and OAuth scopes [R6, R7, R8]; availability does not confirm AVI's edition, data center, authorization or accounting mappings. Phase 1 stores labeled external references and finance exports. Future live adapter shall use server OAuth, least scopes, configured organization/data-center URLs and mappings for customers, items, tax, account/category, price lists and external IDs. Catalog ownership and tax rounding must be reconciled before issuing quotes. Never infer India data center solely from employee location.

INT-04 Future Zoho issuance uses an immutable approved quote snapshot, operation key and provider mapping. After an uncertain timeout, query/reconcile before retrying creation; do not assume provider POSTs are idempotent. Receipts, invoice and order mirrors refresh according to supported capabilities and show last-synced time. CRM may own relationship notes; Zoho owns issued document numbers, tax totals and accounting payment state. Simultaneous edits follow the declared field ownership matrix, never generic last-write-wins. Employee reimbursement object mapping requires Accounts sign-off; posting an expense does not mark a claim reimbursed.

INT-05 Phase 1 dialer/email/map links launch user-selected applications. No automatic call recordings, customer emails or WhatsApp messages are sent. Website, email and WhatsApp entries can be captured manually under the appropriate source. Later connectors require an explicit provider contract, opt-in settings, privacy review, template/consent requirements, delivery callbacks and retry semantics. GeM/other tender portals are manually referenced; the app does not scrape authenticated portals or submit bids.

INT-06 Maps are optional. Site coordinates may be entered manually and visits continue with GPS exceptions if maps/geocoding is unavailable. Browser geolocation must be tested on supported devices/HTTPS; external maps cannot guarantee directions or field verification. AI APIs and SDKs must not be installed or configured for this scope.

## 16 Nonfunctional acceptance targets
NFR-01 Proposed pilot design envelope: 100 active employees, 30 concurrent users, 100,000 leads, 25,000 accounts/sites combined, 250,000 activities and 5,000 tenders. These are sizing targets, not known AVI volumes. Validate with AVI before scaling commitments. Under representative staging load, warm paginated list/filter and normal save operations shall meet p95 of two seconds for server responses; dashboards p95 five seconds. File transfers and external APIs are measured separately and show progress. Measure from identified locations/devices and report test conditions.

NFR-02 Responsive layouts shall work from 360-pixel mobile width through standard desktop widths. Core online/offline flows shall be verified on current stable Chrome Android, Safari iOS, Chrome and Edge desktop at release. Target WCAG 2.2 AA for the core screens: keyboard access, visible focus, labels/error association, readable contrast, non-color-only status and accessible tables. Verify keyboard and screen-reader journeys, not only automated scans.

NFR-03 Proposed hosted service objective is 99.5 percent monthly availability excluding agreed maintenance, with transparent provider dependency reporting. No contractual guarantee is created by this SRS. Recovery, backup retention, storage durability and alerting must match the selected hosting plan and be measured in the pilot.

NFR-04 All mutations affecting money, ownership, submissions and approval state require transactional constraints and concurrent-request tests. No lost update, duplicate posting or half-created conversion is acceptable. Successful external sync is eventually consistent with visible status; local save shall not wait indefinitely for a provider. Minimum required offline rehearsal includes 20 queued visits/drafts with interrupted file upload, reordering, duplicate retries and a later scope revocation.

## 17 Data migration and initial configuration
MIG-01 Collect approved customer/contact, lead and product CSV templates. Run dry-run normalization and candidate-duplicate reports; do not merge customers automatically. Preserve source IDs, original created/received dates and import batch lineage. Reconcile row counts, rejected rows, ownership, open task counts and sample financial references before cutover. Imported historical records shall not generate a flood of retrospective SLA alerts.

MIG-02 Seed only synthetic demo users/data in development. Production bootstrap creates AVI organization, invited administrator and MD membership, then roles/permissions, territories, active members, sources, products, SLA settings, expense rules and approval routes. Expense submission remains blocked for categories with no approved rate/rule. No default production password and no hardcoded privileged email address.

MIG-03 Pilot cutover shall define data freeze, source checkpoint, migration dry-run sign-off, support owner and rollback criteria. Rehearse rollback without deleting accepted financial records: disable affected commands, retain events, restore tested backup where appropriate and reconcile provider side effects. Reimport must be repeatable using stored batch/source keys.

## 18 Implementation and testing sequence
Step 0 Product baseline. Review the decision register, confirm Phase 1 scope and mark defaults versus approved policy. Produce docs/requirements, ADRs, screen map, schema dictionary and a requirement/test matrix before feature code. If an existing repository is supplied, inspect its instructions and reuse compatible patterns. Do not build later-phase modules under the guise of scaffolding.

Step 1 Foundation and security. Implement login/invitations, organization membership, roles/scopes, resource registry, private file flow, audit, command envelopes and migrations. Test organization isolation, column mutation, direct API access, storage and inactive users before adding sales data. Add CI lint, typecheck, unit/database tests and build. Gate: PER-01 through PER-04, SEC-01 through SEC-03 and initial AC-01/02/17 pass.

Step 2 Customer and lead vertical slice. Implement accounts/sites/contacts, products/documents, unified lead capture, CSV import, duplicate review, assignment, attempts, tasks and conversion. Add mock IndiaMART adapter, replay handling and operations status. Gate: AC-03 through AC-07 and AC-21 pass; no separate IndiaMART screens. Demonstrate one manual inquiry and one IndiaMART inquiry traversing the same workflow.

Step 3 Opportunity and field slice. Implement stages, booking references, quote revision/discount tracking, attendance, visit plans/reports, GPS exceptions, limited offline outbox and daily activity. Gate: AC-08 through AC-11 and AC-18 pass; airplane-mode retry and two-device active-visit conflicts resolved without silent overwrites.

Step 4 Tender slice within Phase 1. Implement full tender registration through award/execution and EMD/PBG follow-up; add lot-level outcomes, immutable submission evidence and revised-date reminders. Gate: AC-12 through AC-14 and relevant security tests pass. Demonstrate a two-lot tender with one award, partial installation and an unreleased security after closure.

Step 5 Expense slice within Phase 1. Implement policy versions, travel, claims, receipts, duplicate flags, independent approvals, finance reductions, advances, partial reimbursements and reversals. Gate: AC-15/16/22/23 pass with concurrent payment and self-approval denial tests. A claim export and an external-accounting reference are visibly separate from payment.

Step 6 Reporting and readiness. Implement deterministic dashboards, metric definitions, alert jobs, exports, initial migration, performance and accessibility checks, backup/restore rehearsal and operator runbooks. Reconcile dashboard totals against fixture ledger/source records. Gate: all Phase 1 acceptance criteria pass; no open critical/high severity defects or undocumented access exceptions.

Step 7 Pilot and conditional live integrations. Run UAT with Sales Operations, field rep, manager, Tender Executive and Accounts; require business evidence for both tenders and expenses. Enable IndiaMART only after contract tests with authorized real sample data and replay recovery. Record unavailable providers as disabled with manual fallback and an outstanding integration gate. Live Zoho and communication connectors follow later change-controlled phases; a pilot fallback must not be called a completed live integration.

At each step Codex shall update the requirements matrix, migration instructions, test evidence and remaining decisions, then continue to the next unblocked step. Routine implementation choices do not require repeated approval. Ask only for decisions or credentials that change business authority, financial treatment, production access or third-party behavior; continue unrelated local work while waiting. Deployment/production changes follow the user's actual authorization in that implementation session.

## 19 Acceptance and requirement traceability register
Each scenario below is a minimum acceptance test, not a substitute for testing every numbered requirement. Link test files and run evidence to requirement IDs; expand parametrized role/scope tests across CRUD, commands, views, RPC and files. P1 denotes a release gate; LIVE denotes the conditional IndiaMART live gate.

| Test | Given and when | Required result and linked requirements |
| AC-01 P1 | Rep A requests Rep B's unshared lead, tender file and claim by guessed IDs or direct API | No data or existence leak; denied through UI/API/storage. PER-01/03, SEC-01/03 |
| AC-02 P1 | A user edits profile metadata, changes request organization or calls approval fields directly | No privilege gain, cross-organization linkage or forbidden field change. PER-01, DB-02, SEC-01/02 |
| AC-03 P1 | An IndiaMART fixture, telephone inquiry and CSV inquiry are imported | Same lead workspace, source filtering, history, task and conversion behavior; no IndiaMART module. LEAD-01/02, INT-01/02 |
| AC-04 P1 and LIVE | Same provider inquiry is delivered three times and during overlapping Pull/replay | One normalized inquiry, durable delivery logs, no duplicate lead/task; invalid payload quarantined. LEAD-03/04, INT-02 |
| AC-05 P1 | Same contact sends two distinct equipment requests | Reuse/link contact candidate; retain two inquiries until reviewed; fuzzy name alone does not merge. LEAD-03/04 |
| AC-06 P1 | Lead is reassigned after 20 hours and has no attempt by hour 24 | Original clock retained; one scoped escalation; view/dialer click does not count. LEAD-05/06, NOT-02 |
| AC-07 P1 | Two identical conversion commands run concurrently | One resulting operation, valid accounts/links, no partial duplicate conversion; same key/different payload conflicts. LEAD-07, ARCH-04 |
| AC-08 P1 | Opportunity skips demo and quotation and later changes closed state | Allowed open-stage path; won requires evidence; reopen requires permission; provisional excluded from confirmed sales. OPP-01/03 |
| AC-09 P1 | Approved discount quote changes price or terms | Prior approval invalid; immutable issued revision retained and approval rerouted. QUOTE-01 |
| AC-10 P1 | Two devices start a visit for the same employee; GPS is denied on one | One server-active visit; pending conflicting offline event; exception report allowed and not labeled verified. FIELD-01/02/03 |
| AC-11 P1 | Offline visit and receipt batch retries after disconnect with a conflicting edited parent | Exactly-once accepted operations; ordered parent/file sync; conflict visible; approvals remain online. FIELD-05/06 |
| AC-12 P1 | Tender deadline extends while reminders are queued | Prior date retained, current projection updated, obsolete jobs cancelled and correct new reminders emitted once. TEND-03, NOT-02 |
| AC-13 P1 | Tender has expired mandatory document or unreviewed deviation; user records submission | Readiness blocks unless an allowed independent waiver resolves it; non-waivable items block; accepted submission freezes evidence. TEND-04/05 |
| AC-14 P1 | Two-lot tender is technical-qualified/L1 on one lot, partially awarded and later closed | L1 never counts as award; lot results retained; no excess installation; security refund and collection alerts remain. TEND-01/06/07 |
| AC-15 P1 | Claimant including MD tries approving own claim or no alternate is configured | Denied; Pending Routing instead of automatic approval; deactivation reroutes pending work. EXP-02/07, PER-04 |
| AC-16 P1 | Claim includes mileage, receipt duplicate, cap exception and an old policy date | Decimal allowance correct under effective policy; duplicate flagged; exception requires authority; immutable snapshot. EXP-03/04 |
| AC-17 P1 | User opens a receipt URL without authorization and after signed-link expiry | Access denied; no public object path; staged/unsafe files unavailable. SEC-03/05 |
| AC-18 P1 | Employee is deactivated with a still-valid token and queued offline edits | Online business access fails; queued writes denied on reconnect; ownership retained/transferred; offline limitation documented. PER-04, FIELD-07 |
| AC-19 P1 | Fixture contains 100000 open pipeline at 40 percent and 200000 confirmed booking against 500000 target | Weighted pipeline 40000; target achievement 40 percent; no tender/order double count; zero denominator N/A. OPP-02/03, REP-01/02 |
| AC-20 P1 | Scoped CSV export contains text beginning with equals or plus and restricted customer rows | Formula-safe output, restricted rows absent, export audited; permitted CSV totals match drilldown. SC-19, SEC-04/06 |
| AC-21 P1 and LIVE | Provider returns timeout, rate limit, malformed record and expired credentials | Bounded retry/dead-letter, useful status, no leaked secrets; recovery/replay preserves identity. INT-01/02, NOT-02 |
| AC-22 P1 | Allowed claim is 10000, available advance applied is 3000 and two concurrent reimbursements request 5000 each | Net payable 7000; only one 5000 request succeeds; 2000 remains; no overpayment. EXP-05/06 |
| AC-23 P1 | Claim is reduced by finance, returned, revised, paid in parts and one payment reversed | Version approval correct, increases rerouted, originals immutable, duplicate payment rejected, balance restored correctly. EXP-02/05/06 |
| AC-24 P1 | Pilot dataset and supported devices exercise key workflows and restore | Meets declared latency/accessibility targets and RPO/RTO rehearsal; no missing stored evidence. NFR-01/02/04, SEC-09 |
| AC-25 P1 | Repository and deployment are inspected for AI features and later-phase leakage | No AI API/SDK, scoring, OCR, transcription, assistant or hidden external sending; tender/expense fully present. Section 2, INT-05/06 |

UAT exit requires acceptance by the designated business owners for Sales, Tender and Accounts; the owner and date shall be recorded rather than invented. Known low-severity defects may be accepted with workaround, accountable owner and follow-up date. Missing permissions, double payments, data loss, broken tender readiness or inaccessible Phase 1 modules are release blockers.

## 20 Decision register and change control
D-01 Confirm employee count, hierarchy, territories and whether ASM is a rep, manager or both. Until configured, own scope only; no inferred team approval rights.
D-02 Confirm IndiaMART API entitlement, provider account, Push/Pull availability and live test credentials. Default Disabled with mock/CSV available. Live gate remains open.
D-03 Confirm Zoho organization, data center, edition, contacts/items ownership and accounting object mapping. Default Phase 1 manual references and finance CSV; no live write.
D-04 Approve SLA timing/calendar, geofence radius/accuracy thresholds, GPS exception reviewer, attendance correction and offline lock duration. Proposed defaults in Section 3 remain configurable.
D-05 Approve expense categories, employee grades, mileage/allowance/cap/receipt rules, travel advance treatment, manager/finance limits and alternates. Default financial submission/approval blocked where configuration is absent.
D-06 Approve tender bid/waiver authority, document checklist ownership, submission evidence requirements, security custody and evaluation conventions. No inferred portal or bank authorization.
D-07 Confirm whether production distributor portal, serialized demo tracking or native mobile apps are wanted in later phases. Default excluded from Phase 1; internal channel account type retained.
D-08 Confirm booking, tax, revenue and credit attribution rules with management/Accounts. Default confirmed net bookings as operational sales, not statutory revenue.
D-09 Approve retention, hosting region, backup plan, upload scanning approach, privacy notice and incident owner before using real production records. Synthetic pilot can proceed while decisions are pending.
D-10 Confirm branding assets, preferred terminology, accessibility needs and data migration sources. Use a simple AVI SalesConnect wordmark until approved assets are supplied; do not invent a corporate logo.

Record each resolved decision with owner/date, specification version and linked implementation change. Changes to scope, approval authority, financial treatment, external sending or integration system of record require an updated requirement and acceptance test. Keep the SRS, implementation prompt and requirement matrix synchronized; latest explicit business direction wins over older assumptions.

## 21 Sources and technical verification notes
Business source: Suggest App Features, conversation 6b069f07-10a0-83e8-afb3-b37f8ba12fa0, retrieved 25 November 2026. Latest user scope correction is authoritative. Prior feature suggestions are design input, not evidence that integrations or internal policies are configured.

Technical references checked 25 November 2026. Recheck current documentation and actual account capabilities at implementation; this SRS deliberately does not prescribe undocumented endpoints or API limits.
R1 Supabase changelog https://supabase.com/changelog.md
R2 Supabase Row Level Security https://supabase.com/docs/guides/database/postgres/row-level-security
R3 Supabase Storage Access Control https://supabase.com/docs/guides/storage/security/access-control
R4 IndiaMART Leads API https://help.indiamart.com/knowledge-base/im-lms-leads-api/
R5 IndiaMART CRM Pull API integration https://help.indiamart.com/knowledge-base/lms-crm-integration-v2/
R6 Zoho Books Estimates API https://www.zoho.com/books/api/v3/estimates/
R7 Zoho Books OAuth https://www.zoho.com/books/api/v3/oauth/
R8 Zoho Books Expenses API https://www.zoho.com/books/api/v3/expenses/

Reference numbering points to platform capabilities only. Security, workflows, schema design, thresholds and acceptance targets elsewhere are proposed application requirements and must not be attributed to these vendors as AVI-specific recommendations.


END OF STANDALONE DEVELOPMENT PROMPT
