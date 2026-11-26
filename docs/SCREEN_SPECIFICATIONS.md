# Application design system and screen specifications

The [master brief](MASTER-DEVELOPMENT-PROMPT-2026-11-26.md) defines the navigation, brand and modules. The [SRS screen register](SRS.md#6-screen-specifications) defines the workflow details. Use the [route map](routes.md) to locate the planned screens and the [permission matrix](permissions.md) to determine visibility and available actions. This is the target design for the shared app shell and its components. The current sign-in and intake screens are an earlier implementation.

## Brand and theme

Display AVI SalesConnect and AVI Healthcare Pvt. Ltd. in the sign-in and application shell. Provide authorized logo configuration and a text fallback. Store custom logos through the approved file lifecycle. Use the same Lucide icon and text label for a given action across layouts.

Use these initial design tokens for the Tailwind and shadcn/ui theme. Values are reversible implementation defaults. Recheck rendered contrast for disabled, hovered and selected states before marking the design verified.

| Token | Light | Dark | Use |
|---|---|---|---|
| Canvas | `#F3F6FA` | `#0A1524` | Page background |
| Surface | `#FFFFFF` | `#122238` | Panels, menus and forms |
| Text | `#10243A` | `#ECF3FA` | Primary content |
| Secondary text | `#4C6075` | `#B2C2D3` | Details and field help |
| Brand navy | `#102C4B` | `#102C4B` | Navigation and branding with white text |
| Action blue | `#005FA8` | `#79BFFF` | Links and primary actions |
| Control border | `#667E96` | `#8097AE` | Input boundaries |
| Success | `#146346` | `#6CE1AC` | Completed and successful |
| Pending | `#8A4B00` | `#FFBB73` | Pending and approaching deadlines |
| Critical | `#A72634` | `#FFA4AA` | Overdue, rejected and validation errors |
| Inactive | `#4C6075` | `#B2C2D3` | Closed and inactive |

Use white text on the light action fill and canvas-colored text on the dark action fill. Pair color with a plain-language status label. Keep the focus outline distinct from the control border. Use native system typography, a 16 px default body size and tabular numerals for metrics and amounts. Use a 4 px spacing scale, 8 px control radius and 12 px panel radius. Primary mobile controls have a minimum 44 px touch target.

## Application shell

- At desktop widths, use a collapsible left sidebar. The top bar contains global search, notifications and the account menu. Use breadcrumbs on record detail pages and maintain a clear main heading. Show only modules the user can access. Search, unread counts and dashboard values use the same access rules as the underlying records.
- At phone widths, use Home, Leads, Visits, Tasks and More in the bottom navigation, subject to permission. Expose authorized quick actions for adding leads, checking in, recording visits, adding hospitals and contacts, submitting expenses and scheduling follow-up. Keep core form actions visible near the end of the form and account for the phone safe area.
- Preserve entered data through transient failures and show whether a save succeeded. Only the approved offline workflows use local drafts. Surface pending sync and conflicts alongside the affected records.
- Honor the system color preference on first use and allow an explicit light or dark preference. Keep the theme preference on account switch while clearing prior account data according to the SRS.

## Shared screen patterns

| Pattern | Components and required states |
|---|---|
| Record list | Search, relevant filters and pagination; loading, no records, no matching records, and retryable failure. Include a visible clear-filters action when filters are active. Use a table for comparable columns and a compact list on phones when columns do not fit. |
| Record detail | Record heading, current status, permitted actions and scoped related data. Inaccessible and unavailable IDs use the same screen state. Display timestamps with their timezone when deadlines or audit history depend on it. |
| Create and edit | Persistent labels, validation near each field, required indicators, inline help where rules affect input, a save-in-progress state and an explicit success or failure message. On a version conflict, preserve the user's input and show the current server record before a retry. |
| Approve or post | Show the exact revision, totals and required reason before confirmation. Disable repeat submission while pending and display the recorded outcome or retryable error. |
| Attachment | Show accepted types and size before selection. Distinguish uploading, awaiting scan, rejected and available. Show download only for an authorized, available file version. |
| Dashboard and report | Show metric definition, scope, period and freshness. Provide accessible text or a table for chart values. Show zero only when an authorized query completes with zero results. |

Use native controls where suitable. Verify meaningful accessible names, keyboard traversal, focus return after dialogs, label and error associations, screen reader status announcements, and reflow at a 320 CSS px viewport. Also exercise phone touch targets, compact tables and both color themes. These checks remain acceptance criteria for the implemented UI.
