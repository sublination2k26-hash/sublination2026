const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function loadActions(updateResult = { data: { id: 'employee' }, error: null }) {
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
    '@supabase/supabase-js': { createClient: () => { throw new Error('Unexpected privileged call'); } },
    'next/cache': { revalidatePath: () => { revalidations++; } },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/auth/employee-login': {},
    '@/lib/auth/permissions': { APP_ROLES: ['admin', 'front_desk', 'artist', 'printing', 'heat_press', 'cutting_sewing', 'qc'] },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/actions/employees.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, process, Date, Error,
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
