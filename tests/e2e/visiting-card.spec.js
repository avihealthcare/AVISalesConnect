import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const sampleImage = {
  name:'synthetic-card.png', mimeType:'image/png',
  buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6B0AAAAASUVORK5CYII=','base64'),
};

test('scanned leads support review, duplicate linking, batch capture and manual fallback', async ({ page }, info) => {
  test.skip(process.env.TEST_LOCAL_CARD_EDGE !== 'yes', 'Enable the disposable visiting-card Edge function.');
  const account=execFileSync(process.execPath,['scripts/bootstrap-local.mjs','--disposable'],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill(/^Email: (.+)$/m.exec(account)[1]);
  await page.getByLabel('Password',{exact:true}).fill(/^Password: (.+)$/m.exec(account)[1]);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Executive Sales & Field Operations Overview'})).toBeVisible();
  async function open(name) {
    if (info.project.name==='phone') await page.getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('navigation',{name:'SalesConnect'}).getByRole('button',{name,exact:true}).click();
  }
  await open('Hospitals and Customers');
  await page.getByRole('button',{name:'Add a customer',exact:true}).click();
  await page.getByLabel('Customer name',{exact:true}).fill('Synthetic Scan Hospital');
  await page.getByRole('button',{name:'Save customer',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Scan Hospital',exact:true})).toBeVisible();
  await open('Leads');
  let extractionCalls=0;
  await page.route('**/functions/v1/scan-visiting-card',async route=>{
    if(route.request().method()!=='POST'||route.request().headers()['x-avi-card-action']!=='extract'||extractionCalls++) {
      await route.continue();
      return;
    }
    await route.fulfill({json:{fields:{
      contact:{value:'Synthetic Doctor',confidence:'high'},customer:{value:'Synthetic Scan Hospital',confidence:'high'},
      salutation:{value:'Dr.',confidence:'high'},department:{value:'NICU',confidence:'medium'},
      designation:{value:'Neonatologist',confidence:'high'},mobile:{value:'+919000000001',confidence:'high'},
      pincode:{value:'400001',confidence:'low'},
    }}});
  });
  await page.locator('summary').filter({hasText:'Add New Lead'}).click();
  await page.getByRole('button',{name:/Scan Visiting Card/}).click();
  const scanner=page.getByRole('dialog',{name:'Scan Visiting Card'});
  await expect(scanner.getByRole('button',{name:'Extract Details',exact:true})).toBeDisabled();
  await scanner.getByLabel('Choose front side image').setInputFiles(sampleImage);
  await expect(scanner.getByRole('img',{name:'Front side preview'})).toBeVisible();
  await scanner.getByRole('button',{name:'Rotate 90°'}).click();
  await scanner.getByRole('button',{name:'Crop',exact:true}).click();
  await expect(scanner.getByRole('slider',{name:'left'})).toBeVisible();
  await scanner.getByLabel('Add Back Side').check();
  await scanner.getByLabel('Choose back side image').setInputFiles(sampleImage);
  await scanner.getByRole('button',{name:'Extract Details',exact:true}).click();
  await expect(scanner.getByRole('heading',{name:/Verify details/})).toBeFocused();
  await expect(scanner.getByLabel('Lead source')).toHaveValue('visiting_card');
  await expect(scanner.getByLabel('Contact Full Name')).toHaveValue('Synthetic Doctor');
  await expect(scanner.getByLabel('PIN code')).toHaveClass('avi-card-low');
  await expect(scanner.getByText('Existing hospital or contact found')).toBeVisible();
  await scanner.getByLabel('Link a visible customer').selectOption({label:'Synthetic Scan Hospital'});
  await scanner.getByRole('button',{name:'Save & Scan Another',exact:true}).click();
  await expect(scanner.getByText(/saved. Add the next card/)).toBeVisible();
  await scanner.getByLabel('Choose front side image').setInputFiles(sampleImage);
  await scanner.getByRole('button',{name:'Extract Details',exact:true}).click();
  await expect(scanner.getByRole('alert')).toContainText('Automatic extraction is unavailable');
  await scanner.getByRole('button',{name:'Enter Details Manually',exact:true}).click();
  await expect(scanner.getByRole('img',{name:'Front side reference'})).toBeVisible();
  await scanner.getByLabel('Hospital or organisation name').fill('Synthetic Manual Card');
  await scanner.getByLabel('Email address').fill('manual-card@example.invalid');
  await scanner.getByRole('button',{name:'Save & Create Lead',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Manual Card',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Documents',exact:true}).click();
  await expect(page.getByText('Original front side', {exact:true})).toBeVisible();
});
