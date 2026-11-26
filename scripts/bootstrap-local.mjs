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
  const [, , confirmDisposable, ...options] = process.argv;
  const invite = options.includes('--invite-link');
  const pilotAdmin = options.includes('--pilot-admin');
  const fileAccess = options.includes('--file-access');
  if (confirmDisposable !== '--disposable' || options.length !== Number(invite) + Number(pilotAdmin) + Number(fileAccess)) {
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
  const { data, error } = invite
    ? await operator.auth.admin.generateLink({
        type: 'invite', email, options: { redirectTo: 'http://127.0.0.1:5173/' },
      })
    : await operator.auth.admin.createUser({ email, password, email_confirm: true });
  const user = data?.user?.id;
  if (error || !user || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(user)) {
    throw new Error('Could not create a synthetic Auth user.');
  }

  const request = randomUUID();
  const provisionMembership = pilotAdmin
    ? `select private.provision_pilot_super_admin('${organization}', '${user}', 'Synthetic administrator', '${request}');`
    : `select private.provision_intake_staff('${organization}', '${user}', 'Synthetic staff', null, '${request}');`;
  const fileRole = randomUUID();
  const grantFiles = fileAccess ? `
    insert into public.roles(id,organization_id,code,name,requires_mfa)
    values ('${fileRole}','${organization}','file_fixture','Synthetic attachment access',true);
    insert into public.role_permissions(organization_id,role_id,permission_code)
    values ('${organization}','${fileRole}','file.stage'),('${organization}','${fileRole}','file.download');
    insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
    select organization_id,id,'${fileRole}',now() from public.memberships
    where organization_id='${organization}' and user_id='${user}';
  ` : '';
  try {
    execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres', '-qAt'], {
      input: `
        begin;
        insert into public.organizations (id, name, timezone, base_currency, financial_year_start_month)
        values ('${organization}', 'Synthetic AVI SalesConnect', 'Asia/Kolkata', 'INR', 4);
        ${provisionMembership}
        ${grantFiles}
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

  process.stdout.write(`Synthetic local account\nEmail: ${email}\n`);
  if (invite && data && 'properties' in data) {
    process.stdout.write(`Invitation: ${data.properties.action_link}\n`);
  } else {
    process.stdout.write(`Password: ${password}\n`);
  }
}

bootstrap().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
