import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';

export type FieldDb=SupabaseClient<Database>;
export type FieldKind='attendance_session'|'visit_plan'|'visit'|'task';
export type Option={id:string;name:string};
export type Site=Option&{lat:number|null;lon:number|null};
export type Evidence={verdict:string;condition:string;accuracy_meters:number|null;distance_meters:number|null;exception?:string};
export type Gps={lat:number;lon:number;accuracy:number;captured_at:string};
export type Entry={
  id:string;title:string;status:string;version:number;owner_id:string;owner_name:string|null;created_at:string;
  planned_at:string|null;ended_at:string|null;account_id:string|null;account_name:string|null;
  parent_id:string|null;site_name:string|null;plan_id:string|null;lead_ids:string[];
  details:{work_mode?:string;start_accuracy?:number;purpose?:string;priority?:string;notes?:string;
    duration_minutes?:number;overnight?:boolean;requirements?:string;competition?:string;next_action?:string;follow_up?:string;
    contacts?:string[];products?:{model:string;category:string}[];task_type?:string;description?:string;outcome?:string;lead?:string;contact?:string;
    location_review?:{decision:string;reviewer:string;reason:string};start_evidence?:Evidence;end_evidence?:Evidence;completion_notes?:string};
  history?:{when:string;actor:string|null;details:{reason:string;previous_due_date:string|null;new_due_date:string|null}}[];
};
export type Correction={
  id:string;member_id:string;member_name:string;day:string;requested_status:string|null;start_at:string|null;end_at:string|null;
  justification:string;status:string;created_at:string;decided_at:string|null;review:string|null;
};
export type FieldSnapshot={actor:string;radius:number;can_create:boolean;can_start_visit:boolean;can_update:boolean;can_lead:boolean;can_contact:boolean;
  can_attach:boolean;can_download:boolean;team:Option[];rows:Entry[];corrections:Correction[];attendance_since?:string;can_verify_customer?:boolean};
export type References={accounts:(Option&{city?:string|null})[];sites:Site[];contacts:Option[];leads:Option[];
  products:Option[];commercial:(Option&{kind:string})[];related:(Option&{kind:string})[]};
export const emptyReferences:References={accounts:[],sites:[],contacts:[],leads:[],products:[],commercial:[],related:[]};

export const attendanceStatuses=['Present','Absent','Leave','Holiday','Half Day','Work From Home','On Tour'];
export const workModes=['Field Work','Work From Home','On Tour','Office'];
export const priorities=['High','Medium','Low'];
export const visitPurposes=['New Customer Introduction','Lead Follow-up','Product Demonstration','Quotation Follow-up','Negotiation',
  'Payment Collection','Distributor Meeting','Tender Follow-up','Relationship Development','Installation Coordination','Service Coordination','Other'];
export const visitOutcomes=['Positive / Requirement Confirmed','Demo Requested','Quotation Requested','Under Evaluation','Price Negotiation','No Decision','Lost to Competitor'];
export const taskTypes=['Customer Call','Hospital Visit','Send Quotation','Send Brochure','Product Demonstration','Payment Follow-up',
  'Tender Submission','Distributor Follow-up','Internal Approval','Other'];
export const fieldTitles={attendance_session:'Attendance',visit_plan:'Visit Planner',visit:'Field Visits',task:'Follow-ups and Tasks'};

const india='Asia/Kolkata';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:india,year:'numeric',month:'2-digit',day:'2-digit'});
const stamp=new Intl.DateTimeFormat('en-IN',{timeZone:india,dateStyle:'medium',timeStyle:'short'});
const hours=new Intl.DateTimeFormat('en-IN',{timeZone:india,timeStyle:'short'});
export const indiaDay=(value:string|number|Date=Date.now())=>dayFormat.format(new Date(value));
export const dateTime=(value:string|null|undefined)=>value?stamp.format(new Date(value)):'—';
export const timeOnly=(value:string|null|undefined)=>value?hours.format(new Date(value)):'—';
export const addDays=(day:string,count:number)=>new Date(Date.parse(day+'T00:00:00Z')+count*86_400_000).toISOString().slice(0,10);
export const localInstant=(value:string)=>value?value+':00+05:30':'';
export const clockInput=(value:string|null|undefined)=>value?new Date(Date.parse(value)+19_800_000).toISOString().slice(0,16):'';
export const fields=(form:HTMLFormElement)=>Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,String(value).trim()]));

export function interval(value:string|null,now:number) {
  const total=value?Math.max(0,Math.floor((now-Date.parse(value))/1000)):0;
  return [Math.floor(total/3600),Math.floor(total/60)%60,total%60].map(part=>String(part).padStart(2,'0')).join(':');
}
export function weekStart(day:string) {
  return addDays(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
}
export function gpsCondition(gps:Gps|undefined,visit:boolean,site:Site|undefined,radius:number) {
  if(!gps)return 'GPS unavailable';
  if(Date.now()-Date.parse(gps.captured_at)>180_000)return 'Stale GPS';
  if(gps.accuracy>100)return 'Poor GPS accuracy';
  if(!visit)return 'GPS captured';
  if(site?.lat==null||site.lon==null)return 'Site coordinates unavailable';
  const rad=(degree:number)=>degree*Math.PI/180;
  const a=Math.sin(rad(gps.lat-site.lat)/2)**2+
    Math.cos(rad(site.lat))*Math.cos(rad(gps.lat))*Math.sin(rad(gps.lon-site.lon)/2)**2;
  return 12_742_000*Math.asin(Math.min(1,Math.sqrt(a)))>radius?'Outside check-in radius':'Verified On-Site';
}
export function saveField(db:FieldDb,org:string,kind:FieldKind|'settings',action:string,key:string,body:Json) {
  return db.rpc('field_command',{p_org:org,p_kind:kind,p_action:action,p_key:key,p_body:body});
}
