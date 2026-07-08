import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PreCompact'];

const config = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));

// Flatten the event map into [{event, matcher, command}], asserting the
// documented plugin shape: {hooks: {Event: [{matcher?, hooks: [{type, command}]}]}}.
function flattenCommands(cfg) {
	const out = [];
	for (const [event, entries] of Object.entries(cfg.hooks)) {
		assert.ok(Array.isArray(entries), `${event} maps to an array`);
		for (const entry of entries) {
			assert.ok(Array.isArray(entry.hooks), `${event} entry has a hooks array`);
			for (const h of entry.hooks) {
				assert.equal(h.type, 'command', `${event} hook is type command`);
				out.push({event, matcher: entry.matcher, command: h.command});
			}
		}
	}
	return out;
}

// Resolve a hook command's plugin-rooted script path against the repo root and
// split off its extra CLI args. Every command must be exactly:
//   node "${CLAUDE_PLUGIN_ROOT}/<script>" [args...]
function parseCommand(command) {
	const m = command.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"(.*)$/);
	assert.ok(m, `command uses node + a quoted \${CLAUDE_PLUGIN_ROOT} path: ${command}`);
	const args = m[2].trim() === '' ? [] : m[2].trim().split(/\s+/);
	return {script: join(ROOT, m[1]), args};
}

describe('hooks/hooks.json shape', () => {
	it('declares exactly the three plugin hook events', () => {
		assert.deepEqual(Object.keys(config.hooks).sort(), [...EVENTS].sort());
	});

	it('scopes the PreToolUse hook to Bash', () => {
		assert.equal(config.hooks.PreToolUse[0].matcher, 'Bash');
	});

	it('every command points at a script that exists in the repo', () => {
		for (const {command} of flattenCommands(config)) {
			const {script} = parseCommand(command);
			assert.ok(existsSync(script), `script exists: ${script}`);
		}
	});
});

describe('fail-open contract (hooks are advisory, never block)', () => {
	const run = (script, args, input) =>
		spawnSync(process.execPath, [script, ...args], {input, encoding: 'utf8'});

	for (const {event, command} of flattenCommands(config)) {
		it(`${event} hook exits 0 on garbage stdin`, () => {
			const {script, args} = parseCommand(command);
			const r = run(script, args, 'not json {{{');
			assert.equal(r.status, 0, r.stdout + r.stderr);
		});

		it(`${event} hook exits 0 on empty stdin`, () => {
			const {script, args} = parseCommand(command);
			const r = run(script, args, '');
			assert.equal(r.status, 0, r.stdout + r.stderr);
		});
	}
});

describe('dw-handoff-nudge.js --self-test (PreCompact fixtures)', () => {
	it('passes its embedded fixture payloads', () => {
		const script = join(ROOT, 'skills', 'dw-handoff-skill', 'scripts', 'dw-handoff-nudge.js');
		const r = spawnSync(process.execPath, [script, '--self-test'], {encoding: 'utf8'});
		assert.equal(r.status, 0, r.stdout + r.stderr);
	});
});
