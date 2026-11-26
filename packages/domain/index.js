/** Exact non-negative decimal values converted to integer minor units. */
export function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) throw new Error('Invalid monetary amount');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > 999999999999999999n) throw new Error('Amount exceeds numeric(18,2)');
  return result;
}
export function formatMoney(value) {
  if (typeof value !== 'bigint' || value < 0n || value > 999999999999999999n) throw new Error('Invalid minor units');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
/** Claim balances in integer paise; database must enforce these under a lock. */
export function claimBalances({ claimed, allowed, advance, availableAdvance, payments }) {
  const c = money(claimed), a = money(allowed), adv = money(advance), available = money(availableAdvance);
  if (a > c || adv > a || adv > available) throw new Error('Invalid claim or advance');
  const paid = payments.reduce((sum, payment) => sum + money(payment), 0n);
  const net = a - adv;
  if (paid > net) throw new Error('Payments exceed payable');
  return { rejected: formatMoney(c - a), netPayable: formatMoney(net), outstanding: formatMoney(net - paid), unusedAdvance: formatMoney(available - adv) };
}
/** Return a contact candidate, never a decision to merge inquiries. */
export function contactMatch(a, b) {
  const email = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const phone = value => typeof value === 'string' ? value.replace(/[\s()-]/g, '') : '';
  const ae = email(a.email), be = email(b.email), ap = phone(a.phone), bp = phone(b.phone);
  return Boolean((ae && ae === be) || (ap && ap === bp));
}
export function providerIdentity(organizationId, providerAccountId, inquiryId) {
  const parts = [organizationId, providerAccountId, inquiryId];
  if (parts.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Missing source identity; quarantine event');
  return JSON.stringify(parts.map(v => v.trim()));
}
export function canApproveClaim({ claimantMembershipId, approverMembershipId, active, authorized }) {
  return Boolean(claimantMembershipId && approverMembershipId && active === true && authorized === true && claimantMembershipId !== approverMembershipId);
}
export function tenderReadiness({ bidDecision, goApproved, checklist, compliance }) {
  const blockers = [];
  if (bidDecision !== 'Go' || goApproved !== true) blockers.push('Approved Go decision required');
  for (const item of checklist) {
    if (!item.mandatory) continue;
    const waived = item.waivable === true && item.independentWaiverApproved === true;
    if (!waived && !(item.currentDocument === true && item.verified === true && item.expired === false)) blockers.push(`Checklist: ${item.id}`);
  }
  for (const item of compliance) if (item.reviewed !== true) blockers.push(`Compliance: ${item.id}`);
  return { ready: blockers.length === 0, blockers };
}
/** Protect CSV cells against spreadsheet formula interpretation. */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@\-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
