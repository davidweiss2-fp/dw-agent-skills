#!/usr/bin/env node
'use strict';

// dw-env preflight: deterministic local-environment readiness checks.
//
// Verifies the three things that have actually burned sessions: the flat
// {workspace}/{repo} layout (a clone nested under a namespace subdir breaks
// every downstream path assumption), a reachable Docker daemon, and a
// populated AWS credentials file. Prints a compact JSON envelope; the CLI
// exits 0 on pass, 1 on fail. Reports credential presence/shape only - it
// never echoes a value from the credentials file.
//
// node: builtins only. spawnSync takes argv arrays only - never a shell
// string built from input.

const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const {dirname, join} = require('node:path');

const BOOL_FLAGS = new Set(['json', 'self-test']);
const CHECK_NAMES = new Set(['layout', 'docker', 'aws']);

function parseArgs(argv) {
	const args = {skip: []};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) continue;
		const eq = token.indexOf('=');
		const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
		let value;
		if (eq !== -1) {
			value = token.slice(eq + 1);
		} else if (BOOL_FLAGS.has(key)) {
			args[key] = true;
			continue;
		} else {
			value = argv[i + 1];
			if (value === undefined || value.startsWith('--')) continue;
			i++;
		}
		if (key === 'skip') args.skip.push(...value.split(',').filter(Boolean));
		else args[key] = value;
	}
	return args;
}

// Precedence: --workspace-root flag > DW_ENV_WORKSPACE_ROOT > parent dir of
// the current git root > null (caller skips the layout check).
function resolveWorkspaceRoot(args, env) {
	const flag = args && args['workspace-root'];
	if (typeof flag === 'string' && flag.length > 0) return flag;
	const fromEnv = env && env.DW_ENV_WORKSPACE_ROOT;
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
	const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8'});
	if (r.error || r.status !== 0) return null;
	const top = (r.stdout || '').trim();
	return top ? dirname(top) : null;
}

function listSubdirs(dir) {
	let entries;
	try {
		entries = fs.readdirSync(dir, {withFileTypes: true});
	} catch {
		return null;
	}
	return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

function isGitRepo(dir) {
	return fs.existsSync(join(dir, '.git'));
}

// Asserts the flat {root}/{repo} layout: flags git repos nested two levels
// deep ({root}/<ns>/<repo>/.git) and near-empty namespace dirs shadowing a
// flat repo. `repo` (optional) additionally reports that repo's clone target.
function checkLayout(root, repo) {
	if (!root) {
		return {
			name: 'layout',
			status: 'skip',
			detail: 'no workspace root resolved - layout not checked',
			remediation: 'pass --workspace-root <path> or set DW_ENV_WORKSPACE_ROOT (the concrete root lives in the dw-knowledge store, not in this repo)',
		};
	}
	const top = listSubdirs(root);
	if (top === null) {
		return {name: 'layout', status: 'fail', detail: `workspace root not readable: ${root}`, remediation: `mkdir -p ${root}, or point --workspace-root / DW_ENV_WORKSPACE_ROOT at the real root`};
	}
	const problems = [];
	const fixes = [];
	for (const ns of top) {
		const nsPath = join(root, ns);
		if (isGitRepo(nsPath)) continue;
		const inner = listSubdirs(nsPath) || [];
		for (const name of inner) {
			const nestedPath = join(nsPath, name);
			const flatPath = join(root, name);
			if (isGitRepo(nestedPath)) {
				if (isGitRepo(flatPath)) {
					problems.push(`nested clone ${ns}/${name} shadows the flat repo ${name}`);
					fixes.push(`verify nothing unique is inside, then remove ${nsPath}`);
				} else {
					problems.push(`nested git repo ${ns}/${name} violates the flat layout`);
					fixes.push(`mv ${nestedPath} ${flatPath} && rmdir ${nsPath}`);
				}
			} else if (inner.length <= 2 && isGitRepo(flatPath)) {
				problems.push(`near-empty namespace dir ${ns}/${name} shadows the flat repo ${name}`);
				fixes.push(`verify nothing unique is inside, then remove ${nsPath}`);
			}
		}
	}
	if (problems.length > 0) {
		return {name: 'layout', status: 'fail', detail: problems.join('; '), remediation: fixes.join('; ')};
	}
	let detail = `flat {root}/{repo} layout holds (${top.length} top-level dirs)`;
	if (repo) {
		const target = join(root, repo);
		detail += isGitRepo(target) ? `; ${repo} present at ${target}` : `; ${repo} not cloned yet - clone target is ${target}`;
	}
	return {name: 'layout', status: 'pass', detail, remediation: ''};
}

function checkDocker() {
	const r = spawnSync('docker', ['info'], {stdio: ['ignore', 'ignore', 'ignore']});
	if (r.error && r.error.code === 'ENOENT') {
		return {name: 'docker', status: 'fail', detail: 'docker CLI not found on PATH - Docker is not installed', remediation: 'install Docker Desktop (or colima + the docker CLI), then re-run the preflight'};
	}
	if (r.status === 0) {
		return {name: 'docker', status: 'pass', detail: 'docker daemon is reachable', remediation: ''};
	}
	return {name: 'docker', status: 'fail', detail: 'docker CLI is installed but the daemon did not respond', remediation: 'start Docker Desktop (or `colima start`), wait for it to settle, then re-run the preflight'};
}

// Shape-only check of the AWS credentials file: exists, non-empty, and at
// least one [profile] section carries aws_access_key_id. Never echoes values.
function checkAwsCreds(credPath) {
	const file = credPath || join(os.homedir(), '.aws', 'credentials');
	let raw;
	try {
		raw = fs.readFileSync(file, 'utf8');
	} catch {
		return {name: 'aws', status: 'fail', detail: `credentials file missing: ${file}`, remediation: 'the dev creates and fills it directly (e.g. `aws configure`) - credential values are never pasted to an agent'};
	}
	if (raw.trim().length === 0) {
		return {name: 'aws', status: 'fail', detail: `credentials file is empty: ${file}`, remediation: 'the dev fills it directly (e.g. `aws configure`) - credential values are never pasted to an agent'};
	}
	let sections = 0;
	let sectionsWithKeyId = 0;
	let currentHasKeyId = true; // true so key lines before any [section] header don't count
	for (const line of raw.split(/\r?\n/)) {
		if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
			sections++;
			currentHasKeyId = false;
			continue;
		}
		if (!currentHasKeyId && /^\s*aws_access_key_id\s*=\s*\S/.test(line)) {
			currentHasKeyId = true;
			sectionsWithKeyId++;
		}
	}
	if (sectionsWithKeyId === 0) {
		return {name: 'aws', status: 'fail', detail: `no [profile] section with aws_access_key_id (${sections} section(s) present): ${file}`, remediation: 'add a profile with aws_access_key_id (e.g. `aws configure`) - the dev enters values directly, never via an agent'};
	}
	return {name: 'aws', status: 'pass', detail: `${sectionsWithKeyId} of ${sections} profile(s) carry aws_access_key_id`, remediation: ''};
}

// Fail-fast order: layout -> docker -> aws. Prints per-check lines (unless
// opts.json) plus the compact envelope, and returns the envelope.
function runPreflight(opts = {}) {
	const started = Date.now();
	const skip = new Set(opts.skip || []);
	const checks = [];
	const plan = [
		['layout', () => checkLayout(opts.workspaceRoot || null, opts.repo)],
		['docker', () => checkDocker()],
		['aws', () => checkAwsCreds(opts.credPath)],
	];
	for (const [name, run] of plan) {
		if (skip.has(name)) {
			checks.push({name, status: 'skip', detail: 'skipped via --skip', remediation: ''});
			continue;
		}
		const check = run();
		checks.push(check);
		if (check.status === 'fail') break;
	}
	const status = checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
	const envelope = {command: 'env-preflight', status, checks, durationMs: Date.now() - started};
	if (!opts.json) {
		for (const c of checks) {
			const mark = c.status === 'pass' ? 'ok  ' : c.status === 'skip' ? 'skip' : 'FAIL';
			process.stdout.write(`${mark} ${c.name} - ${c.detail}\n`);
			if (c.remediation) process.stdout.write(`     fix: ${c.remediation}\n`);
		}
	}
	process.stdout.write(JSON.stringify(envelope) + '\n');
	return envelope;
}

function main() {
	const args = parseArgs(process.argv);
	for (const s of args.skip) {
		if (!CHECK_NAMES.has(s)) {
			process.stderr.write(`env-preflight: unknown --skip value '${s}' (expected layout|docker|aws)\n`);
			process.exit(2);
		}
	}
	const envelope = runPreflight({
		workspaceRoot: resolveWorkspaceRoot(args, process.env),
		repo: typeof args.repo === 'string' ? args.repo : undefined,
		skip: args.skip,
		json: args.json === true,
	});
	process.exit(envelope.status === 'pass' ? 0 : 1);
}

module.exports = {resolveWorkspaceRoot, checkLayout, checkAwsCreds, runPreflight};

// --- Self-test ----------------------------------------------------------------

// mkdtemp fixtures (fake nested clone, placeholder-only creds) driving the
// REAL check functions. Needs no Docker daemon and no real credentials.
function selfTest() {
	let failures = 0;
	const log = (ok, msg) => {
		if (!ok) failures++;
		process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
	};

	const root = fs.mkdtempSync(join(os.tmpdir(), 'dw-env-'));
	fs.mkdirSync(join(root, 'flat-repo', '.git'), {recursive: true});
	fs.mkdirSync(join(root, 'some-org', 'nested-repo', '.git'), {recursive: true});

	const nested = checkLayout(root);
	log(nested.status === 'fail', 'checkLayout flags a nested clone');
	log(nested.remediation === `mv ${join(root, 'some-org', 'nested-repo')} ${join(root, 'nested-repo')} && rmdir ${join(root, 'some-org')}`, 'nested-clone remediation is the mv + rmdir line');

	fs.rmSync(join(root, 'some-org'), {recursive: true, force: true});
	log(checkLayout(root).status === 'pass', 'checkLayout passes a flat workspace');

	fs.mkdirSync(join(root, 'other-org', 'flat-repo'), {recursive: true});
	const shadow = checkLayout(root);
	log(shadow.status === 'fail' && shadow.detail.includes('shadows'), 'checkLayout flags a near-empty namespace dir shadowing a flat repo');
	fs.rmSync(join(root, 'other-org'), {recursive: true, force: true});

	const skipped = checkLayout(null);
	log(skipped.status === 'skip' && skipped.remediation.includes('--workspace-root'), 'checkLayout(null) skips with a remediation line');

	const target = checkLayout(root, 'flat-repo');
	log(target.status === 'pass' && target.detail.includes(join(root, 'flat-repo')), 'checkLayout reports the flat clone target for --repo');

	const credDir = fs.mkdtempSync(join(os.tmpdir(), 'dw-env-aws-'));
	log(checkAwsCreds(join(credDir, 'absent')).status === 'fail', 'checkAwsCreds fails on a missing file');
	const emptyFile = join(credDir, 'empty');
	fs.writeFileSync(emptyFile, '\n');
	log(checkAwsCreds(emptyFile).status === 'fail', 'checkAwsCreds fails on an empty file');
	const credFile = join(credDir, 'credentials');
	fs.writeFileSync(credFile, '[default]\naws_access_key_id = AKIA_PLACEHOLDER\naws_secret_access_key = SECRET_PLACEHOLDER\n');
	const shaped = checkAwsCreds(credFile);
	log(shaped.status === 'pass', 'checkAwsCreds passes a populated placeholder profile');
	log(!JSON.stringify(shaped).includes('PLACEHOLDER'), 'checkAwsCreds never echoes a value from the file');
	fs.writeFileSync(credFile, '[default]\nregion = us-east-1\n');
	log(checkAwsCreds(credFile).status === 'fail', 'checkAwsCreds fails when no profile carries aws_access_key_id');

	log(resolveWorkspaceRoot({'workspace-root': join(root, 'a')}, {DW_ENV_WORKSPACE_ROOT: join(root, 'b')}) === join(root, 'a'), 'resolveWorkspaceRoot prefers the flag over the env var');
	log(resolveWorkspaceRoot({}, {DW_ENV_WORKSPACE_ROOT: join(root, 'b')}) === join(root, 'b'), 'resolveWorkspaceRoot falls back to the env var');
	const repoDir = join(root, 'git-repo');
	fs.mkdirSync(repoDir, {recursive: true});
	const init = spawnSync('git', ['init', '-q'], {cwd: repoDir, stdio: 'ignore'});
	if (init.status === 0) {
		const prev = process.cwd();
		process.chdir(repoDir);
		try {
			log(resolveWorkspaceRoot({}, {}) === dirname(fs.realpathSync(repoDir)), 'resolveWorkspaceRoot falls back to the parent of the git root');
		} finally {
			process.chdir(prev);
		}
	} else {
		log(true, 'skip git-fallback probe (git unavailable)');
	}

	fs.rmSync(root, {recursive: true, force: true});
	fs.rmSync(credDir, {recursive: true, force: true});
	process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} - env-preflight self-test\n`);
	process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module) {
	if (process.argv.includes('--self-test')) {
		selfTest();
	} else {
		main();
	}
}
