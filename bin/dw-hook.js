#!/usr/bin/env node
'use strict';

// dw-hook.js - the single dispatcher behind every dw plugin hook event.
//
// hooks/hooks.json points all events here; the payload's hook_event_name picks
// the behavior. Two behaviors:
//   INJECT   - recall saved knowledge (or build a skill's hint/nudge in-process)
//              and emit one hookSpecificOutput.additionalContext JSON document.
//              SessionStart: knowledge indexes; UserPromptSubmit: prompt recall;
//              PreToolUse(Bash): runbook hint; PostToolUseFailure: gotcha recall;
//              PreCompact: handoff nudge.
//   LOG-ONLY - append a one-line JSONL record to the project's run-notes session
//              log (<store>/run-notes/<slug>/session-log.jsonl); no injection.
//              The log feeds the flow's capture step and future recall ranking.
// A session-keyed cache (<store>/run-notes/.cache/<session_id>.json) dedupes
// injections so the same memory is never re-injected within one session.
// The skill modules are require()d lazily: the log-only majority of fires
// (PostToolUse, Stop, …) never pays for loading the recall engine.
//
// ADVISORY: never blocks - always exits 0, fails open on any error.
// node: builtins only. No deps.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const skillScript = (skill, script) => path.join(REPO_ROOT, 'skills', skill, 'scripts', script);
// Loaded leniently: a broken/partial install must not turn every hook fire
// into a stack trace - main() bails silently when km-paths is unavailable.
let kmPaths = null;
try {
	kmPaths = require(skillScript('dw-knowledge-skill', 'km-paths.js'));
} catch {
	kmPaths = null;
}

const PROMPT_RECALL_LIMIT = 5;
const TOOL_RECALL_LIMIT = 3;
const INDEX_CAP_BYTES = 4000;
const WINDOW_DAYS = 90;

// --- payload / io ------------------------------------------------------------

function readStdin() {
	try {
		return fs.readFileSync(0, 'utf8');
	} catch {
		return '';
	}
}

function parsePayload(raw) {
	try {
		const obj = JSON.parse(raw);
		return obj && typeof obj === 'object' ? obj : null;
	} catch {
		return null;
	}
}

function payloadCwd(payload) {
	return typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
}

// Emit the single JSON document a context-injecting hook is allowed to print.
// systemMessage rides along because not every event honors additionalContext
// (PreToolUse/PreCompact read systemMessage); hosts ignore the field they don't use.
function emitContext(event, text) {
	if (!text) return;
	process.stdout.write(JSON.stringify({
		systemMessage: text,
		hookSpecificOutput: {hookEventName: event, additionalContext: text},
	}));
}

// --- session dedupe cache ------------------------------------------------------

function sanitizeId(id) {
	const s = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
	return s || 'no-session';
}

function cachePath(payload) {
	return path.join(kmPaths.storeRoot(), 'run-notes', '.cache', `${sanitizeId(payload.session_id)}.json`);
}

function loadInjected(payload) {
	try {
		const arr = JSON.parse(fs.readFileSync(cachePath(payload), 'utf8'));
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

function saveInjected(payload, files) {
	const file = cachePath(payload);
	kmPaths.ensureDir(path.dirname(file));
	fs.writeFileSync(file, JSON.stringify(files));
}

// --- recall -------------------------------------------------------------------

// Recall against the query text, drop memories already injected this session,
// record the fresh ones, and return the rendered advisory ('' when nothing new).
function recallDeduped(queryText, payload, limit) {
	const kmRecall = require(skillScript('dw-knowledge-skill', 'km-recall.js'));
	const words = kmRecall.tokenize(queryText);
	if (words.length === 0) return '';
	const opts = {
		scope: 'both',
		limit: limit + 10,
		windowDays: WINDOW_DAYS,
		cwd: payloadCwd(payload),
	};
	const items = kmRecall.recall(words, opts, Date.now());
	if (items.length === 0) return '';
	const seen = new Set(loadInjected(payload));
	const fresh = items.filter((it) => !seen.has(it.file)).slice(0, limit);
	if (fresh.length === 0) return '';
	saveInjected(payload, [...seen, ...fresh.map((it) => it.file)]);
	return kmRecall.renderAdvisory(fresh);
}

// --- session log ----------------------------------------------------------------

// Append one compact JSONL record. Event names + tool names only - never prompt
// text, tool output, or anything that could carry PII or secrets. Swallows write
// failures (read-only volume, unmounted store) so logging can never cost an injection.
function logEvent(payload, event) {
	try {
		const dir = kmPaths.runNotesDir(payloadCwd(payload));
		kmPaths.ensureDir(dir);
		const rec = {ts: new Date().toISOString(), event, session_id: sanitizeId(payload.session_id)};
		if (typeof payload.tool_name === 'string') rec.tool = payload.tool_name;
		if (typeof payload.source === 'string') rec.source = payload.source;
		fs.appendFileSync(path.join(dir, 'session-log.jsonl'), `${JSON.stringify(rec)}\n`);
	} catch {
		// advisory log only
	}
}

// Drop dedupe-cache files older than seven days; runs on SessionEnd.
function pruneCache() {
	try {
		const dir = path.join(kmPaths.storeRoot(), 'run-notes', '.cache');
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		for (const name of fs.readdirSync(dir)) {
			const file = path.join(dir, name);
			if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file);
		}
	} catch {
		// cache pruning is best-effort
	}
}

// --- event handlers ----------------------------------------------------------------

// Cap a file's contribution to the SessionStart context; '' when unreadable.
function readCapped(file) {
	try {
		const raw = fs.readFileSync(file, 'utf8');
		return raw.length > INDEX_CAP_BYTES ? `${raw.slice(0, INDEX_CAP_BYTES)}\n[truncated]` : raw;
	} catch {
		return '';
	}
}

function sessionStartContext(payload) {
	const cwd = payloadCwd(payload);
	const parts = [];
	const project = readCapped(kmPaths.projectIndexPath(cwd));
	if (project.trim()) parts.push(`Project knowledge index (dw-knowledge, recall before real work):\n${project.trim()}`);
	const global = readCapped(kmPaths.globalIndexPath());
	if (global.trim()) parts.push(`Global knowledge index (dw-knowledge):\n${global.trim()}`);
	if (parts.length === 0) return '';
	parts.push(`Full memories live under ${kmPaths.storeRoot()} - recall with: node km-recall.js <query> (dw-knowledge skill).`);
	return parts.join('\n\n');
}

// Runbook hint for a Bash command, built in-process (no child node).
function runbookHint(payload) {
	try {
		const hint = require(skillScript('dw-runbook-skill', 'dw-runbook-hint.js'));
		const command = hint.extractCommand(payload);
		if (!command) return '';
		const hits = hint.matchRunbooks(command, {cwd: payloadCwd(payload)});
		return hits.length > 0 ? hint.hintText(hits) : '';
	} catch {
		return '';
	}
}

// Handoff nudge before compaction, built in-process.
function handoffNudge(payload) {
	try {
		const nudge = require(skillScript('dw-handoff-skill', 'dw-handoff-nudge.js'));
		const {derive} = require(skillScript('dw-handoff-skill', 'dw-handoff-path.js'));
		const out = nudge.buildNudge(payload.trigger, derive({}).path);
		const text = out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;
		return typeof text === 'string' ? text : '';
	} catch {
		return '';
	}
}

// Query text for a failed tool call: the command/path that failed + the error.
function failureQuery(payload) {
	const bits = [];
	const input = payload.tool_input;
	if (input && typeof input === 'object') {
		for (const key of ['command', 'file_path', 'description', 'query']) {
			if (typeof input[key] === 'string') bits.push(input[key]);
		}
	}
	for (const key of ['error', 'error_message']) {
		if (typeof payload[key] === 'string') bits.push(payload[key]);
	}
	const resp = payload.tool_response;
	if (typeof resp === 'string') bits.push(resp.slice(0, 2000));
	return bits.join(' ');
}

function dispatch(event, payload) {
	switch (event) {
		case 'SessionStart':
			logEvent(payload, event);
			emitContext(event, sessionStartContext(payload));
			return;
		case 'UserPromptSubmit':
			emitContext(event, recallDeduped(
				typeof payload.prompt === 'string' ? payload.prompt : '',
				payload, PROMPT_RECALL_LIMIT,
			));
			return;
		case 'PreToolUse':
			// Runbook hint only; store recall on this path happens at PostToolUseFailure.
			if (payload.tool_name !== 'Bash') return;
			emitContext(event, runbookHint(payload));
			return;
		case 'PostToolUseFailure':
			logEvent(payload, event);
			emitContext(event, recallDeduped(failureQuery(payload), payload, TOOL_RECALL_LIMIT));
			return;
		case 'PreCompact':
			logEvent(payload, event);
			emitContext(event, handoffNudge(payload));
			return;
		case 'SessionEnd':
			logEvent(payload, event);
			pruneCache();
			return;
		default:
			// Stop, StopFailure, SubagentStop, PostToolUse, PostToolBatch,
			// PostCompact, PermissionDenied, CwdChanged, ...
			logEvent(payload, event);
	}
}

// --- main -------------------------------------------------------------------------

function main() {
	if (!kmPaths) return; // broken install -> silent, fail open
	const payload = parsePayload(readStdin());
	if (!payload) return; // garbage/empty stdin -> silent, fail open
	const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
	if (!event) return;
	dispatch(event, payload);
}

if (require.main === module) {
	try {
		main();
	} catch {
		// advisory hook: never fail the action
	}
	process.exit(0);
}
