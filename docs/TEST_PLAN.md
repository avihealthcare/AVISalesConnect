# Test plan

| Layer | Verification |
| --- | --- |
| Unit and local database | Run `npm run check` for domain rules, migration-level fixtures, TypeScript and web production build. |
| Full local Supabase | Reset migrations in a disposable environment and run the opt-in Auth, API and Storage suite. Check MFA, direct access denial, scope across users and organizations, retries, private objects and deactivation. Inspect migration and security advisor results. |
| Browser | Cover sign-in and MFA, browser recovery, all primary create and approve workflows, mobile touch controls, geolocation exceptions, offline data, and installability at supported viewport sizes. Run `npm run test:e2e` with local Supabase and Chrome for the implemented sign-in, MFA, customer and lead workflow at three viewport sizes. The desktop suite also checks a real local invitation link, password setup and the first MFA prompt. Recovery, other modules and broader browser coverage remain pending. |
| Providers | Verify real contracts in approved staging. Test failure reporting, duplicate prevention, expired credentials, authorized mapping and rate limits before live activation. |
| Release acceptance | Run the complete requirement scenarios and role-based UAT, restore a database and file snapshot, and record either evidence or an open issue for every case. |

Use only synthetic fixtures outside approved environments. The [acceptance matrix](acceptance-matrix.md) and [progress log](PROGRESS.md) record current results. See [the test runbook](runbooks.md) for local commands and environment requirements.
