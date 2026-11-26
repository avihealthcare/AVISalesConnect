# Deployment guide

The repository is configured to build a static Vite application on Netlify. The root configuration specifies the output directory, SPA routing and baseline security headers. Deployment and production database changes require explicit authorization.

For approved staging, connect the requested GitHub repository in Netlify and assign a separate staging Supabase project. Set the public API URL and publishable key for the corresponding build context. Configure exact Supabase Auth site and recovery redirect URLs. Verify sign-in, MFA, recovery, direct navigation and refresh on a nested route, and the response headers. Verify PWA installability once implemented. Use environment-specific variables and confirm that previews cannot reach production records.

For an authorized AVI Healthcare subdomain, add the intended subdomain in Netlify and use the DNS record it specifies. Confirm certificate issuance, HTTPS and the matching Supabase Auth redirect allowlist. Test approved ingress and verify any required content-security-policy changes before release.

See the [local and hosted runbook](runbooks.md), [security guide](SECURITY.md) and [progress log](PROGRESS.md). Staging and production deployments remain outstanding.
