import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', 'skills', 'dw-runbook-skill', 'scripts');
const require = createRequire(import.meta.url);
const runner = require(join(SCRIPTS, 'run.js'));

function selfTest(script) {
	const r = spawnSync(process.execPath, [join(SCRIPTS, script), '--self-test'], {encoding: 'utf8'});
	return r;
}

describe('lock.js --self-test (mutex, coalesce, stale-takeover)', () => {
	it('passes the real multi-process proof', () => {
		const r = selfTest('lock.js');
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});
});

describe('run.js --self-test (modes, pristine guarantee, coalesce cache)', () => {
	it('passes the end-to-end proof against a temp git repo', () => {
		const r = selfTest('run.js');
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});
});

describe('dw-runbook-hint.js --self-test (trigger matching)', () => {
	it('matches triggers and ignores unrelated commands', () => {
		const r = selfTest('dw-runbook-hint.js');
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});
});

describe('parseReport', () => {
	it('defaults: summary "ok" on pass, error lines become findings', () => {
		const out = 'compiling\nERROR: bad thing\nall done';
		const p = runner.parseReport({}, 0, out);
		assert.equal(p.summary, 'ok');
		assert.deepEqual(p.findings, ['ERROR: bad thing']);
		assert.equal(p.findingsTruncated, false);
	});

	it('summary regex captures group 1', () => {
		const p = runner.parseReport({summary: '(\\d+) passed'}, 0, 'Result: 212 passed, 0 failed');
		assert.equal(p.summary, '212');
	});

	it('empty-string fields fall back to defaults (do not match every line)', () => {
		const p = runner.parseReport({summary: '', findings: ''}, 0, 'a clean line\nanother clean line');
		assert.equal(p.summary, 'ok');
		assert.deepEqual(p.findings, []);
	});

	it('caps findings at findingsMax and flags truncation', () => {
		const out = Array.from({length: 15}, (_, i) => `error ${i}`).join('\n');
		const p = runner.parseReport({findingsMax: 10}, 1, out);
		assert.equal(p.findings.length, 10);
		assert.equal(p.findingsTruncated, true);
		assert.equal(p.findingCount, 15);
	});

	it('a malformed regex falls back to the default instead of throwing', () => {
		const p = runner.parseReport({findings: '('}, 1, 'FAIL: nope');
		assert.deepEqual(p.findings, ['FAIL: nope']);
	});
});
