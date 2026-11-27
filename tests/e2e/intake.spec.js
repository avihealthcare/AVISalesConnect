import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('staff signs in by email and saves a linked customer and lead', async ({ page }, info) => {
  const checkFiles = process.env.TEST_LOCAL_FILE_EDGE === 'yes' && info.project.name === 'desktop';
  const options = checkFiles ? ['--file-access'] : [];
  const account = execFileSync(process.execPath, ['scripts/bootstrap-local.mjs', '--disposable', ...options], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const email = /^Email: (.+)$/m.exec(account)?.[1];
  const password = /^Password: (.+)$/m.exec(account)?.[1];
  if (!email || !password) throw new Error('Synthetic account setup did not return sign-in details.');

  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Executive Sales & Field Operations Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toHaveCount(0);
  async function open(name) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    if ((page.viewportSize()?.width ?? 0) <= 700) await menu.click();
    await page.getByRole('navigation', { name: 'SalesConnect' }).getByRole('button', { name, exact: true }).click();
  }

  await open('Hospitals and Customers');
  await page.getByRole('button',{name:'Add a customer',exact:true}).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Synthetic Hospital');
  await page.getByLabel('City',{exact:true}).fill('Mumbai');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByRole('heading',{name:'Synthetic Hospital',exact:true})).toBeVisible();
  if (checkFiles) {
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: 'Attachments', exact: true }).click();
    await page.getByLabel('Add attachment').setInputFiles({
      name: 'Synthetic.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% synthetic browser test\n'),
    });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page.getByText('Attachment saved and awaiting a scan.')).toBeVisible();
    await expect(page.getByText('Awaiting scan', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole('button', { name: 'Attachments', exact: true })).toHaveCount(0);
  }
  await open('Leads');
  await page.locator('summary').filter({hasText:'Add New Lead'}).click();
  await page.getByRole('button',{name:'Manual Entry'}).click();
  const editor=page.getByRole('dialog',{name:'Add New Lead'});
  await editor.getByLabel('Hospital or organisation name').fill('Synthetic Inquiry');
  await editor.getByLabel('Lead source').selectOption('indiamart');
  await editor.getByLabel('External inquiry reference').fill('SYN-2026-0001');
  const localReceiptTime = await page.evaluate(() => {
    const earlier = new Date(Date.now() - 60_000);
    return new Date(earlier.getTime() - earlier.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Received at').fill(localReceiptTime);
  await editor.getByLabel('Email address').fill('inquiry@example.invalid');
  await editor.getByLabel('Lead priority').selectOption('Hot');
  if (info.project.name === 'desktop') {
    await editor.getByLabel('Current sales stage').selectOption('demo_requested');
    await editor.getByLabel('Next action').fill('Confirm the demonstration date');
    await editor.getByLabel('Expected order value (INR)').fill('1250000');
    await editor.getByLabel('Product specifications or requirements').fill('Synthetic equipment requirement');
    for (const [model,quantity,price] of [['Synthetic warmer','2','2000.50'],['Synthetic monitor','3','500.00']]) {
      await editor.getByRole('button',{name:'Add product',exact:true}).click();
      const product=editor.getByRole('group',{name:model.includes('warmer')?'Product 1':'Product 2'});
      await product.getByLabel('Product category').fill('Synthetic category');
      await product.getByLabel('Product model').fill(model);
      await product.getByLabel('Required quantity').fill(quantity);
      await product.getByLabel('Estimated unit price (INR)').fill(price);
    }
  }
  await page.getByLabel('Link a visible customer').selectOption({ label: 'Synthetic Hospital' });
  await editor.getByRole('button', { name: 'Create Lead',exact:true }).click();
  await expect(page.getByRole('heading',{name:'Synthetic Inquiry',exact:true})).toBeVisible();
  if (info.project.name === 'desktop') {
    await page.getByRole('button',{name:'Products and Requirements',exact:true}).click();
    await expect(page.getByRole('cell',{name:'Synthetic warmer',exact:true})).toBeVisible();
    await expect(page.getByRole('cell',{name:'Synthetic monitor',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Activity Timeline',exact:true}).click();
    await page.getByRole('button',{name:'Log Activity',exact:true}).click();
    await page.getByLabel('Activity type').selectOption('Call');
    await page.getByLabel('Activity summary').fill('Synthetic response to inquiry');
    await page.getByRole('button',{name:'Save Activity',exact:true}).click();
    await expect(page.getByText('Synthetic response to inquiry')).toBeVisible();
  }
  await page.getByRole('button',{name:'Back to leads',exact:false}).click();
  if (info.project.name === 'desktop') {
    await expect(page.getByRole('banner').getByRole('button',{name:'Notifications',exact:true})).toBeVisible();
    expect(await page.getByRole('banner').evaluate(element=>element.getBoundingClientRect().height)).toBe(56);
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('Search hospitals and leads')).toBeFocused();
    await expect(page.getByRole('region',{name:'Lead performance'})).toContainText('₹12.5 L');
    await page.getByRole('row',{name:/Synthetic Inquiry/}).hover();
    await page.getByRole('button',{name:'Schedule demo for Synthetic Inquiry'}).click();
    const demo=page.getByRole('dialog',{name:'Schedule Demo',exact:true});
    await demo.getByLabel('Demo date and time').fill('2036-12-02T14:00');
    await demo.getByLabel('Equipment or trial details').fill('Synthetic clinical demonstration');
    await demo.getByRole('button',{name:'Save Demo',exact:true}).click();
    await expect(page.getByText('Demo or trial scheduled.',{exact:true})).toBeVisible();
    await expect(page.getByRole('row',{name:/Synthetic Inquiry/})).toContainText('Demo Scheduled');
    await page.getByRole('button',{name:'Kanban',exact:true}).click();
    await expect(page.getByRole('region',{name:'Demonstration Requested'}).getByText('Synthetic Inquiry')).toBeVisible();
    await page.getByRole('button',{name:'Table',exact:true}).click();
    await page.getByText('Import / Export',{exact:true}).click();
    await page.getByRole('button',{name:'Import leads from CSV',exact:true}).click();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'synthetic.csv', mimeType: 'text/csv',
      buffer: Buffer.from('prospect_name,received_at,contact_route,requirement_text\r\n' +
        'Synthetic CSV,2026-01-01T10:30:00+05:30,csv@example.invalid,"Two, quoted items"\r\n'),
    });
    await page.getByRole('button', { name: 'Import 1 valid row' }).click();
    await expect(page.getByText('1 CSV row saved or matched to your earlier import.')).toBeVisible();
    await page.getByRole('dialog',{name:'Import leads from CSV',exact:true}).getByRole('button',{name:'Close dialog'}).click();
    await expect(page.getByText('Two, quoted items')).toBeVisible();
    await page.getByRole('button',{name:'Filters',exact:true}).click();
    await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('indiamart');
    await expect(page.getByText('Two, quoted items')).toHaveCount(0);
    await page.getByRole('button',{name:'Split',exact:true}).click();
    const queue=page.getByRole('navigation',{name:'Leads in this view',exact:true});
    await queue.getByRole('button',{name:/Synthetic Inquiry/}).click();
    await expect(page.getByRole('heading',{name:'Synthetic Inquiry',exact:true})).toBeVisible();
    await expect(queue.getByRole('button',{name:/Synthetic Inquiry/})).toHaveAttribute('aria-current','page');
    await expect(page.locator('.avi-lead-path [aria-current=step]')).toHaveText('Demonstration Requested');

    await page.getByRole('button',{name:'Schedule Follow-up',exact:true}).click();
    const schedule=page.getByRole('dialog',{name:'Schedule Follow-up',exact:true});
    await schedule.getByLabel('Next action',{exact:true}).fill('Confirm synthetic follow-up');
    await schedule.getByLabel('Next follow-up date').fill('2036-12-01T12:00');
    await schedule.getByRole('button',{name:'Save Follow-up',exact:true}).click();
    await expect(schedule).toHaveCount(0);
    await expect(page.locator('.avi-lead-work')).toContainText('Confirm synthetic follow-up');
    await page.getByRole('button',{name:/Back to leads/}).click();
    await page.getByRole('button',{name:'Save View',exact:true}).click();
    const saved=page.getByRole('dialog',{name:'Save Lead View',exact:true});
    await saved.getByLabel('View name').fill('IndiaMART split queue');
    await saved.getByRole('button',{name:'Save View',exact:true}).click();
    await page.locator('summary').filter({hasText:'IndiaMART split queue'}).click();
    await page.getByRole('button',{name:'Pin as Default',exact:true}).click();
    await page.reload();
    await open('Leads');
    await expect(page.locator('summary').filter({hasText:'IndiaMART split queue'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Split',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.locator('summary').filter({hasText:'IndiaMART split queue'}).click();
    await page.getByRole('button',{name:'Unpin Default',exact:true}).click();
    await page.getByRole('button',{name:'Remove Saved View',exact:true}).click();

    await page.getByRole('button',{name:'Kanban',exact:true}).click();
    const card=page.getByRole('region',{name:'Demonstration Requested',exact:true}).locator('[draggable=true]');
    const target=page.getByRole('region',{name:'Qualified',exact:true});
    const transfer=await page.evaluateHandle(()=>new DataTransfer());
    await card.dispatchEvent('dragstart',{dataTransfer:transfer});
    await target.dispatchEvent('dragover',{dataTransfer:transfer});
    await expect(target).toHaveAttribute('data-drop-target','true');
    await target.dispatchEvent('drop',{dataTransfer:transfer});
    const dragConfirm=page.getByRole('dialog',{name:'Change Sales Stage',exact:true});
    await expect(dragConfirm.getByRole('combobox',{name:'Move to stage'})).toHaveValue('qualified');
    await dragConfirm.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Move Synthetic Inquiry to another stage',exact:true}).click();
    const move=page.getByRole('dialog',{name:'Change Sales Stage',exact:true});
    await move.getByLabel('Move to stage').selectOption('qualified');
    await move.getByRole('button',{name:'Update Stage',exact:true}).click();
    await page.getByRole('region',{name:'Qualified',exact:true}).getByText('Synthetic Inquiry',{exact:true}).click();
    await page.getByRole('button',{name:'Convert Lead',exact:true}).click();
    await page.getByRole('dialog',{name:'Convert Lead',exact:true}).getByRole('button',{name:'Create Opportunity',exact:true}).click();
    await expect(page.getByText('Opportunity created.',{exact:true})).toBeVisible();
    await open('Reports');
    await expect(page.getByRole('row', { name: 'CSV import 1' })).toBeVisible();
  }
  await page.getByLabel('Search hospitals and leads').fill('Synthetic Hospital');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible();
  await page.getByRole('button', { name: 'Synthetic Hospital', exact: true }).click();
  await expect(page.getByLabel('Search by name')).toHaveValue('Synthetic Hospital');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  const scrollsHorizontally = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrollsHorizontally).toBe(false);

  await page.reload();
  await open('Leads');
  await expect(page.getByText('Synthetic Inquiry', { exact: true })).toBeVisible();
  await page.getByLabel('User profile',{exact:true}).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
