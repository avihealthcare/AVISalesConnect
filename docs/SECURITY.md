# Security

Published application data must enforce authentication, active organization membership, action authorization and record scope at the database or backend. Review the [permissions](permissions.md), [database schema](schema.md) and [acceptance matrix](acceptance-matrix.md) together.

Privileged commands must use an effective role and MFA, validate the submitted action and state, and write redacted append-only audit events where material. Browser configuration uses the publishable key only. Audit, operation receipts, filenames and unscanned bytes remain behind restricted boundaries. Protect confidential files with checked parent scope and short-lived signed URLs once publication is implemented.

Disable self-registration for staff deployments. Verify cross-organization and cross-territory denial, stale-session denial, distributor restrictions, sensitive fields, export rights, credential rotation and storage protection. Keep secrets and real data out of the source repository. Take independent backups of PostgreSQL and Storage objects and verify an end-to-end restore under staging conditions.

The current implementation provides partial foundation controls only. Use [progress](PROGRESS.md) for evidence and open work.
