'use strict';

const {spawnSync} = require('node:child_process');
const {mkdirSync} = require('node:fs');
const {dirname, join} = require('node:path');
const os = require('node:os');

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) {
			if (!args._) args._ = [];
			args._.push(token);
			continue;
		}
		const [key, ...rest] = token.slice(2).split('=');
		if (rest.length > 0) {
			args[key] = rest.join('=');
		} else {
			const next = argv[i + 1];
			if (next && !next.startsWith('--')) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

function getStringArg(args, key, envKey, defaultValue) {
	const v = args[key];
	if (typeof v === 'string' && v.length > 0) return v;
	if (envKey && typeof process.env[envKey] === 'string' && process.env[envKey].length > 0) {
		return process.env[envKey];
	}
	return defaultValue ?? '';
}

function ensureParentDir(filePath) {
	try {
		mkdirSync(dirname(filePath), {recursive: true});
	} catch (err) {
		if (err && err.code !== 'EEXIST') throw err;
	}
}

function runCommandCapture(command, args, env) {
	const res = spawnSync(command, args, {stdio: ['ignore', 'pipe', 'inherit'], env});
	return {
		status: typeof res.status === 'number' ? res.status : null,
		stdout: (res.stdout || Buffer.from('')).toString(),
		error: res.error,
	};
}

function ghEnv() {
	return {...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_NO_TTY: '1'};
}

function isNumericString(value) {
	return /^\d+$/.test(value);
}

function ghGraphqlCapture(query, variables) {
	const argList = ['api', 'graphql', '-f', `query=${query}`];
	for (const [k, v] of Object.entries(variables)) {
		if (isNumericString(v)) {
			argList.push('-F', `${k}=${v}`);
		} else {
			argList.push('-f', `${k}=${v}`);
		}
	}
	return runCommandCapture('gh', argList, ghEnv());
}

function getCurrentBranchName() {
	try {
		const gitRepoCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree']);
		const isRepo = (gitRepoCheck.stdout || Buffer.from('')).toString().trim();
		if (gitRepoCheck.error || (typeof gitRepoCheck.status === 'number' && gitRepoCheck.status !== 0)) {
			return 'no-git';
		}
		if (isRepo !== 'true') return 'no-git-repo';
		const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
		if (r.error || (typeof r.status === 'number' && r.status !== 0)) return 'unknown-branch';
		const out = (r.stdout || Buffer.from('')).toString().trim();
		return out && out !== 'HEAD' ? out : 'detached-HEAD';
	} catch {
		return 'unknown-branch';
	}
}

function defaultStateDir() {
	const base = process.env.XDG_CONFIG_HOME || join(os.homedir(), '.config');
	return join(base, 'dw-agent-skills', 'pr-ready-watch');
}

function parsePrUrl(url) {
	const trimmed = String(url || '').trim();
	const match = trimmed.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/i,
	);
	if (!match) {
		throw new Error(`Invalid PR URL (expected https://github.com/owner/repo/pull/N): ${trimmed}`);
	}
	return {owner: match[1], repo: match[2], number: Number.parseInt(match[3], 10)};
}

module.exports = {
	parseArgs,
	getStringArg,
	ensureParentDir,
	runCommandCapture,
	ghEnv,
	ghGraphqlCapture,
	getCurrentBranchName,
	defaultStateDir,
	parsePrUrl,
	join,
};
