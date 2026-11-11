const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function loadActions(updateResult = { data: { id: 'employee' }, error: null }, deleteError) {
  let updates = 0;
  let revalidations = 0;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'admin', active: true }, error: null }) }) }),
      update: () => {
        updates++;
        return { eq: () => ({ select: () => ({ single: async () => updateResult }) }) };
      },
    }),
  };
  const dependencies = {
    'server-only': {},
    '@supabase/supabase-js': { createClient: () => {
      if (deleteError === undefined) throw new Error('Unexpected privileged call');
      return { auth: { admin: { deleteUser: async () => ({ error: deleteError }) } } };
    } },
    'next/cache': { revalidatePath: () => { revalidations++; } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/auth/employee-login': {},
    '@/lib/auth/permissions': { APP_ROLES: ['admin', 'front_desk', 'artist', 'printing', 'heat_press', 'cutting_sewing', 'qc'] },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/actions/employees.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'test-only' } }, Date, Error,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return { actions: exports, updates: () => updates, revalidations: () => revalidations };
}

test('owner cannot remove their own admin access or deactivate themselves', async () => {
  const fixture = loadActions();
  for (const input of [
    { id: 'owner', name: 'Owner', role: 'artist', active: true },
    { id: 'owner', name: 'Owner', role: 'admin', active: false },
  ]) {
    assert.ok((await fixture.actions.updateEmployee(input)).error);
  }
  assert.equal(fixture.updates(), 0);
});

test('owner cannot delete their current account and short passwords never reach privileged API', async () => {
  const fixture = loadActions();
  assert.match((await fixture.actions.deleteEmployee('owner')).error, /cannot delete/);
  assert.match((await fixture.actions.changeEmployeePassword({ id: 'employee', password: 'short' })).error, /at least 8/);
  assert.equal(fixture.revalidations(), 0);
});

test('invalid names and roles are rejected before account or profile writes', async () => {
  const fixture = loadActions();
  for (const input of [{ name: '   ', role: 'artist' }, { name: 'Employee', role: 'invalid' }]) {
    assert.ok((await fixture.actions.updateEmployee({ id: 'employee', active: true, ...input })).error);
    assert.ok((await fixture.actions.createEmployee({ email: 'staff@example.com', password: 'password123', ...input })).error);
  }
  assert.equal(fixture.updates(), 0);
});

test('missing employee update does not report success', async () => {
  const fixture = loadActions({ data: null, error: null });
  const result = await fixture.actions.updateEmployee({ id: 'missing', name: 'Employee', role: 'artist', active: true });
  assert.match(result.error, /not updated/);
  assert.equal(fixture.revalidations(), 0);
});

test('valid employee changes succeed and refresh the employee page', async () => {
  const fixture = loadActions();
  const result = await fixture.actions.updateEmployee({ id: 'employee', name: 'Employee', role: 'artist', active: true });
  assert.equal(result.ok, true);
  assert.equal(fixture.updates(), 1);
  assert.equal(fixture.revalidations(), 1);
});

test('blocked deletion returns an error without silently deactivating', async () => {
  const fixture = loadActions(undefined, { message: 'Database error deleting user' });
  const result = await fixture.actions.deleteEmployee('employee');
  assert.match(result.error, /Could not permanently delete/);
  assert.equal(fixture.updates(), 0);
  assert.equal(fixture.revalidations(), 0);
});

test('employee without linked history is deleted without deactivating', async () => {
  const fixture = loadActions(undefined, null);
  const result = await fixture.actions.deleteEmployee('employee');
  assert.equal(result.ok, true);
  assert.equal(result.deactivated, undefined);
  assert.equal(fixture.updates(), 0);
});

test('failed deactivation does not report successful removal', async () => {
  const fixture = loadActions({ data: null, error: null }, { message: 'Database error deleting user' });
  assert.match((await fixture.actions.deleteEmployee('employee')).error, /Could not permanently delete/);
  assert.equal(fixture.revalidations(), 0);
});

test('unrelated auth failures stay visible and do not change employee access', async () => {
  const fixture = loadActions(undefined, { message: 'Invalid API key' });
  assert.match((await fixture.actions.deleteEmployee('employee')).error, /Invalid API key/);
  assert.equal(fixture.updates(), 0);
});
