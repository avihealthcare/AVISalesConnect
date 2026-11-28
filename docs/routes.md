# Proposed route map

Routes are a design outline, not implemented screens. All require an active authorized session unless stated otherwise.

- /sign-in and /recovery: invite-based access and recovery
- /: scoped home and dashboard
- /leads and /leads/:id: shared intake, review, activities and conversion; source is a filter
- /customers and /customers/:id: accounts, sites, contacts and equipment
- /opportunities and /opportunities/:id: sales stages, evidence and quote references
- /activities and /field: tasks, attendance, plans and visits
- /products: catalogue and document library
- /tenders and /tenders/:id: tender register and full tender workspace
- /expenses: trips, claims, reviews and reimbursement register
- /reports, /operations and /settings: permission-scoped reporting, integration health and administration

Detailed screen requirements are SC-01 through SC-19 in requirements.md. Final routes must follow the full screen register and authorization map.

The pilot sidebar currently switches workspaces within the main application. It includes lead CSV preview/import, distributor accounts, customer sites and contacts, installed equipment, products, personal attendance and visit work, customer-linked tasks, external quote revisions and order references, demo records, tenders, travel and expense claims, personal targets and source/stage reports. Dedicated detail URLs from the proposed route map still require implementation.

Leads now opens the table or Kanban workspace, with filtered queues and record detail tabs. The Lead Settings action exposes configuration to authorized users in the same workspace. The public sign-in path and the account/customer and opportunity workspaces keep their existing entry points.

Leads → Add New Lead offers Manual Entry and Scan Visiting Card. Tesseract.js reads the prepared card images in the browser using assets served by SalesConnect. On save, the authenticated `POST /functions/v1/scan-visiting-card` endpoint accepts the original front and optional back as multipart files, with the organization in `x-avi-organization` and `upload` in `x-avi-card-action`. The Leads Documents tab lists retained card sides.

The CRM resolves `/customers`, `/customers/sites` and `/customers/contacts` to the Customers module. Legacy customer navigation aliases resolve to the same workspace. `/leads/{id}` loads a directly linked record through the lead visibility command. `/users` is limited to organization administrators. The signed-in workspace checks module access before rendering direct routes. `admin-users` is the Supabase Edge endpoint for POST creation and PATCH access, activation and password changes.

### Field Operations

- `/attendance` shows the current working day, monthly history and correction requests.
- `/visit-planner` shows day, week and list views. Today's plans can open `/field-visits/:planId` for check-in.
- `/field-visits` shows visits, meeting reports and Daily Sales Reports.
- `/tasks` shows personal and scoped team follow-ups.
- `/settings` includes the Field Operations policy. Customer 360° and lead detail show scoped linked field records.
