# Development and operations

> Some entries below describe earlier increments and may be superseded by later entries. For the current gate and session handoff, see [PROGRESS.md](PROGRESS.md) and [ROADMAP.md](ROADMAP.md).

Prerequisite: Node.js 20 or later. Run `npm ci` then `npm run check` from the repository root. This runs syntax validation, domain unit tests, and the first migration against an isolated in-memory PGlite PostgreSQL instance with synthetic fixture identities. The fixture substitutes a minimal `auth.uid()` and is not the Supabase authentication or storage service. No real customer or employee data is used.

The pinned Supabase CLI creates local migrations with `SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration new <name>`. The local Docker service was unavailable in this environment, so the migration has not been applied to the complete local Supabase stack. Before depending on it, start an isolated Supabase environment, discover the installed CLI commands with `npx supabase --help`, apply and reset migrations there, run API/RLS/storage tests and advisors, and generate database types. Do not point the local setup at a hosted project without authorization. No Supabase project configuration or seed exists yet.

There is no application server, UI, production bootstrap, backup or restore procedure. Do not use this project with real data. Role grants and a permission helper exist locally, but invitations, role administration, file access, business command handling and transactional audit still need implementation and verification before domain records are exposed. The user-created AVI Sales Connect project (ap-southeast-2) has the seven foundation migrations applied. It is not yet configured for production or real data. Hosted migration versions are reflected in local filenames. Live IndiaMART, Zoho, production hosting, real-data migration, UAT and recovery drills remain separate gates.


## Local web sign-in

Copy `.env.example` to `.env` and set the public Supabase project URL and publishable key; never add a service or secret key. Run `npm ci`, `npm run dev`, and open the local address shown. Access to organization data requires an active membership provisioned by an administrator. Invite-only signup settings have not been verified and must be configured before use. No production bootstrap or invite workflow exists yet, so a new empty project cannot sign in until those are implemented. Staff and administrators sign in with their email address and password. Invitation and recovery links use the configured Supabase Auth redirects. Confirm email delivery and a complete recovery journey before relying on them for pilot support. The web app supports customer intake, manual leads, lead follow-up and viewing converted opportunities. PWA behavior remains outstanding. Browser-based accessibility, real Auth and deactivated-session testing remain outstanding.

Local `.env` now contains the project URL and a publishable key (no service key); it is excluded from Git. The sign-in screen was visually checked locally, during the initial authoring session. See the acceptance matrix for later sign-in evidence.

The customer and lead screens use the `customer_lead_intake` migration installed on AVI Sales Connect. Access requires an active membership and effective `account.read`, `account.create`, `lead.read` or `lead.create` permissions as appropriate. The migration registers those permission codes. Assigning grants to real employees and testing the signed-in UI require provisioned identities. The test suite provisions synthetic identities in the isolated database.

## Provision an intake staff member

Create or invite the approved employee identity through Supabase Auth. Use its Auth user UUID, the app organization UUID, the person's approved display name and a unique request UUID with the following operator-only SQL command. The command requires an existing Auth identity and creates the profile if needed, active membership, an Intake Staff role grant and audit event in one transaction. The role is restricted to owned customer and lead intake, follow-up, conversion and opportunity reads. It includes no approval authority.

```sql
select private.provision_intake_staff(
  '<app organization uuid>'::uuid,
  '<auth user uuid>'::uuid,
  '<approved staff display name>',
  null,
  gen_random_uuid()
);
```

For AVI Sales Connect the app organization UUID is `e429cc69-f227-47ef-8d5d-edb87de37ba7`. The provisioning command rejects existing memberships. Use a reviewed operator change for existing members until administrative screens are available. Browser roles cannot call the command. The hosted project had zero Auth identities at setup. See the acceptance matrix and progress log for current hosted verification.

Run `npm run test:hosted` with the AVI project URL and publishable key in the ignored `.env` to check anonymous HTTP access. These checks make synthetic requests and expect denial. They require network access to Supabase. The new pipeline permission is included in the Intake Staff role. Actual staff invitations, sign-in and acceptance testing remain outstanding.

## Netlify configuration (not deployed)

The root `netlify.toml` builds with Node 22, publishes `apps/web/dist`, provides a non-forced SPA rewrite and sets baseline browser security headers. It permits connections to Supabase's `*.supabase.co` hosts; a custom Supabase domain or a future integration needs a reviewed, narrowly scoped content-security-policy update before use. Location is permitted only to the site itself; capture and consent workflows are not implemented. Deploy previews and separate environments require provider configuration, separate Supabase projects and public build variables; they are not established by this file. Do not place secret keys in frontend environment variables. Test security headers, Auth recovery, nested paths and integration connections on an authorized staging deployment before relying on this configuration. No site has been deployed by adding this file.

Netlify documentation consulted 2026-11-25: https://docs.netlify.com/build/configure-builds/file-based-configuration/ and https://docs.netlify.com/manage/routing/headers/.

## Disposable local Auth and API security test

The opt-in `npm run test:local-auth` creates synthetic identities, organizations, permissions and audit records. Run it **only against a disposable local stack**, never a shared development or hosted database; synthetic records persist until the disposable stack is reset. Start a separate temporary project containing copies of `supabase/migrations` with the pinned CLI. Check that the local stack is healthy and that the database container belongs to that project. Set `CONFIRM_DISPOSABLE_LOCAL_SUPABASE=yes`, `LOCAL_SUPABASE_URL` to its HTTP loopback API URL, `LOCAL_SUPABASE_ANON_KEY` and `LOCAL_SUPABASE_SERVICE_KEY` to its local-only keys, and `LOCAL_SUPABASE_DB_CONTAINER` to its database container name. Supply secrets through a protected environment, not source control, command transcripts or output. The test rejects non-loopback URLs but this is not a substitute for verifying the container. It uses an operator connection to create synthetic fixtures and changes no hosted resources. The test verifies actual password authentication for staff and administrators, record isolation, permissions and scope, concurrent retries, conflicting-key rejection, private attachment restrictions, expired provider-session denial and inactive membership denial with an existing token. Full scenario coverage is tracked in the acceptance matrix.

On 2026-11-25 Docker Desktop was reachable outside the restricted process; the isolated stack was initialized in `/private/tmp/avi-salesconnect-local`. The first Auth test found TOTP disabled by the generated local defaults. TOTP was enabled in that temporary configuration, the isolated stack restarted, and the test passed. This setting does not configure hosted Auth. The local `supabase db reset --no-seed` targeted port 54322 and successfully reapplied all 11 migrations. A missing seed warning on initial startup is expected; the test creates synthetic fixtures explicitly.

The file staging migration is fail-closed metadata only. It does not create a bucket or allow users to upload or retrieve files. The local integration test also inserts synthetic staging metadata and checks a size rejection, append-only enforcement and private API denial; it does not upload files or exercise Storage. Do not interpret this as a file-security release gate. For recovery, follow the file staging design in `docs/schema.md`; do not remove records or objects from a non-disposable environment without a reviewed recovery plan.

### Verify quarantine and client database types

Copy the latest migrations into the same disposable project and run `SUPABASE_TELEMETRY_DISABLED=1 npx supabase db reset --no-seed --workdir /private/tmp/avi-salesconnect-local`. Confirm the reset targets the loopback database and that the project contains only synthetic data. Run the opt-in Auth test above. It writes a synthetic object to the private quarantine bucket with the test service credential, checks that even the record owner cannot upload to the exact reserved path or mint an upload link, and checks that no application session can read or sign the object. The fixture also checks the public route, denial of overwrite and removal by the owner, and retained bytes. On success it removes the synthetic object through the Storage API. If the test stops before cleanup, use the trusted Storage API to remove its synthetic object in the disposable project only.

Run `SUPABASE_TELEMETRY_DISABLED=1 npx supabase db advisors --type security --level warn --fail-on warn --workdir /private/tmp/avi-salesconnect-local`. To review type drift, run `SUPABASE_TELEMETRY_DISABLED=1 npx supabase gen types typescript --schema public --workdir /private/tmp/avi-salesconnect-local` and compare the result to `packages/domain/database.types.ts`. The local generator includes `ComputedFields` metadata and can omit PostgREST version metadata. Keep the public table and RPC contracts aligned. Generate client types only for the exposed schema.

Production file handling still requires a chosen scanner, server-side byte checks, secure promotion, scoped version retrieval and a storage/database restore rehearsal. Preserve quarantine access restrictions during a repair and use Storage APIs for object operations. See [schema and recovery](schema.md#private-quarantine-bucket-2026-11-25).

## Repository local configuration

The checked-in local configuration uses Postgres 17, disables automatic exposure of newly created tables, and disables public signup. The app can be tested with email/password alone. It identifies the disposable SalesConnect stack as `avi-salesconnect-local` and uses ports 54321 for the API and 54322 for the database. Check for local port conflicts before starting. For development sign-in, use local synthetic user provisioning and the local public API settings in `.env`. Keep operator credentials outside Vite and Git. Local configuration does not configure the hosted project.

### Synthetic staff and browser checks

After starting the stack from this repository, run `npm run dev:bootstrap -- --disposable` to create a synthetic organization and one intake user. The command checks the running database container's project and workspace labels and accepts only the fixed loopback API address. Each successful run prints disposable credentials to the local terminal. Do not use them outside this stack.

With Chrome installed and port 5173 free, run `npm run test:e2e`. The test server uses the local API and receives only the local browser key. Each test creates a synthetic staff account and checks email/password sign-in, linked customer and lead creation, refresh and sign-out. The three projects exercise desktop, tablet and phone viewport sizes. The tests do not require a live provider or hosted credentials.

For an authorized staff pilot, configure the cloud sign-in URL as the Supabase Auth Site URL and verify the exact allowed redirect and a working invitation delivery channel. Invite approved staff using Supabase Auth, then provision their existing Auth user IDs into the intended organization with the least-privilege intake role. Verify password setup and organization access with the recipients. The local test can exercise a disposable invitation without delivering email using `npm run dev:bootstrap -- --disposable --invite-link`.

### Private attachments and scanner verification

The application file handler remains disabled unless explicitly enabled in the Edge Function environment. Set `AVI_PRIVATE_FILES_ENABLED=true` and `AVI_FILE_ALLOWED_ORIGIN` to a single approved app origin in a staging environment. For a scanner, set `AVI_FILE_SCANNER_URL` to an approved HTTPS scan endpoint and store `AVI_FILE_SCANNER_TOKEN` as a server-side secret. The endpoint receives the bounded bytes and their SHA-256 and must return JSON containing `sha256`, `verdict` (clean or rejected), and `version`. A timeout, digest mismatch or missing scanner keeps the upload in quarantine. Retry the original file after the scan lease expires. Avoid download URLs or attachment content in logs.

The repository includes a candidate ClamAV adapter under `services/file-scanner`. It binds its HTTP listener to loopback and requires a shared token of at least 32 characters. Run a private same-host daemon with a Unix socket or loopback port. Put an approved HTTPS reverse proxy in front of the scanner adapter. Before production, approve ownership and location, keep signatures current, enable limit-exceeded detection, set the stream limit for the application's supported sizes, and establish scanner monitoring and file retention. The local candidate's default container configuration is evidence for synthetic tests only.

For a disposable test, run the private Edge function locally with the loopback app as its allowed origin and no scanner settings. Run the local Auth/API test and the Chrome tests with `TEST_LOCAL_FILE_EDGE=yes` to exercise the real quarantine endpoint and browser upload. For a separate real-engine test, run ClamAV on loopback and set `AVI_TEST_CLAMD_PORT` for `npm run test:clamav`. Use only synthetic fixtures and the inert EICAR diagnostic. These checks do not deploy the worker or authorize real files. Stop the disposable scanning processes after verification.

### Release the email/password sign-in change

Apply the database migrations, including `20261126105358_email_password_access.sql`, before releasing the frontend. If the pilot uses attachments, deploy the matching private file Edge function before the web release. For forward recovery, redeploy an email/password-compatible app and file handler and correct the affected authorization function in a new migration while preserving grants and audit history.

For an account enrolled before this change, Supabase Auth still checks the verified factor when changing or recovering the password. A provider administrator can review and remove legacy factors with the supported Auth controls when the organization authorizes that change. Verify password recovery on an approved test identity without a factor. [Supabase Auth password update checks](https://github.com/supabase/auth/blob/master/internal/api/user.go)

### Visiting-card lead intake

Keep the `visiting_card_lead_intake` migration and deploy the upload-only `scan-visiting-card` Edge function with JWT verification. Set `AVI_CARD_ALLOWED_ORIGIN` if the production CRM origin differs from the AVI SalesConnect Netlify pilot. The function limits each member to 40 card uploads per hour.

The web build copies the pinned Tesseract worker, WebAssembly core and English recognition model into `/card-ocr/` on the CRM origin. The browser loads those files when a rep chooses Extract Details and reads the prepared front and optional back there. The feature requires no OCR provider credential. Keep worker and model files on the CRM origin and preserve the worker and WebAssembly CSP permissions. Test OCR with a clear two-sided synthetic card and keep the manual-review path available. [Tesseract.js local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)

The private `lead-cards` bucket retains the exact original images at save time. Keep card files isolated from direct download. Review orphaned uploads through an authorized server process and reconcile their paths against attachment records before cleanup. Downloads require integration with the approved clean-file workflow.

For local verification, serve Edge functions with the loopback app as `AVI_CARD_ALLOWED_ORIGIN`, then set `TEST_LOCAL_CARD_EDGE=yes` when running Playwright. The card test runs real browser OCR on synthetic images, checks that extraction makes no upload or external request, and verifies the original upload after save.

### Customer consolidation and User Management

Apply the unified customer/lead migration, then the User Management migration. Deploy the `admin-users` Edge function with JWT verification and set `AVI_ADMIN_ALLOWED_ORIGIN` if the application uses an origin other than the AVI Netlify pilot. The existing Supabase project secrets supply the service credentials. Enable `VITE_USER_MANAGEMENT_ENABLED` in the Netlify build after the migration and the endpoint are active. Keep Auth credentials in the server function and share temporary passwords via the organization’s approved private process.

The first password change activates a newly provisioned membership. Admin password resets temporarily suspend access and invalidate old sessions for that Auth identity. A reset interrupted between Auth and workspace updates can be retried after the three-minute lease. This workflow restricts administrator password reset to single-organization Auth identities and protects self-deactivation and self-demotion. Existing staff handover remains available if work should be reassigned first.
