import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, '..', 'skills', 'dw-deslop-skill', 'scripts', 'deslop-rules.js');
const {applyRules, ruleApplies, loadRules, changedLines, runEngine} = require(scriptPath);

const emRule = [{name: 'em-dash-to-hyphen', find: '[—–]', replace: '-', appliesTo: ['**/*'], enabled: true}];

test('self-test passes', () => {
	const r = spawnSync('node', [scriptPath, '--self-test'], {encoding: 'utf8'});
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /PASS - deslop-rules self-test/);
});

test('applyRules rewrites only introduced lines', () => {
	const content = 'kept — dash\nnew — dash\nalso kept – en\n';
	const {content: out, counts} = applyRules(content, new Set([2]), emRule, 'a.md');
	assert.equal(out, 'kept — dash\nnew - dash\nalso kept – en\n');
	assert.equal(counts['em-dash-to-hyphen'], 1);
});

test('ruleApplies honors globs', () => {
	assert.ok(ruleApplies({appliesTo: ['*.md']}, 'a.md'));
	assert.ok(!ruleApplies({appliesTo: ['*.md']}, 'a.ts'));
	assert.ok(ruleApplies({appliesTo: ['**/*']}, 'deep/nested/x.ts'));
});

test('user rule overrides default of same name', () => {
	const defs = mkdtempSync(join(tmpdir(), 'dr-def-'));
	const dir = mkdtempSync(join(tmpdir(), 'dr-user-'));
	writeFileSync(join(defs, 'd.json'), JSON.stringify([{name: 'em-dash-to-hyphen', find: 'a', replace: 'b'}]));
	writeFileSync(join(dir, 'u.json'), JSON.stringify([{name: 'em-dash-to-hyphen', find: 'x', replace: 'y'}]));
	const rules = loadRules({defaultsPath: join(defs, 'd.json'), userDir: dir});
	const rule = rules.find((r) => r.name === 'em-dash-to-hyphen');
	assert.equal(rule.origin, 'user');
	assert.equal(rule.find, 'x');
	rmSync(defs, {recursive: true, force: true});
	rmSync(dir, {recursive: true, force: true});
});

test('changedLines marks only added lines; --dry-run writes nothing', () => {
	const repo = mkdtempSync(join(tmpdir(), 'dr-git-'));
	const git = (a) => spawnSync('git', a, {cwd: repo, encoding: 'utf8'});
	git(['init', '-q', '-b', 'base']);
	git(['config', 'user.email', 't@example.com']);
	git(['config', 'user.name', 'test']);
	writeFileSync(join(repo, 'f.md'), 'base — keep\n');
	git(['add', 'f.md']);
	git(['commit', '-qm', 'base']);
	git(['checkout', '-qb', 'work']);
	writeFileSync(join(repo, 'f.md'), 'base — keep\nadded — fix\n');
	const cl = changedLines({base: 'base', cwd: repo});
	const key = [...cl.keys()][0];
	assert.ok(cl.get(key).has(2) && !cl.get(key).has(1));
	const before = readFileSync(join(repo, 'f.md'), 'utf8');
	runEngine({base: 'base', cwd: repo, dryRun: true});
	assert.equal(readFileSync(join(repo, 'f.md'), 'utf8'), before);
	rmSync(repo, {recursive: true, force: true});
});
