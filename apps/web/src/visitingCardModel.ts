import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

export const cardExtras = [
  ['salutation','Salutation',40], ['qualifications','Qualifications',150], ['department','Department',120],
  ['website','Website',200], ['hospital_address','Hospital address',500], ['pincode','PIN code',20],
] as const;
type ExtraField = typeof cardExtras[number][0];
export type CardField = ExtraField | 'contact' | 'customer' | 'designation' | 'mobile' | 'alternate_mobile' | 'email' | 'city' | 'state';
export type CardFields = Partial<Record<CardField, { value: string | null; confidence: 'high' | 'medium' | 'low' }>>;
export type MatchInputs = { customer: string; mobile: string; alternate_mobile: string; email: string };
export type CardMatches = {
  customers: { id: string; name: string; city: string | null; can_link: boolean }[];
  contacts: { id: string; name: string; accounts: { id: string; name: string }[] }[];
};
export type CardUpload = { upload_key: string; front: string; back?: string };

export const cardFileLimit = 10 * 1024 * 1024;
export const cardAccept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

export async function uploadCardImages(db: SupabaseClient<Database>, organization: string,
  front: Blob, back?: Blob): Promise<CardUpload> {
  const data = new FormData();
  data.append('front', front, 'front-card');
  if (back) data.append('back', back, 'back-card');
  const result = await db.functions.invoke<CardUpload>('scan-visiting-card', {
    body: data,
    headers: { 'x-avi-organization': organization, 'x-avi-card-action': 'upload' },
  });
  if (result.error || !result.data) {
    const response = result.error?.context;
    if (response instanceof Response) {
      const body: { error?: string } | null = await response.json().catch(() => null);
      if (body?.error) throw new Error(body.error);
    }
    throw new Error('Unable to reach the visiting card service. Try again.');
  }
  return result.data;
}
