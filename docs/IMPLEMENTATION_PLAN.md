# AVI SalesConnect implementation plan

The [current master development brief](MASTER-DEVELOPMENT-PROMPT-2026-11-26.md) governs release scope and names the GitHub and Supabase projects. The [detailed SRS](SRS.md) supplies compatible constraints and acceptance detail. All nine milestones are part of Phase 1.

| Milestone | Work and acceptance gate |
| --- | --- |
| 1. Foundation | Restore the existing source and reproducible local environment. Verify active membership, MFA, role actions and record scopes. Finish audited administration, private file lifecycle and safe bootstrap. Exercise grants, real Auth, API and Storage, stale sessions, concurrent commands and fresh migrations. |
| 2. CRM | Complete customer, contact, equipment, lead and task records with assignment and activity history. Test scoped CRUD, duplicate review, multi-product leads, qualified follow-up, lost reasons and quotation request creation. |
| 3. Field sales | Persist attendance, visit plans, GPS events and exceptions, and daily sales reports. Verify consent, role scope, multiple linked leads, offline replay and conflict handling on mobile. |
| 4. Commercial operations | Implement product catalogue, quotation revisions and discount approval, sales-order tracking, distributor access and demo custody. Verify financial field restrictions, version-bound decisions and order attribution. |
| 5. Tenders | Implement lots, compliance, checklists, deadlines, corrigenda, bid submissions, guarantees, EMD and execution. Verify append-only history, deadline replacement, tender exports and revenue deduplication. |
| 6. Expenses | Implement approved policy versions, travel, mileage, receipts, manager and finance actions, and reimbursement ledgers. Verify no self-approval, exact-decimal balances, approvals tied to claim versions and replay-safe payment recording. |
| 7. Integrations | Verify provider contracts before implementing live adapters. Implement shared IndiaMART intake, reporting for unconfigured connections, Zoho reads and approved write boundaries, Maps and notifications. Test failed sync, repeated ingestion and recovery. |
| 8. Reporting | Implement actual record-based dashboard filters, drill-downs, reports, targets and global search. Verify metric definitions, territory isolation, export rights, pagination and deduplication. |
| 9. Release readiness | Run the full security, browser, responsiveness, PWA and acceptance suite. Rehearse backup and recovery and prepare versioned staging and production configurations. Record UAT evidence and obtain authorization for any production deployment or live database changes. |

The [engineering roadmap](ROADMAP.md), [acceptance matrix](acceptance-matrix.md) and [progress log](PROGRESS.md) track implementation dependencies, evidence and unresolved work. Before writing a module, update its relational model and permission rules, then implement and verify database behavior before exposing it in the UI.

## Tender and expense acceptance

The security milestone is the dependency for both workflows. In particular, a submitted tender or claim must reference an immutable, authorized file version. The operator must be able to explain who acted, which version they acted on, and what a retry did.

| Workflow | Build and verify in order |
| --- | --- |
| Tender preparation | Register one portal/reference per organization. Add lots and current deadline versions. On a corrigendum, retain the prior version and cancel its pending notifications in the same transaction. Validate mandatory checklist items, usable evidence and independent waiver authority before allowing preparation to advance. |
| Tender submission and execution | Bind the authorized submission to the exact reviewed lots, documents and deviations. Store acknowledgement and actual submission time. Verify mixed lot awards, incremental dispatch/installation/acceptance, and continued reminders for unreleased EMD or guarantees after closing. |
| Expense preparation and approval | Publish effective-dated configured policies. Freeze amounts, rule versions and authorized receipts on submission. Select eligible approvers explicitly and leave unrouteable claims waiting for routing. Verify that two people cannot approve with an outdated version or approve their own expense. |
| Expense settlement | Apply confirmed advance balances and compute payable amounts under locks using exact decimal arithmetic. Record partial payments and reversals as immutable transactions with evidence. Verify concurrent reimbursements, duplicate prevention, reconciliation and finance export permissions. |

Expense rates, limits, categories, alternates and tender bid/waiver authorities require AVI's approved policies before a real approval or submission. The implementation and synthetic tests can use separately labeled fixtures. Pending work remains within Phase 1.

Use the [AVI SalesConnect Gemini Canvas reference](https://gemini.google.com/share/20af04e7b3cb9b8bd6a06ca682b1c250) for the navigation layout, header, dashboard cards, pipeline panel and the lead, tender, expense and administration screen layouts. Use the written SRS for module behavior, authorization and acceptance. The reference's demonstration counts and identities do not seed the application.
