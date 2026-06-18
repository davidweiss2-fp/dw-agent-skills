'use strict';

// km-review.js — self-contained STALENESS / PRUNE pass over the knowledge store.
// Dependency-free; node: builtins only. Does NOT depend on the external
// consolidate-memory skill, but stays compatible with its file convention
// (one markdown file per memory + an index file of one line per memory).
//
// CLI:
//   node km-review.js [--scope global|project|both] [--prune] [--window-days N]
//
// Default (REPORT, no --prune): scan the chosen store(s) and list
//   1. prune candidates  — confidence === 0
//   2. stale memories    — now past (last_verified + window-days); flag to re-verify
//   3. near-duplicate groups — same/similar name or description; suggest merging,
//      keeping the richest (longest body + most metadata) member.
//
// With --prune: delete the confidence===0 files and regenerate the index. The
// index regeneration shells out to `node km-index.js` when that script is
// present (forward compatibility); otherwise it is rebuilt inline here so this
// script is fully self-contained.
//
// NOTE: this workflow accepts the "current date" from context via --today
// (YYYY-MM-DD) or the KM_TODAY env var, falling back to the runtime clock. The
// runtime `new Date()` fallback is acceptable here because this script runs on
// the user's machine; tests/orchestration may pin the date with --today.
//
// Attribution: recall protocol + invalidate-then-add adapted from MemPalace
// (github.com/MemPalace/mempalace, MIT); capture + summary-first recall patterns
// inspired by Cabinet (github.com/hilash/cabinet, MIT).

const {readdirSync, readFileSync, statSync, unlinkSync, writeFileSync} = require('node:fs');
const {spawnSync} = require('node:child_process');
const {basename, join} = require('node:path');

const fm = require('./km-frontmatter.js');
const paths = require('./km-paths.js');

const DEFAULT_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- arg parsing -----------------------------------------------------------

// Minimal flag parser: supports --flag, --flag value, and --flag=value.
function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) continue;
		const eq = token.indexOf('=');
		if (eq !== -1) {
			args[token.slice(2, eq)] = token.slice(eq + 1);
			continue;
		}
		const key = token.slice(2);
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--')) {
			args[key] = next;
			i++;
		} else {
			args[key] = true;
		}
	}
	return args;
}

// Resolve which scopes to scan. Accepts global|project|both (default both).
function resolveScopes(scopeArg) {
	const s = typeof scopeArg === 'string' ? scopeArg.toLowerCase() : 'both';
	if (s === 'global') return ['global'];
	if (s === 'project') return ['project'];
	if (s === 'both' || s === true) return ['global', 'project'];
	throw new Error(`Unknown --scope (expected global|project|both): ${scopeArg}`);
}

// Resolve "today" from --today / KM_TODAY / runtime clock, as a UTC-midnight Date.
function resolveToday(args) {
	const raw =
		(typeof args.today === 'string' && args.today) ||
		(typeof process.env.KM_TODAY === 'string' && process.env.KM_TODAY) ||
		'';
	const parsed = parseDateOnly(raw);
	if (parsed) return parsed;
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Parse a YYYY-MM-DD string into a UTC-midnight Date, or null if not valid.
function parseDateOnly(value) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
	if (!m) return null;
	const year = Number.parseInt(m[1], 10);
	const month = Number.parseInt(m[2], 10);
	const day = Number.parseInt(m[3], 10);
	const d = new Date(Date.UTC(year, month - 1, day));
	if (
		d.getUTCFullYear() !== year ||
		d.getUTCMonth() !== month - 1 ||
		d.getUTCDate() !== day
	) {
		return null;
	}
	return d;
}

// --- store reading ---------------------------------------------------------

// Index filename for a scope (INDEX.md global, MEMORY.md project).
function indexFileName(scope) {
	return scope === 'global' ? 'INDEX.md' : 'MEMORY.md';
}

// Resolve the absolute index path for a scope.
function indexPathFor(scope) {
	return scope === 'global' ? paths.globalIndexPath() : paths.projectIndexPath();
}

// List the per-memory *.md files in a store dir, excluding the index file.
// Returns absolute paths; empty when the dir is missing/unreadable.
function listMemoryFiles(dir, scope) {
	const skip = indexFileName(scope).toLowerCase();
	let entries;
	try {
		entries = readdirSync(dir);
	} catch (err) {
		if (err && err.code === 'ENOENT') return [];
		throw err;
	}
	const out = [];
	for (const name of entries) {
		if (!name.toLowerCase().endsWith('.md')) continue;
		if (name.toLowerCase() === skip) continue;
		const full = join(dir, name);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isFile()) out.push(full);
	}
	out.sort();
	return out;
}

// Read + parse one memory file into a normalized record.
function loadMemory(file, scope) {
	let raw;
	try {
		raw = readFileSync(file, 'utf8');
	} catch {
		return null;
	}
	const {data, body} = fm.parse(raw);
	const name = typeof data.name === 'string' ? data.name : basename(file, '.md');
	const description = typeof data.description === 'string' ? data.description : '';
	const confidence = toInt(fm.getMeta(data, 'confidence', null));
	const lastVerified = fm.getMeta(data, 'last_verified', null);
	const status = fm.getMeta(data, 'status', 'active');
	return {
		file,
		scope,
		name,
		description,
		confidence,
		lastVerified: typeof lastVerified === 'string' ? lastVerified : null,
		status: typeof status === 'string' ? status : 'active',
		// richness = body length + count of populated metadata keys. Used to pick
		// the member to KEEP when suggesting a merge of near-duplicates.
		richness: richnessOf(data, body),
	};
}

// Coerce a metadata value to an integer, or null when absent/non-numeric.
function toInt(value) {
	if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
		return Number.parseInt(value.trim(), 10);
	}
	return null;
}

// Heuristic richness score: longer bodies and more-populated metadata win.
function richnessOf(data, body) {
	const bodyLen = body ? String(body).trim().length : 0;
	let metaKeys = 0;
	const meta = data && data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
	for (const k of Object.keys(meta)) {
		const v = meta[k];
		if (v === null || v === undefined || v === '') continue;
		if (Array.isArray(v) && v.length === 0) continue;
		metaKeys++;
	}
	return bodyLen + metaKeys * 40;
}

// Load every memory for a scope. Returns [] when the store doesn't exist.
function loadScope(scope) {
	const dir = paths.resolveStoreDir(scope);
	const files = listMemoryFiles(dir, scope);
	const records = [];
	for (const file of files) {
		const rec = loadMemory(file, scope);
		if (rec) records.push(rec);
	}
	return {dir, records};
}

// --- analysis --------------------------------------------------------------

// Days between two UTC-midnight dates (b - a), or null when a is unparseable.
function daysSince(lastVerifiedStr, today) {
	const lv = parseDateOnly(lastVerifiedStr);
	if (!lv) return null;
	return Math.round((today.getTime() - lv.getTime()) / MS_PER_DAY);
}

// Normalize a string for similarity comparison: lowercase alphanumeric tokens.
function tokenize(s) {
	return String(s || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);
}

// A stable key collapsing whitespace/punctuation — used to catch exact-ish dupes.
function normKey(s) {
	return tokenize(s).join(' ');
}

// Jaccard token overlap between two strings, in [0, 1].
function similarity(a, b) {
	const ta = new Set(tokenize(a));
	const tb = new Set(tokenize(b));
	if (ta.size === 0 && tb.size === 0) return 1;
	if (ta.size === 0 || tb.size === 0) return 0;
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter++;
	const union = ta.size + tb.size - inter;
	return union === 0 ? 0 : inter / union;
}

// Two records are near-duplicates when their name OR description matches closely.
function isNearDuplicate(a, b) {
	if (normKey(a.name) && normKey(a.name) === normKey(b.name)) return true;
	if (normKey(a.description) && normKey(a.description) === normKey(b.description)) return true;
	const nameSim = similarity(a.name, b.name);
	const descSim = similarity(a.description, b.description);
	return nameSim >= 0.7 || descSim >= 0.8;
}

// Group records into near-duplicate clusters (transitive via union-find).
// Returns only clusters with 2+ members.
function findDuplicateGroups(records) {
	const parent = records.map((_, i) => i);
	const find = (x) => {
		let r = x;
		while (parent[r] !== r) r = parent[r];
		while (parent[x] !== r) {
			const nx = parent[x];
			parent[x] = r;
			x = nx;
		}
		return r;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	};
	for (let i = 0; i < records.length; i++) {
		for (let j = i + 1; j < records.length; j++) {
			if (isNearDuplicate(records[i], records[j])) union(i, j);
		}
	}
	const groups = new Map();
	for (let i = 0; i < records.length; i++) {
		const root = find(i);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root).push(records[i]);
	}
	return [...groups.values()].filter((g) => g.length > 1);
}

// Pick the richest member of a group (tie-break: longest name, then path).
function richest(group) {
	return group.slice().sort((a, b) => {
		if (b.richness !== a.richness) return b.richness - a.richness;
		if (b.name.length !== a.name.length) return b.name.length - a.name.length;
		return a.file.localeCompare(b.file);
	})[0];
}

// Build the full analysis for a set of records.
function analyze(records, today, windowDays) {
	const pruneCandidates = records.filter((r) => r.confidence === 0);
	const stale = [];
	for (const r of records) {
		const age = daysSince(r.lastVerified, today);
		if (age !== null && age > windowDays) stale.push({...r, ageDays: age});
	}
	stale.sort((a, b) => b.ageDays - a.ageDays);
	const duplicateGroups = findDuplicateGroups(records);
	return {pruneCandidates, stale, duplicateGroups};
}

// --- index regeneration -----------------------------------------------------

// One index line per memory, matching the per-file frontmatter convention:
//   - <name> — <description>  [type/scope, confidence N]
function indexLineFor(rec) {
	const desc = rec.description ? ` — ${rec.description}` : '';
	const conf = rec.confidence === null ? '?' : rec.confidence;
	return `- ${rec.name}${desc}  [conf ${conf}]`;
}

// Rebuild an index file inline from the current records of a scope.
function rebuildIndexInline(scope, records) {
	const header =
		scope === 'global'
			? '# Knowledge Index (global)\n\nOne line per memory. Regenerated by km-review.js --prune.\n'
			: '# Project Memory Index\n\nOne line per memory. Regenerated by km-review.js --prune.\n';
	const lines = records
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(indexLineFor);
	const body = `${header}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
	const indexPath = indexPathFor(scope);
	paths.ensureDir(paths.resolveStoreDir(scope));
	writeFileSync(indexPath, body, 'utf8');
	return indexPath;
}

// Regenerate a scope's index. Prefer an existing `km-index.js` sibling (forward
// compatibility); fall back to the inline rebuild so this script stands alone.
function regenerateIndex(scope, records) {
	const sibling = join(__dirname, 'km-index.js');
	let hasSibling = false;
	try {
		hasSibling = statSync(sibling).isFile();
	} catch {
		hasSibling = false;
	}
	if (hasSibling) {
		const res = spawnSync(
			process.execPath,
			[sibling, '--scope', scope],
			{stdio: ['ignore', 'pipe', 'inherit']},
		);
		if (!res.error && (res.status === 0 || res.status === null)) {
			return {path: indexPathFor(scope), via: 'km-index.js'};
		}
		// Fall through to inline rebuild if the sibling failed.
	}
	return {path: rebuildIndexInline(scope, records), via: 'inline'};
}

// --- reporting --------------------------------------------------------------

function pluralize(n, word) {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function relPath(file, dir) {
	if (file.startsWith(dir + '/')) return file.slice(dir.length + 1);
	return file;
}

// Print the human-readable REPORT for one scope's analysis.
function printScopeReport(scope, dir, records, analysis, windowDays) {
	const lines = [];
	lines.push(`## scope: ${scope}  (${pluralize(records.length, 'memory')})`);
	lines.push(`   store: ${dir}`);

	if (records.length === 0) {
		lines.push('   (empty or missing store)');
		lines.push('');
		return lines.join('\n');
	}

	// Prune candidates (confidence === 0).
	lines.push('');
	lines.push(`   PRUNE CANDIDATES — confidence 0 (${analysis.pruneCandidates.length}):`);
	if (analysis.pruneCandidates.length === 0) {
		lines.push('     none');
	} else {
		for (const r of analysis.pruneCandidates) {
			lines.push(`     - ${r.name}  [${relPath(r.file, dir)}]`);
		}
	}

	// Stale (past last_verified + window).
	lines.push('');
	lines.push(`   STALE — past last_verified + ${windowDays}d, re-verify (${analysis.stale.length}):`);
	if (analysis.stale.length === 0) {
		lines.push('     none');
	} else {
		for (const r of analysis.stale) {
			const lv = r.lastVerified || 'unknown';
			lines.push(`     - ${r.name}  (last_verified ${lv}, ${r.ageDays}d ago)  [${relPath(r.file, dir)}]`);
		}
	}

	// Near-duplicate groups.
	lines.push('');
	lines.push(`   NEAR-DUPLICATES — suggest merge (${analysis.duplicateGroups.length} group${analysis.duplicateGroups.length === 1 ? '' : 's'}):`);
	if (analysis.duplicateGroups.length === 0) {
		lines.push('     none');
	} else {
		for (const group of analysis.duplicateGroups) {
			const keep = richest(group);
			lines.push(`     - keep "${keep.name}"  [${relPath(keep.file, dir)}] (richest); review/merge:`);
			for (const r of group) {
				if (r === keep) continue;
				lines.push(`         · ${r.name}  [${relPath(r.file, dir)}]`);
			}
		}
	}

	lines.push('');
	return lines.join('\n');
}

// --- main -------------------------------------------------------------------

function main(argv) {
	const args = parseArgs(argv);
	const scopes = resolveScopes(args.scope);
	const prune = args.prune === true || args.prune === 'true';
	const windowDays = (() => {
		const raw = args['window-days'];
		const n = toInt(raw);
		if (n !== null && n >= 0) return n;
		return DEFAULT_WINDOW_DAYS;
	})();
	const today = resolveToday(args);

	const out = [];
	out.push(prune ? '# km-review — PRUNE' : '# km-review — REPORT');
	out.push(`today=${today.toISOString().slice(0, 10)}  window=${windowDays}d  scopes=${scopes.join(',')}`);
	out.push('');

	let totalPruned = 0;
	let totalStale = 0;
	let totalDupGroups = 0;
	let totalPruneCandidates = 0;

	for (const scope of scopes) {
		const {dir, records} = loadScope(scope);
		const analysis = analyze(records, today, windowDays);
		totalPruneCandidates += analysis.pruneCandidates.length;
		totalStale += analysis.stale.length;
		totalDupGroups += analysis.duplicateGroups.length;

		out.push(printScopeReport(scope, dir, records, analysis, windowDays));

		if (prune && analysis.pruneCandidates.length > 0) {
			const removed = [];
			for (const r of analysis.pruneCandidates) {
				try {
					unlinkSync(r.file);
					removed.push(r);
					totalPruned++;
				} catch (err) {
					out.push(`   ! failed to delete ${relPath(r.file, dir)}: ${err.message}`);
				}
			}
			const survivors = records.filter((r) => !removed.includes(r));
			const idx = regenerateIndex(scope, survivors);
			out.push(`   PRUNED ${pluralize(removed.length, 'memory')}; index rebuilt (${idx.via}) -> ${idx.path}`);
			out.push('');
		} else if (prune) {
			out.push('   PRUNED 0 memories; index left unchanged');
			out.push('');
		}
	}

	// Summary.
	out.push('## summary');
	if (prune) {
		out.push(`   pruned: ${totalPruned}`);
	} else {
		out.push(`   prune candidates (confidence 0): ${totalPruneCandidates}`);
		out.push('   (run again with --prune to delete them and rebuild the index)');
	}
	out.push(`   stale (re-verify): ${totalStale}`);
	out.push(`   near-duplicate groups (merge): ${totalDupGroups}`);

	process.stdout.write(out.join('\n') + '\n');
	return 0;
}

if (require.main === module) {
	try {
		process.exitCode = main(process.argv);
	} catch (err) {
		process.stderr.write(`km-review: ${err && err.message ? err.message : err}\n`);
		process.exitCode = 1;
	}
}

module.exports = {
	parseArgs,
	resolveScopes,
	resolveToday,
	parseDateOnly,
	daysSince,
	similarity,
	isNearDuplicate,
	findDuplicateGroups,
	richest,
	analyze,
	indexLineFor,
	main,
};
