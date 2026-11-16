import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { verifyManagedAi } from './verify-managed-ai.ts'

const verifierFixture = `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
const scenario = process.env.VERIFIER_SCENARIO;
const board = { revision: 0, shapes: [] };
const server = createServer();
mock.module('./src/server/index.ts', { exports: { createDaemon: () => ({
 server, store: { getActiveCanvasId: () => 'fixture', getBoard: () => structuredClone(board) },
 close: () => new Promise(resolve => server.close(resolve)),
}) } });
class Socket extends EventEmitter {
 constructor() { super(); queueMicrotask(() => this.emit('open')); }
 send(raw) {
  const message = JSON.parse(raw);
  if (message.type === 'session.update') queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' }))));
  if (message.type === 'input_audio_buffer.commit') queueMicrotask(() => {
   if (scenario !== 'final-only') this.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'A circuit' })));
   this.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'A battery drives current through a resistor.' })));
  });
 }
 close() { queueMicrotask(() => this.emit('close')); }
 terminate() { this.close(); }
}
mock.module('ws', { exports: { default: Socket } });
globalThis.fetch = async (input, options) => {
 const url = new URL(input);
 assert.equal(url.hostname, '127.0.0.1');
 if (url.pathname === '/api/ai/settings') return Response.json({ authMode: 'managed-identity', hasApiKey: false, readOnly: true, model: 'fixture' });
 if (url.pathname === '/api/ai/models') return Response.json({ models: ['fixture'] });
 if (url.pathname.startsWith('/api/moss/')) return Response.json({ error: 'MOSS_DISABLED' }, { status: 503 });
 assert.equal(url.pathname, '/api/ai/chat');
 if (JSON.parse(options.body).mode !== 'lecture') {
  board.revision++;
  board.shapes = [{ id: 'a', type: 'text', text: scenario === 'wrong-labels' ? 'Wrong' : 'Managed Identity' }, { id: 'b', type: 'text', text: 'MAI ready' }];
 } else if (scenario !== 'lecture-wait') {
  board.revision++;
  board.shapes.push({ id: 'c', type: 'note', text: 'A battery drives a resistor.' });
 }
 return new Response('data: {"type":"text-delta","delta":"DONE"}');
};
Object.assign(process.env, { MICO_AI_AUTH_MODE: 'managed-identity', MICO_AI_ENABLED: 'true', MICO_MOSS_ENABLED: 'false' });
const { verifyManagedAi } = await import('./scripts/verify-managed-ai.ts');
const action = () => verifyManagedAi({ pcm: Buffer.alloc(3200), confirmProviderUsage: true });
if (scenario === 'success') {
 const result = await action(); assert.equal(result.status, 'passed'); assert.equal(result.shapes, 3); assert.equal(result.intermediateEvents, 1);
} else {
 const expected = { 'final-only': /no partial/, 'lecture-wait': /Lecture did not persist/, 'wrong-labels': /requested labels/ }[scenario];
 await assert.rejects(action(), expected);
}
`

for (const scenario of ['success', 'final-only', 'lecture-wait', 'wrong-labels']) {
	test(`managed verifier rejects false-green states: ${scenario}`, () => {
		const result = spawnSync(
			process.execPath,
			['--experimental-test-module-mocks', '--input-type=module'],
			{
				input: verifierFixture,
				encoding: 'utf8',
				env: { ...process.env, VERIFIER_SCENARIO: scenario },
				timeout: 10000,
			},
		)
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
	})
}

test('managed verification requires explicit paid-provider confirmation', async (t) => {
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls++
		throw new Error('Unexpected network')
	})
	await assert.rejects(
		verifyManagedAi({ pcm: Buffer.alloc(2), confirmProviderUsage: false }),
		/confirmation/,
	)
	assert.equal(calls, 0)
})

test('managed verification rejects invalid audio before creating a daemon or using credentials', async (t) => {
	const saved = { ...process.env }
	t.after(() => {
		for (const key of ['MICO_AI_AUTH_MODE', 'MICO_AI_ENABLED', 'MICO_MOSS_ENABLED']) {
			if (saved[key] === undefined) delete process.env[key]
			else process.env[key] = saved[key]
		}
	})
	process.env.MICO_AI_AUTH_MODE = 'managed-identity'
	process.env.MICO_AI_ENABLED = 'true'
	process.env.MICO_MOSS_ENABLED = 'false'
	let calls = 0
	t.mock.method(globalThis, 'fetch', async () => {
		calls++
		throw new Error('Unexpected network')
	})
	for (const pcm of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(20 * 16000 * 2 + 2)]) {
		await assert.rejects(verifyManagedAi({ pcm, confirmProviderUsage: true }), /PCM16/)
	}
	assert.equal(calls, 0)
})
