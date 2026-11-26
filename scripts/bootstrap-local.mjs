import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const workspace = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const project = 'avi-salesconnect-local';
const container = `supabase_db_${project}`;

async function bootstrap() {
  if (process.argv.length !== 3 || process.argv[2] !== '--disposable') {
    throw new Error('Run npm run dev:bootstrap -- --disposable against the repository’s local test stack.');
  }
  const labels = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (labels['com.supabase.cli.project'] !== project || labels['com.supabase.cli.workdir'] !== workspace) {
    throw new Error('Start the disposable stack from this workspace before provisioning a synthetic account.');
  }
  const cli = resolve(workspace, 'node_modules', 'supabase', 'dist', 'supabase.js');
  const status = parseEnv(execFileSync(process.execPath, [cli, 'status', '-o', 'env', '--workdir', workspace], {
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (status.API_URL !== 'http://127.0.0.1:54321' || !status.SERVICE_ROLE_KEY) {
    throw new Error('Expected the disposable Supabase API at http://127.0.0.1:54321.');
  }

  const operator = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const organization = randomUUID();
  const email = `demo-${organization}@example.invalid`;
  const password = `Local-${randomBytes(24).toString('base64url')}!9aA`;
  const { data, error } = await operator.auth.admin.createUser({ email, password, email_confirm: true });
  const user = data?.user?.id;
  if (error || !user || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(user)) {
    throw new Error('Could not create a synthetic Auth user.');
  }

  try {
    execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres', '-qAt'], {
      input: `
        begin;
        insert into public.organizations (id, name, timezone, base_currency, financial_year_start_month)
        values ('${organization}', 'Synthetic AVI SalesConnect', 'Asia/Kolkata', 'INR', 4);
        select private.provision_intake_staff(
          '${organization}', '${user}', 'Synthetic staff', null, '${randomUUID()}'
        );
        commit;
      `,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    const cleanup = await operator.auth.admin.deleteUser(user);
    throw new Error(cleanup.error
      ? 'Local membership setup failed and the synthetic Auth user could not be removed. Check the disposable stack.'
      : 'Local membership setup failed. The synthetic Auth user was removed.');
  }

  process.stdout.write(`Synthetic local account\nEmail: ${email}\nPassword: ${password}\n`);
}

bootstrap().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
