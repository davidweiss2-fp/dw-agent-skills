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
		hooks: true,
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
			case '--hooks': opts.hooks = true; break;
			case '--no-hooks': opts.hooks = false; break;
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

function claudeSettingsPath() {
	const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	return path.join(configDir, 'settings.json');
}

function claudePluginInstalled() {
	if (!hasCmd('claude')) return false;
	const r = captureSpawn('claude', ['plugin', 'list']);
	return r.status === 0 && new RegExp(PLUGIN_NAME, 'i').test(r.stdout || '');
}

// Load hooks/hooks.json and point its ${CLAUDE_PLUGIN_ROOT} commands at this install.
function readHooksManifest(repoRoot) {
	const file = path.join(repoRoot, 'hooks', 'hooks.json');
	if (!fs.existsSync(file)) return null;
	const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!manifest || typeof manifest.hooks !== 'object' || manifest.hooks === null) return null;
	const entries = {};
	for (const [event, groups] of Object.entries(manifest.hooks)) {
		if (!Array.isArray(groups)) continue;
		entries[event] = groups.map((group) => ({
			...group,
			hooks: (Array.isArray(group.hooks) ? group.hooks : []).map((h) => ({
				...h,
				command: String(h.command || '').replaceAll('${CLAUDE_PLUGIN_ROOT}', repoRoot),
			})),
		}));
	}
	return entries;
}

function hookCommands(groups) {
	const commands = new Set();
	for (const group of groups || []) {
		for (const h of (group && group.hooks) || []) {
			if (h && typeof h.command === 'string') commands.add(h.command);
		}
	}
	return commands;
}

// Additive merge: append our entries to each event array, dedupe by exact command
// string, never clobber foreign entries. Writes only outside --dry-run.
function mergeHooksIntoSettings(settingsPath, entries, {dryRun} = {}) {
	const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
	if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings is not a JSON object');
	if (settings.hooks === undefined) settings.hooks = {};
	if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) throw new Error('"hooks" is not a JSON object');
	let added = 0;
	let present = 0;
	for (const [event, groups] of Object.entries(entries)) {
		if (settings.hooks[event] === undefined) settings.hooks[event] = [];
		if (!Array.isArray(settings.hooks[event])) throw new Error(`"hooks.${event}" is not an array`);
		const have = hookCommands(settings.hooks[event]);
		for (const group of groups) {
			const fresh = group.hooks.filter((h) => !have.has(h.command));
			present += group.hooks.length - fresh.length;
			if (!fresh.length) continue;
			settings.hooks[event].push({...group, hooks: fresh});
			for (const h of fresh) have.add(h.command);
			added += fresh.length;
		}
	}
	if (added && !dryRun) {
		fs.mkdirSync(path.dirname(settingsPath), {recursive: true});
		fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	}
	return {added, present, settingsPath};
}

// Inverse of the merge: drop exactly the hook entries whose command strings match
// ours; foreign entries and unrelated settings stay in place.
function removeHooksFromSettings(settingsPath, entries, {dryRun} = {}) {
	if (!fs.existsSync(settingsPath)) return {removed: 0, settingsPath};
	const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
	const hooks = settings && settings.hooks;
	if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return {removed: 0, settingsPath};
	let removed = 0;
	for (const [event, groups] of Object.entries(entries)) {
		if (!Array.isArray(hooks[event])) continue;
		const ours = hookCommands(groups);
		const kept = [];
		for (const group of hooks[event]) {
			const before = (group && group.hooks) || [];
			const after = before.filter((h) => !(h && typeof h.command === 'string' && ours.has(h.command)));
			removed += before.length - after.length;
			if (after.length === before.length) kept.push(group);
			else if (after.length) kept.push({...group, hooks: after});
		}
		if (kept.length) hooks[event] = kept;
		else if (hooks[event].length) delete hooks[event];
	}
	if (removed && !dryRun) fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	return {removed, settingsPath};
}

// Hook wiring for whatever the plugin cannot cover: the Claude Code plugin registers
// hooks/hooks.json itself; a non-plugin Claude Code install gets the entries merged
// into settings.json; agents without settings-file hooks get the manual docs.
function wireHooks(ctx) {
	const {opts, repoRoot, say, note, results} = ctx;
	if (!opts.hooks) {
		note('hooks: skipped (--no-hooks)');
		return;
	}
	let entries;
	try {
		entries = readHooksManifest(repoRoot);
	} catch (err) {
		note(`hooks: skipped - unreadable hooks/hooks.json (${err.message})`);
		return;
	}
	if (!entries || !Object.keys(entries).length) return;

	const ran = (id) => results.installed.some((s) => s === id || s.startsWith(`${id} `)) || results.failed.some(([f]) => f === id);
	say('→ hooks');
	if (ran('claude') || claudePluginInstalled()) {
		note('  Claude Code: the plugin wires hooks/hooks.json itself - no settings changes needed');
	} else if (fs.existsSync(path.dirname(claudeSettingsPath()))) {
		try {
			const res = mergeHooksIntoSettings(claudeSettingsPath(), entries, {dryRun: opts.dryRun});
			if (res.added) note(`  Claude Code (non-plugin): ${opts.dryRun ? 'would merge' : 'merged'} ${res.added} hook ${res.added === 1 ? 'entry' : 'entries'} into ${res.settingsPath}`);
			else note(`  Claude Code (non-plugin): hook entries already present in ${res.settingsPath}`);
		} catch (err) {
			note(`  Claude Code: left ${claudeSettingsPath()} untouched (${err.message})`);
		}
	} else {
		note('  Claude Code: not present - no settings to wire');
	}
	if (ran('agents')) {
		note('  cursor / codex / windsurf have no settings-file hooks - wire manually via:');
		note(`    ${path.join(repoRoot, 'skills', 'dw-knowledge-skill', 'references', 'recall-hook.md')}`);
		note(`    ${path.join(repoRoot, 'skills', 'dw-runbook-skill', 'references', 'hook.md')}`);
		note(`    nudge script: ${path.join(repoRoot, 'skills', 'dw-handoff-skill', 'scripts', 'dw-handoff-nudge.js')}`);
	}
}

function installClaude(ctx) {
	const {opts, results, say, note} = ctx;
	results.detected++;
	say('→ Claude Code detected');

	if (!opts.force) {
		if (claudePluginInstalled()) {
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
	const {opts, say, ok, note, repoRoot} = ctx;
	say('→ uninstalling dw-agent-skills');

	if (hasCmd('claude')) {
		if (claudePluginInstalled()) {
			runSpawn('claude', ['plugin', 'uninstall', `${PLUGIN_NAME}@${PLUGIN_NAME}`], opts.dryRun);
			ok('  removed claude plugin');
		} else {
			note('  claude plugin not installed — skipping');
		}
	}

	// Remove exactly the hook entries the installer merges (same dedupe key: the
	// exact command string), leaving foreign hooks and other settings untouched.
	if (opts.hooks) {
		try {
			const entries = readHooksManifest(repoRoot);
			if (entries) {
				const res = removeHooksFromSettings(claudeSettingsPath(), entries, {dryRun: opts.dryRun});
				if (res.removed) ok(`  ${opts.dryRun ? 'would remove' : 'removed'} ${res.removed} hook ${res.removed === 1 ? 'entry' : 'entries'} from ${res.settingsPath}`);
				else note(`  no dw hook entries in ${res.settingsPath} - skipping`);
			}
		} catch (err) {
			note(`  hooks: left ${claudeSettingsPath()} untouched (${err.message})`);
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
  --hooks/--no-hooks Wire agent hooks: Claude settings merge or fallback docs (default: on)
  --uninstall, -u    Remove Claude plugin and dw hook entries
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

	if (ctx.results.detected) wireHooks(ctx);

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

if (require.main === module) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

module.exports = {
	parseArgs,
	readHooksManifest,
	mergeHooksIntoSettings,
	removeHooksFromSettings,
	hookCommands,
};
