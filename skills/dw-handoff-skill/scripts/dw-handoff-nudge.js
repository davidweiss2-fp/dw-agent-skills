#!/usr/bin/env node
'use strict';

// dw-handoff nudge: a Claude Code PreCompact hook, shipped with the plugin.
//
// Fires when the session is about to compact - auto (context window nearly
// full) or manual (/compact). Compaction discards conversation detail, so this
// nudges the agent to persist state FIRST: write a dw-handoff document to the
// path derived by dw-handoff-path.js, and save any active dw-flow state to the
// worktree context dir. It is ADVISORY: it never blocks - it always exits 0
// and only adds context. Fails open on any parse/derivation error.
//
// node: builtins only. No deps. Path derivation is reused from
// ./dw-handoff-path (never duplicated here).

const {derive} = require('./dw-handoff-path');

// Pull the trigger out of a PreCompact hook payload. Tolerates snake_case and
// camelCase event-name fields. Returns null (stay silent) when the payload is
// not an object or names a different event; a missing event name is treated as
// PreCompact because this hook is only ever wired to that event.
function extractEvent(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
	const name = payload.hook_event_name ?? payload.hookEventName;
	if (name !== undefined && name !== 'PreCompact') return null;
	return {trigger: payload.trigger === 'manual' ? 'manual' : 'auto'};
}

// Handoff path from the skill's own derivation. Fail open: a broken git or fs
// must not kill the nudge, so fall back to pointing at the script.
function handoffPath() {
	try {
		return derive({}).path;
	} catch {
		return 'the path printed by: node <dw-handoff-skill>/scripts/dw-handoff-path.js';
	}
}

function buildNudge(trigger, path) {
	const reason =
		trigger === 'manual'
			? 'compaction was requested manually (/compact)'
			: 'the context window is nearly full (auto-compact)';
	const text =
		`Session nearing compaction - ${reason}. Conversation detail not persisted now will be lost. ` +
		`Before continuing: (1) write a handoff via the dw-handoff skill to ${path} ` +
		`- objective, current state, next steps, decisions, gotchas, pointers; ` +
		`(2) if a dw-flow is active, persist its state (current phase, approved plan, gate decisions) ` +
		`to the worktree context dir so the flow can resume at the right phase.`;
	return {
		systemMessage: text,
		hookSpecificOutput: {hookEventName: 'PreCompact', additionalContext: text},
	};
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
	const event = extractEvent(payload);
	if (!event) process.exit(0);
	// Advisory only: surface context, never block compaction.
	process.stdout.write(JSON.stringify(buildNudge(event.trigger, handoffPath())));
	process.exit(0);
}

module.exports = {buildNudge, extractEvent};

// --- Self-test --------------------------------------------------------------

function selfTest() {
	const {spawnSync} = require('node:child_process');
	let failures = 0;
	const log = (ok, msg) => {
		if (!ok) failures++;
		process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
	};
	// Drive the REAL hook path: spawn this script and pipe fixture payloads.
	const pipe = (input) => spawnSync(process.execPath, [__filename], {input, encoding: 'utf8'});

	const auto = pipe(JSON.stringify({hook_event_name: 'PreCompact', trigger: 'auto'}));
	let out = null;
	try {
		out = JSON.parse(auto.stdout);
	} catch {}
	log(auto.status === 0, 'valid auto payload exits 0');
	log(out !== null && typeof out.systemMessage === 'string' && out.systemMessage.length > 0, 'auto payload emits a systemMessage');
	log(out !== null && out.hookSpecificOutput.hookEventName === 'PreCompact', 'hookSpecificOutput names PreCompact');
	log(out !== null && out.hookSpecificOutput.additionalContext.includes('auto-compact'), 'auto trigger named in the nudge');
	log(out !== null && out.hookSpecificOutput.additionalContext.includes('dw-handoff'), 'nudge points at the dw-handoff skill');

	const manual = pipe(JSON.stringify({hook_event_name: 'PreCompact', trigger: 'manual'}));
	log(manual.status === 0 && manual.stdout.includes('manually (/compact)'), 'manual trigger named in the nudge');

	const garbage = pipe('not json {{{');
	log(garbage.status === 0 && garbage.stdout === '', 'garbage stdin: silent exit 0');

	const empty = pipe('');
	log(empty.status === 0 && empty.stdout === '', 'empty stdin: silent exit 0');

	const other = pipe(JSON.stringify({hook_event_name: 'SessionStart'}));
	log(other.status === 0 && other.stdout === '', 'non-PreCompact event: silent exit 0');

	log(extractEvent({hookEventName: 'PreCompact', trigger: 'manual'}).trigger === 'manual', 'extractEvent tolerates camelCase');
	log(extractEvent({}) !== null && extractEvent({}).trigger === 'auto', 'extractEvent defaults a bare payload to auto');
	log(extractEvent('nope') === null && extractEvent(null) === null, 'extractEvent rejects non-objects');

	process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} - nudge self-test\n`);
	process.exit(failures === 0 ? 0 : 1);
}

if (require.main === module) {
	if (process.argv.includes('--self-test')) {
		selfTest();
	} else {
		main();
	}
}
