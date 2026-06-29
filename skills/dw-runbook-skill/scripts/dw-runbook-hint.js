#!/usr/bin/env node
'use strict';

// dw-runbook hint: an OPTIONAL Claude Code PreToolUse(Bash) hook.
//
// Reads the hook payload from stdin, and if the proposed Bash command matches a
// saved runbook's `triggers`, nudges the agent to run the runbook instead (one
// call, cached, queued, self-cleaning) rather than re-deriving the steps. It is
// ADVISORY: it never blocks — it always exits 0 and only adds context. Fails
// open on any parse/scan error.
//
// node: builtins only. No deps. Pure-read of the command string; no shelling out.

const fs = require('node:fs');
const {join} = require('node:path');
const paths = require('./runbook-paths');

const RUN_JS = join(__dirname, 'run.js');

// Find every runbook whose triggers match `command`. Scans the project + global
// store by default; `opts.roots` overrides the search roots (used by the test).
function matchRunbooks(command, opts = {}) {
	const roots = opts.roots || [
		{scope: 'project', root: paths.projectStoreDir(opts.cwd || process.cwd())},
		{scope: 'global', root: paths.globalStoreDir()},
	];
	const hits = [];
	for (const {scope, root} of roots) {
		let entries;
		try {
			entries = fs.readdirSync(root, {withFileTypes: true});
		} catch {
			continue;
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name.startsWith('.') || e.name === '_lib') continue;
			let manifest;
			try {
				manifest = JSON.parse(fs.readFileSync(join(root, e.name, 'manifest.json'), 'utf8'));
			} catch {
				continue;
			}
			const triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];
			for (const t of triggers) {
				let re;
				try {
					re = new RegExp(t);
				} catch {
					continue;
				}
				if (re.test(command)) {
					hits.push({scope, name: manifest.name || e.name});
					break;
				}
			}
		}
	}
	return hits;
}

function hintText(hits) {
	const list = hits.map((h) => `• ${h.name} (${h.scope}):  node ${RUN_JS} ${h.name} --scope ${h.scope}`).join('\n');
	return (
		`A saved runbook already covers this command. Prefer it over re-deriving the ` +
		`steps — it runs once, is cached/queued so parallel agents don't collide, and ` +
		`restores the working tree afterward:\n${list}`
	);
}

function extractCommand(payload) {
	if (!payload || typeof payload !== 'object') return '';
	const ti = payload.tool_input || payload.toolInput || {};
	const cmd = ti.command ?? payload.command;
	return typeof cmd === 'string' ? cmd : '';
}

function readStdin() {
	return new Promise((resolve) => {
		let data = '';
		if (process.stdin.isTTY) {
			resolve('');
			return;
		}
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => (data += c));
		process.stdin.on('end', () => resolve(data));
		process.stdin.on('error', () => resolve(data));
	});
}

async function main() {
	const raw = await readStdin();
	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		process.exit(0); // fail open
	}
	const command = extractCommand(payload);
	if (!command) process.exit(0);
	let hits = [];
	try {
		hits = matchRunbooks(command, {cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd()});
	} catch {
		process.exit(0);
	}
	if (hits.length === 0) process.exit(0);
	const text = hintText(hits);
	// Advisory only: surface context, never block.
	process.stdout.write(
		JSON.stringify({
			systemMessage: text,
			hookSpecificOutput: {hookEventName: 'PreToolUse', additionalContext: text},
		}),
	);
	process.exit(0);
}

module.exports = {matchRunbooks, hintText, extractCommand};

// --- Self-test --------------------------------------------------------------

function selfTest() {
	const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = require('node:fs');
	const {tmpdir} = require('node:os');
	let failures = 0;
	const log = (ok, msg) => {
		if (!ok) failures++;
		process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
	};
	const root = mkdtempSync(join(tmpdir(), 'rb-hint-'));
	mkdirSync(join(root, 'ci'), {recursive: true});
	writeFileSync(join(root, 'ci', 'manifest.json'), JSON.stringify({name: 'ci', triggers: ['(^|\\s)npm (run )?test\\b', 'phpstan']}));
	// Decoys the real matcher must skip: a shared-lib dir and a runtime dotdir.
	mkdirSync(join(root, '_lib'), {recursive: true});
	writeFileSync(join(root, '_lib', 'manifest.json'), JSON.stringify({name: '_lib', triggers: ['.*']}));
	mkdirSync(join(root, '.results'), {recursive: true});

	// Drive the REAL matchRunbooks via the roots override (not a re-implementation).
	const scan = (command) => matchRunbooks(command, {roots: [{scope: 'test', root}]});
	log(scan('npm test').length === 1 && scan('npm test')[0].name === 'ci', 'matchRunbooks matches "npm test"');
	log(scan('npm run test -- --watch').length === 1, 'matchRunbooks matches "npm run test --watch"');
	log(scan('docker exec x phpstan analyse').length === 1, 'matchRunbooks matches a phpstan invocation');
	log(scan('git status').length === 0, 'matchRunbooks ignores unrelated commands');
	log(scan('anything at all').every((h) => h.name !== '_lib'), 'matchRunbooks skips the _lib dir even with a catch-all trigger');
	log(extractCommand({tool_input: {command: 'npm test'}}) === 'npm test', 'extractCommand reads the payload');
	rmSync(root, {recursive: true, force: true});
	process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} — hint self-test\n`);
	process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module) {
	if (process.argv.includes('--self-test')) {
		selfTest();
	} else {
		main();
	}
}
