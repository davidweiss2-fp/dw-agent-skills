'use strict';

// Copy each shared module into every skill that uses it, so a skill installed on its own still
// has the code. `--check` verifies the copies match and is what CI runs.
//
// Vendoring rather than requiring across skill directories: `npx skills add <repo> --all` installs
// each skill independently, so a cross-directory require resolves from the Claude plugin cache and
// throws everywhere else. Full reasoning: utils/README.md.

const {readFileSync, writeFileSync, existsSync} = require('node:fs');
const {join, dirname} = require('node:path');

const ROOT = join(__dirname, '..');

// One entry per shared module: its source, and the skills that vendor it.
const SHARED = [
	{
		name: 'agent-tags',
		source: 'utils/agent-tags.js',
		consumers: ['skills/dw-review-prs-skill/scripts', 'skills/dw-pr-ready-skill/scripts'],
	},
];

const HEADER = (source) =>
	`// GENERATED from ${source} by utils/sync-utils.js - do not edit here.\n` +
	`// Edit the source and re-run \`node utils/sync-utils.js\`; CI fails on drift.\n`;

function targetsFor(entry) {
	return entry.consumers.map((dir) => ({
		file: join(ROOT, dir, `_shared-${entry.name}.js`),
		rel: `${dir}/_shared-${entry.name}.js`,
	}));
}

function rendered(entry) {
	const src = readFileSync(join(ROOT, entry.source), 'utf8');
	// Strip the source's own 'use strict' so the header can lead; the copy re-adds it.
	return `'use strict';\n\n${HEADER(entry.source)}\n${src.replace(/^'use strict';\n+/, '')}`;
}

function main(argv) {
	const check = argv.includes('--check');
	const drift = [];
	let written = 0;
	for (const entry of SHARED) {
		const want = rendered(entry);
		for (const t of targetsFor(entry)) {
			const have = existsSync(t.file) ? readFileSync(t.file, 'utf8') : null;
			if (have === want) continue;
			if (check) {
				drift.push(`${t.rel} ${have === null ? 'is missing' : 'has drifted from'} ${entry.source}`);
				continue;
			}
			writeFileSync(t.file, want);
			written++;
			process.stdout.write(`wrote ${t.rel}\n`);
		}
	}
	if (check) {
		if (drift.length) {
			process.stderr.write(`vendored copies out of date:\n  ${drift.join('\n  ')}\n`);
			process.stderr.write('run: node utils/sync-utils.js\n');
			process.exit(1);
		}
		process.stdout.write(`all vendored copies match (${SHARED.length} shared module(s))\n`);
		return;
	}
	process.stdout.write(written ? `synced ${written} file(s)\n` : 'already in sync\n');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {SHARED, rendered, targetsFor};
