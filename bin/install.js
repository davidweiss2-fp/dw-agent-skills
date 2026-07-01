#!/usr/bin/env node
'use strict';

const child_process = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO = 'davidweiss2-fp/dw-agent-skills';
const PLUGIN_NAME = 'dw-agent-skills';

const PROVIDERS = [
	{id: 'claude', label: 'Claude Code', mech: 'claude plugin install', detect: 'command:claude'},
	{id: 'agents', label: 'Other agents', mech: "npx skills add -a '*' (minus claude-code)", detect: 'command:npx'},
];

function parseArgs(argv) {
	const opts = {
		dryRun: false,
		force: false,
		uninstall: false,
		listOnly: false,
		help: false,
		nonInteractive: false,
		only: [],
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case '--dry-run': opts.dryRun = true; break;
			case '--force': opts.force = true; break;
			case '--uninstall':
			case '-u': opts.uninstall = true; break;
			case '--list': opts.listOnly = true; break;
			case '-h':
			case '--help': opts.help = true; break;
			case '--non-interactive': opts.nonInteractive = true; break;
			// `npx <pkg> -- <args>` can forward the `--` separator to the bin; ignore it.
			case '--': break;
			case '--only': {
				const v = argv[++i];
				if (!v) die('error: --only requires an argument');
				opts.only.push(v);
				break;
			}
			default:
				if (a.startsWith('--')) die(`unknown flag: ${a}`);
		}
	}
	// `cursor` is an alias for the skills-CLI `agents` path.
	opts.only = opts.only.map((id) => (id === 'cursor' ? 'agents' : id));
	const known = new Set(PROVIDERS.map((p) => p.id));
	for (const id of opts.only) {
		if (!known.has(id)) die(`unknown --only id: ${id}. Valid: ${[...known].join(', ')}`);
	}
	return opts;
}

function die(msg) {
	process.stderr.write(`${msg}\n`);
	process.exit(1);
}

function hasCmd(cmd) {
	try {
		if (process.platform === 'win32') {
			return child_process.spawnSync('where', [cmd], {stdio: 'ignore'}).status === 0;
		}
		return child_process.spawnSync('sh', ['-c', `command -v '${cmd.replace(/'/g, `'\\''`)}'`], {stdio: 'ignore'}).status === 0;
	} catch {
		return false;
	}
}

function macAppPresent(name) {
	if (process.platform !== 'darwin') return false;
	const r = child_process.spawnSync('mdfind', [`kMDItemDisplayName == '${name}'`], {encoding: 'utf8'});
	return (r.stdout || '').trim().length > 0;
}

function detectMatch(spec) {
	return spec.split('||').some((part) => {
		const [kind, val] = part.split(':');
		if (kind === 'command') return hasCmd(val);
		if (kind === 'macapp') return macAppPresent(val);
		return false;
	});
}

function spawnXplat(cmd, args, opts) {
	if (process.platform === 'win32') {
		const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
		return child_process.spawnSync(`${cmd} ${args.map(quote).join(' ')}`, [], {shell: true, ...(opts || {})});
	}
	return child_process.spawnSync(cmd, args, opts || {});
}

function runSpawn(cmd, args, dry, spawnOpts) {
	const where = spawnOpts && spawnOpts.cwd ? ` (cwd: ${spawnOpts.cwd})` : '';
	if (dry) {
		process.stdout.write(`  would run: ${cmd} ${args.join(' ')}${where}\n`);
		return {status: 0};
	}
	process.stdout.write(`  $ ${cmd} ${args.join(' ')}${where}\n`);
	return spawnXplat(cmd, args, {stdio: 'inherit', ...(spawnOpts || {})});
}

function captureSpawn(cmd, args) {
	try {
		return spawnXplat(cmd, args, {encoding: 'utf8'});
	} catch {
		return {status: 1, stdout: '', stderr: ''};
	}
}

function detectRepoRoot() {
	let dir = __dirname;
	for (let i = 0; i < 6; i++) {
		if (fs.existsSync(path.join(dir, 'skills', 'dw-pr-ready-skill', 'SKILL.md'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.join(__dirname, '..');
}

function listSkillNames(repoRoot) {
	const skillsRoot = path.join(repoRoot, 'skills');
	if (!fs.existsSync(skillsRoot)) return [];
	return fs
		.readdirSync(skillsRoot, {withFileTypes: true})
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
}

function skillSummary(repoRoot, name) {
	try {
		const text = fs.readFileSync(path.join(repoRoot, 'skills', name, 'SKILL.md'), 'utf8');
		const h1 = text.split('\n').find((l) => l.startsWith('# '));
		if (h1) return h1.slice(2).trim();
	} catch (_e) {
		/* no summary */
	}
	return '';
}

function installClaude(ctx) {
	const {opts, results, say, note} = ctx;
	results.detected++;
	say('→ Claude Code detected');

	if (!opts.force) {
		const r = captureSpawn('claude', ['plugin', 'list']);
		if (r.status === 0 && new RegExp(PLUGIN_NAME, 'i').test(r.stdout || '')) {
			note('  plugin already installed — updating to the latest version (use --force to reinstall)');
			// Refresh the marketplace from its source, then update the plugin to apply it.
			const u1 = runSpawn('claude', ['plugin', 'marketplace', 'update', PLUGIN_NAME], opts.dryRun);
			const u2 = runSpawn('claude', ['plugin', 'update', `${PLUGIN_NAME}@${PLUGIN_NAME}`], opts.dryRun);
			if ((u1.status || 0) === 0 && (u2.status || 0) === 0) {
				results.installed.push('claude (updated — restart Claude Code to apply)');
			} else {
				results.failed.push(['claude', 'claude plugin update failed (use --force to reinstall)']);
			}
			return;
		}
	}

	const r1 = runSpawn('claude', ['plugin', 'marketplace', 'add', REPO], opts.dryRun);
	const r2 = runSpawn('claude', ['plugin', 'install', `${PLUGIN_NAME}@${PLUGIN_NAME}`], opts.dryRun);
	if ((r1.status || 0) === 0 && (r2.status || 0) === 0) results.installed.push('claude');
	else results.failed.push(['claude', 'claude plugin install failed']);
}

function installAgents(ctx) {
	const {opts, results, say, note, repoRoot} = ctx;
	results.detected++;
	say('→ installing to other agents via the skills CLI');
	// Install every skill to every agent the skills CLI supports.
	const r = runSpawn('npx', ['-y', 'skills', 'add', REPO, '--all'], opts.dryRun, {cwd: os.homedir()});
	if ((r.status || 0) !== 0) {
		results.failed.push(['agents', 'npx skills add failed']);
		return;
	}
	// Drop the skills CLI's claude-code copy.
	const skillNames = listSkillNames(repoRoot);
	if (skillNames.length) {
		const rm = runSpawn('npx', ['-y', 'skills', 'remove', '-a', 'claude-code', '-s', ...skillNames, '-y'], opts.dryRun, {cwd: os.homedir()});
		if ((rm.status || 0) !== 0) note('  note: could not remove the claude-code copy — install Claude via `--only claude`');
	}
	results.installed.push('agents');
}

function uninstall(ctx) {
	const {opts, say, ok, note} = ctx;
	say('→ uninstalling dw-agent-skills');

	if (hasCmd('claude')) {
		const probe = captureSpawn('claude', ['plugin', 'list']);
		if (probe.status === 0 && new RegExp(PLUGIN_NAME, 'i').test(probe.stdout || '')) {
			runSpawn('claude', ['plugin', 'uninstall', `${PLUGIN_NAME}@${PLUGIN_NAME}`], opts.dryRun);
			ok('  removed claude plugin');
		} else {
			note('  claude plugin not installed — skipping');
		}
	}

	note('  skills installed via `npx skills add` — remove with `npx skills remove` or your IDE skill manager');
	ok('done');
}

function printList() {
	const repoRoot = detectRepoRoot();
	process.stdout.write('dw-agent-skills provider matrix\n\n');
	for (const p of PROVIDERS) {
		process.stdout.write(`  ${p.id.padEnd(10)} ${p.label.padEnd(16)} ${p.mech}\n`);
	}
	process.stdout.write('\nSkills:\n');
	const names = listSkillNames(repoRoot);
	if (!names.length) {
		process.stdout.write('  (none)\n');
		return;
	}
	for (const name of names) {
		const summary = skillSummary(repoRoot, name);
		process.stdout.write(`  ${name}${summary ? ` — ${summary}` : ''}\n`);
	}
}

function printHelp() {
	process.stdout.write(`dw-agent-skills installer

USAGE
  npx -y github:${REPO} -- [flags]
  node bin/install.js [flags]

FLAGS
  --only <id>        claude | agents (repeatable)
  --dry-run          Print commands only
  --force            Reinstall even if present
  --uninstall, -u    Remove Claude plugin
  --list             Show providers and skills
  --non-interactive  No prompts
  -h, --help         This help

EXAMPLES
  npx -y github:${REPO}
  npx -y github:${REPO} -- --only agents
  npx -y github:${REPO} -- --only claude
`);
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		return 0;
	}
	if (opts.listOnly) {
		printList();
		return 0;
	}

	const repoRoot = detectRepoRoot();
	const ctx = {
		opts,
		repoRoot,
		say: (s) => process.stdout.write(`${s}\n`),
		note: (s) => process.stdout.write(`  ${s}\n`),
		ok: (s) => process.stdout.write(`${s}\n`),
		results: {installed: [], skipped: [], failed: [], detected: 0},
	};

	if (opts.uninstall) {
		uninstall(ctx);
		return 0;
	}

	ctx.say('dw-agent-skills installer');
	ctx.note(REPO);
	if (opts.dryRun) ctx.note('(dry run)');
	process.stdout.write('\n');

	const want = (id) => opts.only.length === 0 || opts.only.includes(id);
	const explicit = (id) => opts.only.includes(id);

	for (const prov of PROVIDERS) {
		if (!want(prov.id)) continue;
		if (!explicit(prov.id) && !detectMatch(prov.detect)) continue;
		if (prov.id === 'claude') installClaude(ctx);
		if (prov.id === 'agents') installAgents(ctx);
	}

	process.stdout.write('\n');
	ctx.say('done');
	if (ctx.results.installed.length) {
		ctx.ok('installed:');
		for (const a of ctx.results.installed) process.stdout.write(`  • ${a}\n`);
	}
	if (ctx.results.skipped.length) {
		for (const [a, why] of ctx.results.skipped) process.stdout.write(`  skipped ${a}: ${why}\n`);
	}
	if (ctx.results.failed.length) {
		for (const [a, why] of ctx.results.failed) process.stderr.write(`  failed ${a}: ${why}\n`);
		process.exit(1);
	}
	return 0;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
