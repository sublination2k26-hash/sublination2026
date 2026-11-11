const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup(query, rows) {
  let cleanup, update, counts, disconnected = false;
  const element = {
    querySelectorAll: () => rows,
    addEventListener() {}, removeEventListener() {},
  };
  const exported = {};
  let state = 0;
  const react = {
    useId: () => 'list', useRef: () => ({ current: element }),
    useState: initial => [state++ === 0 ? query : initial, value => { counts = typeof value === 'function' ? value(counts ?? { total: 0, shown: 0 }) : value; }],
    useEffect: callback => { cleanup = callback(); },
  };
  class Select {}
  const code = ts.transpileModule(fs.readFileSync('src/components/ui/searchable-list.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports: exported, HTMLSelectElement: Select,
    MutationObserver: class { constructor(callback) { update = callback; } observe() {} disconnect() { disconnected = true; } },
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx: () => null, jsxs: () => null } : {},
  });
  exported.SearchableList({ children: null });
  return { update: () => update(), cleanup: () => cleanup(), counts: () => counts, disconnected: () => disconnected };
}
function row(text, value = '') {
  return { textContent: text, hidden: false, querySelectorAll: () => [{ value }], toggleAttribute(name, hidden) { this.hidden = hidden; }, removeAttribute() { this.hidden = false; } };
}
test('list searches rendered labels and edited values without removing records', () => {
  const rows = [row('JO-2026-0035 Veterinary Printing'), row('JO-2026-0034', 'Santos')];
  const list = setup('  sAnToS ', rows);
  assert.equal(rows[0].hidden, true);
  assert.equal(rows[1].hidden, false);
  assert.equal(list.counts().shown, 1);
  assert.equal(rows.length, 2);
  list.cleanup();
  assert.equal(rows[0].hidden, false);
  assert.equal(list.disconnected(), true);
});
test('list refilters refreshed records and restores all rows when search is empty', () => {
  const rows = [row('Printing')];
  const list = setup('printing', rows);
  rows.push(row('Sewing'), row('Printing completed'));
  list.update();
  assert.equal(list.counts().total, 3);
  assert.equal(list.counts().shown, 2);
  assert.equal(rows[1].hidden, true);
  list.cleanup();
  const cleared = setup('', rows);
  assert.equal(cleared.counts().shown, 3);
  assert.equal(rows.every(row => !row.hidden), true);
});
