import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// Resolve the skill's scripts dir from this test file's location (absolute paths only).
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', 'skills', 'dw-knowledge-skill', 'scripts');
const KM_SCRUB = join(SCRIPTS, 'km-scrub.js');
const KM_RECALL = join(SCRIPTS, 'km-recall.js');
const KM_INDEX = join(SCRIPTS, 'km-index.js');

const require = createRequire(import.meta.url);
const fm = require(join(SCRIPTS, 'km-frontmatter.js'));

// Run a script with given input on stdin; return {status, stdout, stderr}.
function run(script, args, {input = '', cwd, env} = {}) {
	const res = spawnSync(process.execPath, [script, ...args], {
		input,
		cwd,
		env: env ? {...process.env, ...env} : process.env,
		encoding: 'utf8',
	});
	return {
		status: res.status,
		stdout: res.stdout || '',
		stderr: res.stderr || '',
	};
}

// Build a minimal valid memory file body (frontmatter + body).
function memory({name, description, type = 'how-to', trigger = '', lastVerified = '2026-06-18'}) {
	return [
		'---',
		`name: ${name}`,
		`description: ${description}`,
		'metadata:',
		'  node_type: memory',
		`  type: ${type}`,
		'  scope: global',
		`  trigger: ${trigger}`,
		`  last_verified: ${lastVerified}`,
		'  confidence: 2',
		'  status: active',
		'---',
		'',
		'1. (intent) do the thing -> (action) run <{cmd}>',
		'',
		'## Verify',
		'It worked.',
		'',
	].join('\n');
}

describe('km-scrub', () => {
	it('redacts a fake gh token and exits 0', () => {
		// Build the token at runtime so the literal never appears in source.
		const token = 'ghp_' + 'A'.repeat(30);
		const r = run(KM_SCRUB, [], {input: `use ${token} to auth\n`});
		assert.equal(r.status, 0, 'should exit 0 (clean / auto-slotted)');
		assert.ok(!r.stdout.includes(token), 'raw token must not survive in output');
		assert.ok(r.stdout.includes('{api_key}'), 'token should be slotted to {api_key}');
	});

	it('refuses (exit 2) on an inline private-key block', () => {
		const key = [
			'-----BEGIN PRIVATE KEY-----',
			'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8',
			'-----END PRIVATE KEY-----',
		].join('\n');
		const r = run(KM_SCRUB, [], {input: `here is a key:\n${key}\n`});
		assert.equal(r.status, 2, 'private key must force refusal (exit 2)');
	});
});

describe('km-frontmatter', () => {
	const text = [
		'---',
		'name: Run the tests',
		'description: How to run the tests on this repo',
		'metadata:',
		'  node_type: memory',
		'  type: how-to',
		'  parameters:',
		'    - name: test_cmd',
		'      example: npm test',
		'    - name: install_cmd',
		'      example: npm ci',
		'---',
		'',
		'body line',
		'',
	].join('\n');

	it('keeps the example field for multi-line list-of-object parameters', () => {
		const {data} = fm.parse(text);
		const params = data.metadata.parameters;
		assert.equal(params.length, 2);
		assert.deepEqual(params[0], {name: 'test_cmd', example: 'npm test'});
		assert.deepEqual(params[1], {name: 'install_cmd', example: 'npm ci'});
	});

	it('round-trips parameters through stringify -> parse without losing example', () => {
		const {data, body} = fm.parse(text);
		const reparsed = fm.parse(fm.stringify(data, body));
		assert.deepEqual(reparsed.data.metadata.parameters, data.metadata.parameters);
	});
});

describe('km-recall', () => {
	let store;
	let env;

	before(() => {
		store = mkdtempSync(join(tmpdir(), 'km-recall-'));
		// Point HOME at the tmp dir so globalStoreDir() resolves under it.
		mkdirSync(join(store, '.claude', 'knowledge'), {recursive: true});
		const dir = join(store, '.claude', 'knowledge');
		writeFileSync(
			join(dir, 'deploy.md'),
			memory({
				name: 'Deploy the widget service',
				description: 'How to deploy the widget service to staging',
				trigger: 'how do we deploy the widget service',
			}),
		);
		writeFileSync(
			join(dir, 'coffee.md'),
			memory({
				name: 'Brew office coffee',
				description: 'How to brew coffee in the office kitchen',
				trigger: 'coffee brewing kitchen beans',
			}),
		);
		env = {HOME: store, USERPROFILE: store};
	});

	after(() => {
		rmSync(store, {recursive: true, force: true});
	});

	it('ranks a matching memory above a non-matching one', () => {
		const r = run(KM_RECALL, ['--scope', 'global', '--json', 'deploy', 'widget', 'service'], {env});
		assert.equal(r.status, 0);
		const items = JSON.parse(r.stdout);
		assert.ok(items.length >= 1, 'should return at least one match');
		assert.equal(items[0].title, 'Deploy the widget service', 'best match ranks first');
		// The coffee memory shares no query terms, so it should not appear at all.
		assert.ok(
			!items.some((it) => it.title === 'Brew office coffee'),
			'non-matching memory must be excluded',
		);
	});
});

describe('km-index', () => {
	let store;
	let env;

	before(() => {
		store = mkdtempSync(join(tmpdir(), 'km-index-'));
		const dir = join(store, '.claude', 'knowledge');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, 'alpha.md'),
			memory({name: 'Alpha procedure', description: 'First procedure'}),
		);
		writeFileSync(
			join(dir, 'beta.md'),
			memory({name: 'Beta procedure', description: 'Second procedure'}),
		);
		env = {HOME: store, USERPROFILE: store};
	});

	after(() => {
		rmSync(store, {recursive: true, force: true});
	});

	it('regenerates the index idempotently (run twice -> identical file)', () => {
		const indexPath = join(store, '.claude', 'knowledge', 'INDEX.md');
		const first = run(KM_INDEX, ['--scope', 'global', '--now', '2026-06-18'], {env});
		assert.equal(first.status, 0, first.stderr);
		const a = readFileSync(indexPath, 'utf8');
		const second = run(KM_INDEX, ['--scope', 'global', '--now', '2026-06-18'], {env});
		assert.equal(second.status, 0, second.stderr);
		const b = readFileSync(indexPath, 'utf8');
		assert.equal(a, b, 'two runs must produce a byte-identical index');
	});
});
