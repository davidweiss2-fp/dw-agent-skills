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

// Files whose `"version"` field is the package version. The CHANGELOG is deliberately absent:
// its headings carry hand-written release notes, and an auto-inserted empty one is noise a
// human then has to clean up.
const VERSION_FILES = ['package.json', '.claude-plugin/plugin.json'];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function nextPatch(version) {
	const m = SEMVER.exec(String(version || '').trim());
	if (!m) throw new Error(`not a plain major.minor.patch version: ${JSON.stringify(version)}`);
	return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// Rewrites only the version line, so formatting and key order elsewhere survive untouched -
// JSON.parse + stringify would reformat the whole file and bury the bump in noise.
function setVersion(text, version) {
	const line = /^(\s*)"version"(\s*):(\s*)"[^"]*"/m;
	if (!line.test(text)) throw new Error('no "version" field found');
	return text.replace(line, `$1"version"$2:$3"${version}"`);
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

	process.stdout.write('bump-version self-test: ok\n');
}

function main(argv) {
	if (argv.includes('--self-test')) return selfTest();
	const i = argv.indexOf('--base');
	if (i === -1 || !argv[i + 1]) {
		process.stderr.write('usage: bump-version.js --base <major.minor.patch> [--root DIR]\n');
		process.exit(1);
	}
	const r = argv.indexOf('--root');
	const root = r === -1 ? process.cwd() : argv[r + 1];
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

module.exports = {nextPatch, setVersion, applyVersion, VERSION_FILES};
