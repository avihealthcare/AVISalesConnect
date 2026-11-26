export type Option = { kind: 'source' | 'stage' | 'loss'; code: string; label: string; behavior: string | null; active: boolean; sort_order: number };
export type Person = { id: string; name: string };
export type Product = { category: string; model: string; quantity: string | number; estimated_unit_price: string | number | null; requirements: string | null };
export type LeadRow = {
  id: string; version: number; number: string; customer: string; contact: string | null; designation: string | null; email: string | null;
  mobile: string | null; city: string | null; state: string | null; source: string; stage: string; behavior: string;
  priority: string; owner: string | null; owner_name: string | null; territory_name: string | null; value: string | null;
  received_at: string; updated_at: string; follow_up: string | null; first_response_overdue: boolean; products: string | null;
};
export type LeadData = {
  id: string; row_version: number; source_key: string; external_reference: string | null; prospect_name: string; customer_type: string | null;
  contact_person: string | null; designation: string | null; mobile: string | null; alternate_mobile: string | null; email: string | null;
  contact_route: string | null; missing_contact_reason: string | null; city: string | null; state: string | null; country: string | null;
  account_id: string | null; priority: string; sales_stage: string; probability: number | null; budget: string | null;
  expected_value: string | null; expected_purchase_on: string | null; description: string | null; requirement_text: string | null;
  loss_reason: string | null; competitor: string | null; next_action: string | null; next_action_due_at: string | null;
  lifecycle: string; received_at: string; ingested_at: string; updated_at: string;
};
export type LeadEvent = { kind: string; occurred_at: string; actor: string | null; details: Record<string, string | number | null> };
export type LeadDetail = {
  number: string; data: LeadData; owner: string | null; owner_name: string | null; territory: string | null;
  created_name: string | null; updated_name: string | null; can_edit: boolean; can_reopen: boolean; can_attach: boolean; can_download: boolean;
  products: Product[]; timeline: LeadEvent[];
  related: { id: string; kind: string; title: string; status: string; created_at: string; planned_at: string | null; reference: string | null }[];
  inquiries: { number: string; customer: string; source: string; external_reference: string | null; received_at: string;
    description: string | null; requirements: string | null; products: Product[] }[];
  duplicates: { id: string; version: number; number: string; customer: string; source: string; contact: string | null;
    mobile: string | null; email: string | null; city: string | null; requirements: string | null; match: string }[];
};
export type Workspace = {
  rows: LeadRow[]; total: number; catalog: Option[]; staff: Person[]; territories: (Person & { owner: string | null })[]; accounts: Person[];
  can_create: boolean; can_manage: boolean; can_export: boolean; can_settings: boolean; escalations: number;
  rules: { response_hours: number; inactive_days: number };
  notifications: { id: string; lead_id: string; message: string; created_at: string; read_at: string | null }[];
};
export const priorities = ['Hot', 'Warm', 'Cold', 'Unqualified'];
export const activityTypes = ['Call', 'Meeting', 'Visit', 'Note', 'Quotation', 'Demonstration', 'Order', 'Follow-up'];
export const behaviors = [
  ['new','New'], ['active','In progress'], ['qualified','Qualified'], ['hold','On hold'], ['won','Won'], ['lost','Lost'], ['closed','Closed'],
];
export const options = (workspace: Workspace, kind: Option['kind'], selected?: string | null) =>
  workspace.catalog.filter(option => option.kind === kind && (option.active || option.code === selected));
export const label = (workspace: Workspace, kind: Option['kind'], code?: string | null) =>
  workspace.catalog.find(part => part.kind === kind && part.code === code)?.label ?? code ?? '—';
const indiaTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const inr = new Intl.NumberFormat('en-IN', { style: 'currency',currency: 'INR',maximumFractionDigits: 2 });
export const dateTime = (value?: string | null) => value ? indiaTime.format(new Date(value)) + ' IST' : '—';
export const money = (value?: string | number | null) => value == null || value === '' ? '—' : inr.format(Number(value));
export const inputTime = (value?: string | null) => value
  ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
export const readTime = (value: string) => value ? new Date(value).toISOString() : '';
export const readFields = (form: HTMLFormElement) => Object.fromEntries(Array.from(new FormData(form), ([key,value]) => [key,String(value).trim()]));
export function commandError(error: { code?: string; message?: string } | null) {
  if (error?.code === '23505') return 'This inquiry reference is already recorded for the selected source.';
  if (error?.code === 'PT409') return error.message ?? 'This record changed during editing. Refresh to continue.';
  if (error?.code === 'PT404' || error?.code === '42501') return 'This record or action is unavailable with your access.';
  if (error?.code === '22023') return error.message ?? 'Review the required fields.';
  if (error?.code?.startsWith('22') || error?.code === '23514' || error?.code === '23502') return 'Review the field values and try again.';
  return 'The save could not be confirmed. Retry with the same entries.';
}
