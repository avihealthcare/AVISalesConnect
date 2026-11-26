import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('invited pilot admin sets a password and reaches administration', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The same invitation flow runs on all viewport sizes.');
  const output = execFileSync(process.execPath, ['scripts/bootstrap-local.mjs', '--disposable', '--invite-link', '--pilot-admin'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const email = /^Email: (.+)$/m.exec(output)?.[1];
  const invitation = /^Invitation: (.+)$/m.exec(output)?.[1];
  if (!email || !invitation) throw new Error('Local invitation setup failed.');

  await page.goto(invitation);
  await expect(page.getByRole('heading', { name: 'Choose a password' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  const password = `Local-${randomUUID()}aA1!`;
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Administration' }).click();
  await expect(page.getByRole('heading', { name: 'Staff administration' })).toBeVisible();
  await expect(page.getByText('Synthetic administrator', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deactivate access' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add expense rule' }).click();
  await page.getByLabel('Category code').fill('MILEAGE');
  await page.getByLabel('Calculation').selectOption('mileage');
  await page.getByLabel(/Rate per kilometre/).fill('12.50');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText(/Saved version 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Tender approval' }).click();
  await page.getByRole('button', { name: 'Add approval route' }).click();
  await page.getByLabel('Approval step').selectOption('waiver');
  await page.getByLabel('Primary approver').selectOption({ label: 'Synthetic administrator' });
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText(/Saved version 1/)).toBeVisible();
  await page.getByRole('button', { name: 'Expense policy' }).click();
  await expect(page.getByLabel(/Rate per kilometre/)).toHaveValue('12.50');

  const navigation = page.getByRole('navigation', { name: 'SalesConnect' });
  await navigation.getByRole('button',{name:'Leads',exact:true}).click();
  await page.getByRole('button',{name:'Lead Settings',exact:true}).click();
  await page.getByLabel('Display name').fill('Synthetic campaign');
  await page.getByRole('button',{name:'Add Configuration',exact:true}).click();
  await expect(page.getByRole('status').getByText('Saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Add New Lead/}).click();
  const editor=page.getByRole('dialog',{name:'Add New Lead'});
  await editor.getByLabel('Lead source').selectOption('synthetic_campaign');
  await editor.getByLabel('Hospital or organisation name').fill('Synthetic close and reopen');
  await editor.getByLabel('Email address').fill('reopen@example.invalid');
  await editor.getByRole('button',{name:'Create Lead',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic close and reopen',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Change Stage',exact:true}).click();
  const changeStage=page.getByRole('dialog',{name:'Change Sales Stage'});
  await changeStage.getByLabel('Move to stage').selectOption('lost');
  await changeStage.getByLabel('Lost lead reason').selectOption('price');
  await changeStage.getByRole('button',{name:'Update Stage',exact:true}).click();
  await page.getByRole('button',{name:'Reopen Lead',exact:true}).click();
  const reopen=page.getByRole('dialog',{name:'Reopen Lead'});
  await reopen.getByLabel('Move to stage').selectOption('contacted');
  await reopen.getByLabel('Reopening reason').fill('Synthetic customer returned');
  await reopen.getByRole('button',{name:'Reopen Lead',exact:true}).click();
  await page.getByRole('button',{name:'Status History',exact:true}).click();
  await expect(page.getByText('Synthetic customer returned',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Back to leads/}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Excel',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('salesconnect-leads.xml');

  await navigation.getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByLabel('Model or product name').fill('Synthetic model');
  await page.getByLabel('Product code').fill('SYN-CATALOG-1');
  await page.getByLabel('Category', { exact: true }).fill('Testing');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Synthetic model', { exact: true })).toBeVisible();

  await navigation.getByRole('button', { name: 'Attendance', exact: true }).click();
  await page.getByLabel('Location exception reason').fill('Synthetic browser has no GPS hardware');
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  await page.getByLabel('Location exception reason').fill('Synthetic browser has no GPS hardware');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Pending Review', { exact: true })).toBeVisible();

  await navigation.getByRole('button', { name: 'Tenders', exact: true }).click();
  await page.getByRole('button', { name: 'Register tender', exact: true }).click();
  await page.getByLabel('Procuring authority').fill('Synthetic authority');
  await page.getByLabel('Portal', { exact: true }).fill('GeM');
  await page.getByLabel('Bid reference').fill('SYN-BID-001');
  await page.getByLabel('Submission deadline').fill('2036-12-01T12:00');
  await page.getByRole('button', { name: 'Save tender', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SYN-BID-001', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Travel & expenses', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'My travel', exact: true }).click();
  await page.getByRole('button', { name: 'New travel request', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic training trip');
  await page.getByLabel('Start date', { exact: true }).fill('2036-12-03');
  await page.getByLabel('End date', { exact: true }).fill('2036-12-04');
  await page.getByLabel('Geography code').fill('MAHARASHTRA');
  await page.getByLabel('Travel type code').fill('DOMESTIC');
  await page.getByLabel('Estimated amount').fill('5000');
  await page.getByLabel('Business purpose').fill('Synthetic workflow check');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synthetic training trip', exact: true })).toBeVisible();
});
