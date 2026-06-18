'use strict';

// km-recall.js — RECALL search + rank over the knowledge-memory store. PURE READ.
// Never writes. Reads *.md from the chosen store(s), parses frontmatter, filters to
// real memories (metadata.type in the taxonomy, status !== 'superseded'), scores each
// against the query, ranks by relevance * recency * confidence, and emits an ADVISORY
// block (default), a JSON array (--json), or a hook block (--hook, stdin {prompt}).
//
// CLI:
//   km-recall.js <query words...>
//     [--scope global|project|both (default both)]
//     [--limit N (default 5)]
//     [--window-days N (default 90)]
//     [--json]
//     [--hook]
//
// Dependency-free; node: builtins only. Matches the house style of utils.js.
//
// Attribution: capture + summary-first recall patterns inspired by Cabinet
// (github.com/hilash/cabinet, MIT); recall protocol + invalidate-then-add adapted
// from MemPalace (github.com/MemPalace/mempalace, MIT).

const fs = require('node:fs');
const path = require('node:path');

const km = require('./km-frontmatter.js');
const paths = require('./km-paths.js');

const VALID_TYPES = ['how-to', 'domain', 'task', 'gotcha'];
const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Field weights for relevance scoring. Trigger is weighted highest, then the
// recall key (name + description), then the broader recall_conditions text.
const WEIGHT_TRIGGER = 3;
const WEIGHT_NAME = 2;
const WEIGHT_DESCRIPTION = 2;
const WEIGHT_RECALL_CONDITIONS = 1;

// --- arg parsing -----------------------------------------------------------

// Parse argv into {query: string[], scope, limit, windowDays, json, hook}.
// Positional (non --) tokens are query words. Flags accept --k v or --k=v.
function parseArgs(argv) {
	const out = {
		query: [],
		scope: 'both',
		limit: DEFAULT_LIMIT,
		windowDays: DEFAULT_WINDOW_DAYS,
		json: false,
		hook: false,
	};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) {
			out.query.push(token);
			continue;
		}
		const eq = token.indexOf('=');
		let key;
		let value;
		if (eq !== -1) {
			key = token.slice(2, eq);
			value = token.slice(eq + 1);
		} else {
			key = token.slice(2);
			const next = argv[i + 1];
			if (key === 'json' || key === 'hook') {
				value = true;
			} else if (next !== undefined && !next.startsWith('--')) {
				value = next;
				i++;
			} else {
				value = true;
			}
		}
		switch (key) {
			case 'scope':
				out.scope = String(value);
				break;
			case 'limit':
				out.limit = toPositiveInt(value, DEFAULT_LIMIT);
				break;
			case 'window-days':
				out.windowDays = toPositiveInt(value, DEFAULT_WINDOW_DAYS);
				break;
			case 'json':
				out.json = value === true || value === 'true';
				break;
			case 'hook':
				out.hook = value === true || value === 'true';
				break;
			default:
				// Unknown flag: ignore defensively.
				break;
		}
	}
	return out;
}

function toPositiveInt(value, fallback) {
	const n = Number.parseInt(String(value), 10);
	if (Number.isFinite(n) && n > 0) return n;
	return fallback;
}

// --- tokenization & scoring -----------------------------------------------

// Lowercase, split on non-alphanumerics, drop empties and 1-char noise tokens.
function tokenize(text) {
	if (text === undefined || text === null) return [];
	return String(text)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1);
}

// Build a Set of unique query terms.
function queryTermSet(queryWords) {
	return new Set(tokenize(queryWords.join(' ')));
}

// Count how many distinct query terms appear in a field's token list,
// then multiply by the field weight. Distinct-term overlap keeps long
// fields from dominating via repetition.
function fieldOverlap(fieldText, queryTerms, weight) {
	if (queryTerms.size === 0) return 0;
	const fieldTokens = new Set(tokenize(fieldText));
	if (fieldTokens.size === 0) return 0;
	let hits = 0;
	for (const term of queryTerms) {
		if (fieldTokens.has(term)) hits++;
	}
	return hits * weight;
}

// Normalize a possibly-array field (e.g. recall_conditions may be a list) to text.
function fieldToText(value) {
	if (value === undefined || value === null) return '';
	if (Array.isArray(value)) return value.map(fieldToText).join(' ');
	if (typeof value === 'object') return Object.values(value).map(fieldToText).join(' ');
	return String(value);
}

// Raw relevance = weighted distinct-term overlap across name, description,
// trigger, and recall_conditions.
function relevanceScore(data, queryTerms) {
	const name = fieldToText(data.name);
	const description = fieldToText(data.description);
	const trigger = fieldToText(km.getMeta(data, 'trigger', ''));
	const recallConditions = fieldToText(km.getMeta(data, 'recall_conditions', ''));
	return (
		fieldOverlap(trigger, queryTerms, WEIGHT_TRIGGER) +
		fieldOverlap(name, queryTerms, WEIGHT_NAME) +
		fieldOverlap(description, queryTerms, WEIGHT_DESCRIPTION) +
		fieldOverlap(recallConditions, queryTerms, WEIGHT_RECALL_CONDITIONS)
	);
}

// Parse a YYYY-MM-DD date string to a UTC timestamp (ms), or null if unparseable.
function parseDate(value) {
	if (value === undefined || value === null) return null;
	const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isFinite(ts) ? ts : null;
}

// Recency factor in (0, 1]. Fresh (within window) -> 1.0; decays toward a floor
// as the memory ages past the window. Missing/unparseable date -> neutral 0.5.
function recencyFactor(lastVerified, windowDays, nowMs) {
	const ts = parseDate(lastVerified);
	if (ts === null) return 0.5;
	const ageDays = (nowMs - ts) / MS_PER_DAY;
	if (ageDays <= windowDays) return 1.0;
	// Linear-ish decay beyond the window, floored at 0.25 so old-but-relevant
	// memories still surface (they get flagged suspect, not dropped).
	const overshoot = ageDays - windowDays;
	const factor = 1.0 - overshoot / (windowDays * 4);
	return factor < 0.25 ? 0.25 : factor;
}

// Confidence factor. confidence 0 -> 0 (caller excludes). Otherwise scales mildly
// so confidence ranks but never overwhelms relevance: 1 -> ~0.66 ... grows with conf.
function confidenceFactor(confidence) {
	const c = Number(confidence);
	if (!Number.isFinite(c) || c <= 0) return 0;
	return c / (c + 0.5);
}

// suspect = today is past last_verified + window. Missing date counts as suspect.
function isSuspect(lastVerified, windowDays, nowMs) {
	const ts = parseDate(lastVerified);
	if (ts === null) return true;
	return nowMs > ts + windowDays * MS_PER_DAY;
}

// --- parameter resolution --------------------------------------------------

// Resolve {parameter} slots in name/description/body against live query terms.
// We can't know real values from a text query, so we surface the declared
// parameters with their stored examples; the agent fills them from live context.
function resolveParameters(data) {
	const params = km.getMeta(data, 'parameters', []);
	if (!Array.isArray(params)) return [];
	const out = [];
	for (const p of params) {
		if (p && typeof p === 'object') {
			out.push({name: String(p.name || ''), example: p.example === undefined ? '' : p.example});
		} else if (p !== undefined && p !== null) {
			out.push({name: String(p), example: ''});
		}
	}
	return out.filter((p) => p.name.length > 0);
}

// --- store reading ---------------------------------------------------------

// List candidate memory files for a scope. Returns absolute *.md paths,
// excluding the index files (INDEX.md / MEMORY.md). Missing dir -> [].
function listMemoryFiles(storeDir) {
	let entries;
	try {
		entries = fs.readdirSync(storeDir, {withFileTypes: true});
	} catch {
		return [];
	}
	const out = [];
	for (const ent of entries) {
		if (!ent.isFile()) continue;
		const nm = ent.name;
		if (!nm.endsWith('.md')) continue;
		if (nm === 'INDEX.md' || nm === 'MEMORY.md') continue;
		out.push(path.join(storeDir, nm));
	}
	return out;
}

// Resolve the list of {scope, dir} stores to read for the requested scope.
function storesForScope(scope, cwd) {
	const scopes = scope === 'both' ? ['global', 'project'] : [scope];
	const out = [];
	for (const s of scopes) {
		let dir;
		try {
			dir = paths.resolveStoreDir(s, cwd);
		} catch {
			continue; // unknown scope token -> skip
		}
		out.push({scope: s, dir});
	}
	return out;
}

// Read + parse one memory file into a candidate record, or null if it should be
// skipped (unreadable, wrong type, superseded, or zero confidence).
function loadCandidate(file, scope, queryTerms, windowDays, nowMs) {
	let raw;
	try {
		raw = fs.readFileSync(file, 'utf8');
	} catch {
		return null;
	}
	const {data, body} = km.parse(raw);
	const type = km.getMeta(data, 'type', '');
	if (!VALID_TYPES.includes(type)) return null;
	const status = km.getMeta(data, 'status', 'active');
	if (status === 'superseded') return null;

	const confidence = km.getMeta(data, 'confidence', 0);
	const confFactor = confidenceFactor(confidence);
	if (confFactor === 0) return null; // confidence 0 -> excluded entirely

	const relevance = relevanceScore(data, queryTerms);
	if (relevance === 0) return null; // no query-term overlap -> not a match

	const lastVerified = km.getMeta(data, 'last_verified', '');
	const recency = recencyFactor(lastVerified, windowDays, nowMs);
	const rank = relevance * recency * confFactor;

	return {
		file,
		scope,
		title: fieldToText(data.name) || path.basename(file, '.md'),
		type,
		description: fieldToText(data.description),
		confidence: Number(confidence),
		lastVerified: lastVerified === '' ? null : String(lastVerified),
		suspect: isSuspect(lastVerified, windowDays, nowMs),
		relevance,
		recency,
		rank,
		parameters: resolveParameters(data),
		body,
	};
}

// Gather, score, sort (rank desc, then relevance desc, then title asc), and limit.
function recall(queryWords, opts, nowMs) {
	const queryTerms = queryTermSet(queryWords);
	const candidates = [];
	if (queryTerms.size === 0) return candidates; // empty query -> no matches
	for (const store of storesForScope(opts.scope, opts.cwd)) {
		for (const file of listMemoryFiles(store.dir)) {
			const c = loadCandidate(file, store.scope, queryTerms, opts.windowDays, nowMs);
			if (c) candidates.push(c);
		}
	}
	candidates.sort((a, b) => {
		if (b.rank !== a.rank) return b.rank - a.rank;
		if (b.relevance !== a.relevance) return b.relevance - a.relevance;
		return a.title.localeCompare(b.title);
	});
	return candidates.slice(0, opts.limit);
}

// --- output ----------------------------------------------------------------

// Render the human-readable ADVISORY block for a set of ranked candidates.
function renderAdvisory(items) {
	const lines = ['Saved knowledge that may apply — verify before relying:', ''];
	let n = 0;
	for (const it of items) {
		n++;
		const flag = it.suspect ? '  [SUSPECT: past last_verified + window — re-verify]' : '';
		lines.push(`${n}. ${it.title}  (${it.type}, confidence ${it.confidence})`);
		if (it.description) lines.push(`   ${it.description}`);
		lines.push(`   last_verified: ${it.lastVerified || 'unknown'}${flag}`);
		lines.push(`   file: ${it.file}`);
		if (it.parameters.length > 0) {
			const slots = it.parameters
				.map((p) => (p.example === '' ? `{${p.name}}` : `{${p.name}}=${p.example}`))
				.join(', ');
			lines.push(`   parameters (resolve from live context): ${slots}`);
		}
		lines.push('');
	}
	return lines.join('\n').replace(/\n+$/, '\n');
}

// JSON-friendly projection (drops the full body; keeps everything else).
function toJsonItem(it) {
	return {
		title: it.title,
		type: it.type,
		scope: it.scope,
		description: it.description,
		confidence: it.confidence,
		last_verified: it.lastVerified,
		suspect: it.suspect,
		relevance: it.relevance,
		recency: Number(it.recency.toFixed(4)),
		rank: Number(it.rank.toFixed(4)),
		file: it.file,
		parameters: it.parameters,
	};
}

// Read the entire stdin stream synchronously and return it as a string.
function readStdin() {
	try {
		return fs.readFileSync(0, 'utf8');
	} catch {
		return '';
	}
}

// Pull the query string from a Claude Code hook JSON payload on stdin.
// The payload carries a {prompt} field (the user's prompt). Tolerant of junk.
function queryFromHookStdin() {
	const raw = readStdin();
	if (!raw.trim()) return '';
	try {
		const obj = JSON.parse(raw);
		if (obj && typeof obj.prompt === 'string') return obj.prompt;
		// Some hook shapes nest under prompt-like fields; fall back gracefully.
		if (obj && typeof obj.user_prompt === 'string') return obj.user_prompt;
		return '';
	} catch {
		return '';
	}
}

// --- main ------------------------------------------------------------------

function main() {
	const opts = parseArgs(process.argv);
	opts.cwd = process.cwd();
	const nowMs = Date.now();

	if (opts.hook) {
		// Hook mode: query comes from stdin JSON. Emit an advisory block ONLY when
		// there are matches; otherwise print nothing (exit 0) so it never spams.
		const prompt = queryFromHookStdin();
		const queryWords = tokenize(prompt);
		if (queryWords.length === 0) {
			process.exit(0);
			return;
		}
		const items = recall(queryWords, opts, nowMs);
		if (items.length === 0) {
			process.exit(0);
			return;
		}
		process.stdout.write(renderAdvisory(items));
		process.exit(0);
		return;
	}

	if (opts.query.length === 0) {
		const msg = 'Usage: km-recall.js <query words...> ' +
			'[--scope global|project|both] [--limit N] [--window-days N] [--json] [--hook]';
		process.stderr.write(`${msg}\n`);
		process.exit(2);
		return;
	}

	const items = recall(opts.query, opts, nowMs);

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(items.map(toJsonItem), null, 2)}\n`);
		process.exit(0);
		return;
	}

	if (items.length === 0) {
		process.stdout.write('No saved knowledge matched this query. (None found — not invented.)\n');
		process.exit(0);
		return;
	}

	process.stdout.write(renderAdvisory(items));
	process.exit(0);
}

if (require.main === module) {
	main();
}

module.exports = {
	parseArgs,
	tokenize,
	queryTermSet,
	relevanceScore,
	recencyFactor,
	confidenceFactor,
	isSuspect,
	resolveParameters,
	recall,
	renderAdvisory,
	toJsonItem,
};
