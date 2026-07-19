'use strict';

// Scaffold a stable, idempotent path for a session handoff document — keyed by
// branch + date, so a same-branch, same-day re-run intentionally resolves to
// the same path and overwrites the previous handoff.
//
// Dependency-free; node: builtins only. No network, no randomness, no shelling
// out. Pure path derivation + a skeleton emitted to stderr.
//
// PURPOSE: a handoff is a session artifact, not repo content, so it belongs in
// the dw-agent store's handoffs/ dir (DW_STORE_ROOT or ~/Documents/dw-agent-store)
// - never the working tree. This script computes the path the SKILL writes to
// and prints a starter skeleton so the agent fills sections rather than
// inventing structure.
//
// CLI:
//   node dw-handoff-path.js
//   node dw-handoff-path.js --focus "wire up the retry path"
//   node dw-handoff-path.js --date 2026-06-18        (override clock; for tests)
//   node dw-handoff-path.js --json                   (emit {path, skeleton} as JSON to stdout)
//
// OUTPUT:
//   default: absolute .md path -> stdout ; skeleton -> stderr
//   --json:  {path, slug, skeleton} -> stdout
//
// EXIT CODES:
//   0 = path derived (never fails on bad input; it sanitizes instead)

const os = require('node:os');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');

// Store root for all durable dw-* data: DW_STORE_ROOT env override, else
// ~/Documents/dw-agent-store. (MIRROR: keep storeRoot byte-identical with
// km-paths.js / runbook-paths.js / deslop-rules.js.)
function storeRoot(env = process.env) {
	const fromEnv = env && env.DW_STORE_ROOT;
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
	return join(os.homedir(), 'Documents', 'dw-agent-store');
}

// --- arg parsing (house style) --------------------------------------------

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

// --- slug derivation -------------------------------------------------------

// Lowercase, keep [a-z0-9-], collapse runs, trim, cap length. Defends the
// filename against arbitrary --focus / branch text without ever shelling out
// with that text.
function slugify(input, fallback) {
	const s = String(input || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/g, '');
	return s || fallback;
}

// Current git branch via argv-only spawn (no shell, no interpolation). Returns
// a sanitized slug or a neutral fallback when not in a repo.
function branchSlug() {
	try {
		const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		if (r.error || (typeof r.status === 'number' && r.status !== 0)) return '';
		const branch = (r.stdout || Buffer.from('')).toString().trim();
		if (!branch || branch === 'HEAD') return '';
		return slugify(branch, '');
	} catch {
		return '';
	}
}

// YYYY-MM-DD from an explicit --date (preferred, deterministic) or the clock.
function dateStamp(explicit) {
	if (typeof explicit === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
		return explicit;
	}
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function buildSkeleton(focus) {
	const focusLine = focus ? `\n> Next-session focus: ${focus}\n` : '';
	return [
		'# Session Handoff',
		focusLine.trimEnd(),
		'',
		'## Objective',
		'<one line: the goal of this work>',
		'',
		'## Current state',
		'<what is true right now — works / half-done / broken; branch + committed/pushed?>',
		'',
		'## Next steps',
		'1. <single most important next action>',
		'2. <...>',
		'',
		'## Key decisions & constraints',
		'- <decision> — <why>',
		'',
		'## Gotchas',
		'- <trap hit this session and how to avoid it>',
		'',
		'## Pointers',
		'- <path / URL / ticket / PR / command — reference, do not recreate>',
		'',
		'## Suggested next skills',
		'- <skill-name> — <one-line why>',
		'',
	].join('\n');
}

// --- main ------------------------------------------------------------------

function derive(args) {
	const focus = typeof args.focus === 'string' ? args.focus : '';
	const base = branchSlug() || slugify(focus, 'session');
	const slug = `${base}-${dateStamp(args.date)}`;
	const path = join(storeRoot(), 'handoffs', `${slug}.md`);
	const skeleton = buildSkeleton(focus);
	return {path, slug, skeleton};
}

function main() {
	const args = parseArgs(process.argv);
	const {path, slug, skeleton} = derive(args);

	if (args.json) {
		process.stdout.write(JSON.stringify({path, slug, skeleton}));
		process.stdout.write('\n');
	} else {
		process.stdout.write(`${path}\n`);
		process.stderr.write(`${skeleton}\n`);
	}
	process.exit(0);
}

if (require.main === module) {
	main();
}

module.exports = {storeRoot, slugify, dateStamp, buildSkeleton, derive};
