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
  await page.getByLabel('Customer name', { exact: true }).fill('Synthetic Hospital');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByText('Synthetic Hospital', { exact: true })).toBeVisible();
  if (checkFiles) {
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
  await page.getByLabel('Customer or contact name').fill('Synthetic Inquiry');
  const localReceiptTime = await page.evaluate(() => {
    const earlier = new Date(Date.now() - 60_000);
    return new Date(earlier.getTime() - earlier.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Received at').fill(localReceiptTime);
  await page.getByLabel('Phone number or email').fill('inquiry@example.invalid');
  await page.getByLabel('Link a visible customer').selectOption({ label: 'Synthetic Hospital' });
  await page.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByText('Synthetic Inquiry', { exact: true })).toBeVisible();
  if (info.project.name === 'desktop') {
    await page.getByText('Import leads from CSV', { exact: true }).click();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'synthetic.csv', mimeType: 'text/csv',
      buffer: Buffer.from('prospect_name,received_at,contact_route,requirement_text\r\n' +
        'Synthetic CSV,2026-01-01T10:30:00+05:30,csv@example.invalid,"Two, quoted items"\r\n'),
    });
    await page.getByRole('button', { name: 'Import 1 valid row' }).click();
    await expect(page.getByText('1 CSV row saved or matched to your earlier import.')).toBeVisible();
    await expect(page.getByText('Two, quoted items')).toBeVisible();
    await open('Reports');
    await expect(page.getByRole('row', { name: 'CSV 1' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
