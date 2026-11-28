export const customerCategories = ['Private Hospital','Government Hospital','Medical College','Nursing Home',
  "Children's Hospital",'Neonatal Centre','Maternity Hospital','Clinic','Distributor','Government Department','Procurement Agency','Other'];
export const customerStatuses = ['Active','Prospect','Inactive','On Hold'];
export const contactDesignations = ['Neonatologist','Paediatrician','Intensivist','Anaesthesiologist','Biomedical Engineer','Purchase Manager',
  'Nursing In-charge','Hospital Administrator','Hospital Owner','Medical Superintendent','Consultant','Distributor Representative'];
export const decisionRoles = ['Decision Maker','Technical Evaluator','Influencer','End User','Purchase Authority','Financial Approver','Gatekeeper','Channel Partner'];

type Details = Record<string, string | null | undefined>;
export type Department = { key: string; name: string };
export type Option = { id: string; name: string };
export type AccountOption = Option & { departments: Department[] };
type Access = { can_edit: boolean; can_attach: boolean; can_download: boolean };
export type Customer = Option & { number: string; version: number; category: string; group: string | null; city: string | null; state: string | null;
  status: string; segment?:string; subtype?:string; lifecycle?:string; site_count?:number; active_count?:number;
  primary_contact?:{name:string; designation:string|null; phone:string|null}|null; owner: string | null; owner_name: string | null; territory: string | null; territory_name: string | null; details: Details; zoho_id: string | null };
export type Contact = Access & Option & { version: number; created_at: string; details: Details;
  accounts: (Option & { primary: boolean; department: string | null; department_key: string | null })[] };
export type CustomerInfo = Access & Customer & {
  departments: Department[]; branches: Customer[]; contacts: Contact[];
  sites?:{id:string;title:string;type:string|null;city:string|null;pin:string|null;primary:boolean}[];
  opportunities?:{id:string;title:string;status:string;created_at:string}[];
  leads: { id: string; reference: string; title: string; status: string; created_at: string }[];
  related: { id: string; kind: string; title: string; status: string; created_at: string; planned_at: string | null; ended_at: string | null;
    subtype: string | null; reference: string | null; amount: string | null; equipment: Details | null }[];
  timeline: { title: string; created_at: string; actor: string | null }[];
};
export type Directory = { rows: (Customer|Contact)[]; can_create: boolean; can_contact: boolean; manage: boolean; actor_name: string;
  summary?:{total:number;healthcare:number;partners:number;active:number}; subtypes?:string[]; states?:string[];
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

export const accountSegments=['Healthcare Institution','Dealer / Distributor','Government / Tender Body'] as const;
export const accountLifecycles=['Prospect','Active Account','Key Partner / Account','Inactive'] as const;
export const accountSubtypes:Record<typeof accountSegments[number],readonly string[]>={
  'Healthcare Institution':['Multi-Specialty Hospital','Government Hospital','Medical College','Nursing Home','Clinic','Neonatal Centre','Maternity Hospital','Other'],
  'Dealer / Distributor':['Authorized Dealer','Regional Distributor','Medical Equipment Trader','Hospital Supply Contractor','System Integrator','Other'],
  'Government / Tender Body':['Government Department','Procurement Agency','Other'],
};
export function customerSegment(customer:Pick<Customer,'details'|'category'>) {
  return accountSegments.find(item=>item===customer.details.segment) ??
    (customer.category==='Distributor'?'Dealer / Distributor':['Government Department','Procurement Agency'].includes(customer.category)
      ?'Government / Tender Body':'Healthcare Institution');
}
