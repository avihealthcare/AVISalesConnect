export const customerCategories = ['Private Hospital','Government Hospital','Medical College','Nursing Home',
  "Children's Hospital",'Neonatal Centre','Maternity Hospital','Clinic','Distributor','Government Department','Procurement Agency','Other'];
export const customerStatuses = ['Active','Prospect','Inactive','On Hold'];
export const contactDesignations = ['Neonatologist','Paediatrician','Intensivist','Anaesthesiologist','Biomedical Engineer','Purchase Manager',
  'Nursing In-charge','Hospital Administrator','Hospital Owner','Medical Superintendent','Consultant','Distributor Representative'];
export const decisionRoles = ['Decision Maker','Technical Evaluator','Influencer','End User','Purchase Authority','Financial Approver'];

type Details = Record<string, string | null | undefined>;
export type Department = { key: string; name: string };
export type Option = { id: string; name: string };
export type AccountOption = Option & { departments: Department[] };
type Access = { can_edit: boolean; can_attach: boolean; can_download: boolean };
export type Customer = Option & { number: string; version: number; category: string; group: string | null; city: string | null; state: string | null;
  status: string; owner: string | null; owner_name: string | null; territory: string | null; territory_name: string | null; details: Details; zoho_id: string | null };
export type Contact = Access & Option & { version: number; created_at: string; details: Details;
  accounts: (Option & { primary: boolean; department: string | null; department_key: string | null })[] };
export type CustomerInfo = Access & Customer & {
  departments: Department[]; branches: Customer[]; contacts: Contact[];
  leads: { id: string; reference: string; title: string; status: string; created_at: string }[];
  related: { id: string; kind: string; title: string; status: string; created_at: string; planned_at: string | null; ended_at: string | null;
    subtype: string | null; reference: string | null; amount: string | null; equipment: Details | null }[];
  timeline: { title: string; created_at: string; actor: string | null }[];
};
export type Directory = { rows: (Customer|Contact)[]; can_create: boolean; can_contact: boolean; manage: boolean; actor_name: string;
  staff: Option[]; territories: Option[]; accounts: AccountOption[] };

export function telephone(value: string | null | undefined) {
  const number = value?.replace(/[ .()-]/g,'');
  return number && /^\+?\d{7,15}$/.test(number) ? number : undefined;
}
export function waLink(value: string | null | undefined) {
  const number=telephone(value);
  if (!number) return undefined;
  if (number.startsWith('+')) return 'https://wa.me/' + number.slice(1);
  if (/^[6-9][0-9]{9}$/.test(number)) return 'https://wa.me/91' + number;
  return number.length>10&&!number.startsWith('0') ? 'https://wa.me/'+number : undefined;
}
