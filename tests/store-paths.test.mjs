import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, lstatSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

const kmPaths = require(join(ROOT, 'skills', 'dw-knowledge-skill', 'scripts', 'km-paths.js'));
const rbPaths = require(join(ROOT, 'skills', 'dw-runbook-skill', 'scripts', 'runbook-paths.js'));
const DW_HOOK = join(ROOT, 'bin', 'dw-hook.js');
const DW_MIGRATE = join(ROOT, 'bin', 'dw-migrate.js');

function run(script, {input = '', env = {}} = {}) {
	return spawnSync(process.execPath, [script], {
		input,
		encoding: 'utf8',
		env: {...process.env, ...env},
	});
}

describe('store root resolution', () => {
	it('storeRoot honors DW_STORE_ROOT and defaults to ~/Documents/dw-agent-store', () => {
		assert.equal(kmPaths.storeRoot({DW_STORE_ROOT: '/x/store'}), '/x/store');
		assert.match(kmPaths.storeRoot({}), /Documents\/dw-agent-store$/);
		assert.equal(rbPaths.storeRoot({DW_STORE_ROOT: '/x/store'}), '/x/store');
	});

	it('preferLegacy picks legacy whenever it exists (even if the new dir does too), else new', () => {
		const base = mkdtempSync(join(tmpdir(), 'dw-prefer-'));
		const fresh = join(base, 'new');
		const legacy = join(base, 'legacy');
		mkdirSync(legacy);
		assert.equal(kmPaths.preferLegacy(fresh, legacy), legacy);
		mkdirSync(fresh);
		assert.equal(kmPaths.preferLegacy(fresh, legacy), legacy, 'creating the new dir never flips away from legacy');
		assert.equal(kmPaths.preferLegacy(join(base, 'neither'), join(base, 'nope')), join(base, 'neither'));
		rmSync(base, {recursive: true});
	});

	it('mirrored storeRoot/preferLegacy stay byte-identical across the four owners', () => {
		const OWNERS = [
			'skills/dw-knowledge-skill/scripts/km-paths.js',
			'skills/dw-runbook-skill/scripts/runbook-paths.js',
			'skills/dw-deslop-skill/scripts/deslop-rules.js',
			'skills/dw-handoff-skill/scripts/dw-handoff-path.js',
		];
		const extract = (file, fn) => {
			const src = readFileSync(join(ROOT, file), 'utf8');
			const m = src.match(new RegExp(`function ${fn}[\\s\\S]*?\\n}\\n`));
			return m && m[0];
		};
		const roots = OWNERS.map((f) => {
			const fn = extract(f, 'storeRoot');
			assert.ok(fn, `storeRoot found in ${f}`);
			return fn;
		});
		for (const r of roots.slice(1)) assert.equal(r, roots[0]);
		// dw-handoff-path only needs storeRoot; the other three also mirror preferLegacy.
		const prefers = OWNERS.slice(0, 3).map((f) => {
			const fn = extract(f, 'preferLegacy');
			assert.ok(fn, `preferLegacy found in ${f}`);
			return fn;
		});
		for (const p of prefers.slice(1)) assert.equal(p, prefers[0]);
	});
});

describe('dw-migrate.js', () => {
	let home;
	before(() => {
		home = mkdtempSync(join(tmpdir(), 'dw-migrate-'));
		mkdirSync(join(home, '.claude', 'knowledge'), {recursive: true});
		writeFileSync(join(home, '.claude', 'knowledge', 'thing.md'), 'mem\n');
		mkdirSync(join(home, '.claude', 'projects', '-p-a', 'memory'), {recursive: true});
		mkdirSync(join(home, '.claude', 'projects', '-p-a', 'sessions'), {recursive: true});
	});
	after(() => rmSync(home, {recursive: true, force: true}));

	it('moves legacy stores, leaves symlinks, and never touches sibling data', () => {
		const env = {HOME: home, USERPROFILE: home, DW_STORE_ROOT: join(home, 'Documents', 'dw-agent-store')};
		const r = run(DW_MIGRATE, {env});
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.ok(lstatSync(join(home, '.claude', 'knowledge')).isSymbolicLink());
		assert.equal(readFileSync(join(home, '.claude', 'knowledge', 'thing.md'), 'utf8'), 'mem\n');
		assert.ok(existsSync(join(home, 'Documents', 'dw-agent-store', 'knowledge', 'thing.md')));
		assert.ok(existsSync(join(home, '.claude', 'projects', '-p-a', 'sessions')));
		assert.ok(!lstatSync(join(home, '.claude', 'projects', '-p-a', 'sessions')).isSymbolicLink());

		const again = run(DW_MIGRATE, {env});
		assert.equal(again.status, 0, again.stdout + again.stderr);
		assert.match(again.stdout, /skipped .*already a symlink/);
	});
});

describe('dw-hook.js dispatcher', () => {
	let store;
	let cwd;
	let home;
	before(() => {
		store = mkdtempSync(join(tmpdir(), 'dw-hookstore-'));
		cwd = mkdtempSync(join(tmpdir(), 'dw-hookcwd-'));
		// Empty HOME: without it, a real ~/.claude legacy store would win via
		// preferLegacy and the fixture store would never be read.
		home = mkdtempSync(join(tmpdir(), 'dw-hookhome-'));
		mkdirSync(join(store, 'knowledge'), {recursive: true});
		writeFileSync(join(store, 'knowledge', 'widget-deploy.md'), [
			'---',
			'name: widget-deploy-gotcha',
			'description: deploy the widget service safely',
			'metadata:',
			'  type: gotcha',
			'  confidence: 3',
			'  last_verified: 2099-01-01',
			'---',
			'Deploy notes.',
			'',
		].join('\n'));
	});
	after(() => {
		rmSync(store, {recursive: true, force: true});
		rmSync(cwd, {recursive: true, force: true});
		rmSync(home, {recursive: true, force: true});
	});

	const payload = (extra) => JSON.stringify({session_id: 'test-session', cwd, ...extra});
	const env = () => ({DW_STORE_ROOT: store, HOME: home, USERPROFILE: home});

	it('injects recall on UserPromptSubmit and dedupes within a session', () => {
		const first = run(DW_HOOK, {input: payload({hook_event_name: 'UserPromptSubmit', prompt: 'deploy the widget service'}), env: env()});
		assert.equal(first.status, 0, first.stdout + first.stderr);
		const out = JSON.parse(first.stdout);
		assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
		assert.match(out.hookSpecificOutput.additionalContext, /widget-deploy-gotcha/);

		const second = run(DW_HOOK, {input: payload({hook_event_name: 'UserPromptSubmit', prompt: 'deploy the widget service'}), env: env()});
		assert.equal(second.status, 0);
		assert.equal(second.stdout, '', 'same memory is not re-injected in the same session');
	});

	it('recalls on PostToolUseFailure from command + error text', () => {
		const r = run(DW_HOOK, {input: payload({
			hook_event_name: 'PostToolUseFailure',
			session_id: 'other-session',
			tool_name: 'Bash',
			tool_input: {command: 'deploy widget'},
			error: 'service failed',
		}), env: env()});
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /widget-deploy-gotcha/);
	});

	it('log-only events append to the run-notes session log and stay silent', () => {
		const r = run(DW_HOOK, {input: payload({hook_event_name: 'Stop'}), env: env()});
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
		const slug = String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
		const log = readFileSync(join(store, 'run-notes', slug, 'session-log.jsonl'), 'utf8');
		assert.match(log, /"event":"Stop"/);
	});

	it('SessionStart injects the knowledge indexes when present', () => {
		writeFileSync(join(store, 'knowledge', 'INDEX.md'), '- widget-deploy-gotcha - deploy notes\n');
		const r = run(DW_HOOK, {input: payload({hook_event_name: 'SessionStart', source: 'startup'}), env: env()});
		assert.equal(r.status, 0, r.stdout + r.stderr);
		const out = JSON.parse(r.stdout);
		assert.match(out.hookSpecificOutput.additionalContext, /widget-deploy-gotcha/);
	});
});
