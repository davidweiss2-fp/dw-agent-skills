import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const installJs = path.join(root, 'bin', 'install.js');

function runInstall(args) {
	return spawnSync('node', [installJs, ...args], {
		cwd: root,
		encoding: 'utf8',
		env: {...process.env},
	});
}

describe('installer dry-run', () => {
	it('--list shows providers', () => {
		const r = runInstall(['--list']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /dw-pr-ready-skill/);
		assert.match(r.stdout, /cursor/);
		assert.match(r.stdout, /claude/);
	});

	it('--dry-run --only cursor prints skills add', () => {
		const r = runInstall(['--dry-run', '--only', 'cursor']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /skills add/);
		assert.match(r.stdout, /cursor/);
	});

	it('--dry-run --only claude prints plugin install', () => {
		const r = runInstall(['--dry-run', '--only', 'claude']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /plugin install/);
	});
});
