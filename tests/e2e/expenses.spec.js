import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('an employee saves a travel draft and an itemized claim across reload', async ({ page }) => {
  const account = execFileSync(process.execPath, ['scripts/bootstrap-local.mjs', '--disposable'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const email = /^Email: (.+)$/m.exec(account)?.[1];
  const password = /^Password: (.+)$/m.exec(account)?.[1];
  if (!email || !password) throw new Error('Synthetic account setup did not return sign-in details.');

  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  async function openExpenses() {
    if ((page.viewportSize()?.width ?? 0) <= 700) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('navigation', { name: 'SalesConnect' }).getByRole('button', { name: 'Expenses', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Travel & expenses', exact: true })).toBeVisible();
  }
  await openExpenses();
  await page.getByRole('button', { name: 'My travel', exact: true }).click();
  await page.getByRole('button', { name: 'New travel request', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic regional trip');
  await page.getByLabel('Start date', { exact: true }).fill('2027-01-10');
  await page.getByLabel('End date', { exact: true }).fill('2027-01-12');
  await page.getByLabel('Geography code', { exact: true }).fill('WEST');
  await page.getByLabel('Travel type code', { exact: true }).fill('FIELD');
  await page.getByLabel('Estimated amount', { exact: true }).fill('500.00');
  await page.getByLabel('Business purpose', { exact: true }).fill('Synthetic demonstration');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic regional trip' })).toBeVisible();

  await page.getByRole('button', { name: 'My claims', exact: true }).click();
  await page.getByRole('button', { name: 'New claim', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic expense claim');
  await page.getByRole('button', { name: 'Add expense line' }).click();
  await page.getByLabel('Category code', { exact: true }).fill('MEALS');
  await page.getByLabel('Service date', { exact: true }).fill('2026-01-10');
  await page.getByLabel('Geography code', { exact: true }).fill('WEST');
  await page.getByLabel('Travel type code', { exact: true }).fill('FIELD');
  await page.getByLabel('Actual amount', { exact: true }).fill('125.50');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic expense claim' })).toBeVisible();

  await page.reload();
  await openExpenses();
  await page.getByRole('button', { name: 'Synthetic expense claim', exact: true }).click();
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await expect(page.getByLabel('Actual amount', { exact: true })).toHaveValue('125.50');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
