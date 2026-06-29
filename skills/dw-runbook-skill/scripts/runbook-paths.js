'use strict';

// Path helpers for the runbook store. Dependency-free; node: builtins only.
// Storage layout (two-tier, mirrors dw-knowledge's global-vs-project rule):
//   GLOBAL:        ~/.claude/knowledge/runbooks/            (repo-agnostic / user-level)
//   PROJECT-LOCAL: ~/.claude/projects/<slug>/runbooks/      (repo-specific)
// The project <slug> is cwd with every non-alphanumeric char replaced by '-'.
//
// Inside a store root:
//   <name>/manifest.json + <name>/command.sh   one folder per command/flow
//   _lib/setups/<n>.sh  _lib/cleanups/<n>.sh    reusable, edited once
//   .locks/  .results/  .runs/                  runtime (lock dirs, result cache, logs)

const {mkdirSync} = require('node:fs');
const {join} = require('node:path');
const os = require('node:os');

function globalStoreDir() {
	return join(os.homedir(), '.claude', 'knowledge', 'runbooks');
}

// Slug for a project root: cwd with every non-alphanumeric char replaced by '-'.
function projectSlug(cwd = process.cwd()) {
	return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

function projectStoreDir(cwd = process.cwd()) {
	return join(os.homedir(), '.claude', 'projects', projectSlug(cwd), 'runbooks');
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
	globalStoreDir,
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
