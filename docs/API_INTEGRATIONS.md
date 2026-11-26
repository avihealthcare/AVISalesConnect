# API integrations

| Integration | Ownership and required verification | Status |
| --- | --- | --- |
| IndiaMART | Import authorized inquiry data into shared leads. Confirm account API entitlement, polling limits, payload and stable external ID. Replay the same input in tests and reconcile duplicates and failures. Provide CSV fallback when unavailable. | Live connection and CSV import pending |
| Zoho Books | Zoho owns official estimates, orders, invoices and payment records. Verify the account region, organization, OAuth scopes, refresh and rate limits. Confirm record mapping, replay, reconciliation and conflict handling. Official writes require explicit authorization. | Adapter, configuration and live verification pending |
| Google Maps | Verify deployment referrer restrictions, permitted API feature and limits. Visits also need a browser geolocation exception workflow. | Pending |
| Email and optional WhatsApp | Approve sending identity, routing, templates and user preferences. Verify retries and delivery outcomes using the authorized providers. | Pending |

Provider secrets belong in trusted backend configuration. Integration health should distinguish unconfigured credentials, unverified configuration, sync failures, and successful confirmed syncs. See [scope reconciliation](scope-reconciliation.md) and [business rules](BUSINESS_RULES.md).
