import test from 'node:test';
import assert from 'node:assert/strict';
import { money, formatMoney, claimBalances, contactMatch, providerIdentity, canApproveClaim, tenderReadiness, csvCell } from '../../packages/domain/index.js';

test('money is exact and rejects ambiguous and out-of-range inputs', () => {
  assert.equal(formatMoney(money('10000.01') + money('0.09')), '10000.10');
  for (const v of ['-1', '1.001', '1e3', ' 1', '01', '10000000000000000.00', 1]) assert.throws(() => money(v));
});
test('claim balances enforce advance and payment limits', () => {
  const data = {claimed:'10000', allowed:'10000', advance:'3000', availableAdvance:'3000', payments:['5000']};
  assert.deepEqual(claimBalances(data), {rejected:'0.00', netPayable:'7000.00', outstanding:'2000.00', unusedAdvance:'0.00'});
  assert.throws(() => claimBalances({...data, payments:['5000','5000']}));
  assert.throws(() => claimBalances({...data, availableAdvance:'2999'}));
});
test('matching contact information is a candidate, not an inquiry identity', () => {
  assert.equal(contactMatch({email:' A@EXAMPLE.COM '}, {email:'a@example.com'}), true);
  assert.equal(contactMatch({}, {}), false);
  assert.notEqual(providerIdentity('org','account','one'), providerIdentity('org','account','two'));
  assert.throws(() => providerIdentity('org','account',''));
});
test('approval requires independent active authorized member', () => {
  assert.equal(canApproveClaim({claimantMembershipId:'a', approverMembershipId:'a', active:true, authorized:true}), false);
  assert.equal(canApproveClaim({claimantMembershipId:'a', approverMembershipId:'b', active:false, authorized:true}), false);
  assert.equal(canApproveClaim({claimantMembershipId:'a', approverMembershipId:'b', active:true, authorized:true}), true);
});
test('tender readiness blocks expired and non-waivable documents', () => {
  const item = {id:'certificate', mandatory:true, currentDocument:true, verified:true, expired:true, waivable:false, independentWaiverApproved:true};
  assert.equal(tenderReadiness({bidDecision:'Go', checklist:[], compliance:[]}).ready, false);
  assert.equal(tenderReadiness({bidDecision:'Go', goApproved:true, checklist:[item], compliance:[]}).ready, false);
  assert.equal(tenderReadiness({bidDecision:'Go', goApproved:true, checklist:[{...item, waivable:true}], compliance:[{id:'deviation', reviewed:false}]}).ready, false);
  assert.equal(tenderReadiness({bidDecision:'Go', goApproved:true, checklist:[{...item, expired:false}], compliance:[{id:'deviation', reviewed:true}]}).ready, true);
});
test('CSV cells quote content and neutralize formulas including leading whitespace', () => {
  assert.equal(csvCell(' =1+1'), '"\' =1+1"');
  assert.equal(csvCell('"name"'), '"""name"""');
});
