import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

async function cardImage(page, name, lines) {
  const encoded = await page.evaluate(lines => {
    const canvas = document.createElement('canvas');
    canvas.width = 1100;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.fillStyle = '#102c47';
    context.font = '44px Arial';
    lines.forEach((line,index)=>context.fillText(line,65,90+index*73));
    return canvas.toDataURL().split(',')[1];
  },lines);
  return { name, mimeType:'image/png', buffer:Buffer.from(encoded,'base64') };
}

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
  const front = await cardImage(page, 'front.png', [
    'Synthetic Scan Hospital', 'Dr. Synthetic Doctor', 'Consultant Neonatologist', '+91 90000 00001', 'Mumbai 400001',
  ]);
  const back = await cardImage(page, 'back.png', [
    'Secondary Clinic', 'Email: clinic@example.invalid', 'Landline: 022-2345-6789', 'www.example.invalid',
  ]);
  const blank = await cardImage(page, 'blank.png', []);
  const cardRequests = [];
  const knownOrigins = new Set([new URL(page.url()).origin, process.env.LOCAL_SUPABASE_URL]);
  const external = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/functions/v1/scan-visiting-card') && request.method()==='POST') cardRequests.push(request);
    if (url.protocol.startsWith('http') && !knownOrigins.has(url.origin)) external.push(url.origin);
  });
  await page.locator('summary').filter({hasText:'Add New Lead'}).click();
  await page.getByRole('button',{name:/Scan Visiting Card/}).click();
  const scanner=page.getByRole('dialog',{name:'Scan Visiting Card'});
  await expect(scanner.getByRole('button',{name:'Extract Details',exact:true})).toBeDisabled();
  await scanner.getByLabel('Choose front side image').setInputFiles(front);
  await expect(scanner.getByRole('img',{name:'Front side preview'})).toBeVisible();
  const rotate = scanner.getByRole('button',{name:'Rotate 90°'});
  for (let turn=0;turn<4;turn++) await rotate.click();
  await scanner.getByRole('button',{name:'Crop',exact:true}).click();
  await expect(scanner.getByRole('slider',{name:'left'})).toBeVisible();
  await scanner.getByLabel('Add Back Side').check();
  await scanner.getByLabel('Choose back side image').setInputFiles(back);
  await scanner.getByRole('button',{name:'Extract Details',exact:true}).click();
  await expect(scanner.getByRole('heading',{name:/Verify details/})).toBeFocused({timeout:20000});
  await expect(scanner.getByLabel('Lead source')).toHaveValue('visiting_card');
  await expect(scanner.getByLabel('Contact Full Name')).toHaveValue('Synthetic Doctor');
  await expect(scanner.getByLabel('Hospital or organisation name')).toHaveValue('Synthetic Scan Hospital');
  await expect(scanner.getByLabel('Hospital or organisation name')).toHaveClass('avi-card-low');
  await expect(scanner.getByLabel('Email address')).toHaveValue('clinic@example.invalid');
  await expect(scanner.getByLabel('Secondary / Landline Number')).toHaveValue('+912223456789');
  expect(cardRequests).toHaveLength(0);
  expect(external).toEqual([]);
  await expect(scanner.getByText('Existing hospital or contact found')).toBeVisible();
  await scanner.getByLabel('Link a visible customer').selectOption({label:'Synthetic Scan Hospital'});
  await scanner.getByRole('button',{name:'Save & Scan Another',exact:true}).click();
  await expect(scanner.getByText(/saved. Add the next card/)).toBeVisible();
  await scanner.getByLabel('Choose front side image').setInputFiles(blank);
  await scanner.getByRole('button',{name:'Extract Details',exact:true}).click();
  await expect(scanner.getByRole('alert')).toContainText('No readable card details found');
  await scanner.getByRole('button',{name:'Enter Details Manually',exact:true}).click();
  await expect(scanner.getByRole('img',{name:'Front side reference'})).toBeVisible();
  await scanner.getByLabel('Hospital or organisation name').fill('Synthetic Manual Card');
  await scanner.getByLabel('Email address').fill('manual-card@example.invalid');
  await scanner.getByRole('button',{name:'Save & Create Lead',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Manual Card',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Documents',exact:true}).click();
  await expect(page.getByText('Original front side', {exact:true})).toBeVisible();
  expect(cardRequests.map(request=>request.headers()['x-avi-card-action'])).toEqual(['upload','upload']);
});
