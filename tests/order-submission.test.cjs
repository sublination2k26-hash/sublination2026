const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsUnderTest = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/order-submission.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: exportsUnderTest, Promise });
const { createOrderOnce } = exportsUnderTest;
const { saveOrderSewerAssignments } = exportsUnderTest;

test('order retries finish sewer assignments with the same request IDs and original order', async () => {
  const progress = {};
  const assignments = [{requestId:'a',employeeId:'sewer-a',quantity:8,notes:'M sizes'}, {requestId:'b',employeeId:'sewer-b',quantity:5,notes:'L sizes'}];
  const saved = new Map(); let creates=0; let fail=true;
  const submit=async()=>{
    const orderId=await createOrderOnce(progress,async()=>{creates++;return 'order-1';});
    await saveOrderSewerAssignments(assignments,async()=>`${orderId}-sewing`,async(task,assignment)=>{
      assert.equal(task,'order-1-sewing');
      if(assignment.requestId==='b'&&fail){fail=false;throw new Error('Connection lost');}
      saved.set(assignment.requestId,assignment);
    });
  };
  await assert.rejects(submit(),/Connection lost/);
  await submit();
  assert.equal(creates,1); assert.equal(saved.size,2);
  assert.equal(saved.get('a').quantity,8); assert.equal(saved.get('b').employeeId,'sewer-b');
});

test('orders without selected sewers defer assignment without requesting a sewing task', async () => {
  await saveOrderSewerAssignments([],async()=>{throw new Error('Must not query');},async()=>{throw new Error('Must not save');});
});

test('concurrent creation requests share one saved order', async () => {
  const progress = {};
  let calls = 0;
  const create = async () => { calls++; return 'original-order'; };
  const results = await Promise.all([createOrderOnce(progress, create), createOrderOnce(progress, create)]);
  assert.deepEqual(results, ['original-order', 'original-order']);
  assert.equal(calls, 1);
});

test('retry after later save steps fail reuses the existing order', async () => {
  const progress = {};
  let calls = 0;
  const create = async () => { calls++; return 'original-order'; };
  await createOrderOnce(progress, create);
  assert.equal(await createOrderOnce(progress, create), 'original-order');
  assert.equal(calls, 1);
});

test('failed creation can be retried', async () => {
  const progress = {};
  let calls = 0;
  const create = async () => { if (++calls === 1) throw new Error('Creation failed'); return 'saved-order'; };
  await assert.rejects(createOrderOnce(progress, create), /Creation failed/);
  assert.equal(await createOrderOnce(progress, create), 'saved-order');
  assert.equal(calls, 2);
});

test('separate form submissions can create separate legitimate orders', async () => {
  let calls = 0;
  const create = async () => `order-${++calls}`;
  assert.equal(await createOrderOnce({}, create), 'order-1');
  assert.equal(await createOrderOnce({}, create), 'order-2');
});
