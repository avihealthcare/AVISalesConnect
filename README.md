# AVI SalesConnect

AVI Healthcare's sales operations application is in foundation development. The existing web app supports sign-in, authenticator MFA, password recovery, and initial customer and lead workflows. The full Phase 1 release, production deployment and external connections are pending. Use synthetic data in development.

## Local development

Use Node.js 22.12 or newer and Docker. Run `npm ci` and `npm run check` from the repository root. To run Supabase locally, check that the configured local ports are free, then run `npx supabase start`. Copy `.env.example` to `.env`, fill in the local API URL and its browser publishable key, and run `npm run dev`. Sign-in requires a provisioned local Auth user with an active membership. The [local test runbook](docs/runbooks.md) explains synthetic accounts and the opt-in Auth, API and Storage test.

The [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [entity relationships](docs/ENTITY_RELATIONSHIPS.md), [permission model](docs/permissions.md), and [design system](docs/SCREEN_SPECIFICATIONS.md) describe how the app is built. See the [current master brief](docs/MASTER-DEVELOPMENT-PROMPT-2026-11-26.md), [detailed SRS](docs/SRS.md), and [progress log](docs/PROGRESS.md) for the full scope and verification status.
