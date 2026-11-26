MASTER DEVELOPMENT PROMPT – AVI SALESCONNECT
1. Project Overview
Act as a senior full-stack software architect, UI/UX designer, database architect, cybersecurity engineer and application developer.
Develop a complete, production-ready, scalable Lead Management and Field Sales Management application called:
AVI SalesConnect
Company: AVI Healthcare Pvt. Ltd.
Industry: Medical Equipment Manufacturing and Sales
AVI Healthcare manufactures and markets medical equipment, including:
* ICU Ventilators
* Transport Ventilators
* Infant Radiant Warmers
* Infant Incubators
* Transport Incubators
* Bubble CPAP Systems
* LED Phototherapy Units
* Neonatal Medical Equipment
* Medical Accessories and Consumables
The application shall manage the entire sales lifecycle from initial customer inquiry to quotation, demonstration, negotiation, order confirmation and payment follow-up.
It shall also manage field sales activities, employee attendance, hospital visits, government tenders, distributors, travel expenses, sales targets and management reporting.
The application must be simple enough for field salespersons to operate with minimum data entry while providing comprehensive visibility to management.


2. Technology Stack
Use the following technology stack:
Component	Technology
Frontend	React with TypeScript
Build framework	Vite
UI framework	Tailwind CSS
UI components	shadcn/ui
Icons	Lucide React
Backend	Supabase
Database	PostgreSQL
Authentication	Supabase Auth
Database security	Supabase Row Level Security
File storage	Supabase Storage
Backend functions	Supabase Edge Functions
Data fetching	TanStack Query
Form management	React Hook Form
Form validation	Zod
Charts	Recharts
Routing	React Router
Hosting	Netlify
Source control	GitHub
Maps	Google Maps API
Accounting integration	Zoho Books API
Lead integration	IndiaMART API
Testing	Vitest and Playwright
Mobile support	Progressive Web Application
Develop a single responsive application supporting desktop, tablet, Android and iPhone browsers.
The application must be installable as a Progressive Web Application on supported devices.
Maintain an architecture that allows future development of native Android and iOS applications without changing the central database.
Use stable, mutually compatible versions of all dependencies and verify current official documentation before implementing external integrations.

3. Design and User Interface
Design a professional, modern, clean enterprise application appropriate for a medical equipment manufacturing company.
Branding
* Application name: AVI SalesConnect
* Company name: AVI Healthcare Pvt. Ltd.
* Provide an option to upload the official company logo.
* Primary colour: Navy Blue
* Secondary colour: Medical Blue
* Background: White and Light Grey
* Green: Successful and completed activities
* Orange: Pending or approaching deadlines
* Red: Overdue or rejected activities
* Grey: Inactive or closed activities
Support light mode and dark mode.
Use clear typography, consistent icons, readable tables, responsive forms and modern dashboard components.
Avoid excessive decorative elements and unnecessary animations.
Desktop Layout
Provide a collapsible left navigation sidebar, top navigation bar, global search, notification centre, user profile, breadcrumbs and main content area.
The sidebar shall contain:
1. Dashboard
2. Leads
3. Hospitals and Customers
4. Contacts
5. Attendance
6. Field Visits
7. Visit Planner
8. Follow-ups and Tasks
9. Products
10. Quotations
11. Sales Orders
12. Demonstrations
13. Distributors
14. Tenders
15. Expenses
16. Sales Targets
17. Reports
18. Administration
19. Settings
Display only modules authorised for the logged-in user.
Mobile Layout
Provide a mobile-first interface for field salespersons.
Bottom navigation:
* Home
* Leads
* Visits
* Tasks
* More
Provide prominent quick-action buttons:
* Add Lead
* Check In
* Record Visit
* Add Hospital
* Add Contact
* Submit Expense
* Schedule Follow-up
Forms must be optimised for mobile phones with large touch targets and minimum compulsory data entry.

4. User Management and Permissions
Implement role-based access control with hierarchical reporting.
Support the following roles:
Role	Primary responsibilities
Super Administrator	Complete system administration
Managing Director	Company-wide visibility and approvals
National Sales Head	All sales operations
Regional Sales Manager	Assigned regional sales operations
Area Sales Manager	Assigned territories and sales team
Field Sales Executive	Assigned leads, customers and field activities
Sales Operations Executive	Incoming inquiries, qualification and allocation
Tender Executive	Tender management
Accounts Executive	Financial records, collections and expense verification
Service Executive	Product demonstration and installation coordination
Distributor	Restricted access to own business activities
Allow administrators to create additional custom roles.
Implement granular permissions for each module:
* View
* Create
* Edit
* Archive
* Assign
* Approve
* Reject
* Export
* View financial information
* View team records
* View organisation-wide records
Permission Rules
Field salespersons shall only access authorised customers, territories, assigned leads and their own activities.
Area Sales Managers shall access their own records and records of assigned subordinate employees.
Regional Sales Managers shall access all authorised territories and subordinate teams within their region.
Management shall have company-wide access.
Sales Operations Executives shall be able to view, qualify, allocate and monitor incoming inquiries.
Accounts Executives shall access authorised financial records, quotations, orders, payments and expenses.
Tender Executives shall access tender-related records and documents.
Distributors shall not access other distributors' records, company-wide sales information or confidential internal pricing.
Prevent employees from changing their own roles or permissions.
Enforce all permissions at the database and backend level, not merely by hiding frontend components.
Support employee deactivation, session revocation and reassignment of leads when employees leave the organisation.

5. Management Dashboard
Develop a dynamic dashboard with filters for:
* Date range
* Financial year
* Region
* Territory
* Salesperson
* Distributor
* Product category
* Product model
* Lead source
Display the following KPI cards:
* Total new leads
* Active leads
* Hot leads
* Unassigned leads
* Uncontacted leads
* Overdue follow-ups
* Total sales pipeline value
* Weighted sales pipeline value
* Quotations submitted
* Orders received
* Monthly sales
* Sales target achievement
* Payments outstanding
* Hospital visits today
* Employees in the field
* Active demonstrations
* Active tenders
* Upcoming tender deadlines
* Pending expense claims
Develop charts for:
* Monthly sales versus target
* Product-wise sales
* Territory-wise sales
* Salesperson-wise performance
* Lead source performance
* Lead conversion funnel
* Quotations versus orders
* Hospital visit trends
* Lost lead reasons
* Tender participation and success rate
* Expense trends
Every dashboard KPI shall be clickable and shall open the corresponding filtered records.
Include a management attention section showing:
* Uncontacted inquiries
* Overdue follow-ups
* Stagnant opportunities
* Unapproved discounts
* Overdue demonstrations
* Upcoming tenders
* Pending expense approvals
* Overdue customer payments
All dashboard data must come from actual authorised database records, not hardcoded values.

6. Unified Lead Management
Develop a comprehensive Lead Management module covering all inquiry sources.
Lead Sources
* IndiaMART
* Company website
* Telephone inquiry
* WhatsApp
* Email
* Hospital visit
* Exhibition
* Distributor
* Customer referral
* Doctor referral
* Government inquiry
* Social media
* Existing customer
* Other
Allow administrators to add or deactivate lead sources.
Lead Creation Form
Include the following fields:
* Automatically generated lead number
* Lead creation date and time
* Lead source
* External inquiry reference
* Hospital or organisation name
* Customer type
* Contact person
* Designation
* Mobile number
* Alternate mobile number
* Email address
* City
* State
* Country
* Territory
* Assigned salesperson
* Product category
* Product model
* Required quantity
* Product specifications or requirements
* Estimated budget
* Expected order value
* Expected purchase date
* Lead priority
* Current sales stage
* Probability of conversion
* Next follow-up date
* Lead description
* Attachments
* Created by
* Last updated by
Allow a single lead to contain multiple products with different quantities and estimated prices.
Lead Priority
* Hot
* Warm
* Cold
* Unqualified
Lead Pipeline Stages
* New Inquiry
* Contact Pending
* Contacted
* Requirement Understanding
* Qualified
* Quotation Requested
* Quotation Submitted
* Demonstration Requested
* Demonstration Completed
* Negotiation
* Purchase Approval Pending
* Order Confirmed
* Won
* Lost
* On Hold
* Closed – Not Qualified
Make stages configurable by administrators.
Do not enforce an unnecessarily rigid sequence. For example, a customer may request a demonstration before receiving a quotation.
Lead Views
Provide:
* Table view
* Kanban pipeline view
* My Leads
* Team Leads
* Unassigned Leads
* New Leads
* Hot Leads
* Overdue Follow-ups
* Inactive Leads
* Won Leads
* Lost Leads
Support searching, filtering, sorting, pagination, bulk assignment and authorised Excel/CSV export.
Lead Details Screen
Provide a header with customer name, lead number, priority, status, owner and estimated value.
Include tabs:
* Overview
* Products and Requirements
* Contacts
* Activity Timeline
* Follow-ups
* Field Visits
* Quotations
* Demonstrations
* Orders
* Documents
* Status History
Maintain a chronological activity timeline containing calls, meetings, visits, notes, quotations, stage changes, assignments and follow-up activities.
Lead Business Rules
* Generate a unique lead number automatically.
* Detect potential duplicates using mobile number, email, hospital and product requirement.
* Allow authorised users to merge duplicate leads after review.
* Preserve original inquiry history during merging.
* Assign leads manually or automatically by territory.
* Send notifications when leads are allocated or reassigned.
* Allow administrators to configure first-response deadlines.
* Escalate unattended leads after the configured deadline.
* Require a next action or follow-up date for active qualified leads.
* Require a reason when marking a lead as lost.
* Record competitor information when available.
* Preserve historical ownership and stage changes.
* Prevent duplicate opportunity value from being counted across linked quotations.
* Allow authorised users to reopen closed leads with a recorded reason.
Lost Lead Reasons
* Price too high
* Competitor selected
* Technical specification mismatch
* Budget unavailable
* Purchase postponed
* Product unavailable
* Certification requirement
* Customer not responding
* Distributor-related issue
* Tender unsuccessful
* Other
Allow management to configure additional reasons.

7. IndiaMART Integration
Integrate IndiaMART inquiries directly into the unified Leads database.
Do not develop a separate IndiaMART module, dashboard or separate sales pipeline.
Use a secure backend integration with the authorised IndiaMART API.
For every incoming IndiaMART inquiry:
* Import the buyer name.
* Import organisation details.
* Import contact number.
* Import email address when available.
* Import location.
* Import product requirement.
* Import inquiry date and time.
* Store the original external inquiry reference.
* Set lead source as IndiaMART.
* Attempt duplicate detection.
* Allocate the inquiry based on configured territory rules.
* Notify the Sales Operations Executive or assigned salesperson.
Provide integration configuration under Administration > Integrations.
Implement scheduled synchronisation at intervals permitted by IndiaMART.
Maintain synchronisation logs, error logs, last successful synchronisation date, retry mechanisms and duplicate prevention using external inquiry identifiers.
Do not expose API credentials to the frontend.
If API access or credentials are unavailable, provide a CSV import facility and a clearly labelled integration-not-configured status.
Do not fabricate successful API responses or import fictitious leads into production.

8. Hospital and Customer Master
Create a centralised database of hospitals, healthcare establishments, distributors and institutional customers.
Customer categories:
* Private Hospital
* Government Hospital
* Medical College
* Nursing Home
* Children's Hospital
* Neonatal Centre
* Maternity Hospital
* Clinic
* Distributor
* Government Department
* Procurement Agency
* Other
Hospital Master Fields
* Unique hospital ID
* Hospital name
* Hospital group or chain
* Customer category
* Complete address
* City
* District
* State
* PIN code
* Country
* Latitude
* Longitude
* Website
* Main telephone number
* Number of hospital beds
* NICU bed capacity
* PICU bed capacity
* ICU bed capacity
* Number of operating theatres
* Ownership type
* Assigned territory
* Assigned salesperson
* Customer classification
* Customer status
* Zoho Books customer ID, where applicable
* Notes
* Attachments
Customer Details Screen
Provide tabs for:
* Overview
* Contacts
* Installed Equipment
* Leads
* Field Visits
* Quotations
* Orders
* Demonstrations
* Payments
* Documents
* Activity Timeline
A hospital may contain multiple contacts, multiple leads, multiple departments, multiple quotations and multiple installed equipment records.
Prevent unnecessary duplicate hospital records.
Support hospital groups with multiple branches.

9. Contact Management
Maintain individual contacts linked to hospitals, customers and distributors.
Contact designations may include:
* Neonatologist
* Paediatrician
* Intensivist
* Anaesthesiologist
* Biomedical Engineer
* Purchase Manager
* Nursing In-charge
* Hospital Administrator
* Hospital Owner
* Medical Superintendent
* Consultant
* Distributor Representative
Contact fields:
* Full name
* Hospital or organisation
* Department
* Designation
* Mobile number
* WhatsApp number
* Email address
* Office telephone
* Contact category
* Decision-making role
* Preferred communication method
* Notes
* Visiting card attachment
Decision-making roles:
* Decision Maker
* Technical Evaluator
* Influencer
* End User
* Purchase Authority
* Financial Approver
Allow one contact to be associated with multiple hospitals where required.
Provide click-to-call, click-to-email and click-to-WhatsApp functionality.

10. Installed Equipment Database
Create a dedicated Installed Equipment section within every hospital profile.
The objective is to build long-term hospital-wise market intelligence.
Capture:
* Hospital
* Department
* Equipment category
* Manufacturer
* Model
* Quantity
* Serial number, if available
* Approximate installation date
* Approximate equipment age
* Warranty status
* AMC status
* Equipment condition
* Expected replacement date
* Replacement opportunity
* AVI or competitor equipment
* Notes
* Equipment photographs
* Information source
* Last verification date
Allow filtering of hospitals based on installed equipment, competitor brand, equipment age and potential replacement date.
Do not collect patient information in equipment records or photographs.

11. Field Sales and Attendance Management
Develop a complete field activity management module.
Daily Attendance
Allow employees to:
* Start their working day.
* End their working day.
* Record GPS coordinates.
* Record date and time.
* Record GPS accuracy.
* View attendance history.
* Submit attendance correction requests.
Attendance statuses:
* Present
* Absent
* Leave
* Holiday
* Half Day
* Work From Home
* On Tour
Allow authorised managers to review and approve corrections.
Do not implement continuous background employee tracking.
Capture location only during relevant attendance and customer visit actions, with employee awareness and consent.
Visit Planner
Allow employees to create daily and weekly visit plans.
Capture:
* Planned visit date
* Hospital
* Contact person
* Visit purpose
* Related lead
* Scheduled time
* Priority
* Notes
Provide calendar and list views.
Managers shall be able to view their team’s planned visits.
Visit Purposes
* New Customer Introduction
* Lead Follow-up
* Product Demonstration
* Quotation Follow-up
* Negotiation
* Payment Collection
* Distributor Meeting
* Tender Follow-up
* Relationship Development
* Installation Coordination
* Service Coordination
* Other
Hospital Visit Check-In
When the salesperson reaches the hospital:
* Select the hospital or create an authorised provisional hospital record.
* Capture GPS location.
* Record check-in timestamp.
* Compare current location with hospital coordinates.
* Calculate approximate distance from the registered hospital.
* Record GPS accuracy.
* Allow exceptions when location permissions, internet or GPS accuracy are inadequate.
* Require an explanation for location exceptions.
Make the acceptable check-in radius configurable by administrators.
GPS verification must not be treated as infallible proof of physical attendance.
Hospital Visit Check-Out
Capture:
* Check-out time
* GPS coordinates
* Visit duration
* Meeting outcome
* Contact persons met
* Products discussed
* Customer requirements
* Competitor information
* Next action
* Next follow-up date
* Photographs or documents, if necessary
Allow users to create a new lead directly from the visit report.
Allow multiple leads to be linked to a single hospital visit.
Visit Reporting
Automatically generate Daily Sales Reports based on recorded activities.
Include:
* Attendance time
* Hospitals visited
* Planned versus completed visits
* Contacts met
* Visit duration
* New leads generated
* Follow-ups completed
* Quotations discussed
* Orders confirmed
* Expenses recorded
* Next day's planned activities
Allow managers to review, acknowledge and comment on daily reports.

12. Follow-Up and Task Management
Create a central task management system connected to all application modules.
Task types:
* Customer Call
* Hospital Visit
* Send Quotation
* Send Brochure
* Product Demonstration
* Payment Follow-up
* Tender Submission
* Distributor Follow-up
* Internal Approval
* Other
Task fields:
* Task title
* Related lead, hospital, tender or order
* Assigned employee
* Created by
* Due date and time
* Priority
* Description
* Status
* Completion notes
* Completion date
Task statuses:
* Pending
* In Progress
* Completed
* Overdue
* Cancelled
* Rescheduled
Provide:
* Today's Tasks
* Upcoming Tasks
* Overdue Tasks
* Completed Tasks
* Team Tasks
* Calendar View
When a lead follow-up is rescheduled, record the previous due date and reason.
Automatically create tasks from lead assignment, tender deadlines, demonstration return dates and payment follow-ups where configured.
Prevent duplicate automated tasks.

13. Product Catalogue
Maintain a product master for AVI Healthcare.
Fields:
* Product code
* Product category
* Product name
* Model number
* Description
* Technical specifications
* HSN code
* GST rate
* Standard selling price
* Distributor price
* Export price
* Minimum authorised selling price
* Currency
* Warranty
* Product photographs
* Product brochure
* User manual
* Demonstration video link
* Regulatory documents
* Certification validity
* Active or discontinued status
Support multiple price lists and quantity-based pricing.
Only authorised users shall access confidential minimum selling prices and distributor prices.
Allow authorised employees to share approved product brochures and documents through email or WhatsApp.
Maintain version history and expiry dates for regulatory documents.
Never automatically represent an expired certificate as valid.

14. Quotation Management
Develop quotation tracking with Zoho Books integration.
Zoho Books shall remain the authoritative system for official estimates, financial transactions and invoices.
Quotation Features
* Create quotation request against a lead.
* Select existing customer.
* Add multiple products.
* Add quantity and unit price.
* Apply authorised discounts.
* Calculate applicable taxes.
* Add accessories.
* Add warranty terms.
* Add installation charges, if applicable.
* Add freight charges, if applicable.
* Add payment terms.
* Add delivery terms.
* Add quotation validity.
* Add commercial notes.
* Submit for discount approval.
* Create an official estimate in Zoho Books when authorised.
* Retrieve official quotation PDF.
* Maintain quotation revision history.
* Track customer acceptance.
Quotation statuses:
* Draft
* Approval Pending
* Approved
* Submitted
* Revision Requested
* Accepted
* Rejected
* Expired
* Cancelled
* Converted to Order
Require approval whenever a salesperson exceeds the configured discount limit or quotes below an authorised price.
Once an approved quotation is revised, require fresh approval when applicable.
Maintain local quotation requests and synchronised Zoho estimate references without creating duplicate accounting records.

15. Sales Order and Payment Tracking
Synchronise authorised sales order, invoice and payment information from Zoho Books.
Display:
* Sales order number
* Related lead
* Related quotation
* Customer name
* Product details
* Order date
* Order value
* Invoice status
* Dispatch status, where available
* Installation status
* Payment terms
* Invoice amount
* Amount received
* Outstanding amount
* Payment due date
* Payment follow-up history
Provide customer-wise outstanding payment reports to authorised employees.
Allow salespersons to record payment follow-up notes without modifying accounting transactions.
Maintain clear distinctions between:
* Confirmed order value
* Invoiced sales
* Payments received
* Outstanding receivables
Do not treat quotations or expected orders as completed sales.

16. Demonstration Management
Develop a module for tracking medical equipment demonstrations.
Maintain a demonstration equipment register containing:
* Equipment ID
* Product model
* Serial number
* Current location
* Availability status
* Equipment condition
* Responsible employee
Demo Request Fields
* Related hospital
* Related lead
* Product
* Requested demonstration date
* Expected duration
* Responsible salesperson
* Responsible service engineer
* Purpose
* Approval status
Demo Workflow
Requested → Approval Pending → Approved → Scheduled → Dispatched → Demonstration In Progress → Completed → Return Pending → Returned
Include cancelled and rejected statuses.
Capture:
* Actual demonstration start date
* Customer feedback
* Technical feedback
* Expected order probability
* Equipment return date
* Equipment condition upon return
* Demo extension requests
* Attachments
Prevent overlapping bookings of the same demonstration equipment.
Send reminders before demonstration return dates and escalate overdue returns.

17. Territory and Distributor Management
Support a configurable sales hierarchy.
Country → Region → State → Territory → Employee
Allow multiple employees within a territory.
Maintain territory assignment history and manager relationships.
Distributor Master
Capture:
* Distributor name
* Contact person
* Address
* Territory
* Authorised product categories
* Contact details
* GST number
* Agreement validity
* Distributor status
* Assigned AVI employee
* Sales target
* Zoho Books customer reference
* Distributor documents
Track:
* Distributor-generated leads
* Quotations
* Orders
* Sales performance
* Payment follow-ups
* Hospital coverage
* Agreement expiry
* Product demonstrations
Implement potential channel-conflict warnings when multiple distributors or salespersons are pursuing the same customer requirement.
Allow authorised managers to resolve channel conflicts without deleting historical records.

18. Government Tender Management
This module is compulsory in Phase 1.
Develop a comprehensive Tender Management system appropriate for a medical equipment manufacturer participating in GeM, government hospitals and institutional tenders.
Tender Master Fields
* Internal tender ID
* GeM bid number or tender reference number
* Tender title
* Tendering authority
* Procurement agency
* Hospital or institution
* State
* Tender portal
* Tender URL
* Publication date
* Pre-bid meeting date
* Clarification submission deadline
* Bid submission deadline
* Technical bid opening date
* Financial bid opening date
* Tender validity
* Estimated tender value
* Product category
* Proposed AVI model
* Required quantity
* Assigned tender executive
* Assigned salesperson
* Distributor or channel partner
* Tender priority
* EMD amount
* Tender fee
* Performance Bank Guarantee requirement
* Delivery period
* Payment terms
* Warranty requirement
* Notes
Support multiple product lines within one tender.
Tender Statuses
* Identified
* Under Evaluation
* Participation Approval Pending
* Participating
* Pre-Bid Representation Submitted
* Awaiting Corrigendum
* Documentation In Progress
* Bid Submitted
* Technical Evaluation
* Technical Qualified
* Technical Rejected
* Financial Bid Opened
* L1
* L2
* Other Ranking
* Negotiation
* Awarded
* Lost
* Cancelled
* Not Participating
* Order Execution
* Completed
Tender Details Screen
Provide tabs:
* Tender Overview
* Product Requirements
* Technical Compliance
* Eligibility Checklist
* Documents
* Pre-Bid Clarifications
* Corrigenda
* EMD and Bank Guarantees
* Financial Bid
* Competitors
* Approvals
* Order Execution
* Payment Status
* Activity History
Technical Compliance Matrix
Allow tender executives to enter:
* Serial number
* Tender specification
* Required parameter
* Offered model
* Offered specification
* Compliance status
* Deviation
* Supporting document
* Remarks
Compliance statuses:
* Complied
* Partially Complied
* Not Complied
* Clarification Required
* Not Applicable
Provide authorised export of the compliance matrix to Excel and PDF.
Tender Document Checklist
Include configurable document categories:
* Manufacturing Licence
* ISO Certification
* CE Certification
* BIS Certification, where applicable
* ICMED Certification
* Product Brochure
* Manufacturer Authorisation
* Technical Compliance Statement
* Declaration
* Turnover Certificate
* CA Certificate
* Past Performance
* Purchase Orders
* Installation Certificates
* EMD Proof
* Bank Guarantee
* Financial Documents
* Other Documents
Allow documents to be marked as required, available, pending, verified, expired or not applicable.
Pre-Bid Management
Track:
* Original specification
* Requested amendment
* Justification
* Submission date
* Authority response
* Corrigendum reference
* Revised specification
* Acceptance or rejection
EMD and Bank Guarantee Register
Capture:
* Tender reference
* Instrument type
* Amount
* Bank name
* Reference number
* Submission date
* Validity date
* Refund due date
* Actual refund date
* Status
* Supporting documents
Send alerts before expiry and pending refund dates.
Competitor Tracking
Capture:
* Competitor company
* Offered brand
* Offered model
* Quoted price, when officially available
* Technical qualification status
* Financial ranking
* Remarks
Restrict access to confidential financial bid information.
Tender Execution
For awarded tenders, track:
* Purchase order or NOA
* Order quantity
* Delivery deadline
* Dispatch quantity
* Installation quantity
* Pending installation
* Site readiness
* Acceptance certificate status
* Invoice status
* Payment status
* Liquidated damages
* PBG status
Link awarded tenders with sales orders rather than duplicating sales revenue.
Tender Alerts
Send configurable reminders before:
* Pre-bid meeting
* Clarification deadline
* Bid submission deadline
* Document expiry
* EMD expiry
* Bank guarantee expiry
* Delivery deadline
* Payment due date
Preserve previous tender deadlines when corrigenda change dates.

19. Travel and Expense Management
This module is compulsory in Phase 1.
Develop a complete expense submission, approval and reimbursement system.
Expense Categories
* Local Conveyance
* Petrol or Diesel
* Kilometre-Based Travel
* Taxi
* Auto Rickshaw
* Train
* Bus
* Airfare
* Hotel
* Food
* Daily Allowance
* Parking
* Toll
* Customer Meeting Expense
* Exhibition Expense
* Other
Allow administrators to create and configure categories.
Expense Entry Form
Capture:
* Expense date
* Employee
* Expense category
* Amount
* Currency
* Travel from
* Travel to
* Distance travelled
* Vehicle type
* Related hospital visit
* Related lead
* Related tender
* Related trip
* Business purpose
* Receipt or invoice attachment
* Remarks
Support mobile camera upload of receipts.
Kilometre-Based Reimbursement
Allow configurable rates based on:
* Employee category
* Two-wheeler
* Four-wheeler
* Applicable effective date
Calculate eligible reimbursement based on approved distance multiplied by the applicable reimbursement rate.
Do not automatically treat GPS displacement as actual road distance travelled.
Allow employees to enter actual business travel distance, subject to approval.
Outstation Travel Requests
Capture:
* Destination
* Travel purpose
* Expected departure
* Expected return
* Estimated travel expense
* Estimated hotel expense
* Estimated daily allowance
* Related customers or events
Provide manager approval before travel where required by company policy.
Expense Claim Workflow
Draft → Submitted → Manager Approval Pending → Manager Approved → Accounts Verification → Approved for Payment → Reimbursed
Also support:
* Rejected
* Returned for Correction
* Partially Approved
Expense Business Rules
* Employees cannot approve their own expense claims.
* Expenses above configurable limits require additional approval.
* Require receipts according to category-specific policies.
* Detect possible duplicate expense submissions.
* Support grouped weekly or monthly expense claims.
* Preserve original claimed amount and approved amount.
* Require reasons for rejected or reduced expenses.
* Prevent unauthorised modification after submission.
* Allow returned claims to be corrected and resubmitted.
* Maintain complete approval history.
* Record reimbursement date and payment reference.
* Prevent duplicate reimbursement.
* Allow authorised finance integration where supported.
Expense Dashboard
Display:
* Expenses submitted
* Expenses pending approval
* Expenses approved
* Expenses rejected
* Expenses reimbursed
* Outstanding reimbursement
* Employee-wise expenses
* Territory-wise expenses
* Expense category breakdown
* Travel expenses versus sales
* Expenses related to hospital visits
Provide employee-wise, monthly and financial-year-wise reports.

20. Sales Targets and Performance Management
Allow management to define sales targets by:
* Employee
* Team
* Territory
* Region
* Distributor
* Product category
* Product model
* Month
* Quarter
* Financial year
Support both quantity-based and revenue-based targets.
Track:
* Target value
* Achieved value
* Achievement percentage
* Remaining target
* Orders received
* Invoiced sales
* Collections
* New qualified leads
* Hospital visits
* Follow-up compliance
* Lead conversion rate
* Quotation conversion rate
* Demo conversion rate
Allow management to select the applicable achievement basis, such as invoiced sales or confirmed orders.
Maintain consistent calculation rules across dashboards and reports.
Provide a deterministic weighted pipeline calculation using estimated order value multiplied by the configured probability of conversion.
This is a rule-based calculation, not AI forecasting.

21. Notifications and Escalations
Implement a central notification engine.
Support:
* In-app notifications
* Email notifications
* PWA push notifications where supported
* WhatsApp notifications through approved integration, if configured
Notification events:
* New lead received
* Lead assigned
* Lead reassigned
* First response overdue
* Follow-up due
* Follow-up overdue
* Stagnant lead
* Quotation approval requested
* Quotation approved or rejected
* Demonstration scheduled
* Demonstration return overdue
* Upcoming tender deadline
* Expiring certificate
* Expiring bank guarantee
* Expense submitted
* Expense approved or rejected
* Expense reimbursed
* Customer payment overdue
* Sales target milestone achieved
Allow administrators to configure escalation rules, notification recipients, working hours and reminder frequency.
Prevent duplicate notification delivery.
Maintain notification delivery logs and read/unread status.
Do not rely exclusively on browser push notifications for critical deadlines.

22. Database Architecture
Design a normalised relational PostgreSQL database.
Use UUID primary keys where appropriate.
Use foreign key constraints, unique constraints, indexes, data validation and transactional functions.
All relevant tables shall contain organisation references, created_at, updated_at, created_by and updated_by fields.
Use soft archival for business records where appropriate.
Core Database Tables
Organisation and Users
* organisations
* user_profiles
* employee_profiles
* roles
* permissions
* role_permissions
* user_roles
* employee_reporting
* regions
* territories
* territory_assignments
Customers and Contacts
* customers
* customer_branches
* customer_contacts
* contacts
* contact_customer_relationships
* customer_assignments
* installed_equipment
* installed_equipment_history
Lead Management
* lead_sources
* lead_statuses
* lead_priorities
* leads
* lead_products
* lead_assignments
* lead_status_history
* lead_activities
* lead_notes
* lead_attachments
* lost_lead_reasons
* lead_merge_history
* lead_external_references
Field Sales
* attendance
* attendance_correction_requests
* visit_plans
* field_visits
* visit_contacts
* visit_leads
* visit_attachments
* daily_sales_reports
* daily_report_comments
* location_verification_logs
Tasks
* tasks
* task_assignments
* task_history
* task_reminders
Products
* product_categories
* products
* product_documents
* price_lists
* price_list_items
* product_certifications
* product_accessories
Quotations and Sales
* quotation_requests
* quotation_items
* quotation_versions
* discount_approval_rules
* quotation_approvals
* sales_orders
* sales_order_items
* invoices
* invoice_items
* payment_records
* payment_allocations
* payment_followups
Demonstrations
* demo_equipment
* demo_requests
* demo_approvals
* demonstrations
* demo_feedback
* demo_extensions
* demo_movements
Distributors
* distributors
* distributor_territories
* distributor_products
* distributor_agreements
* channel_conflicts
Tenders
* tenders
* tender_products
* tender_status_history
* tender_assignments
* tender_documents
* tender_document_checklists
* tender_compliance_items
* tender_prebid_queries
* tender_corrigenda
* tender_deadline_history
* tender_emd_records
* tender_bank_guarantees
* tender_competitors
* tender_approvals
* tender_execution_records
* tender_sales_order_links
Expenses
* expense_categories
* expense_policies
* mileage_rates
* travel_requests
* travel_request_approvals
* expense_entries
* expense_receipts
* expense_claims
* expense_claim_items
* expense_approvals
* expense_reimbursements
Targets and Reporting
* sales_targets
* target_assignments
* reporting_periods
* report_definitions
System and Integrations
* notifications
* notification_preferences
* notification_delivery_logs
* escalation_rules
* integration_settings
* integration_sync_logs
* external_record_mappings
* integration_events
* background_job_logs
* document_metadata
* audit_logs
* application_settings
Consolidate redundant tables where justified by good relational design, but do not omit functional requirements.
Important Relationships
* One hospital can have multiple contacts.
* One contact can be associated with multiple hospitals.
* One hospital can have multiple leads.
* One lead can contain multiple products.
* One lead can have multiple quotations.
* One lead can have multiple follow-up activities.
* One lead can be associated with multiple visits.
* One visit can involve multiple contacts and leads.
* One hospital can contain multiple installed equipment records.
* One tender can contain multiple product requirements.
* One tender can contain multiple compliance items.
* One tender can be linked to multiple sales orders.
* One expense claim can contain multiple expense entries.
* One expense claim can contain multiple approval records.
* One invoice can have multiple payment allocations.
Key Database Requirements
* Use fixed-precision decimal types for currency.
* Never use floating-point types for financial amounts.
* Store timestamps consistently using timezone-aware types.
* Display dates and times in Asia/Kolkata by default.
* Support financial years from 1 April to 31 March.
* Add indexes on frequently filtered fields.
* Use unique external identifiers for integration records.
* Use transaction-safe sequential business reference numbers.
* Validate quantity, amount, status and date constraints.
* Use database transactions for approvals and financial state changes.
* Prevent double-counting across linked leads, tenders, orders and invoices.
* Maintain immutable or append-only audit history for sensitive operations.
Generate SQL migrations and an Entity Relationship Diagram before implementing dependent application modules.

23. Zoho Books Integration
Integrate with the existing AVI Healthcare Zoho Books organisation using authorised APIs.
Support synchronisation of:
* Customers
* Items
* Estimates
* Sales Orders
* Invoices
* Customer Payments
* Outstanding Receivables
Zoho Books shall be the source of truth for official financial records.
AVI SalesConnect shall be the source of truth for:
* Leads
* Hospital relationships
* Customer activities
* Field visits
* Follow-up tasks
* Sales pipeline
* Tender management
* Demonstration management
Use secure backend OAuth token management.
Implement:
* Initial synchronisation
* Incremental synchronisation
* Manual synchronisation by authorised users
* Scheduled synchronisation
* API rate-limit handling
* Retry with backoff
* Error reporting
* External ID mapping
* Idempotent record creation
* Conflict detection
* Synchronisation history
Require explicit authorisation before creating or modifying official Zoho Books records.
Do not create duplicate customers when a matching Zoho customer exists.
Do not store OAuth refresh tokens or client secrets in frontend code or publicly readable database tables.
If Zoho credentials are not available, provide an integration configuration screen and testable adapter architecture without falsely reporting a successful connection.

24. Reporting and MIS
Develop a comprehensive Reports module.
Include:
Lead Reports
* Lead source analysis
* Lead status analysis
* Lead aging report
* Uncontacted leads
* Overdue follow-ups
* Lead conversion report
* Lost lead analysis
* Product-wise inquiries
Field Sales Reports
* Employee attendance
* Daily sales reports
* Hospital visits
* Planned versus completed visits
* Average visit duration
* New hospitals added
* Employee activity summary
* Territory coverage
Sales Reports
* Monthly sales
* Financial-year sales
* Product-wise sales
* Territory-wise sales
* Salesperson-wise sales
* Distributor-wise sales
* Target versus achievement
* Quotation conversion
* Order pipeline
* Outstanding payments
Tender Reports
* Active tenders
* Upcoming deadlines
* Participating tenders
* Awarded tenders
* Lost tenders
* Tender success rate
* EMD outstanding
* Bank guarantee expiry
* Pending delivery and installation
Expense Reports
* Employee-wise expenses
* Category-wise expenses
* Monthly expenses
* Expense approval status
* Pending reimbursements
* Territory-wise expenses
* Sales expenses versus revenue
Provide date filters, saved report filters, authorised Excel/CSV exports, printable reports and PDF export where appropriate.
Implement server-side filtering and pagination for large datasets.

25. Global Search
Develop a global search facility accessible from desktop and mobile.
Allow searching across authorised records using:
* Hospital name
* Customer name
* Contact person
* Mobile number
* Email address
* Lead number
* Product name
* Quotation number
* Sales order number
* GeM bid number
* Tender reference
* Employee name
* Distributor name
Search results must respect all database-level access permissions.

26. Security and Data Protection
Implement production-grade security.
Mandatory requirements:
* Secure Supabase authentication.
* Role-based database access.
* Row Level Security on all relevant tables.
* Restricted document storage policies.
* Signed URLs for confidential documents.
* Server-side validation.
* Input sanitisation.
* Rate limiting where appropriate.
* Secure API credential management.
* Audit trails.
* Session management.
* Employee account deactivation.
* Least-privilege access.
* Authorised data export only.
* Protection against unauthorised direct API access.
* Protection against cross-territory data leakage.
* Database backup and recovery procedures.
Never expose the Supabase service role key in frontend code.
Do not store plaintext passwords.
Implement security tests using different user roles and territories.
Maintain an audit log capturing:
* User ID
* Action
* Record type
* Record ID
* Previous value where appropriate
* New value where appropriate
* Timestamp
* Request context
Restrict audit log modification and deletion.
The application is a business sales management system, not a clinical application. Do not collect or store patient medical records, patient photographs or identifiable clinical information.
Apply appropriate data minimisation and privacy controls to customer contact information and employee location information.

27. Offline and Mobile Functionality
The application should support limited offline functionality for field salespersons.
Allow offline drafting of:
* New lead records
* Hospital visit reports
* Customer contact records
* Expense entries
* Follow-up notes
Synchronise drafts when internet connectivity is restored.
Provide:
* Offline status indicator
* Pending synchronisation indicator
* Failed synchronisation notification
* Retry option
* Duplicate prevention
* Conflict resolution
Do not silently overwrite newer server records.
Clearly distinguish offline-captured visit timestamps and location records from server-verified synchronisation timestamps.
Restrict offline caching of sensitive financial records and confidential documents.
Clear sensitive local data upon logout where technically supported.

28. Administration and Configuration
Create an Administration module allowing authorised users to manage:
* Employees
* Roles
* Permissions
* Reporting hierarchy
* Regions
* Territories
* Lead sources
* Lead stages
* Lead priorities
* Product categories
* Lost lead reasons
* Visit purposes
* Expense categories
* Expense policies
* Mileage rates
* Discount approval rules
* Tender document checklists
* Sales targets
* Working hours
* Holidays
* Notification rules
* Escalation rules
* Company branding
* Financial year settings
* External integrations
Avoid hardcoding business rules that management may need to modify later.

29. GitHub Integration and Code Management
Create and maintain a GitHub repository for the application, subject to available repository permissions.
Organise the codebase using a modular, scalable structure.
Suggested repository structure:
avi-salesconnect/
  src/
    components/
    layouts/
    pages/
    features/
      dashboard/
      leads/
      customers/
      contacts/
      attendance/
      visits/
      tasks/
      products/
      quotations/
      orders/
      demonstrations/
      distributors/
      tenders/
      expenses/
      targets/
      reports/
      administration/
    hooks/
    services/
    integrations/
    schemas/
    types/
    utils/
    lib/
  supabase/
    migrations/
    functions/
    tests/
    seed.sql
  public/
  tests/
  docs/
  .github/
    workflows/
  .env.example
  README.md
  netlify.toml
Implement:
* Meaningful Git commits.
* Separate feature branches where appropriate.
* Pull request checks.
* Automated linting.
* TypeScript checks.
* Automated testing.
* Production build verification.
* Database migration version control.
* Environment-specific configuration.
Never commit real credentials, private keys or production customer data.
Create a comprehensive README containing setup, architecture, development instructions, testing and deployment procedures.

30. Netlify Deployment
Configure deployment on Netlify.
Maintain separate development, staging and production environments.
Implement:
* GitHub-based deployment.
* Environment variables.
* SPA routing configuration.
* HTTPS.
* Build optimisation.
* Deployment previews.
* Error handling.
* Secure headers.
* PWA manifest.
* Application icons.
* Service worker configuration.
Ensure application refresh works correctly on nested routes.
Provide instructions for connecting a custom AVI Healthcare subdomain.
Do not deploy to production or modify a live production database without explicit authorisation.

31. Testing and Acceptance Criteria
Do not consider any module complete merely because its user interface has been developed.
Every module must have working database persistence, permissions, validation, business logic, error handling and automated tests.
At minimum, verify the following scenarios:
Lead Management
* A salesperson can create a lead with multiple products.
* An office executive can assign a lead to an authorised salesperson.
* Duplicate IndiaMART inquiries are not imported twice.
* A lead can be converted into a quotation request.
* Lost leads require a reason.
* Overdue follow-ups appear in the appropriate dashboards.
Field Sales
* Employee attendance records are stored correctly.
* Hospital visit check-in captures location and accuracy.
* GPS exceptions can be submitted and reviewed.
* A visit can generate multiple related opportunities.
* Daily sales reports correctly reflect actual visit records.
* Offline drafts synchronise without duplication.
Tender Management
* A tender can contain multiple products.
* Technical compliance items can be recorded and exported.
* Deadline reminders are generated correctly.
* Corrigenda preserve previous deadline history.
* EMD refunds and bank guarantee expiry are tracked.
* Awarded tenders link to sales orders without duplicate revenue.
Expense Management
* Employees can submit expenses with attachments.
* Mileage reimbursement uses the applicable policy rate.
* Managers can approve or reject claims.
* Employees cannot approve their own claims.
* Accounts can record reimbursement.
* Duplicate payments are prevented.
* Approval history remains available.
Security
* One salesperson cannot access another unauthorised territory.
* Distributors cannot access confidential internal information.
* Users cannot increase their own permissions.
* Direct backend requests cannot bypass access restrictions.
* Confidential attachments cannot be downloaded without permission.
* Deactivated employees lose access.
Integrations
* Repeated synchronisation does not create duplicate records.
* Integration failures are logged accurately.
* Expired credentials are handled securely.
* Financial records correctly reflect Zoho Books data.
* No production integration reports success without confirmation from the external service.
Create unit tests, integration tests and end-to-end browser tests.
Include responsive testing for desktop, tablet and mobile screen sizes.

32. Implementation Sequence
All the following development milestones belong to Phase 1 of the product. They are implementation milestones, not optional future product phases.
Milestone 1 – Foundation
* Project setup
* GitHub repository
* Supabase configuration
* Database architecture
* Authentication
* User roles and permissions
* Organisation and territory structure
* Responsive application layout
* Shared UI components
Milestone 2 – CRM
* Lead Management
* Hospital Master
* Contact Management
* Installed Equipment
* Follow-ups
* Lead activity timeline
Milestone 3 – Field Sales
* Attendance
* Visit Planner
* GPS check-in and check-out
* Visit reports
* Daily Sales Reports
* Mobile interface
* Offline drafts
Milestone 4 – Commercial Operations
* Product catalogue
* Quotation requests
* Discount approvals
* Sales order tracking
* Distributor Management
* Demonstration Management
Milestone 5 – Tender Management
* Tender database
* Tender pipeline
* Compliance matrix
* Document checklist
* Pre-bid management
* EMD and bank guarantees
* Tender execution
* Deadline notifications
Milestone 6 – Expense Management
* Expense categories and policies
* Expense entry
* Travel requests
* Mileage reimbursement
* Approval workflow
* Accounts verification
* Reimbursement tracking
Milestone 7 – External Integrations
* IndiaMART integration
* Zoho Books integration
* Maps integration
* Email notifications
* Optional WhatsApp integration
* Integration monitoring
Milestone 8 – Management and Reporting
* Management dashboards
* Sales targets
* Performance reporting
* MIS reports
* Global search
* Report exports
Milestone 9 – Production Readiness
* Security review
* RLS testing
* Performance optimisation
* Responsive design testing
* Integration testing
* PWA testing
* Database backup procedures
* Staging deployment
* User acceptance testing
* Documentation
Do not postpone Tender Management or Expense Management to a subsequent product release.

33. Documentation Requirements
Maintain the following documents within the GitHub repository:
* docs/SRS.md
* docs/ARCHITECTURE.md
* docs/DATABASE_SCHEMA.md
* docs/ENTITY_RELATIONSHIPS.md
* docs/USER_PERMISSIONS.md
* docs/BUSINESS_RULES.md
* docs/SCREEN_SPECIFICATIONS.md
* docs/API_INTEGRATIONS.md
* docs/TEST_PLAN.md
* docs/DEPLOYMENT_GUIDE.md
* docs/SECURITY.md
* docs/IMPLEMENTATION_PLAN.md
* docs/PROGRESS.md
* docs/DECISIONS.md
* docs/USER_GUIDE.md
The implementation progress document must identify:
* Completed modules
* Partially completed modules
* Pending modules
* Known issues
* Failed tests
* External dependencies
* Required credentials
* Database migration status
* Next implementation tasks
Update the progress document after every milestone.
Record important architectural decisions and their justification in DECISIONS.md.

34. Instructions to Codex
Follow these instructions throughout development:
1. Inspect the existing repository, if any, before making changes.
2. Preserve working functionality and existing data.
3. Create a detailed implementation plan before writing application code.
4. Develop the database schema and security model before dependent modules.
5. Develop shared components and design conventions before individual screens.
6. Implement all modules systematically according to the implementation sequence.
7. Do not create placeholder buttons that perform no action.
8. Do not create disconnected UI screens without database integration.
9. Do not use hardcoded dashboard statistics in production.
10. Clearly distinguish development sample data from production data.
11. Do not expose external API credentials.
12. Do not introduce unnecessary dependencies.
13. Use reusable components and strongly typed TypeScript interfaces.
14. Ensure every form includes validation, loading states and meaningful error messages.
15. Ensure every list includes search, filters and pagination where appropriate.
16. Ensure sensitive operations require proper authorisation.
17. Test every major workflow before marking it complete.
18. Maintain consistent business logic across all modules.
19. Do not implement any AI Sales Intelligence functionality in the current release.
20. Do not create a separate IndiaMART Lead Management module.
21. Ensure Tender Management and Expense Management are fully included in Phase 1.
22. Use configurable business policies rather than inventing fixed AVI Healthcare policies.
23. Do not invent external API capabilities; verify official documentation.
24. Do not perform destructive database operations or production deployments without explicit authorisation.
25. Document blockers and incomplete features transparently.
26. Make reasonable reversible technical decisions without repeatedly requesting minor clarifications.
27. Request user input only when credentials, irreversible actions or consequential business-policy decisions are required.
28. Do not claim that implementation, integration or deployment is successful unless verified.
29. Maintain implementation continuity using repository documentation rather than relying exclusively on conversation history.
30. Produce a fully functional, secure, maintainable application suitable for actual business use.

35. Final Expected Outcome
The completed AVI SalesConnect application must allow AVI Healthcare management to answer the following questions immediately:
* How many leads have we received today?
* How many leads have not been contacted?
* Which employee is responsible for each inquiry?
* Which IndiaMART leads have converted into orders?
* Which hospitals have been visited today?
* What did the salesperson discuss with the customer?
* Which customers require ICU or neonatal equipment?
* Which follow-ups are overdue?
* Which quotations are awaiting customer decisions?
* What orders are expected this month?
* Where are our demonstration machines?
* Which hospitals have competitor equipment?
* Which government tenders are approaching their submission deadlines?
* How much EMD is outstanding?
* Which bank guarantees are approaching expiry?
* Which salespersons are achieving their targets?
* How much is each territory spending on sales activities?
* Which employee expenses are awaiting approval?
* How much customer payment is outstanding?
The application should become the central sales operations platform of AVI Healthcare Pvt. Ltd.
The primary objective is to increase sales productivity, strengthen employee accountability, improve lead conversion, reduce manual reporting and provide management with real-time visibility into company-wide sales operations.
Begin by inspecting the repository and creating the implementation plan, Software Requirements Specification, database architecture, permission matrix and application design system. Thereafter, implement the application milestone by milestone, validating each milestone before proceeding to the next.
