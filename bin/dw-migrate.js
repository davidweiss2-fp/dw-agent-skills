#!/usr/bin/env node
'use strict';

// dw-migrate.js - one-time move of the dw stores from the legacy ~/.claude
// layout to the dw-agent store (DW_STORE_ROOT or ~/Documents/dw-agent-store),
// leaving a symlink at each legacy location so unported readers keep working.
//
//   ~/.claude/knowledge                    -> <store>/knowledge      (runbooks/,
//                                             deslop-rules/ ride along inside)
//   ~/.claude/projects/<slug>/memory       -> <store>/projects/<slug>/memory
//   ~/.claude/projects/<slug>/runbooks     -> <store>/projects/<slug>/runbooks
//
// Only those subdirs move - the rest of ~/.claude/projects/<slug>/ (session
// transcripts etc.) is Claude Code's own data and is not touched.
//
// CLI: node dw-migrate.js [--dry-run]
// Idempotent: a legacy path that is already a symlink is skipped; a non-empty
// destination that already exists is reported and skipped (merge by hand).
// EXIT: 0 on success/nothing-to-do; 1 when any item was skipped as unsafe.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {storeRoot} = require(path.join(__dirname, '..', 'skills', 'dw-knowledge-skill', 'scripts', 'km-paths.js'));

function isSymlink(p) {
	try {
		return fs.lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}

function isDir(p) {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

// Move src -> dest (rename, falling back to copy+rm across devices), then
// symlink src -> dest. Returns {status, detail}.
function moveAndLink(src, dest, dryRun) {
	if (isSymlink(src)) return {status: 'skipped', detail: 'already a symlink (migrated)'};
	if (!isDir(src)) return {status: 'skipped', detail: 'no legacy dir'};
	if (fs.existsSync(dest)) return {status: 'unsafe', detail: `destination already exists: ${dest} - merge by hand, then symlink`};
	const rel = path.relative(src, dest);
	if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
		return {status: 'unsafe', detail: `destination is inside the source: ${dest} - pick a DW_STORE_ROOT outside ~/.claude`};
	}
	if (dryRun) return {status: 'would-move', detail: `-> ${dest}`};
	fs.mkdirSync(path.dirname(dest), {recursive: true});
	try {
		fs.renameSync(src, dest);
	} catch (err) {
		if (err && err.code === 'EXDEV') {
			fs.cpSync(src, dest, {recursive: true});
			fs.rmSync(src, {recursive: true});
		} else {
			throw err;
		}
	}
	fs.symlinkSync(dest, src);
	return {status: 'moved', detail: `-> ${dest} (symlink left behind)`};
}

function main() {
	const dryRun = process.argv.includes('--dry-run');
	const root = storeRoot();
	const home = os.homedir();
	const items = [];

	items.push({
		label: '~/.claude/knowledge',
		src: path.join(home, '.claude', 'knowledge'),
		dest: path.join(root, 'knowledge'),
	});

	const projectsDir = path.join(home, '.claude', 'projects');
	let slugs = [];
	try {
		slugs = fs.readdirSync(projectsDir).filter((s) => isDir(path.join(projectsDir, s)));
	} catch {
		// no legacy projects dir
	}
	for (const slug of slugs) {
		for (const sub of ['memory', 'runbooks']) {
			items.push({
				label: `~/.claude/projects/${slug}/${sub}`,
				src: path.join(projectsDir, slug, sub),
				dest: path.join(root, 'projects', slug, sub),
			});
		}
	}

	let unsafe = 0;
	for (const item of items) {
		let r;
		try {
			r = moveAndLink(item.src, item.dest, dryRun);
		} catch (err) {
			r = {status: 'unsafe', detail: `failed mid-move (${err && err.code ? err.code : err}) - inspect ${item.src} and ${item.dest} by hand`};
		}
		if (r.status === 'skipped' && r.detail === 'no legacy dir') continue;
		if (r.status === 'unsafe') unsafe++;
		process.stdout.write(`${r.status.padEnd(10)} ${item.label} ${r.detail}\n`);
	}

	if (!dryRun) {
		for (const sub of ['handoffs', 'run-notes']) {
			fs.mkdirSync(path.join(root, sub), {recursive: true});
		}
	}
	process.stdout.write(`store root: ${root}${dryRun ? ' (dry run - nothing changed)' : ''}\n`);
	process.exit(unsafe > 0 ? 1 : 0);
}

if (require.main === module) {
	main();
}

module.exports = {moveAndLink};
