# Business rules

- Keep one inquiry pipeline across all sources. Record source identity, first attempts, ownership changes and audit history. Check potential duplicates before merging and retain the source history. A qualified active lead needs a next action and a lost lead needs a reason.
- Capture employee location only at explicit attendance or visit actions. Record GPS accuracy and exception reasons. Preserve offline capture time separately from server receipt time. Visits may link multiple leads and contacts.
- Store money as fixed-precision decimals. Tie financial decisions to immutable approved versions. Prevent self-approval, duplicate payment posting and duplicate revenue from linked tenders, opportunities and orders.
- Preserve tender deadline history across corrigenda and replace stale reminders. Link awards to actual orders and retain unresolved securities and delivery obligations after the tender closes.
- Resolve expense rates from the applicable approved policy version. Claims, advances, approval decisions, reimbursements and reversals need independent authorization and auditable balances.
- Restrict access by membership, module permission, record scope and sensitive field policy. Preserve evidence and authorship through reassignment and deactivation.

The [master brief](MASTER-DEVELOPMENT-PROMPT-2026-11-26.md), [SRS](SRS.md) and [decisions](DECISIONS.md) govern individual rules. Many workflows above remain in development. See [progress](PROGRESS.md) for verified behavior.
