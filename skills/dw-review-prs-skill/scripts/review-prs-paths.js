'use strict';

// Store paths for the review-queue run notes. Dependency-free; node: builtins only.
// Layout, rooted at the dw-agent store:
//   <store>/run-notes/dw-review-prs/state.md    (one line per PR: head SHA + status)
//   <store>/run-notes/dw-review-prs/comments.md (ledger of every drafted/submitted comment)
// The queue spans repos, so this dir is fixed rather than per-project. Always
// under the new root - this store has no legacy ~/.claude location to prefer.

const {mkdirSync} = require('node:fs');
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

// Run-notes directory for this skill (<store>/run-notes/dw-review-prs).
function reviewNotesDir(env = process.env) {
	return join(storeRoot(env), 'run-notes', 'dw-review-prs');
}

function statePath(env = process.env) {
	return join(reviewNotesDir(env), 'state.md');
}

function commentsLogPath(env = process.env) {
	return join(reviewNotesDir(env), 'comments.md');
}

// High-water mark per PR per comment surface, so `watch` can tell a new comment
// from one an earlier pass already surfaced.
function watchStatePath(env = process.env) {
	return join(reviewNotesDir(env), 'watch-state.json');
}

// The published dashboard's Artifact URL. Persisted so every later run updates that
// same page instead of minting a new link the reviewer has to re-find.
function dashboardStatePath(env = process.env) {
	return join(reviewNotesDir(env), 'dashboard.json');
}

// Create a directory (recursive); ignore EEXIST.
function ensureDir(dir) {
	try {
		mkdirSync(dir, {recursive: true});
	} catch (err) {
		if (err && err.code !== 'EEXIST') throw err;
	}
}

// Authors whose PRs a DIFFERENT routine reviews, as {login: why}. Those PRs are
// classified `delegated` instead of becoming work here, so the hand-off is a property
// of the store rather than something the reviewer has to remember to click each run.
// Two routines drafting on one PR is not just duplicated effort: this skill holds an
// unsubmitted PENDING review, and a pending review blocks REST comment posting on that
// PR (one per user per PR), which is how a sibling routine's posting path breaks.
function delegatedAuthorsPath(env = process.env) {
	return join(reviewNotesDir(env), 'delegated-authors.json');
}

module.exports = {
	delegatedAuthorsPath,
	storeRoot,
	reviewNotesDir,
	statePath,
	commentsLogPath,
	watchStatePath,
	dashboardStatePath,
	ensureDir,
};
