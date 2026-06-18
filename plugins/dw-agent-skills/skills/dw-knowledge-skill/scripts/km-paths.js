'use strict';

// Path helpers for the knowledge-memory store. Dependency-free; node: builtins only.
// Storage layout (hybrid):
//   GLOBAL:        ~/.claude/knowledge/                  (INDEX.md + per-memory *.md)
//   PROJECT-LOCAL: ~/.claude/projects/<slug>/memory/     (MEMORY.md + per-memory *.md)
// The project <slug> is cwd with every non-alphanumeric char replaced by '-'.

const {mkdirSync} = require('node:fs');
const {join} = require('node:path');
const os = require('node:os');

// Absolute path to the global knowledge store directory (~/.claude/knowledge).
function globalStoreDir() {
	return join(os.homedir(), '.claude', 'knowledge');
}

// Slug for a project root: cwd with every non-alphanumeric char replaced by '-'.
// e.g. /Users/x/.claude/p -> -Users-x--claude-p
function projectSlug(cwd = process.cwd()) {
	return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

// Absolute path to the project-local memory directory
// (~/.claude/projects/<slug>/memory).
function projectStoreDir(cwd = process.cwd()) {
	return join(os.homedir(), '.claude', 'projects', projectSlug(cwd), 'memory');
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
	globalStoreDir,
	projectSlug,
	projectStoreDir,
	resolveStoreDir,
	globalIndexPath,
	projectIndexPath,
	ensureDir,
	slugifyName,
};
