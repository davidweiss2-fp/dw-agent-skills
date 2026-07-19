'use strict';

// Path helpers for the knowledge-memory store. Dependency-free; node: builtins only.
// Storage layout (hybrid), rooted at the dw-agent store:
//   GLOBAL:        <store>/knowledge/                  (INDEX.md + per-memory *.md)
//   PROJECT-LOCAL: <store>/projects/<slug>/memory/     (MEMORY.md + per-memory *.md)
// <store> is DW_STORE_ROOT or ~/Documents/dw-agent-store. A legacy ~/.claude
// location that still exists always wins: pre-`dw migrate` it holds the data,
// post-migrate it is a symlink into the store, so both resolve correctly.
// The project <slug> is cwd with every non-alphanumeric char replaced by '-'.

const {mkdirSync, existsSync} = require('node:fs');
const {join} = require('node:path');
const os = require('node:os');

// Store root for all durable dw-* data: DW_STORE_ROOT env override, else
// ~/Documents/dw-agent-store. (MIRROR: keep storeRoot/preferLegacy byte-identical
// across km-paths.js / runbook-paths.js / deslop-rules.js; dw-handoff-path.js
// mirrors storeRoot only.)
function storeRoot(env = process.env) {
	const fromEnv = env && env.DW_STORE_ROOT;
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
	return join(os.homedir(), 'Documents', 'dw-agent-store');
}

// A legacy dir that exists wins over the new-root dir - pre-migrate it holds
// the data, post-migrate it is a symlink into the store. Deciding on the
// legacy side (never on the new dir's existence) means creating one new-root
// dir can never flip a sibling store away from its data mid-session.
function preferLegacy(newDir, legacyDir) {
	if (existsSync(legacyDir)) return legacyDir;
	return newDir;
}

// Absolute path to the global knowledge store directory (<store>/knowledge).
function globalStoreDir() {
	return preferLegacy(
		join(storeRoot(), 'knowledge'),
		join(os.homedir(), '.claude', 'knowledge'),
	);
}

// Slug for a project root: cwd with every non-alphanumeric char replaced by '-'.
// e.g. /Users/x/.claude/p -> -Users-x--claude-p
function projectSlug(cwd = process.cwd()) {
	return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

// Absolute path to the project-local memory directory
// (<store>/projects/<slug>/memory).
function projectStoreDir(cwd = process.cwd()) {
	const slug = projectSlug(cwd);
	return preferLegacy(
		join(storeRoot(), 'projects', slug, 'memory'),
		join(os.homedir(), '.claude', 'projects', slug, 'memory'),
	);
}

// Resolve a store directory by scope: 'global' or 'project'.
function resolveStoreDir(scope, cwd = process.cwd()) {
	if (scope === 'project') return projectStoreDir(cwd);
	if (scope === 'global') return globalStoreDir();
	throw new Error(`Unknown scope (expected 'global' or 'project'): ${scope}`);
}

// Index file for the global store (<globalStoreDir>/INDEX.md).
function globalIndexPath() {
	return join(globalStoreDir(), 'INDEX.md');
}

// Index file for the project store. MEMORY.md lives INSIDE the memory dir
// per the existing project convention (<projectStoreDir>/MEMORY.md).
function projectIndexPath(cwd = process.cwd()) {
	return join(projectStoreDir(cwd), 'MEMORY.md');
}

// Per-project run-notes directory (<store>/run-notes/<slug>) - session logs,
// flow/gate state, hook dedupe cache. Always under the new root; never legacy.
function runNotesDir(cwd = process.cwd()) {
	return join(storeRoot(), 'run-notes', projectSlug(cwd));
}

// Create a directory (recursive); ignore EEXIST.
function ensureDir(dir) {
	try {
		mkdirSync(dir, {recursive: true});
	} catch (err) {
		if (err && err.code !== 'EEXIST') throw err;
	}
}

// Kebab-case a memory name into a safe filename stem (no extension).
// Lowercases, replaces runs of non-alphanumerics with single '-', trims '-'.
function slugifyName(name) {
	const stem = String(name)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return stem || 'memory';
}

module.exports = {
	storeRoot,
	preferLegacy,
	globalStoreDir,
	projectSlug,
	projectStoreDir,
	resolveStoreDir,
	globalIndexPath,
	projectIndexPath,
	runNotesDir,
	ensureDir,
	slugifyName,
};
