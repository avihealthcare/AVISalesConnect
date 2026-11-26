import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { totp } from '../support/totp.js';

test('invited pilot admin sets a password and reaches administration after MFA', async ({ page }, info) => {
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
  await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sales workspace' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Set up an authenticator' }).click();
  const setupKey = page.getByText(/^Setup key:/).locator('code');
  await expect(setupKey).toBeVisible();
  const secret = (await setupKey.textContent())?.trim();
  if (!secret) throw new Error('The local authenticator setup key is missing.');
  const secondsRemaining = 30 - Math.floor(Date.now() / 1000) % 30;
  if (secondsRemaining < 4) await new Promise(resolve => setTimeout(resolve, secondsRemaining * 1000));
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByRole('button', { name: 'Administration' }).click();
  await expect(page.getByRole('heading', { name: 'Staff administration' })).toBeVisible();
  await expect(page.getByText('Synthetic administrator', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deactivate access' })).toHaveCount(0);
});
