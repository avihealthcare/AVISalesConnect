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
