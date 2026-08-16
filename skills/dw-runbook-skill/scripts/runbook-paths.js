'use strict';

// Path helpers for the runbook store. Dependency-free; node: builtins only.
// Storage layout (two-tier, mirrors dw-knowledge's global-vs-project rule),
// rooted at the dw-agent store (DW_STORE_ROOT or ~/Documents/dw-agent-store):
//   GLOBAL:        <store>/knowledge/runbooks/            (repo-agnostic / user-level)
//   PROJECT-LOCAL: <store>/projects/<slug>/runbooks/      (repo-specific)
// A legacy ~/.claude location that still exists always wins (pre-migrate data,
// post-migrate symlink). The project <slug> is cwd with every non-alphanumeric
// char replaced by '-'.
//
// Inside a store root:
//   <name>/manifest.json + <name>/command.sh   one folder per command/flow
//   _lib/setups/<n>.sh  _lib/cleanups/<n>.sh    reusable, edited once
//   .locks/  .results/  .runs/                  runtime (lock dirs, result cache, logs)

const {mkdirSync, existsSync, statSync, readFileSync} = require('node:fs');
const {join, dirname, resolve} = require('node:path');
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

function globalStoreDir() {
	return preferLegacy(
		join(storeRoot(), 'knowledge', 'runbooks'),
		join(os.homedir(), '.claude', 'knowledge', 'runbooks'),
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

function projectStoreDir(cwd = process.cwd()) {
	const slug = projectSlug(cwd);
	return preferLegacy(
		join(storeRoot(), 'projects', slug, 'runbooks'),
		join(os.homedir(), '.claude', 'projects', slug, 'runbooks'),
	);
}

// Resolve a store root by scope ('global' | 'project') or an explicit --root override.
function resolveStoreDir(scope, cwd = process.cwd(), rootOverride) {
	if (rootOverride) return rootOverride;
	if (scope === 'project') return projectStoreDir(cwd);
	if (scope === 'global') return globalStoreDir();
	throw new Error(`Unknown scope (expected 'global' or 'project'): ${scope}`);
}

// Well-known sub-paths within a store root.
function commandDir(root, name) {
	return join(root, name);
}
function setupsDir(root) {
	return join(root, '_lib', 'setups');
}
function cleanupsDir(root) {
	return join(root, '_lib', 'cleanups');
}
function locksDir(root) {
	return join(root, '.locks');
}
function resultsDir(root) {
	return join(root, '.results');
}
function runsDir(root) {
	return join(root, '.runs');
}
function worktreesDir(root) {
	return join(root, '.worktrees');
}

function ensureDir(dir) {
	// Recursive mkdir is not atomic: when another process concurrently rmdir's the
	// same tree (lock churn), it can spuriously throw ENOENT/EEXIST. Retry briefly.
	for (let attempt = 0; ; attempt++) {
		try {
			mkdirSync(dir, {recursive: true});
			return;
		} catch (err) {
			if (err && err.code === 'EEXIST') return;
			if (err && err.code === 'ENOENT' && attempt < 8) continue;
			throw err;
		}
	}
}

module.exports = {
	storeRoot,
	preferLegacy,
	globalStoreDir,
	mainCheckoutRoot,
	projectSlug,
	projectStoreDir,
	resolveStoreDir,
	commandDir,
	setupsDir,
	cleanupsDir,
	locksDir,
	resultsDir,
	runsDir,
	worktreesDir,
	ensureDir,
};
