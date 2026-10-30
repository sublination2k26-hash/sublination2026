const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/team-messages.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });

test('polling merges a sent message without duplicating it or skipping intervening staff messages', () => {
  const current = [{ id: 1 }, { id: 4 }];
  const merged = exported.mergeMessages(current, [{ id: 2 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual(Array.from(merged, item => item.id), [1, 2, 3, 4]);
  assert.deepEqual(current.map(item => item.id), [1, 4]);
});

test('older history merges in chronological order and preserves newer messages', () => {
  const merged = exported.mergeMessages([{ id: 5 }, { id: 6 }], [{ id: 4 }, { id: 3 }]);
  assert.deepEqual(Array.from(merged, item => item.id), [3, 4, 5, 6]);
});

test('mentions encode selected accounts, preserve names and exclude removed tags', () => {
  const ann = { id: '00000000-0000-0000-0000-000000000001', full_name: 'Ann', role: 'artist' };
  const anna = { id: '00000000-0000-0000-0000-000000000002', full_name: 'Anna', role: 'artist' };
  const encoded = exported.encodeMentions('@Anna please reply to @Ann. @Annabelle is plain text.', [ann, anna]);
  assert.equal(encoded, `${exported.mentionToken(anna)} please reply to ${exported.mentionToken(ann)}. @Annabelle is plain text.`);
  assert.deepEqual(Array.from(exported.mentionedAccounts(encoded, [ann, anna])), [ann.id, anna.id]);
  assert.deepEqual(Array.from(exported.mentionedAccounts(exported.encodeMentions('Removed mention', [ann]), [ann])), []);
  const special = { ...ann, full_name: 'Alex [Design] (A+)' };
  assert.equal(exported.encodeMentions(`@${special.full_name}!`, [special]), `${exported.mentionToken(special)}!`);
});

test('reply context loads separately without embedding the self relationship', async () => {
  assert.equal(exported.messageColumns.includes('reply:team_messages'), false);
  const messages = [{ id: 10, body: 'Reply', reply_to_id: 2 }, { id: 11, body: 'Another reply', reply_to_id: 2 }];
  let calls = 0;
  const result = await exported.loadMessageReplies(messages, async ids => {
    calls++;
    assert.deepEqual(Array.from(ids), [2]);
    return { data: [{ id: 2, body: 'Older original', sender: { full_name: 'Artist' } }], error: null };
  });
  assert.equal(calls, 1);
  assert.equal(result[0].reply.body, 'Older original');
  assert.equal(result[1].reply.sender.full_name, 'Artist');
  assert.equal(messages[0].reply, undefined);
});

test('reply context reuses loaded parents and handles inaccessible parents', async () => {
  const result = await exported.loadMessageReplies([
    { id: 1, body: 'Original', reply_to_id: null }, { id: 2, body: 'Reply', reply_to_id: 1 },
  ], () => { throw new Error('Should not fetch loaded parents'); });
  assert.equal(result[1].reply.body, 'Original');
  const missing = await exported.loadMessageReplies([{ id: 3, reply_to_id: 99 }], async () => ({ data: [], error: null }));
  assert.equal(missing[0].reply, null);
  await assert.rejects(exported.loadMessageReplies([{ id: 3, reply_to_id: 99 }], async () => ({ data: null, error: { message: 'Connection failed' } })), /Connection failed/);
});
