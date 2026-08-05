import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

const SKILL = join(ROOT, 'skills', 'dw-review-prs-skill', 'scripts');
const lib = require(join(SKILL, 'review-prs-lib.js'));
const CLI = join(SKILL, 'review-prs.js');

function runCli(args, env = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: {...process.env, ...env},
	});
}

describe('parsePrRef', () => {
	it('reads a PR from a url with a files view, a fragment, or the short forms', () => {
		for (const input of [
			'https://github.com/acme/widget/pull/42',
			'https://github.com/acme/widget/pull/42/files#diff-abc',
			'acme/widget#42',
			'acme/widget/42',
		]) {
			assert.deepEqual(lib.parsePrRef(input), {
				owner: 'acme',
				repo: 'widget',
				number: 42,
				key: 'acme/widget#42',
			});
		}
	});

	it('rejects anything that is not a PR reference', () => {
		for (const input of ['', null, 'acme/widget', 'acme/widget#0', 'https://github.com/acme/widget/issues/42', 'nonsense']) {
			assert.equal(lib.parsePrRef(input), null, `rejected: ${input}`);
		}
	});
});

describe('state file', () => {
	it('round-trips through render and parse, and upsert replaces one entry', () => {
		const first = lib.upsertState({}, 'acme/widget#42', {sha: 'aaa', status: 'drafted', at: 't1'});
		const both = lib.upsertState(first, 'acme/other#7', {sha: 'bbb', status: 'submitted', at: 't2'});
		const reparsed = lib.parseStateMd(lib.renderStateMd(both));
		assert.deepEqual(reparsed['acme/widget#42'], {
			key: 'acme/widget#42',
			sha: 'aaa',
			status: 'drafted',
			at: 't1',
		});
		assert.equal(reparsed['acme/other#7'].status, 'submitted');

		const moved = lib.upsertState(both, 'acme/widget#42', {sha: 'ccc', status: 'submitted', at: 't3'});
		assert.equal(Object.keys(moved).length, 2, 'upsert replaces rather than appends');
		assert.equal(lib.parseStateMd(lib.renderStateMd(moved))['acme/widget#42'].sha, 'ccc');
	});

	it('ignores prose around the entries', () => {
		const parsed = lib.parseStateMd(
			'# heading\n\nSome explanation.\n\n- acme/widget#42 | sha=aaa | status=drafted | at=t1\n- not an entry\n',
		);
		assert.deepEqual(Object.keys(parsed), ['acme/widget#42']);
	});
});

describe('classifyPr', () => {
	const base = {key: 'acme/widget#42', headSha: 'head1', isOpen: true, authoredByMe: false, pendingReview: null, submittedShas: []};

	it('reports drafts waiting when a pending review carries comments', () => {
		const c = lib.classifyPr({...base, pendingReview: {id: 1, draftCount: 3}});
		assert.equal(c.status, 'draft-waiting');
		assert.match(c.reason, /3/);
	});

	it('flags an empty pending review, because it blocks posting on that PR', () => {
		assert.equal(lib.classifyPr({...base, pendingReview: {id: 1, draftCount: 0}}).status, 'draft-empty');
	});

	it('treats a submitted review at the current head as done, and an older one as new work', () => {
		assert.equal(lib.classifyPr({...base, submittedShas: ['head1']}).status, 'reviewed');
		const stale = lib.classifyPr({...base, submittedShas: ['head0']});
		assert.equal(stale.status, 'needs-draft');
		assert.match(stale.reason, /pushed to/);
	});

	it('falls back to the store when the API shows no review, and skips a declined head', () => {
		assert.equal(lib.classifyPr(base, {sha: 'head1', status: 'submitted'}).status, 'reviewed');
		assert.equal(lib.classifyPr(base, {sha: 'head1', status: 'declined'}).status, 'skip');
		assert.equal(lib.classifyPr(base, {sha: 'head0', status: 'submitted'}).status, 'needs-draft');
	});

	it('never queues a closed PR or the reviewer own PR', () => {
		assert.equal(lib.classifyPr({...base, isOpen: false}).status, 'closed');
		assert.equal(lib.classifyPr({...base, authoredByMe: true}).status, 'skip');
	});

	it('a pending review outranks a stale state entry claiming the head was submitted', () => {
		const c = lib.classifyPr({...base, pendingReview: {id: 1, draftCount: 2}}, {sha: 'head1', status: 'submitted'});
		assert.equal(c.status, 'draft-waiting');
	});
});

describe('queue presentation', () => {
	it('puts drafts waiting first, then new work, then the empty-slot case', () => {
		const rows = [
			{key: 'a/a#1', status: 'reviewed'},
			{key: 'd/d#4', status: 'draft-empty'},
			{key: 'c/c#3', status: 'needs-draft'},
			{key: 'b/b#2', status: 'draft-waiting'},
		];
		assert.deepEqual(
			lib.sortQueue(rows).map((r) => r.status),
			['draft-waiting', 'needs-draft', 'draft-empty', 'reviewed'],
		);
	});

	it('counts by status', () => {
		assert.deepEqual(
			lib.summarize([{status: 'needs-draft'}, {status: 'needs-draft'}, {status: 'reviewed'}]),
			{'needs-draft': 2, reviewed: 1},
		);
	});

	it('keeps a multi-line finding on one ledger row', () => {
		const row = lib.ledgerLine({at: 't', key: 'a/a#1', status: 'drafted', weight: 'nit', finding: 'line one\nline two'});
		assert.equal(row.split('\n').length, 1);
		assert.match(row, /line one line two/);
	});
});

describe('cli guards (no network)', () => {
	it('prints usage with no arguments and fails on an unknown subcommand', () => {
		const help = runCli([]);
		assert.equal(help.status, 0);
		assert.match(help.stdout, /queue/);
		assert.equal(runCli(['nope']).status, 1);
	});

	it('refuses a comment body that is missing the dev-ai tag, before touching the network', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-body-'));
		const file = join(dir, 'body.md');
		writeFileSync(file, 'looks like a review comment but carries no tag\n');
		const res = runCli(['draft', 'acme/widget#42', '--path', 'a.php', '--line', '10', '--body-file', file]);
		assert.equal(res.status, 1);
		assert.match(res.stderr, /\[dev-ai\]/);
		rmSync(dir, {recursive: true, force: true});
	});

	it('refuses a tagged body whose ask does not lead, and accepts one where it does', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-ask-'));
		const buried = join(dir, 'buried.md');
		writeFileSync(buried, '[dev-ai]\nnit: the docblock lost its condition.\n\nAsk: restore the clause.\n');
		const res = runCli(['draft', 'acme/widget#42', '--path', 'a.php', '--line', '10', '--body-file', buried]);
		assert.equal(res.status, 1);
		assert.match(res.stderr, /Ask:/);

		// Same guard, satisfied: the ask leads, so the body gets past validation and
		// fails later — on the network, not on its shape.
		const leads = join(dir, 'leads.md');
		writeFileSync(leads, '[dev-ai]\nAsk: restore the when-clause on `@throws`.\n\nnit: the docblock lost its condition.\n');
		assert.doesNotMatch(runCli(['draft', 'acme/widget#42', '--path', 'a.php', '--line', '10', '--body-file', leads]).stderr, /Ask:/);
		rmSync(dir, {recursive: true, force: true});
	});

	it('refuses an empty or missing body file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-body-'));
		const empty = join(dir, 'empty.md');
		writeFileSync(empty, '   \n');
		assert.equal(runCli(['draft', 'acme/widget#42', '--body-file', empty]).status, 1);
		assert.equal(runCli(['draft', 'acme/widget#42', '--body-file', join(dir, 'nope.md')]).status, 1);
		rmSync(dir, {recursive: true, force: true});
	});

	it('refuses to submit without a recognized event', () => {
		const res = runCli(['submit', 'acme/widget#42', '--event', 'LGTM']);
		assert.equal(res.status, 1);
		assert.match(res.stderr, /COMMENT/);
	});

	it('rejects a bad PR reference before anything else', () => {
		assert.equal(runCli(['surfaces', 'not-a-pr']).status, 1);
	});
});

describe('cli store writes', () => {
	it('records a head SHA that classifyPr then reads back as handled', () => {
		const store = mkdtempSync(join(tmpdir(), 'dw-review-store-'));
		const res = runCli(
			['state-set', 'acme/widget#42', '--sha', 'head1', '--status', 'submitted'],
			{DW_STORE_ROOT: store},
		);
		assert.equal(res.status, 0, res.stderr);
		const file = join(store, 'run-notes', 'dw-review-prs', 'state.md');
		const entry = lib.parseStateMd(readFileSync(file, 'utf8'))['acme/widget#42'];
		assert.equal(entry.sha, 'head1');
		assert.equal(
			lib.classifyPr(
				{key: 'acme/widget#42', headSha: 'head1', isOpen: true, authoredByMe: false, pendingReview: null, submittedShas: []},
				entry,
			).status,
			'reviewed',
		);
		assert.equal(runCli(['state-set', 'acme/widget#42', '--sha', 'x', '--status', 'bogus'], {DW_STORE_ROOT: store}).status, 1);
		rmSync(store, {recursive: true, force: true});
	});

	it('writes the ledger header once and appends a row per comment', () => {
		const store = mkdtempSync(join(tmpdir(), 'dw-review-store-'));
		const env = {DW_STORE_ROOT: store};
		assert.equal(runCli(['log', 'acme/widget#42', '--weight', 'nit', '--finding', 'first'], env).status, 0);
		assert.equal(runCli(['log', 'acme/widget#42', '--weight', 'blocker', '--finding', 'second'], env).status, 0);
		const text = readFileSync(join(store, 'run-notes', 'dw-review-prs', 'comments.md'), 'utf8');
		assert.equal(text.match(/\| when \|/g).length, 1, 'header written once');
		assert.equal(text.match(/acme\/widget#42/g).length, 2);
		assert.equal(runCli(['log', 'acme/widget#42'], env).status, 1, '--finding is required');
		rmSync(store, {recursive: true, force: true});
	});
});
