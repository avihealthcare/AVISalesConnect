import type { CardField, CardFields } from './visitingCardModel';

export type CardLine = { text: string; confidence: number };
type Rating = NonNullable<CardFields[CardField]>['confidence'];
const hospitalWords = /\b(hospitals?|clinics?|medical (?:cent(?:re|er)|college|institute)|health\s?care|nursing home|health (?:cent(?:re|er)|system)|diagnostic (?:cent(?:re|er)|services)|children'?s (?:care|cent(?:re|er)))\b/i;
const roleWords = /\b(neonatologist|p(?:ae|e)diatrician|intensivist|an(?:ae|e)sthesiologist|biomedical engineer|purchase manager|consultant|surgeon|medical officer|director|head of|professor|administrator|procurement officer|nursing (?:in.?charge|superintendent))\b/i;
const addressWords = /\b(road|rd\.?|street|lane|avenue|floor|building|sector|plot|near|opposite|opp\.?|nagar|marg|colony|block)\b/i;
const salutationPattern = /^(Dr|Prof|Mr|Mrs|Ms|Shri|Smt)\.?\s+/i;
const degrees = /\b(?:MBBS|M\.B\.B\.S\.?|MD|M\.D\.?|MS|DCH|DNB|DM|MCh|FRCP|MRCP|Fellowship)\b/i;
const states = /\b(?:Andaman and Nicobar Islands|Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chandigarh|Chhattisgarh|Dadra and Nagar Haveli and Daman and Diu|Delhi|Goa|Gujarat|Haryana|Himachal Pradesh|Jammu and Kashmir|Jharkhand|Karnataka|Kerala|Ladakh|Lakshadweep|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Puducherry|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal)\b/i;
const explicitDepartment = /\b(?:NICU|PICU|ICU|Neonatology|Pediatrics|Paediatrics|Biomedical|Procurement|Anaesthesia|Anesthesia|Critical Care|Cardiology|Obstetrics|Gynaecology|Gynecology)\b/i;

export function normalizeCardPhone(value: string) {
  const phone = value.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(phone)) return phone;
  if (/^00[1-9]\d{6,14}$/.test(phone)) return '+' + phone.slice(2);
  if (/^91\d{10}$/.test(phone)) return '+' + phone;
  if (/^0\d{10}$/.test(phone)) return '+91' + phone.slice(1);
  if (/^[1-9]\d{9}$/.test(phone)) return '+91' + phone;
  return null;
}

export function readCardFields(sides: CardLine[][]): CardFields {
  const lines = sides.flatMap((side, sideIndex) => side.map(line => ({
    text: line.text.replace(/[|•]+/g, ' ').replace(/\s+/g, ' ').trim(),
    confidence: line.confidence, sideIndex,
  })).filter(line => line.text && line.confidence >= 25));
  const fields: CardFields = {};
  function set(field: CardField, value: string | undefined, score: number, inferred = false) {
    if (!value) return;
    const limits: Partial<Record<CardField, number>> = { salutation:40, mobile:30, alternate_mobile:30, email:254,
      hospital_address:500, designation:150, qualifications:150, city:120, state:120, department:120, pincode:20 };
    const rating: Rating = inferred || score < 68 ? 'low' : score < 88 ? 'medium' : 'high';
    fields[field] = { value:value.trim().slice(0, limits[field] ?? 200), confidence:rating };
  }
  function pick(field: CardField, candidates: {value:string; confidence:number}[]) {
    const first = candidates[0];
    if (first) set(field, first.value, first.confidence,
      candidates.some(item => item.value.trim().toLowerCase() !== first.value.trim().toLowerCase()));
  }

  const emails = [];
  const websites = [];
  const phones = new Map<string, number>();
  for (const {text, confidence} of lines) {
    const email = text.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}\b/i)?.[0];
    if (email) emails.push({value:email.toLowerCase(),confidence});
    const website = text.replace(email ?? '\u0000', '').match(/(?:https?:\/\/|www\.|(?<=\bweb(?:site)?:\s))[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s]*)?/i)?.[0];
    if (website) websites.push({value:website.replace(/[,.]+$/, ''),confidence});
    for (const match of text.matchAll(/(?<![\w@])(?:\+?\d[\d(). -]{7,}\d)(?!\w)/g)) {
      const phone = normalizeCardPhone(match[0]);
      if (phone && !phones.has(phone)) phones.set(phone, confidence);
    }
  }
  pick('email',emails);
  pick('website',websites);
  const rankedPhones = [...phones].sort(([left],[right]) =>
    Number(/^\+91[6-9]\d{9}$/.test(right)) - Number(/^\+91[6-9]\d{9}$/.test(left)));
  rankedPhones.slice(0,2).forEach(([phone,confidence], index) =>
    set(index ? 'alternate_mobile' : 'mobile', phone, confidence, rankedPhones.length > 2));

  const hospitals = lines.filter(line => hospitalWords.test(line.text) && !addressWords.test(line.text) &&
    !/@|www\.|\b(?:dr|consultant)\./i.test(line.text));
  pick('customer', hospitals.map(line=>({value:line.text,confidence:line.confidence})));
  const nameLabel = /^name\s*[:–-]/i;
  const explicitName = lines.find(line => salutationPattern.test(line.text) || nameLabel.test(line.text));
  const nameCandidate = lines.find((line,index) => {
    const next = lines[index+1];
    return next?.sideIndex===line.sideIndex && (roleWords.test(next.text) || degrees.test(next.text)) &&
      /^[A-Z][A-Za-z.'’-]+(?: [A-Z][A-Za-z.'’-]+){1,4}$/.test(line.text) &&
      !hospitalWords.test(line.text) && !roleWords.test(line.text) && !states.test(line.text) &&
      !addressWords.test(line.text) && !explicitDepartment.test(line.text) && !degrees.test(line.text);
  });
  const named = explicitName ?? nameCandidate;
  if (named) {
    const person = named.text.replace(/^name\s*[:–-]\s*/i,'');
    const title = person.match(salutationPattern)?.[1];
    if (title) set('salutation',title[0].toUpperCase()+title.slice(1).toLowerCase()+'.',named.confidence);
    const name = person.replace(salutationPattern,'').split(/[,()]/)[0].trim();
    const degreeAt = name.search(degrees);
    set('contact',degreeAt>0 ? name.slice(0,degreeAt).trim() : name,named.confidence,!explicitName);
  }
  const qualification = lines.find(line=>degrees.test(line.text) && !hospitalWords.test(line.text));
  if (qualification) set('qualifications',qualification.text.slice(qualification.text.search(degrees)),qualification.confidence);
  const title = lines.find(line=>roleWords.test(line.text) && line!==named && !addressWords.test(line.text));
  if (title) set('designation',title.text,title.confidence, hospitalWords.test(title.text));

  const printedDepartment = lines.find(line=>/^(?:dept\.?|department)\s*(?:of\s+|[:–-]\s*)/i.test(line.text));
  const specialty = lines.find(line=>explicitDepartment.test(line.text) && (line===title || /^\b(?:NICU|PICU|ICU|Neonatology|Pediatrics|Paediatrics)\b/i.test(line.text)));
  if (printedDepartment) set('department',printedDepartment.text.replace(/^(?:dept\.?|department)\s*(?:of\s+|[:–-]\s*)/i,''),printedDepartment.confidence);
  else if (specialty) set('department',specialty.text.match(explicitDepartment)?.[0],specialty.confidence,true);
  else if (title && /neonatologist/i.test(title.text)) set('department','Neonatology',title.confidence,true);

  const locations = lines.filter(line => !/@|www\.|\b(?:mobile|phone|telephone|landline|fax|whatsapp)\b/i.test(line.text) &&
    ((/\b[1-9]\d{5}\b/.test(line.text) && /[a-z]/i.test(line.text)) ||
      /^city\s*:/i.test(line.text) || states.test(line.text)));
  pick('pincode',locations.flatMap(line => {
    const pin = line.text.match(/(?:\b(?:PIN(?:\s*code)?|ZIP)\s*[:–-]?\s*|(?<!\d))([1-9]\d{5})(?!\d)/i);
    return pin ? [{value:pin[1],confidence:line.confidence}] : [];
  }));
  pick('state',locations.flatMap(line => {
    const state = line.text.match(states)?.[0];
    return state ? [{value:state,confidence:line.confidence}] : [];
  }));
  for (const line of locations) {
    const state = line.text.match(states);
    const precedingState = state?.index ? line.text.slice(0,state.index).trim().replace(/[,–-]$/, '').trim() : '';
    const city = line.text.match(/^city\s*:\s*([a-z][a-z ]{1,45})\b/i)?.[1] ??
      precedingState.match(/(?:^|,\s*)([a-z][a-z ]{1,35})$/i)?.[1] ??
      line.text.match(/(?:^|,\s*)([a-z][a-z ]{1,35})\s*[-–]?\s+[1-9]\d{5}\b/i)?.[1];
    if (city && !addressWords.test(city) && !states.test(city) && !/\b(pin|zip)\b/i.test(city)) {
      set('city',city,line.confidence,!/^city\s*:/i.test(line.text));
      break;
    }
  }
  const locationSide = lines.find(line=>addressWords.test(line.text))?.sideIndex;
  if (locationSide!==undefined) {
    const address = lines.filter(line=>line.sideIndex===locationSide && line.confidence >= 45 &&
      (addressWords.test(line.text) || locations.includes(line)));
    if (address.length) set('hospital_address',address.map(line=>line.text).join(', '),
      Math.min(...address.map(line=>line.confidence)),true);
  }
  return fields;
}
