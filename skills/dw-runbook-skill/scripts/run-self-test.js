'use strict';

// End-to-end self-test for run.js: builds a throwaway git repo + store, then
// proves each isolation mode, report parsing, the pristine guarantee, and the
// coalesce cache. node: builtins only. Invoked via `run.js --self-test`.

const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const runner = require('./run');
const paths = require('./runbook-paths');

function git(repo, args) {
	return spawnSync('git', ['-C', repo, ...args], {encoding: 'utf8'});
}

function mkRepo() {
	const dir = mkdtempSync(join(tmpdir(), 'rb-repo-'));
	spawnSync('git', ['init', '-q', dir], {encoding: 'utf8'});
	git(dir, ['config', 'user.email', 'test@example.com']);
	git(dir, ['config', 'user.name', 'Test']);
	git(dir, ['config', 'commit.gpgsign', 'false']);
	writeFileSync(join(dir, 'README.md'), 'hi\n');
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'init']);
	return dir;
}

// Write a command runbook directly into the store (exercises the same layout
// scaffold() produces, with a real body).
function writeCommand(root, name, {isolation, ref, body, report, cleanups}) {
	const dir = paths.commandDir(root, name);
	paths.ensureDir(dir);
	const manifest = {name, kind: 'command', isolation, ref, setups: [], cleanups: cleanups ? Object.keys(cleanups) : [], command: 'command.sh', report: report || {}};
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
	writeFileSync(join(dir, 'command.sh'), `#!/usr/bin/env bash\nset -uo pipefail\n${body}\n`, {mode: 0o755});
	if (cleanups) {
		paths.ensureDir(paths.cleanupsDir(root));
		for (const [cn, cbody] of Object.entries(cleanups)) {
			writeFileSync(join(paths.cleanupsDir(root), `${cn}.sh`), `#!/usr/bin/env bash\n${cbody}\n`, {mode: 0o755});
		}
	}
}

function run() {
	let failures = 0;
	const log = (ok, msg) => {
		if (!ok) failures++;
		process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
	};
	const repo = mkRepo();
	const root = mkdtempSync(join(tmpdir(), 'rb-store-'));
	try {
		// 1. worktree mode, passing, with a summary parser.
		writeCommand(root, 'wt-pass', {
			isolation: 'worktree',
			ref: 'HEAD',
			body: 'echo "12 passed, 0 failed"; exit 0',
			report: {summary: '(\\d+) passed'},
		});
		const r1 = runner.runCommand(root, 'wt-pass', {cwd: repo});
		log(r1.status === 'pass', `worktree: status pass (got ${r1.status})`);
		log(r1.summary === '12', `worktree: summary parsed (got "${r1.summary}")`);
		log(!!r1.log && existsSync(r1.log), 'worktree: log file written');
		let wtLeft = [];
		try {
			wtLeft = readdirSync(paths.worktreesDir(root));
		} catch {
			wtLeft = [];
		}
		log(wtLeft.length === 0, `worktree: temp worktree removed (leftover=${wtLeft.length})`);

		// 2. coalesce: an identical second run reuses the cached result.
		const r1b = runner.runCommand(root, 'wt-pass', {cwd: repo});
		log(r1b.cached === true, `coalesce: identical re-run served from cache (cached=${r1b.cached})`);

		// 3. shared-dir, passing, with a cleanup that restores the checkout.
		writeCommand(root, 'sd-pass', {
			isolation: 'shared-dir',
			ref: 'working',
			body: 'echo work > rb_artifact.txt; echo "ok"; exit 0',
			cleanups: {'rm-artifact': 'rm -f "$RUNBOOK_WORKDIR/rb_artifact.txt"'},
		});
		const r2 = runner.runCommand(root, 'sd-pass', {cwd: repo});
		log(r2.status === 'pass', `shared-dir: status pass (got ${r2.status})`);
		log(r2.pristine === true, `shared-dir: checkout restored pristine (pristine=${r2.pristine})`);

		// 4. shared-dir drift: a command that dirties the tree with no cleanup is
		//    caught and reported as an error (the pristine guarantee).
		writeCommand(root, 'sd-drift', {
			isolation: 'shared-dir',
			ref: 'working',
			body: 'echo leak > rb_leak.txt; exit 0',
		});
		const r3 = runner.runCommand(root, 'sd-drift', {cwd: repo});
		log(r3.status === 'error', `pristine guard: drift flagged as error (got ${r3.status})`);
		log(r3.pristine === false, `pristine guard: pristine=false (got ${r3.pristine})`);
		git(repo, ['clean', '-fdq']); // tidy the leak for later steps

		// 5. failing command surfaces findings.
		writeCommand(root, 'wt-fail', {
			isolation: 'worktree',
			ref: 'HEAD',
			body: 'echo "ERROR: boom in module X"; exit 3',
		});
		const r4 = runner.runCommand(root, 'wt-fail', {cwd: repo});
		log(r4.status === 'fail', `fail: status fail (got ${r4.status})`);
		log(r4.exitCode === 3, `fail: exit code preserved (got ${r4.exitCode})`);
		log(r4.findings.length >= 1 && /boom/.test(r4.findings[0]), `fail: finding captured (got ${JSON.stringify(r4.findings)})`);

		// 6. flow aggregates child statuses.
		const flowDir = paths.commandDir(root, 'check');
		paths.ensureDir(flowDir);
		writeFileSync(join(flowDir, 'manifest.json'), JSON.stringify({name: 'check', kind: 'flow', steps: ['wt-pass', 'wt-fail']}, null, 2));
		const r5 = runner.runCommand(root, 'check', {cwd: repo});
		log(r5.kind === 'flow' && r5.status === 'fail', `flow: fails when a step fails (got ${r5.status})`);
		log(Array.isArray(r5.steps) && r5.steps.length === 2, `flow: reports each step (got ${r5.steps && r5.steps.length})`);

		// 7. dry-run plans without executing or locking; shared-dir locks on the resource.
		const r6 = runner.runCommand(root, 'sd-pass', {cwd: repo, dryRun: true});
		log(r6.dryRun === true && r6.plan.lockKey === r6.plan.resource, `dry-run: shared-dir lockKey is the resource (got ${r6.plan && r6.plan.lockKey})`);

		// 8. pristine guard catches an in-place edit to an ALREADY-dirty tracked file
		//    (status lines stay " M", so a status-only check would miss it).
		writeFileSync(join(repo, 'README.md'), 'hi\nlocal edit\n');
		writeCommand(root, 'sd-inplace', {
			isolation: 'shared-dir',
			ref: 'working',
			body: 'echo more >> "$RUNBOOK_WORKDIR/README.md"; exit 0',
		});
		const r7 = runner.runCommand(root, 'sd-inplace', {cwd: repo});
		log(r7.status === 'error' && r7.pristine === false, `pristine guard: in-place edit to an already-dirty file flagged (status=${r7.status})`);
		git(repo, ['checkout', '--', 'README.md']);

		// 9. flow cycle is detected instead of overflowing the stack.
		const cyc = paths.commandDir(root, 'loopflow');
		paths.ensureDir(cyc);
		writeFileSync(join(cyc, 'manifest.json'), JSON.stringify({name: 'loopflow', kind: 'flow', steps: ['loopflow']}));
		let cycleThrew = false;
		try {
			runner.runCommand(root, 'loopflow', {cwd: repo});
		} catch (e) {
			cycleThrew = /cycle/.test(e.message);
		}
		log(cycleThrew, 'flow cycle: a self-referential flow throws instead of overflowing');
	} finally {
		rmSync(repo, {recursive: true, force: true});
		rmSync(root, {recursive: true, force: true});
	}
	process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} — run self-test\n`);
	return failures === 0 ? 0 : 1;
}

module.exports = {run};
