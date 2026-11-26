import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { totp } from '../support/totp.js';

test('staff completes MFA and saves a linked customer and lead', async ({ page }) => {
  const account = execFileSync(process.execPath, ['scripts/bootstrap-local.mjs', '--disposable'], {
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
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up an authenticator' }).click();
  const setup = page.getByText(/^Setup key:/);
  await expect(setup).toBeVisible();
  const secret = (await setup.locator('code').textContent())?.trim();
  if (!secret) throw new Error('The local authenticator setup key is missing.');
  // Avoid starting verification just as the authenticator code is due to change.
  const secondsRemaining = 30 - Math.floor(Date.now() / 1000) % 30;
  if (secondsRemaining < 4) await new Promise(resolve => setTimeout(resolve, secondsRemaining * 1000));
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales workspace' })).toBeVisible();

  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('Synthetic Hospital');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByText('Synthetic Hospital', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leads', exact: true }).click();
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
  const scrollsHorizontally = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrollsHorizontally).toBe(false);

  await page.reload();
  await page.getByRole('button', { name: 'Leads', exact: true }).click();
  await expect(page.getByText('Synthetic Inquiry', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
