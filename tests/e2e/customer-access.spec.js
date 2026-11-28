import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { read, utils, write } from 'xlsx';

test('admin provisions a scoped user, assigns a customer, and exchanges Excel workbooks', async ({page,browser},info)=>{
  test.skip(info.project.name!=='desktop'||process.env.TEST_LOCAL_ADMIN_EDGE!=='yes','Uses the disposable admin endpoint.');
  test.setTimeout(70_000);
  const account=execFileSync(process.execPath,['scripts/bootstrap-local.mjs','--disposable','--pilot-admin'],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  const email=/^Email: (.+)$/m.exec(account)[1], password=/^Password: (.+)$/m.exec(account)[1];
  const newEmail=`sales-${crypto.randomUUID()}@example.invalid`;
  const temporary='Synthetic-temp-01!';
  const chosen='Synthetic-updated-02!';
  async function signIn(target,address,secret){
    await target.getByLabel('Email',{exact:true}).fill(address);
    await target.getByLabel('Password',{exact:true}).fill(secret);
    await target.getByRole('button',{name:'Sign in',exact:true}).click();
  }
  async function go(target,label){
    await target.getByRole('navigation',{name:'SalesConnect'}).getByRole('button',{name:label,exact:true}).click();
  }
  await page.goto('/');
  await signIn(page,email,password);
  await go(page,'User Management');
  await page.getByRole('button',{name:'Create New User',exact:true}).click();
  const userEditor=page.getByRole('dialog',{name:'Create New User'});
  await userEditor.getByLabel('Full name').fill('Synthetic Sales Rep');
  await userEditor.getByLabel('Email address').fill(newEmail);
  await userEditor.getByLabel('Designation').fill('Sales Executive');
  await userEditor.getByLabel('Territory or region').fill('West Zone');
  await userEditor.getByLabel('Temporary password').fill(temporary);
  await expect(userEditor.getByLabel('Dashboard',{exact:true})).toBeChecked();
  await userEditor.getByLabel('Leads',{exact:true}).check();
  await userEditor.getByLabel('Customers',{exact:true}).check();
  await userEditor.getByRole('button',{name:'Create New User',exact:true}).click();
  await expect(page.getByRole('row',{name:/Synthetic Sales Rep/})).toContainText('Password setup');
  const rep=await browser.newPage();
  try{
    await rep.goto('http://127.0.0.1:5173/');
    await signIn(rep,newEmail,temporary);
    await rep.getByLabel('New password',{exact:true}).fill(chosen);
    await rep.getByLabel('Confirm password').fill(chosen);
    await rep.getByRole('button',{name:'Update password'}).click();
    await signIn(rep,newEmail,chosen);
    await expect(rep.getByRole('navigation',{name:'SalesConnect'})).toContainText('Customers');
    await expect(rep.getByRole('navigation',{name:'SalesConnect'}).getByText('User Management')).toHaveCount(0);
    await rep.goto('http://127.0.0.1:5173/users');
    await expect(rep.getByRole('heading',{name:'Access Restricted'})).toBeVisible();
    await go(page,'Customers');
    await page.getByRole('button',{name:'Add Customer',exact:true}).click();
    await page.getByLabel('Customer name',{exact:true}).fill('Synthetic Partner Account');
    await page.getByLabel('Account category').selectOption('Dealer / Distributor');
    await page.getByLabel('Account sub-type').selectOption('Regional Distributor');
    await page.getByLabel('City',{exact:true}).fill('Mumbai');
    await page.getByRole('button',{name:'Save customer'}).click();
    await expect(page.getByRole('heading',{name:'Synthetic Partner Account',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Assign as Lead',exact:true}).click();
    const assignment=page.getByRole('dialog',{name:'Assign Customer as Lead'});
    await assignment.getByRole('button',{name:'+ Quick Add Site'}).click();
    const site=page.getByRole('dialog',{name:'Quick Add Site'});
    await site.getByLabel('Site name').fill('Synthetic Warehouse');
    await site.getByLabel('Address').fill('1 Test Road');
    await site.getByLabel('City').fill('Mumbai');
    await site.getByRole('button',{name:'Save site',exact:true}).click();
    await expect(assignment.getByLabel('Site / Branch').locator('option:checked')).toHaveText('Synthetic Warehouse');
    await assignment.getByRole('button',{name:'+ Quick Add Contact'}).click();
    const contact=page.getByRole('dialog',{name:'Quick Add Contact'});
    await contact.getByLabel('Contact name').fill('Synthetic Partner Rep');
    await contact.getByLabel('Email').fill('partner@example.invalid');
    await contact.getByRole('button',{name:'Save contact',exact:true}).click();
    await expect(assignment.getByLabel('Primary contact').locator('option:checked')).toHaveText('Synthetic Partner Rep');
    await assignment.getByLabel('Assign to user').selectOption({label:'Synthetic Sales Rep · Sales Executive · West Zone'});
    await expect(assignment.getByLabel('Lead type / inquiry context')).toHaveValue('Dealer / Stocking / Tender Inquiry');
    await assignment.getByRole('button',{name:'Assign as Lead',exact:true}).click();
    await page.getByRole('button',{name:'View Lead →'}).click();
    await expect(page.getByRole('heading',{name:'Synthetic Partner Account',exact:true})).toBeVisible();
    const assigned=page.url();
    await rep.goto(assigned);
    await expect(rep.getByRole('heading',{name:'Synthetic Partner Account',exact:true})).toBeVisible();

    await go(page,'Leads');
    for(const type of ['biff8','xlsx']){
      const filename=type==='biff8'?'legacy.xls':'current.xlsx';
      const workbook=utils.book_new();
      utils.book_append_sheet(workbook,utils.aoa_to_sheet([
        ['prospect_name','received_at','contact_route','requirement_text'],
        [`Synthetic ${type} import`,'2026-01-01T09:00:00+05:30','workbook@example.invalid','Workbook inquiry'],
      ]),'Leads');
      await page.locator('summary').filter({hasText:'Import / Export'}).click();
      await page.getByRole('button',{name:'Import leads from CSV or Excel',exact:true}).click();
      const importer=page.getByRole('dialog',{name:'Import leads from CSV or Excel'});
      await importer.getByLabel('CSV or Excel file').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:write(workbook,{type:'buffer',bookType:type})});
      await importer.getByRole('button',{name:'Import 1 valid row'}).click();
      await expect(importer.getByText(/1 (?:XLS|XLSX) row saved/)).toBeVisible();
      await importer.getByRole('button',{name:'Close dialog'}).click();
    }
    await page.locator('summary').filter({hasText:'Import / Export'}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export Excel',exact:true}).click()]);
    expect(download.suggestedFilename()).toBe('salesconnect-leads.xlsx');
    const workbook=read(await readFile(await download.path()));
    const exported=utils.sheet_to_json(workbook.Sheets.Leads,{header:1});
    expect(exported.some(row=>row.includes('Synthetic biff8 import'))).toBe(true);
    expect(exported.some(row=>row.includes('Synthetic xlsx import'))).toBe(true);
    await go(rep,'Leads');
    await expect(rep.getByText('Synthetic xlsx import',{exact:true})).toHaveCount(0);
    const [readLead]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/rpc/read_lead_management')&&
      response.request().postDataJSON()?.p_id),page.getByRole('button',{name:'Synthetic xlsx import',exact:true}).click()]);
    await rep.goto('http://127.0.0.1:5173/leads/'+readLead.request().postDataJSON().p_id);
    await expect(rep.getByRole('alert').filter({hasText:'You do not have permission to view this lead'})).toBeVisible();
    await go(page,'User Management');
    const sales=page.getByRole('row',{name:/Synthetic Sales Rep/});
    await sales.getByRole('button',{name:'Reset Password',exact:true}).click();
    const reset=page.getByRole('dialog',{name:'Reset Password'});
    await reset.getByLabel('Temporary password').fill('Synthetic-reset-03!');
    await reset.getByRole('button',{name:'Reset Password',exact:true}).click();
    await expect(sales).toContainText('Password setup');
    const resetPage=await browser.newPage();
    try {
      await resetPage.goto('http://127.0.0.1:5173/');
      await signIn(resetPage,newEmail,'Synthetic-reset-03!');
      await expect(resetPage.getByLabel('New password',{exact:true})).toBeVisible();
    } finally {await resetPage.close();}
  } finally {await rep.close();}
});
