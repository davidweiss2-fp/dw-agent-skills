'use strict';

// INDEX regenerator for the knowledge-memory store. Idempotent: running twice
// yields byte-identical output. Dependency-free; node: builtins only.
//
// GLOBAL store:  regenerate <globalStoreDir>/INDEX.md ENTIRELY from the
//                frontmatter of every *.md memory file (one line each).
// PROJECT store: regenerate ONLY a fenced block inside MEMORY.md, delimited by
//                '<!-- dw-knowledge:start -->' / '<!-- dw-knowledge:end -->',
//                leaving all other MEMORY.md content intact (create if absent).
//
// CLI: km-index.js [--scope global|project|both]   (default: both)
//      [--now YYYY-MM-DD]   override "today" for suspect detection (else runtime date)
//      [--window N]         staleness window in days (default 90)
//
// Capture + summary-first recall patterns inspired by Cabinet
// (github.com/hilash/cabinet, MIT); recall protocol + invalidate-then-add
// adapted from MemPalace (github.com/MemPalace/mempalace, MIT).

const {readdirSync, readFileSync, writeFileSync, existsSync} = require('node:fs');
const {join, basename} = require('node:path');

const km = require('./km-paths.js');
const fm = require('./km-frontmatter.js');

const BLOCK_START = '<!-- dw-knowledge:start -->';
const BLOCK_END = '<!-- dw-knowledge:end -->';
const DEFAULT_WINDOW_DAYS = 90;
const DESC_MAX = 80;

// --- arg parsing (matches dw-pr-ready-skill/scripts/utils.js style) --------

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) {
			if (!args._) args._ = [];
			args._.push(token);
			continue;
		}
		const [key, ...rest] = token.slice(2).split('=');
		if (rest.length > 0) {
			args[key] = rest.join('=');
		} else {
			const next = argv[i + 1];
			if (next && !next.startsWith('--')) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

// --- entry collection ------------------------------------------------------

// List *.md memory files in a store dir, excluding the index file itself.
// Returns absolute paths; tolerates a missing directory (-> []).
function listMemoryFiles(dir, indexFileName) {
	let names;
	try {
		names = readdirSync(dir);
	} catch (err) {
		if (err && err.code === 'ENOENT') return [];
		throw err;
	}
	return names
		.filter((n) => n.toLowerCase().endsWith('.md'))
		.filter((n) => n !== indexFileName)
		.map((n) => join(dir, n));
}

// Read one memory file into a normalized index entry, or null if unreadable.
function readEntry(filePath) {
	let text;
	try {
		text = readFileSync(filePath, 'utf8');
	} catch (err) {
		if (err && err.code === 'ENOENT') return null;
		throw err;
	}
	const {data} = fm.parse(text);
	const file = basename(filePath);
	const name = scalarOr(data.name, file.replace(/\.md$/i, ''));
	const description = scalarOr(data.description, '');
	const type = scalarOr(fm.getMeta(data, 'type'), 'unknown');
	const confidence = fm.getMeta(data, 'confidence');
	const lastVerified = scalarOr(fm.getMeta(data, 'last_verified'), '');
	const status = scalarOr(fm.getMeta(data, 'status'), 'active');
	return {file, name, description, type, confidence, lastVerified, status};
}

function scalarOr(value, fallback) {
	if (value === undefined || value === null) return fallback;
	const s = String(value).trim();
	return s === '' ? fallback : s;
}

// --- line rendering --------------------------------------------------------

// Truncate a description to ~DESC_MAX chars, collapsing whitespace, with an
// ellipsis when cut. Deterministic given the same input.
function shortDesc(description) {
	const collapsed = String(description).replace(/\s+/g, ' ').trim();
	if (collapsed.length <= DESC_MAX) return collapsed;
	return `${collapsed.slice(0, DESC_MAX).trimEnd()}…`;
}

// Is this entry suspect? True when active, has a parseable last_verified date,
// and that date + window is strictly before "today".
function isSuspect(entry, todayMs, windowDays) {
	if (entry.status === 'superseded') return false;
	const verifiedMs = parseDateMs(entry.lastVerified);
	if (verifiedMs === null || todayMs === null) return false;
	const windowMs = windowDays * 24 * 60 * 60 * 1000;
	return verifiedMs + windowMs < todayMs;
}

// Parse a YYYY-MM-DD string to epoch ms (UTC midnight), or null if not a date.
// Rejects out-of-range months/days rather than letting Date.UTC roll them over.
function parseDateMs(s) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const ms = Date.UTC(year, month - 1, day);
	if (Number.isNaN(ms)) return null;
	// Round-trip guard: catch overflow like 2026-02-31 rolling into March.
	const d = new Date(ms);
	if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
		return null;
	}
	return ms;
}

// Render a single index line for an entry. Format:
// - [<name>](<file>) — <desc> · type:<type> · conf:<confidence> · verified:<date> [· SUSPECT] [· SUPERSEDED]
function renderLine(entry, todayMs, windowDays) {
	const desc = shortDesc(entry.description);
	const conf = entry.confidence === undefined || entry.confidence === null ?
		'?' :
		String(entry.confidence);
	const verified = entry.lastVerified || '?';
	let line = `- [${entry.name}](${entry.file}) — ${desc} · type:${entry.type}` +
		` · conf:${conf} · verified:${verified}`;
	if (entry.status === 'superseded') {
		line += ' · SUPERSEDED';
	} else if (isSuspect(entry, todayMs, windowDays)) {
		line += ' · SUSPECT';
	}
	return line;
}

// Build the deterministic list of rendered lines for a set of files.
function renderLines(files, todayMs, windowDays) {
	const entries = files
		.map(readEntry)
		.filter((e) => e !== null);
	// Deterministic order: by name (locale-independent), then by file.
	entries.sort((a, b) => {
		if (a.name < b.name) return -1;
		if (a.name > b.name) return 1;
		if (a.file < b.file) return -1;
		if (a.file > b.file) return 1;
		return 0;
	});
	return entries.map((e) => renderLine(e, todayMs, windowDays));
}

// --- global store ----------------------------------------------------------

// Regenerate <globalStoreDir>/INDEX.md entirely. Returns the absolute path written.
function regenerateGlobal(todayMs, windowDays) {
	const dir = km.globalStoreDir();
	const indexPath = km.globalIndexPath();
	const files = listMemoryFiles(dir, basename(indexPath));
	const lines = renderLines(files, todayMs, windowDays);
	const body = lines.length ?
		lines.join('\n') :
		'_No memories yet._';
	const content = `# Knowledge Index (global)\n\n${body}\n`;
	km.ensureDir(dir);
	writeOnChange(indexPath, content);
	return indexPath;
}

// --- project store ---------------------------------------------------------

// Regenerate ONLY the fenced knowledge block inside MEMORY.md, preserving the
// rest of the file. Creates MEMORY.md (and the block) when absent.
function regenerateProject(todayMs, windowDays, cwd) {
	const dir = km.projectStoreDir(cwd);
	const indexPath = km.projectIndexPath(cwd);
	const files = listMemoryFiles(dir, basename(indexPath));
	const lines = renderLines(files, todayMs, windowDays);
	const blockInner = lines.length ?
		lines.join('\n') :
		'_No project memories yet._';
	const block = `${BLOCK_START}\n${blockInner}\n${BLOCK_END}`;

	let existing = null;
	try {
		existing = readFileSync(indexPath, 'utf8');
	} catch (err) {
		if (!(err && err.code === 'ENOENT')) throw err;
	}

	let content;
	if (existing === null) {
		// Fresh MEMORY.md with the managed block.
		content = `# Project Memory\n\n${block}\n`;
	} else {
		content = replaceBlock(existing, block);
	}
	km.ensureDir(dir);
	writeOnChange(indexPath, content);
	return indexPath;
}

// Replace the fenced block in `text` with `block`, leaving the rest intact.
// If no block exists, append one (separated by a blank line). Idempotent.
function replaceBlock(text, block) {
	const src = String(text).replace(/\r\n/g, '\n');
	const startIdx = src.indexOf(BLOCK_START);
	const endIdx = src.indexOf(BLOCK_END);
	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = src.slice(0, startIdx);
		const after = src.slice(endIdx + BLOCK_END.length);
		return `${before}${block}${after}`;
	}
	// No (valid) block: append one. Ensure exactly one blank line before it
	// and a single trailing newline after.
	const trimmed = src.replace(/\s+$/, '');
	if (trimmed === '') return `${block}\n`;
	return `${trimmed}\n\n${block}\n`;
}

// --- io --------------------------------------------------------------------

// Write only when content differs, so the regenerator is a no-op on a stable
// store (and never churns mtimes). Idempotent by construction.
function writeOnChange(filePath, content) {
	let current = null;
	try {
		current = readFileSync(filePath, 'utf8');
	} catch (err) {
		if (!(err && err.code === 'ENOENT')) throw err;
	}
	if (current === content) return;
	writeFileSync(filePath, content);
}

// --- main ------------------------------------------------------------------

function resolveToday(args) {
	const override = typeof args.now === 'string' ? args.now : null;
	if (override) {
		const ms = parseDateMs(override);
		if (ms === null) {
			throw new Error(`Invalid --now (expected YYYY-MM-DD): ${override}`);
		}
		return ms;
	}
	// Runtime fallback: this script runs on the user's machine, so a live clock
	// is acceptable here (only the workflow's own build-time JS must avoid it).
	return Date.now();
}

function main(argv) {
	const args = parseArgs(argv);
	const scope = typeof args.scope === 'string' ? args.scope : 'both';
	if (!['global', 'project', 'both'].includes(scope)) {
		throw new Error(`Unknown --scope (expected global|project|both): ${scope}`);
	}
	const windowDays = args.window !== undefined ?
		Number.parseInt(args.window, 10) :
		DEFAULT_WINDOW_DAYS;
	if (!Number.isFinite(windowDays) || windowDays < 0) {
		throw new Error(`Invalid --window (expected non-negative integer): ${args.window}`);
	}
	const todayMs = resolveToday(args);
	const written = [];
	if (scope === 'global' || scope === 'both') {
		written.push(regenerateGlobal(todayMs, windowDays));
	}
	if (scope === 'project' || scope === 'both') {
		written.push(regenerateProject(todayMs, windowDays, process.cwd()));
	}
	for (const p of written) {
		process.stdout.write(`indexed ${p}\n`);
	}
}

if (require.main === module) {
	try {
		main(process.argv);
	} catch (err) {
		process.stderr.write(`km-index: ${err && err.message ? err.message : String(err)}\n`);
		process.exit(1);
	}
}

module.exports = {
	parseArgs,
	listMemoryFiles,
	readEntry,
	shortDesc,
	isSuspect,
	parseDateMs,
	renderLine,
	renderLines,
	regenerateGlobal,
	regenerateProject,
	replaceBlock,
	main,
	BLOCK_START,
	BLOCK_END,
};
