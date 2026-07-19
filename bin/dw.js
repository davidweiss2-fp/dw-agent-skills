#!/usr/bin/env node
'use strict';

// dw - one stable command surface over the dw-* skill scripts, so agents and
// hooks call `dw <verb>` instead of re-deriving per-skill node paths.
//
//   dw recall <query...> [flags]   knowledge recall        (km-recall.js)
//   dw runbook <args...>           run/save a runbook      (run.js)
//   dw handoff [flags]             handoff path + skeleton (dw-handoff-path.js)
//   dw migrate [--dry-run]         legacy ~/.claude -> store move + symlinks
//   dw paths                       print resolved store locations
//
// Everything is delegated verbatim: same flags, same stdin/stdout/exit code.

const path = require('node:path');
const {spawnSync} = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

const COMMANDS = {
	recall: 'skills/dw-knowledge-skill/scripts/km-recall.js',
	runbook: 'skills/dw-runbook-skill/scripts/run.js',
	handoff: 'skills/dw-handoff-skill/scripts/dw-handoff-path.js',
	migrate: 'bin/dw-migrate.js',
};

function usage() {
	process.stderr.write(
		'Usage: dw <recall|runbook|handoff|migrate|paths> [args...]\n' +
		'  recall <query...>    search saved knowledge (km-recall flags apply)\n' +
		'  runbook <args...>    run.js passthrough (memoized workflows)\n' +
		'  handoff [--focus s]  print the handoff path + skeleton\n' +
		'  migrate [--dry-run]  move legacy ~/.claude stores to the dw-agent store\n' +
		'  paths                print resolved store locations\n',
	);
}

function printPaths() {
	const km = require(path.join(REPO_ROOT, 'skills', 'dw-knowledge-skill', 'scripts', 'km-paths.js'));
	const rb = require(path.join(REPO_ROOT, 'skills', 'dw-runbook-skill', 'scripts', 'runbook-paths.js'));
	const lines = [
		`store root:        ${km.storeRoot()}`,
		`knowledge global:  ${km.globalStoreDir()}`,
		`knowledge project: ${km.projectStoreDir()}`,
		`runbooks global:   ${rb.globalStoreDir()}`,
		`runbooks project:  ${rb.projectStoreDir()}`,
		`run-notes:         ${km.runNotesDir()}`,
	];
	process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
	const [, , cmd, ...rest] = process.argv;
	if (cmd === 'paths') {
		printPaths();
		process.exit(0);
	}
	const script = COMMANDS[cmd];
	if (!script) {
		usage();
		process.exit(cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 2);
	}
	const r = spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...rest], {stdio: 'inherit'});
	process.exit(typeof r.status === 'number' ? r.status : 1);
}

if (require.main === module) {
	main();
}
