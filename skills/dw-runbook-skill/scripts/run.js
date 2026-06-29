#!/usr/bin/env node
'use strict';

// dw-runbook runner: turn a saved command/flow into one call with a known,
// compact result. node: builtins only.
//
//   node run.js <name> [--scope global|project] [--root DIR] [--dry-run] [--json]
//   node run.js scaffold <name> [--flow] [--isolation worktree|shared-dir] [--scope ..]
//   node run.js list [--scope ..]
//   node run.js --self-test
//
// Lifecycle for every run: [coalesce/lock] -> setup -> command -> report ->
// cleanup -> (shared-dir) assert the checkout is pristine. The agent reads a
// compact envelope; full output spills to a log file referenced by path.

const fs = require('node:fs');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {join} = require('node:path');
const paths = require('./runbook-paths');
const lock = require('./lock');

// --- small shell/git helpers ------------------------------------------------

function sh(cmd, args, opts = {}) {
	const res = spawnSync(cmd, args, {encoding: 'utf8', ...opts});
	return {
		status: typeof res.status === 'number' ? res.status : null,
		stdout: res.stdout || '',
		stderr: res.stderr || '',
		error: res.error,
	};
}

function git(repo, args, opts = {}) {
	return sh('git', ['-C', repo, ...args], opts);
}

function repoRootOf(cwd) {
	const r = git(cwd, ['rev-parse', '--show-toplevel']);
	if (r.status !== 0) return null;
	return r.stdout.trim();
}

function sha1(s) {
	return crypto.createHash('sha1').update(s).digest('hex');
}

// Hash of the working-tree state: status lines PLUS tracked content (`git diff
// HEAD`), so an in-place edit to an already-dirty file is detected — status lines
// alone are byte-identical in that case.
function worktreeDirty(repo) {
	const status = git(repo, ['status', '--porcelain']).stdout || '';
	const diff = git(repo, ['diff', 'HEAD']).stdout || '';
	return sha1(`${status}\0${diff}`);
}

// Full snapshot for the pristine guarantee: HEAD + the dirty hash.
function worktreeSnapshot(repo) {
	return sha1(`${git(repo, ['rev-parse', 'HEAD']).stdout.trim()}\0${worktreeDirty(repo)}`);
}

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function fileVersion(filePaths) {
	const h = crypto.createHash('sha1');
	for (const p of filePaths) {
		try {
			h.update(p);
			h.update(fs.readFileSync(p));
		} catch {
			h.update('\0missing\0');
		}
	}
	return h.digest('hex').slice(0, 12);
}

// --- ref + signature --------------------------------------------------------

function resolveRef(repo, ref) {
	if (!ref || ref === 'working') {
		const head = git(repo, ['rev-parse', 'HEAD']);
		return {label: 'working', sha: head.stdout.trim(), dirty: worktreeDirty(repo)};
	}
	if (ref.startsWith('merge-base:')) {
		const base = ref.slice('merge-base:'.length);
		const mb = git(repo, ['merge-base', 'HEAD', base]);
		return {label: ref, sha: mb.stdout.trim(), dirty: ''};
	}
	const rp = git(repo, ['rev-parse', ref]);
	return {label: ref, sha: rp.stdout.trim(), dirty: ''};
}

function computeSig(manifest, refInfo, version) {
	return sha1(
		JSON.stringify({
			name: manifest.name,
			kind: manifest.kind || 'command',
			isolation: manifest.isolation,
			refLabel: refInfo.label,
			refSha: refInfo.sha,
			dirty: refInfo.dirty,
			version,
		}),
	).slice(0, 16);
}

// --- report parsing ---------------------------------------------------------

const DEFAULT_FINDING_RE = /(?:\berror\b|\bfail(?:ed|ure|s)?\b|✗|✖|\bFAIL\b)/i;

function parseReport(report, code, combined) {
	report = report || {};
	const lines = combined.split('\n');
	const max = Number.isInteger(report.findingsMax) ? report.findingsMax : 10;

	let findingRe = DEFAULT_FINDING_RE;
	if (typeof report.findings === 'string' && report.findings.trim() !== '') {
		try {
			findingRe = new RegExp(report.findings, report.findingsFlags || 'i');
		} catch {
			findingRe = DEFAULT_FINDING_RE;
		}
	}
	const matched = lines.filter((l) => l.trim() && findingRe.test(l)).map((l) => l.trim());
	const findings = matched.slice(0, max);
	const findingsTruncated = matched.length > max;

	let summary;
	if (typeof report.summary === 'string' && report.summary.trim() !== '') {
		try {
			const m = combined.match(new RegExp(report.summary, report.summaryFlags || ''));
			if (m) summary = (m[1] !== undefined ? m[1] : m[0]).trim();
		} catch {
			summary = undefined;
		}
	}
	if (!summary) {
		summary = code === 0 ? 'ok' : matched[0] ? matched[0].slice(0, 200) : `exit ${code}`;
	}
	return {summary, findings, findingsTruncated, findingCount: matched.length};
}

// --- script resolution ------------------------------------------------------

function resolveScripts(root, manifest) {
	const dir = paths.commandDir(root, manifest.name);
	const command = join(dir, manifest.command || 'command.sh');
	const setups = (manifest.setups || []).map((n) => join(paths.setupsDir(root), `${n}.sh`));
	const cleanups = (manifest.cleanups || []).map((n) => join(paths.cleanupsDir(root), `${n}.sh`));
	return {dir, command, setups, cleanups};
}

// Run one bash script, append its output to the log, return {code, output}.
function runScript(scriptPath, cwd, env, logFd) {
	const r = sh('bash', [scriptPath], {cwd, env});
	const chunk = `\n# --- ${scriptPath} (cwd=${cwd}) ---\n${r.stdout}${r.stderr}`;
	if (logFd !== null) fs.writeSync(logFd, chunk);
	return {code: r.status === null ? 1 : r.status, output: r.stdout + r.stderr};
}

// --- the core: run one command ---------------------------------------------

function runCommand(root, name, opts = {}) {
	const dir = paths.commandDir(root, name);
	const manifestPath = join(dir, 'manifest.json');
	if (!fs.existsSync(manifestPath)) {
		throw new Error(`no runbook "${name}" at ${dir}`);
	}
	const manifest = readJson(manifestPath);
	if ((manifest.kind || 'command') === 'flow') return runFlow(root, manifest, opts);

	const isolation = manifest.isolation || 'worktree';
	if (isolation !== 'worktree' && isolation !== 'shared-dir') {
		throw new Error(`runbook "${name}": isolation must be worktree|shared-dir`);
	}
	const cwd = opts.cwd || process.cwd();
	const repo = manifest.repo
		? manifest.repo
		: repoRootOf(cwd);
	if (!repo) throw new Error(`runbook "${name}": not inside a git repo (cwd=${cwd})`);

	const scripts = resolveScripts(root, manifest);
	const version = fileVersion([manifestPath, scripts.command, ...scripts.setups, ...scripts.cleanups]);
	const refInfo = resolveRef(repo, manifest.ref);
	const sig = computeSig(manifest, refInfo, version);
	const resource = manifest.resource || `repo:${repo}`;
	const resultPath = join(paths.resultsDir(root), `${sig}.json`);

	if (isolation === 'worktree' && refInfo.label === 'working') {
		throw new Error(`runbook "${name}": worktree mode needs a committed ref (set manifest.ref, e.g. "HEAD")`);
	}

	const plan = {name, kind: 'command', isolation, repo, resource, ref: refInfo.label, refSha: refInfo.sha, sig, lockKey: isolation === 'shared-dir' ? resource : sig, resultPath, command: scripts.command, setups: scripts.setups, cleanups: scripts.cleanups};
	if (opts.dryRun) return {dryRun: true, plan};

	// Coalesce / lock.
	const lease = lock.coordinate({
		lockKey: plan.lockKey,
		sig,
		state: `${refInfo.label}@${refInfo.sha}`,
		locksDir: paths.locksDir(root),
		resultPath,
		pollMs: manifest.pollMs,
		ttlMs: manifest.ttlMs,
		timeoutMs: manifest.timeoutMs,
	});
	if (lease.role === 'cached' || lease.role === 'coalesced') {
		return {...lease.result, cached: true, coalesced: lease.role === 'coalesced'};
	}

	// We are the leader: execute.
	paths.ensureDir(paths.runsDir(root));
	const startedAt = Date.now();
	const logPath = join(paths.runsDir(root), `${name}-${sig.slice(0, 8)}-${startedAt}.log`);
	const logFd = fs.openSync(logPath, 'a');
	let workdir = repo;
	let madeWorktree = false;
	let beforeSnapshot = null;
	let envelope;
	try {
		if (isolation === 'worktree') {
			paths.ensureDir(paths.worktreesDir(root));
			workdir = join(paths.worktreesDir(root), `wt-${sig.slice(0, 8)}-${process.pid}`);
			// Clear any leftover from a prior hard-crashed run before re-adding.
			git(repo, ['worktree', 'prune']);
			try {
				fs.rmSync(workdir, {recursive: true, force: true});
			} catch {
				/* nothing to clear */
			}
			const add = git(repo, ['worktree', 'add', '--detach', '--force', workdir, refInfo.sha]);
			if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
			madeWorktree = true;
		} else {
			beforeSnapshot = worktreeSnapshot(repo);
		}

		const env = {
			...process.env,
			RUNBOOK_NAME: name,
			RUNBOOK_WORKDIR: workdir,
			RUNBOOK_REPO: repo,
			RUNBOOK_REF: refInfo.label,
			RUNBOOK_REF_SHA: refInfo.sha,
			RUNBOOK_RESOURCE: resource,
			RUNBOOK_ISOLATION: isolation,
			RUNBOOK_LOG: logPath,
		};

		let combined = '';
		let code = 0;
		for (const s of scripts.setups) {
			const r = runScript(s, workdir, env, logFd);
			combined += r.output;
			if (r.code !== 0) {
				code = r.code;
				combined += `\n[runbook] setup failed: ${s}\n`;
			}
		}
		if (code === 0) {
			const r = runScript(scripts.command, workdir, env, logFd);
			combined += r.output;
			code = r.code;
		}
		// Cleanups always run (best-effort restore), even on failure.
		for (const c of scripts.cleanups) {
			const r = runScript(c, workdir, env, logFd);
			combined += r.output;
		}

		const parsed = parseReport(manifest.report, code, combined);
		let status = code === 0 ? 'pass' : 'fail';
		let pristine = null;
		if (isolation === 'shared-dir') {
			pristine = worktreeSnapshot(repo) === beforeSnapshot;
			if (!pristine) {
				status = 'error';
				parsed.summary = `cleanup did not restore the checkout (working tree drifted) — ${parsed.summary}`;
			}
		}
		envelope = {
			command: name,
			kind: 'command',
			status,
			exitCode: code,
			cached: false,
			isolation,
			ref: refInfo.label,
			sig,
			durationMs: Date.now() - startedAt,
			summary: parsed.summary,
			findings: parsed.findings,
			findingsTruncated: parsed.findingsTruncated,
			pristine,
			log: logPath,
		};
		lock.writeResultAtomic(resultPath, envelope);
		return envelope;
	} finally {
		fs.closeSync(logFd);
		if (madeWorktree) git(repo, ['worktree', 'remove', '--force', workdir]);
		lock.release(lease);
	}
}

// --- flows ------------------------------------------------------------------

function runFlow(root, manifest, opts = {}) {
	const steps = manifest.steps || [];
	if (opts.dryRun) {
		return {dryRun: true, plan: {name: manifest.name, kind: 'flow', steps}};
	}
	const stack = opts._stack || new Set();
	if (stack.has(manifest.name)) {
		throw new Error(`runbook flow cycle detected: "${manifest.name}" via [${[...stack].join(' -> ')}]`);
	}
	stack.add(manifest.name);
	const childOpts = {...opts, _stack: stack};
	const startedAt = Date.now();
	const results = [];
	let status = 'pass';
	for (const step of steps) {
		const r = runCommand(root, step, childOpts);
		results.push({command: step, status: r.status, summary: r.summary, cached: r.cached, log: r.log});
		if (r.status === 'error') status = 'error';
		else if (r.status !== 'pass' && status !== 'error') status = 'fail';
	}
	const failed = results.filter((r) => r.status !== 'pass');
	return {
		command: manifest.name,
		kind: 'flow',
		status,
		durationMs: Date.now() - startedAt,
		summary: failed.length === 0 ? `${steps.length} step(s) ok` : `${failed.length}/${steps.length} step(s) failed: ${failed.map((f) => f.command).join(', ')}`,
		steps: results,
	};
}

// --- scaffold ---------------------------------------------------------------

const COMMAND_STUB = `#!/usr/bin/env bash
# Runbook command body: the ONE thing this command checks/does.
# Runs with cwd = $RUNBOOK_WORKDIR. Available env: RUNBOOK_REPO, RUNBOOK_REF,
# RUNBOOK_RESOURCE, RUNBOOK_ISOLATION, RUNBOOK_LOG. Print to stdout/stderr;
# the runner captures it. Exit non-zero on failure.
#
# Example (Docker-bound check, shared-dir mode):
#   docker exec {container} sh -lc 'cd /app && {tool} {args}'
set -euo pipefail

echo "TODO: implement {name}"
`;

function scaffold(root, name, scOpts) {
	const dir = paths.commandDir(root, name);
	if (fs.existsSync(join(dir, 'manifest.json'))) {
		throw new Error(`runbook "${name}" already exists at ${dir}`);
	}
	paths.ensureDir(dir);
	paths.ensureDir(paths.setupsDir(root));
	paths.ensureDir(paths.cleanupsDir(root));

	let manifest;
	if (scOpts.flow) {
		manifest = {name, kind: 'flow', steps: []};
	} else {
		manifest = {
			name,
			kind: 'command',
			isolation: scOpts.isolation || 'worktree',
			ref: (scOpts.isolation || 'worktree') === 'worktree' ? 'HEAD' : 'working',
			setups: [],
			cleanups: [],
			command: 'command.sh',
			// Optional regexes matched by the hint hook against a hand-run Bash
			// command; on a match it nudges the agent to run this runbook instead.
			triggers: [],
			// Optional report parser; empty fields fall back to defaults.
			report: {summary: '', findings: ''},
		};
	}
	fs.writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
	if (!scOpts.flow) {
		fs.writeFileSync(join(dir, 'command.sh'), COMMAND_STUB.replace(/\{name\}/g, name), {mode: 0o755});
	}
	return {dir, manifest};
}

function listRunbooks(root) {
	let entries = [];
	try {
		entries = fs.readdirSync(root, {withFileTypes: true});
	} catch {
		return [];
	}
	const out = [];
	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith('.') || e.name === '_lib') continue;
		const mp = join(root, e.name, 'manifest.json');
		try {
			const m = readJson(mp);
			out.push({name: m.name || e.name, kind: m.kind || 'command', isolation: m.isolation});
		} catch {
			// not a runbook dir
		}
	}
	return out;
}

// --- CLI --------------------------------------------------------------------

function parseCli(argv) {
	const out = {_: [], flags: {}};
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i];
		if (t.startsWith('--')) {
			const key = t.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith('--')) {
				out.flags[key] = next;
				i++;
			} else {
				out.flags[key] = true;
			}
		} else {
			out._.push(t);
		}
	}
	return out;
}

function main() {
	const cli = parseCli(process.argv.slice(2));
	const scope = cli.flags.scope || 'project';
	// A bare `--root` (no value) is ignored, falling back to scope.
	const rootOverride = typeof cli.flags.root === 'string' ? cli.flags.root : undefined;
	const root = paths.resolveStoreDir(scope, process.cwd(), rootOverride);
	const print = (obj) => process.stdout.write(JSON.stringify(obj, null, cli.flags.json ? 0 : 2) + '\n');

	const cmd = cli._[0];
	if (cmd === 'scaffold') {
		const name = cli._[1];
		if (!name) throw new Error('scaffold needs a name');
		const {dir, manifest} = scaffold(root, name, {flow: !!cli.flags.flow, isolation: cli.flags.isolation});
		process.stdout.write(`scaffolded ${manifest.kind} "${name}" at ${dir}\n`);
		if (!cli.flags.flow) {
			process.stdout.write(`  edit ${join(dir, 'command.sh')} then run:  node ${__filename} ${name} --scope ${scope}\n`);
		}
		return;
	}
	if (cmd === 'list') {
		for (const rb of listRunbooks(root)) {
			process.stdout.write(`${rb.kind === 'flow' ? 'flow   ' : 'command'}  ${rb.name}${rb.isolation ? `  [${rb.isolation}]` : ''}\n`);
		}
		return;
	}
	if (!cmd) throw new Error('usage: run.js <name> | scaffold <name> | list | --self-test');
	const result = runCommand(root, cmd, {dryRun: !!cli.flags['dry-run']});
	print(result);
	if (result.status === 'fail' || result.status === 'error') process.exitCode = 1;
}

module.exports = {
	runCommand,
	runFlow,
	scaffold,
	listRunbooks,
	parseReport,
	computeSig,
	resolveRef,
	repoRootOf,
};

if (require.main === module) {
	if (process.argv.includes('--self-test')) {
		process.exit(require('./run-self-test').run());
	}
	try {
		main();
	} catch (err) {
		process.stderr.write(`runbook error: ${err.message}\n`);
		process.exit(2);
	}
}
