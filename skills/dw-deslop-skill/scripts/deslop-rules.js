'use strict';

// Deterministic deslop rules engine. Applies find/replace rules ONLY to the lines
// this branch introduced (the deslop scope), so unchanged code is never touched.
// Rules are data: shipped defaults in references/rules.default.json, overlaid by user
// rules in ~/.claude/knowledge/deslop-rules/*.json (a same-name user rule wins).

const {spawnSync} = require('node:child_process');
const {readFileSync, writeFileSync, readdirSync, existsSync} = require('node:fs');
const {join} = require('node:path');
const os = require('node:os');

const DEFAULTS_PATH = join(__dirname, '..', 'references', 'rules.default.json');

function userRulesDir() {
	return join(os.homedir(), '.claude', 'knowledge', 'deslop-rules');
}

function parseArgs(argv) {
	const args = {paths: []};
	for (let i = 2; i < argv.length; i++) {
		const t = argv[i];
		if (t === '--staged' || t === '--list' || t === '--dry-run' || t === '--json' || t === '--self-test') {
			args[t.slice(2)] = true;
		} else if (t === '--base') {
			args.base = argv[++i];
		} else if (t === '--paths') {
			while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.paths.push(argv[++i]);
		}
	}
	return args;
}

function loadRules(opts = {}) {
	const defaultsPath = opts.defaultsPath || DEFAULTS_PATH;
	const dir = opts.userDir || userRulesDir();
	const byName = new Map();
	let defaults = [];
	try {
		defaults = JSON.parse(readFileSync(defaultsPath, 'utf8'));
	} catch {
		defaults = [];
	}
	for (const r of defaults) byName.set(r.name, {...r, origin: 'default'});
	if (existsSync(dir)) {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith('.json')) continue;
			let parsed;
			try {
				parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
			} catch {
				continue;
			}
			const list = Array.isArray(parsed) ? parsed : [parsed];
			for (const r of list) if (r && r.name) byName.set(r.name, {...r, origin: 'user'});
		}
	}
	return [...byName.values()];
}

function globToRegExp(glob) {
	if (glob === '*' || glob === '**' || glob === '**/*') return /^.*$/;
	const re = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*\//g, '(?:.*/)?')
		.replace(/\*\*/g, '.*')
		.replace(/\*/g, '[^/]*');
	return new RegExp(`^${re}$`);
}

function ruleApplies(rule, file) {
	const globs = rule.appliesTo && rule.appliesTo.length ? rule.appliesTo : ['**/*'];
	return globs.some((g) => globToRegExp(g).test(file));
}

// Parse `git diff --unified=0` into a map of file -> Set of added (new-side) line numbers.
function changedLines(opts = {}) {
	const cwd = opts.cwd || process.cwd();
	let diffArgs;
	if (opts.staged) {
		diffArgs = ['diff', '--staged', '--unified=0', '--no-color'];
	} else {
		const base = opts.base || resolveBase(cwd);
		diffArgs = ['diff', '--unified=0', '--no-color', `--merge-base`, base];
	}
	if (opts.paths && opts.paths.length) diffArgs.push('--', ...opts.paths);
	const res = spawnSync('git', diffArgs, {cwd, encoding: 'utf8'});
	const out = res.status === 0 && res.stdout ? res.stdout : '';
	const map = new Map();
	let file = null;
	for (const line of out.split('\n')) {
		const fm = line.match(/^\+\+\+ b\/(.*)$/);
		if (fm) {
			file = fm[1] === '/dev/null' ? null : fm[1];
			if (file && !map.has(file)) map.set(file, new Set());
			continue;
		}
		const hm = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
		if (hm && file) {
			const start = Number.parseInt(hm[1], 10);
			const count = hm[2] === undefined ? 1 : Number.parseInt(hm[2], 10);
			for (let n = start; n < start + count; n++) map.get(file).add(n);
		}
	}
	return map;
}

function resolveBase(cwd) {
	for (const ref of ['origin/HEAD', 'main', 'master']) {
		const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {cwd, encoding: 'utf8'});
		if (r.status === 0) return ref.replace(/^origin\//, 'origin/');
	}
	return 'HEAD';
}

// Apply rules to the added lines of one file's content. Pure - no I/O.
function applyRules(content, addedLines, rules, file) {
	const lines = content.split('\n');
	const counts = {};
	for (let idx = 0; idx < lines.length; idx++) {
		const lineNo = idx + 1;
		if (addedLines && !addedLines.has(lineNo)) continue;
		for (const rule of rules) {
			if (rule.enabled === false) continue;
			if (!ruleApplies(rule, file)) continue;
			const re = new RegExp(rule.find, rule.flags || 'g');
			const before = lines[idx];
			const after = before.replace(re, rule.replace);
			if (after !== before) {
				const hits = (before.match(re) || []).length;
				counts[rule.name] = (counts[rule.name] || 0) + hits;
				lines[idx] = after;
			}
		}
	}
	return {content: lines.join('\n'), counts};
}

function runEngine(opts) {
	const cwd = opts.cwd || process.cwd();
	const rules = loadRules(opts);
	const changed = changedLines(opts);
	const rulesApplied = {};
	let anyChange = false;
	for (const [file, addedLines] of changed) {
		const abs = join(cwd, file);
		if (!existsSync(abs)) continue;
		const original = readFileSync(abs, 'utf8');
		const {content, counts} = applyRules(original, addedLines, rules, file);
		if (content !== original) {
			anyChange = true;
			if (!opts.dryRun) writeFileSync(abs, content);
			for (const [name, n] of Object.entries(counts)) {
				rulesApplied[name] = rulesApplied[name] || {rule: name, files: [], count: 0};
				rulesApplied[name].files.push(file);
				rulesApplied[name].count += n;
			}
		}
	}
	return {
		command: 'deslop-rules',
		status: anyChange ? 'changed' : 'pass',
		dryRun: !!opts.dryRun,
		rulesApplied: Object.values(rulesApplied),
	};
}

function main() {
	const args = parseArgs(process.argv);
	if (args.list) {
		const rules = loadRules();
		if (args.json) {
			process.stdout.write(JSON.stringify(rules, null, 2) + '\n');
		} else {
			for (const r of rules) {
				process.stdout.write(`${r.enabled === false ? '[off] ' : ''}${r.name} (${r.origin}) - ${r.description || ''}\n`);
			}
		}
		return;
	}
	const envelope = runEngine({base: args.base, staged: args.staged, paths: args.paths, dryRun: args['dry-run']});
	if (args.json) {
		process.stdout.write(JSON.stringify(envelope) + '\n');
	} else {
		const applied = envelope.rulesApplied.map((r) => `${r.rule} x${r.count} in ${r.files.length} file(s)`).join('; ');
		process.stdout.write(`${envelope.status}${envelope.dryRun ? ' (dry-run)' : ''}${applied ? ': ' + applied : ' - nothing to change'}\n`);
	}
}

// --- Self-test --------------------------------------------------------------

function selfTest() {
	const {mkdtempSync, mkdirSync, writeFileSync: wf, rmSync} = require('node:fs');
	const {tmpdir} = require('node:os');
	let failures = 0;
	const log = (ok, msg) => {
		if (!ok) failures++;
		process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
	};

	// applyRules: only added lines change; untouched lines keep their em-dash.
	const rules = [{name: 'em-dash-to-hyphen', find: '[\\u2014\\u2013]', replace: '-', appliesTo: ['**/*'], enabled: true}];
	const content = 'kept — dash\nnew — dash\n';
	const added = new Set([2]);
	const out = applyRules(content, added, rules, 'a.md');
	log(out.content === 'kept — dash\nnew - dash\n', 'applyRules rewrites only the added line');
	log(out.counts['em-dash-to-hyphen'] === 1, 'applyRules counts the one replacement');

	// glob matching
	log(ruleApplies({appliesTo: ['*.md']}, 'a.md') && !ruleApplies({appliesTo: ['*.md']}, 'a.js'), 'ruleApplies honors *.md');
	log(ruleApplies({appliesTo: ['**/*']}, 'deep/x.ts'), 'ruleApplies catch-all matches nested');

	// user overlay precedence
	const dir = mkdtempSync(join(tmpdir(), 'deslop-user-'));
	const defs = mkdtempSync(join(tmpdir(), 'deslop-def-'));
	wf(join(defs, 'd.json'), JSON.stringify([{name: 'em-dash-to-hyphen', find: 'x', replace: 'y', origin: 'seed'}]));
	wf(join(dir, 'over.json'), JSON.stringify([{name: 'em-dash-to-hyphen', find: 'z', replace: 'w'}]));
	const loaded = loadRules({defaultsPath: join(defs, 'd.json'), userDir: dir});
	const overlaid = loaded.find((r) => r.name === 'em-dash-to-hyphen');
	log(overlaid.origin === 'user' && overlaid.find === 'z', 'user rule overrides default of same name');

	// changedLines + dry-run against a real temp git repo
	const repo = mkdtempSync(join(tmpdir(), 'deslop-git-'));
	const git = (a) => spawnSync('git', a, {cwd: repo, encoding: 'utf8'});
	git(['init', '-q', '-b', 'base']);
	git(['config', 'user.email', 't@example.com']);
	git(['config', 'user.name', 'test']);
	wf(join(repo, 'f.md'), 'base — keep\n');
	git(['add', 'f.md']);
	git(['commit', '-qm', 'base']);
	git(['checkout', '-qb', 'work']);
	wf(join(repo, 'f.md'), 'base — keep\nadded — fix\n');
	const cl = changedLines({base: 'base', cwd: repo});
	const fileKey = [...cl.keys()][0];
	log(cl.get(fileKey) && cl.get(fileKey).has(2) && !cl.get(fileKey).has(1), 'changedLines marks only line 2 as added');
	const before = readFileSync(join(repo, 'f.md'), 'utf8');
	runEngine({base: 'base', cwd: repo, dryRun: true, defaultsPath: DEFAULTS_PATH});
	log(readFileSync(join(repo, 'f.md'), 'utf8') === before, '--dry-run writes nothing');

	rmSync(dir, {recursive: true, force: true});
	rmSync(defs, {recursive: true, force: true});
	rmSync(repo, {recursive: true, force: true});
	process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} - deslop-rules self-test\n`);
	process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module) {
	if (process.argv.includes('--self-test')) selfTest();
	else main();
}

module.exports = {loadRules, changedLines, applyRules, ruleApplies, globToRegExp, runEngine};
