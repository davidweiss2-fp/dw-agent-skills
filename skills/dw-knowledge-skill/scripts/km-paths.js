'use strict';

// Path helpers for the knowledge-memory store. Dependency-free; node: builtins only.
// Storage layout (hybrid), rooted at the dw-agent store:
//   GLOBAL:        <store>/knowledge/                  (INDEX.md + per-memory *.md)
//   PROJECT-LOCAL: <store>/projects/<slug>/memory/     (MEMORY.md + per-memory *.md
//                                                      + global/ -> the global store)
// <store> is DW_STORE_ROOT or ~/Documents/dw-agent-store. A legacy ~/.claude
// location that still exists always wins: pre-`dw migrate` it holds the data,
// post-migrate it is a symlink into the store, so both resolve correctly.
// The project <slug> is cwd with every non-alphanumeric char replaced by '-', after a
// git worktree is resolved back to the main checkout it was cut from.

const {mkdirSync, existsSync, statSync, readFileSync} = require('node:fs');
const {join, dirname, resolve} = require('node:path');
const os = require('node:os');

// Name of the global-store pointer inside a project memory dir.
const GLOBAL_LINK_NAME = 'global';

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

// Resolve a cwd inside a linked git worktree back to the MAIN checkout's root, so a
// worktree keys to the same project as the repo it was cut from. A linked worktree's
// `.git` is a FILE holding `gitdir: <main>/.git/worktrees/<name>`; a normal checkout's
// is a directory. Anything else - the main checkout, a plain subdirectory, a submodule,
// no repo at all - returns `cwd` untouched, so only worktree sessions change store.
// (MIRROR: keep mainCheckoutRoot/projectSlug byte-identical across km-paths.js and
// runbook-paths.js.)
function mainCheckoutRoot(cwd) {
	let dir = String(cwd);
	for (;;) {
		let pointer = null;
		try {
			const dotGit = join(dir, '.git');
			if (!statSync(dotGit).isFile()) return cwd; // a real checkout root
			pointer = readFileSync(dotGit, 'utf8').trim().replace(/^gitdir:\s*/, '');
		} catch {
			// No `.git` here (or it is unreadable) - keep walking up.
		}
		if (pointer !== null) {
			// <main>/.git/worktrees/<name> -> <main>. Git may write the pointer relative
			// to the worktree, so resolve it before slicing. A `.git` file that is not a
			// worktree pointer has no such segment and is left alone.
			const parts = resolve(dir, pointer).split(/[\\/]/);
			const marker = parts.indexOf('worktrees');
			if (marker < 1) return cwd;
			return parts.slice(0, marker - 1).join('/') || cwd;
		}
		const parent = dirname(dir);
		if (parent === dir) return cwd; // hit the filesystem root
		dir = parent;
	}
}

// Slug for a project root: cwd with every non-alphanumeric char replaced by '-'.
// e.g. /Users/x/.claude/p -> -Users-x--claude-p
// A git worktree resolves to its main checkout first, so knowledge captured while
// working in one is filed under the project rather than under a dir that dies with the PR.
function projectSlug(cwd = process.cwd()) {
	return String(mainCheckoutRoot(cwd)).replace(/[^a-zA-Z0-9]/g, '-');
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

// Does the project memory dir carry a resolvable `global/` pointer - the symlink
// to the global store that lets a native reader reach a cross-repo memory as
// `global/<name>.md` without duplicating the file?
function hasGlobalLink(memoryDir) {
	return existsSync(join(memoryDir, GLOBAL_LINK_NAME));
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
	GLOBAL_LINK_NAME,
	storeRoot,
	preferLegacy,
	globalStoreDir,
	mainCheckoutRoot,
	projectSlug,
	projectStoreDir,
	resolveStoreDir,
	globalIndexPath,
	projectIndexPath,
	hasGlobalLink,
	runNotesDir,
	ensureDir,
	slugifyName,
};
