import test from 'node:test';
import assert from 'node:assert/strict';
import {utils,write} from 'xlsx';
import {readLeadWorkbook} from '../../apps/web/src/spreadsheets.ts';

test('lead workbook preview reads legacy and current Excel files and flags formulas',async()=>{
  for(const bookType of ['biff8','xlsx']){
    const book=utils.book_new();
    const sheet=utils.aoa_to_sheet([
      ['prospect_name','received_at','contact_route'],
      ['Synthetic hospital','2026-01-01T10:00:00+05:30','+919000000001'],
    ]);
    utils.book_append_sheet(book,sheet,'Leads');
    const parsed=await readLeadWorkbook(write(book,{type:'array',bookType}));
    assert.deepEqual(parsed.data,[['prospect_name','received_at','contact_route'],
      ['Synthetic hospital','2026-01-01T10:00:00+05:30','+919000000001']]);
  }
  const book=utils.book_new();
  const serial=(Date.UTC(2026,0,1,10)-Date.UTC(1899,11,30))/86_400_000;
  const sheet=utils.aoa_to_sheet([['prospect_name','received_at'],['Example',serial]]);
  sheet.A2={t:'s',v:'Cached name',f:'"Cached name"'};
  sheet.B2.z='yyyy-mm-dd hh:mm:ss';
  utils.book_append_sheet(book,sheet,'Leads');
  const {data,formulas}=await readLeadWorkbook(write(book,{type:'array',bookType:'xlsx'}));
  assert.equal(data[1][1],'2026-01-01T10:00:00+05:30');
  assert.deepEqual([...formulas],[1]);
});
