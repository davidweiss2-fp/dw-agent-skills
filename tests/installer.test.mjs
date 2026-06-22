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
		assert.match(r.stdout, /agents/);
		assert.match(r.stdout, /claude/);
	});

	it('--dry-run --only agents installs to all agents and drops claude-code', () => {
		const r = runInstall(['--dry-run', '--only', 'agents']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /skills add .* --all/);
		assert.match(r.stdout, /skills remove -a claude-code/);
	});

	it('accepts `cursor` as an alias for `agents`', () => {
		const r = runInstall(['--dry-run', '--only', 'cursor']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /other agents/);
		assert.match(r.stdout, /skills add/);
	});

	it('--dry-run --only claude prints plugin install', () => {
		// --force exercises the install path deterministically; without it the
		// dry-run short-circuits to "already installed" on machines where the
		// plugin is present (passes in CI, fails locally — a brittle test).
		const r = runInstall(['--dry-run', '--only', 'claude', '--force']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /plugin install/);
	});

	it('tolerates the npx `--` separator forwarded to the bin', () => {
		// `npx -y github:owner/repo -- --only cursor` can forward `--` to the
		// script; parseArgs must ignore it rather than die("unknown flag: --").
		const r = runInstall(['--', '--dry-run', '--only', 'cursor']);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /skills add/);
	});
});
