import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'skills', 'dw-env-skill', 'scripts', 'env-preflight.js');
const require = createRequire(import.meta.url);
const preflight = require(SCRIPT);

function withTempDir(fn) {
	const dir = mkdtempSync(join(tmpdir(), 'env-test-'));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

describe('env-preflight.js --self-test', () => {
	it('passes the embedded fixture proof', () => {
		const r = spawnSync(process.execPath, [SCRIPT, '--self-test'], {encoding: 'utf8'});
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});
});

describe('checkLayout', () => {
	it('flags a nested clone and prescribes the mv + rmdir fix', () => {
		withTempDir((root) => {
			mkdirSync(join(root, 'ns', 'repo', '.git'), {recursive: true});
			const c = preflight.checkLayout(root);
			assert.equal(c.status, 'fail');
			assert.ok(c.detail.includes('ns/repo'), c.detail);
			assert.ok(c.remediation.includes(`mv ${join(root, 'ns', 'repo')} ${join(root, 'repo')}`), c.remediation);
			assert.ok(c.remediation.includes(`rmdir ${join(root, 'ns')}`), c.remediation);
		});
	});

	it('passes a flat workspace', () => {
		withTempDir((root) => {
			mkdirSync(join(root, 'repo-a', '.git'), {recursive: true});
			mkdirSync(join(root, 'repo-b', '.git'), {recursive: true});
			assert.equal(preflight.checkLayout(root).status, 'pass');
		});
	});

	it('skips with a remediation line when no root resolved', () => {
		const c = preflight.checkLayout(null);
		assert.equal(c.status, 'skip');
		assert.ok(c.remediation.includes('DW_ENV_WORKSPACE_ROOT'), c.remediation);
	});
});

describe('checkAwsCreds', () => {
	it('fails on an empty file', () => {
		withTempDir((dir) => {
			const file = join(dir, 'credentials');
			writeFileSync(file, '');
			assert.equal(preflight.checkAwsCreds(file).status, 'fail');
		});
	});

	it('passes a placeholder profile and never echoes the key', () => {
		withTempDir((dir) => {
			const file = join(dir, 'credentials');
			writeFileSync(file, '[default]\naws_access_key_id = AKIA_PLACEHOLDER\naws_secret_access_key = SECRET_PLACEHOLDER\n');
			const c = preflight.checkAwsCreds(file);
			assert.equal(c.status, 'pass');
			assert.ok(!JSON.stringify(c).includes('AKIA_PLACEHOLDER'));
			assert.ok(!JSON.stringify(c).includes('SECRET_PLACEHOLDER'));
		});
	});
});

describe('resolveWorkspaceRoot', () => {
	it('prefers the --workspace-root flag over the env var', () => {
		const got = preflight.resolveWorkspaceRoot({'workspace-root': '/ws/flag'}, {DW_ENV_WORKSPACE_ROOT: '/ws/env'});
		assert.equal(got, '/ws/flag');
	});

	it('falls back to DW_ENV_WORKSPACE_ROOT when no flag is given', () => {
		assert.equal(preflight.resolveWorkspaceRoot({}, {DW_ENV_WORKSPACE_ROOT: '/ws/env'}), '/ws/env');
	});
});
