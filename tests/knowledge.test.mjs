import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
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
const KM_REVIEW = join(SCRIPTS, 'km-review.js');

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
function memory({
	name,
	description,
	type = 'how-to',
	trigger = '',
	lastVerified = '2026-06-18',
	confidence = 2,
}) {
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
		`  confidence: ${confidence}`,
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

	// --- table-driven coverage: every slot/replace detector -----------------
	// Each case builds its synthetic secret at RUNTIME (no literal secret in
	// source), runs km-scrub, and asserts the raw value never survives while
	// the expected slot does land in stdout.
	const slotCases = [
		{
			name: 'connection_string (scheme://user:pass@host)',
			build: () => {
				const secret = 'sup3rSecretPass_' + 'Q'.repeat(8);
				return {secret, input: `db: postgres://appuser:${secret}@db.example.com:5432/prod\n`};
			},
			expectSlot: '{connection_string}',
		},
		{
			name: 'connection_string (jdbc:...)',
			build: () => {
				const secret = 'jdbcSecret_' + 'R'.repeat(8);
				return {secret, input: `jdbc:postgresql://dbhost:5432/prod?password=${secret}\n`};
			},
			expectSlot: '{connection_string}',
		},
		{
			name: 'openai_key (sk-...)',
			build: () => {
				const secret = 'sk-' + 'B'.repeat(30);
				return {secret, input: `OPENAI_API_KEY=${secret}\n`};
			},
			expectSlot: '{api_key}',
		},
		{
			name: 'aws_access_key_id (AKIA...)',
			build: () => {
				const secret = 'AKIA' + '0'.repeat(16);
				return {secret, input: `aws_access_key_id = ${secret}\n`};
			},
			expectSlot: '{api_key}',
		},
		{
			name: 'slack_token (xox...)',
			build: () => {
				const secret = 'xoxb-' + '1'.repeat(20);
				return {secret, input: `slack token: ${secret}\n`};
			},
			expectSlot: '{api_key}',
		},
		{
			name: 'bearer_token (Bearer ...)',
			build: () => {
				const secret = 'Bearer ' + 'C'.repeat(24);
				return {secret, input: `Authorization: ${secret}\n`};
			},
			// The token portion (without the literal word "Bearer") is slotted.
			expectSlot: 'Bearer {api_key}',
		},
		{
			name: 'uuid',
			build: () => {
				const secret = '123e4567-e89b-12d3-a456-426614174000';
				return {secret, input: `request_id: ${secret}\n`};
			},
			expectSlot: '{uuid}',
		},
		{
			name: 'org_id (account id adjacent to keyword)',
			build: () => {
				const secret = '987654321';
				return {secret, input: `account_id: ${secret}\n`};
			},
			expectSlot: 'account_id: {account_id}',
		},
		{
			name: 'internal_host (builtin suffix)',
			build: () => {
				const secret = 'build-box-7.corp';
				return {secret, input: `ssh into ${secret} to debug\n`};
			},
			expectSlot: '{host}',
		},
		{
			name: 'email',
			build: () => {
				const secret = 'jane.doe' + '+test@realcompany.io';
				return {secret, input: `contact: ${secret}\n`};
			},
			expectSlot: '{email}',
		},
		{
			name: 'private_ip (RFC1918)',
			build: () => {
				const secret = '192.168.1.42';
				return {secret, input: `host at ${secret} is unreachable\n`};
			},
			expectSlot: '{host}',
		},
		{
			name: 'high_entropy_blob (generic catch-all)',
			build: () => {
				// 40+ mixed-case/digit chars, no recognizable provider prefix, length
				// and shape chosen to clear the >4.0 bits/char entropy gate.
				const secret = 'qT7zR2mK9wL4vN8xJ1bH6cF3sD5gA0pY2eU9rW7t';
				return {secret, input: `token=${secret}\n`};
			},
			expectSlot: '{secret}',
		},
	];

	for (const {name, build, expectSlot} of slotCases) {
		it(`slots ${name} and exits 0`, () => {
			const {secret, input} = build();
			const r = run(KM_SCRUB, [], {input});
			assert.equal(r.status, 0, `should exit 0 (clean / auto-slotted); stderr=${r.stderr}`);
			assert.ok(!r.stdout.includes(secret), 'raw secret value must not survive in output');
			assert.ok(
				r.stdout.includes(expectSlot),
				`expected slot ${expectSlot} in output, got: ${r.stdout}`,
			);
		});
	}

	// --- refuse detectors -----------------------------------------------------
	const refuseCases = [
		{
			name: 'private_key (BEGIN/END block)',
			build: () => {
				const body = 'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8' + 'Z'.repeat(20);
				const key = [
					'-----BEGIN RSA PRIVATE KEY-----',
					body,
					'-----END RSA PRIVATE KEY-----',
				].join('\n');
				return {secret: body, input: `here is a key:\n${key}\n`};
			},
		},
		{
			name: 'private_key (bare BEGIN header, truncated paste)',
			build: () => {
				const header = '-----BEGIN PRIVATE KEY-----';
				return {secret: header, input: `truncated paste:\n${header}\n(rest got cut off)\n`};
			},
		},
	];

	for (const {name, build} of refuseCases) {
		it(`refuses (exit 2) on ${name}`, () => {
			const {secret, input} = build();
			const r = run(KM_SCRUB, [], {input});
			assert.equal(r.status, 2, `must refuse (exit 2); stdout=${r.stdout}`);
			assert.ok(!r.stdout.includes(secret), 'raw secret value must not survive in output');
		});
	}

	// --- regression: detector-ordering guard ---------------------------------
	// A high-entropy blob INSIDE a BEGIN/END PRIVATE KEY block must be caught by
	// the private_key REFUSE detector (which runs first and strips the match to
	// a {REDACTED_PRIVATE_KEY} marker) before the generic high_entropy_blob
	// detector ever gets a chance to slot it to {secret}. If detector order ever
	// regresses, this would silently leak key material behind a generic slot.
	it('regression: high-entropy key body inside BEGIN/END block must REFUSE, not slot to {secret}', () => {
		const body = 'qT7zR2mK9wL4vN8xJ1bH6cF3sD5gA0pY2eU9rW7tQ8mZ3nB6vC1xL4kJ9wR2tY7q';
		const key = ['-----BEGIN PRIVATE KEY-----', body, '-----END PRIVATE KEY-----'].join('\n');
		const r = run(KM_SCRUB, [], {input: `key:\n${key}\n`});
		assert.equal(r.status, 2, 'must refuse (exit 2), not fall through to a generic slot');
		assert.ok(!r.stdout.includes(body), 'raw key body must not survive in output');
		assert.ok(
			!r.stdout.includes('{secret}'),
			'must not be slotted to the generic high_entropy_blob placeholder',
		);
	});

	// --- regression: allow-list pass-through ---------------------------------
	// example.com/org/net and localhost are explicitly allow-listed placeholder
	// hosts; they must pass through verbatim, not get redacted.
	it('regression: example.com email and localhost pass through unredacted', () => {
		const input = 'contact placeholder@example.com or reach the service at localhost:8080\n';
		const r = run(KM_SCRUB, [], {input});
		assert.equal(r.status, 0, 'should exit 0 (clean)');
		assert.ok(r.stdout.includes('placeholder@example.com'), 'example.com email must pass through verbatim');
		assert.ok(r.stdout.includes('localhost:8080'), 'localhost must pass through verbatim');
		assert.ok(!r.stdout.includes('{email}'), 'allow-listed email must not be redacted');
		assert.ok(!r.stdout.includes('{host}'), 'allow-listed host must not be redacted');
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

describe('km-review', () => {
	let store;
	let env;
	let dir;
	let freshFile;
	let staleFile;
	let pruneFile;

	before(() => {
		store = mkdtempSync(join(tmpdir(), 'km-review-'));
		dir = join(store, '.claude', 'knowledge');
		mkdirSync(dir, {recursive: true});

		// (a) fresh — recent last_verified, confidence 2. Well inside the window.
		freshFile = join(dir, 'fresh.md');
		writeFileSync(
			freshFile,
			memory({
				name: 'Fresh procedure',
				description: 'A recently verified memory',
				lastVerified: '2026-06-25',
				confidence: 2,
			}),
		);

		// (b) stale — last_verified well past --window-days, confidence 2.
		staleFile = join(dir, 'stale.md');
		writeFileSync(
			staleFile,
			memory({
				name: 'Stale procedure',
				description: 'A memory that has not been re-verified in a long time',
				lastVerified: '2026-01-01',
				confidence: 2,
			}),
		);

		// (c) prune candidate — confidence 0, regardless of last_verified.
		pruneFile = join(dir, 'prune-me.md');
		writeFileSync(
			pruneFile,
			memory({
				name: 'Prune candidate',
				description: 'A memory that has been invalidated',
				lastVerified: '2026-06-25',
				confidence: 0,
			}),
		);

		env = {HOME: store, USERPROFILE: store};
	});

	after(() => {
		rmSync(store, {recursive: true, force: true});
	});

	it('REPORT mode flags the stale memory but not the fresh one', () => {
		const r = run(
			KM_REVIEW,
			['--scope', 'global', '--window-days', '30', '--today', '2026-06-30'],
			{env},
		);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /# km-review — REPORT/);

		// Stale memory (last_verified 2026-01-01, ~180d ago) must be listed under STALE.
		assert.match(
			r.stdout,
			/STALE[\s\S]*Stale procedure/,
			'stale memory should be flagged in the STALE section',
		);
		// Fresh memory (last_verified 2026-06-25, 5d ago) must NOT appear in the STALE list.
		const staleSection = r.stdout.split('STALE')[1] || '';
		assert.ok(
			!staleSection.includes('Fresh procedure'),
			'fresh memory must not be flagged as stale',
		);

		// The confidence-0 memory is reported as a prune candidate but not deleted.
		assert.match(
			r.stdout,
			/PRUNE CANDIDATES[\s\S]*Prune candidate/,
			'confidence-0 memory should be listed as a prune candidate',
		);
		assert.ok(existsSync(pruneFile), 'REPORT mode must not delete any files');
		assert.ok(existsSync(staleFile), 'REPORT mode must not delete any files');
		assert.ok(existsSync(freshFile), 'REPORT mode must not delete any files');
	});

	it('--prune deletes only the confidence-0 file and rewrites the index, keeping fresh + stale', () => {
		const indexPath = join(dir, 'INDEX.md');
		const r = run(
			KM_REVIEW,
			['--scope', 'global', '--prune', '--window-days', '30', '--today', '2026-06-30'],
			{env},
		);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /# km-review — PRUNE/);

		// Only the confidence-0 file is unlinked; staleness alone does not prune.
		assert.ok(!existsSync(pruneFile), 'confidence-0 file must be deleted by --prune');
		assert.ok(existsSync(staleFile), 'stale but nonzero-confidence file must survive --prune');
		assert.ok(existsSync(freshFile), 'fresh file must survive --prune');

		// The regenerated index must drop the pruned entry and keep the survivors.
		const indexBody = readFileSync(indexPath, 'utf8');
		assert.ok(
			!indexBody.includes('Prune candidate'),
			'pruned memory must be removed from the index',
		);
		assert.ok(indexBody.includes('Stale procedure'), 'stale (unpruned) memory must remain in the index');
		assert.ok(indexBody.includes('Fresh procedure'), 'fresh memory must remain in the index');
	});
});
