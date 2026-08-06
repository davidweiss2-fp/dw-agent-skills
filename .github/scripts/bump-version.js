'use strict';

// Set every file that declares the package version to one patch above a base version.
//
// The target is computed from `main`, never from the branch: a bump relative to the branch
// would climb on every CI run, while `main + 1` is the same answer however many times this
// runs. That is what makes the step safe to repeat on a re-run or a second push.
//
// Node + CommonJS, node: builtins only. No git in here - the workflow reads the base version
// and passes it in, so the logic stays pure and self-testable.

const {readFileSync, writeFileSync, existsSync} = require('node:fs');
const {join} = require('node:path');

// Every file whose `"version"` field is the package version. marketplace.json declares it
// nested inside `plugins[]`, which is how it drifted to 0.3.6 while the other two were at
// 0.4.6 - a top-level-only sweep does not see it. The CHANGELOG is deliberately absent: its
// headings carry hand-written release notes, and an auto-inserted empty one is noise a human
// then has to clean up.
const VERSION_FILES = ['package.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function nextPatch(version) {
	const m = SEMVER.exec(String(version || '').trim());
	if (!m) throw new Error(`not a plain major.minor.patch version: ${JSON.stringify(version)}`);
	return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// Rewrites only the version line, so formatting and key order elsewhere survive untouched -
// JSON.parse + stringify would reformat the whole file and bury the bump in noise.
//
// Refuses a file carrying more than one `"version"` field rather than guessing which is the
// package's. These fields are nested (marketplace.json's sits inside plugins[]), so "the first
// one" is a positional accident, and the failure it would cause - bumping the wrong field, or
// silently leaving the real one stale - is exactly how marketplace.json drifted in the first place.
function setVersion(text, version) {
	const all = /^\s*"version"\s*:\s*"[^"]*"/gm;
	const found = String(text).match(all) || [];
	if (found.length === 0) throw new Error('no "version" field found');
	if (found.length > 1) {
		throw new Error(`${found.length} "version" fields found - name the intended one explicitly`);
	}
	return text.replace(/^(\s*)"version"(\s*):(\s*)"[^"]*"/m, `$1"version"$2:$3"${version}"`);
}

function applyVersion(root, version, files = VERSION_FILES) {
	const changed = [];
	for (const rel of files) {
		const file = join(root, rel);
		if (!existsSync(file)) throw new Error(`version file missing: ${rel}`);
		const before = readFileSync(file, 'utf8');
		const after = setVersion(before, version);
		if (after !== before) {
			writeFileSync(file, after);
			changed.push(rel);
		}
	}
	return changed;
}

// Asserts every version file agrees. The PR bump keeps them in sync going forward, but nothing
// stops a hand-edit or a merge that bypassed the workflow, and silent drift is precisely how
// marketplace.json sat ten patches behind without anyone noticing.
function check(root, files = VERSION_FILES) {
	const seen = new Map();
	for (const rel of files) {
		const file = join(root, rel);
		if (!existsSync(file)) throw new Error(`version file missing: ${rel}`);
		const m = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(readFileSync(file, 'utf8'));
		if (!m) throw new Error(`no "version" field in ${rel}`);
		seen.set(rel, m[1]);
	}
	const versions = [...new Set(seen.values())];
	if (versions.length > 1) {
		const detail = [...seen].map(([f, v]) => `  ${f}: ${v}`).join('\n');
		throw new Error(`version files disagree:\n${detail}`);
	}
	process.stdout.write(`all ${files.length} version files agree at ${versions[0]}\n`);
}

function selfTest() {
	const assert = require('node:assert/strict');
	assert.equal(nextPatch('0.4.6'), '0.4.7');
	assert.equal(nextPatch('1.0.0'), '1.0.1');
	assert.equal(nextPatch(' 0.4.9 '), '0.4.10');
	assert.throws(() => nextPatch('0.4'), /not a plain major\.minor\.patch/);
	assert.throws(() => nextPatch('1.2.3-rc.1'), /not a plain major\.minor\.patch/);

	const src = '{\n  "name": "x",\n  "version": "0.4.6",\n  "bin": {"x": "./b.js"}\n}\n';
	const out = setVersion(src, '0.4.7');
	assert.match(out, /"version": "0\.4\.7"/);
	// Everything but the version line is byte-identical, so the diff is one line.
	assert.equal(out.replace('0.4.7', '0.4.6'), src);
	// Applying the same target twice is a no-op, which is what lets CI re-run safely.
	assert.equal(setVersion(out, '0.4.7'), out);
	assert.throws(() => setVersion('{"name":"x"}', '1.0.0'), /no "version" field/);

	// Nested, as marketplace.json declares it inside plugins[].
	const nested = '{\n  "name": "m",\n  "plugins": [\n    {\n      "version": "0.3.6"\n    }\n  ]\n}\n';
	assert.match(setVersion(nested, '0.4.7'), /"version": "0\.4\.7"/);
	// Ambiguity is an error, not a coin flip on whichever field comes first.
	assert.throws(
		() => setVersion('{\n  "version": "1.0.0",\n  "p": [{\n    "version": "2.0.0"\n  }]\n}', '3.0.0'),
		/2 "version" fields found/,
	);

	process.stdout.write('bump-version self-test: ok\n');
}

function main(argv) {
	if (argv.includes('--self-test')) return selfTest();
	const rootArg = argv.indexOf('--root');
	if (argv.includes('--check')) {
		return check(rootArg === -1 ? process.cwd() : argv[rootArg + 1]);
	}
	const i = argv.indexOf('--base');
	if (i === -1 || !argv[i + 1]) {
		process.stderr.write('usage: bump-version.js (--base <major.minor.patch> | --check | --self-test) [--root DIR]\n');
		process.exit(1);
	}
	const root = rootArg === -1 ? process.cwd() : argv[rootArg + 1];
	const target = nextPatch(argv[i + 1]);
	const changed = applyVersion(root, target);
	// Consumed by the workflow: an unchanged tree must not produce an empty amend.
	const out = process.env.GITHUB_OUTPUT;
	if (out) {
		// `files` too, so the workflow stages exactly what this changed and the list is not
		// written down in two places that can drift apart.
		require('node:fs').appendFileSync(
			out,
			`version=${target}\nchanged=${changed.length > 0}\nfiles=${changed.join(' ')}\n`,
		);
	}
	process.stdout.write(
		changed.length
			? `bumped to ${target}: ${changed.join(', ')}\n`
			: `already at ${target}, nothing to change\n`,
	);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {nextPatch, setVersion, applyVersion, check, VERSION_FILES};
