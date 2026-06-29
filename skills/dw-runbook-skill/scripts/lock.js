#!/usr/bin/env node
'use strict';

// dw-runbook lock: a file-based single-flight coordinator. node: builtins only.
//
// One primitive, keyed differently per isolation mode:
//   shared-dir mode -> lockKey = the RESOURCE (the shared checkout / container).
//                      Different signatures are mutually exclusive (a real mutex);
//                      the same signature coalesces onto one run's result.
//   worktree  mode -> lockKey = the SIGNATURE. Different signatures never contend
//                      (separate worktrees run in parallel); the same signature
//                      coalesces.
//
// coordinate() returns a lease whose `role` is one of:
//   'leader'    -> YOU run the work, then writeResultAtomic() + release().
//   'coalesced' -> another in-flight run produced the result (returned in .result).
//   'cached'    -> a fresh result already existed (returned in .result). Never ran.
//
// OWNERSHIP IS THE META FILE, not the directory. The lock dir is just a container;
// ownership is whoever atomically creates `meta.json` inside it with O_EXCL
// (`writeFileSync(..., {flag:'wx'})`) — a cross-platform compare-and-swap that
// needs no deps and no flock(1) (which macOS lacks). This means:
//   * No double-leader from the mkdir->writeMeta gap: an empty dir is simply
//     claimable by the next exclusive meta create; there is no "meta-less
//     takeover" to race on.
//   * A leader is reclaimed ONLY when its PID is dead — liveness is authoritative,
//     so a slow-but-alive leader is NEVER evicted (which for a mutex would be a
//     correctness violation). The cost: a crashed holder whose PID is reused by an
//     unrelated process blocks waiters until timeoutMs (a loud error, never silent
//     corruption). Acceptable on a single machine at low parallelism.
//   * A reclaimer removes only the exact dead meta it observed (token-matched), and
//     a leader releases only its own meta — so no one ever deletes a live owner's
//     claim.

const fs = require('node:fs');
const crypto = require('node:crypto');
const {join} = require('node:path');
const {ensureDir} = require('./runbook-paths');

const DEFAULTS = {
	pollMs: 200,
	timeoutMs: 15 * 60 * 1000, // a waiter gives up after this (loud error, no corruption)
	ttlMs: 10 * 60 * 1000, // result-cache freshness window (signature already guards correctness)
};

// --- primitives -------------------------------------------------------------

function sleepMs(ms) {
	const sab = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(sab, 0, 0, Math.max(0, ms | 0));
}

// Is a process alive? EPERM means it exists but is owned by another user.
function isAlive(pid) {
	if (!pid || typeof pid !== 'number') return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err && err.code === 'EPERM';
	}
}

function makeToken() {
	return crypto.randomBytes(8).toString('hex');
}

// Lock-dir name safe on disk AND collision-resistant (sanitized prefix + hash).
function lockDirName(key) {
	const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
	const hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 8);
	return `${safe}-${hash}`;
}

function metaPathOf(lockDir) {
	return join(lockDir, 'meta.json');
}

function readMetaAt(metaPath) {
	try {
		return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
	} catch {
		return null;
	}
}

// Atomically claim ownership by exclusively creating the meta file. Returns true
// iff WE created it; false if another owner holds it OR the lock dir was just
// removed by a concurrent release (ENOENT) — the caller's loop then retries.
function tryClaim(metaPath, meta) {
	const body = JSON.stringify(meta);
	try {
		fs.writeFileSync(metaPath, body, {flag: 'wx'});
		return true;
	} catch (err) {
		if (err && err.code === 'EEXIST') return false;
		if (err && err.code === 'ENOENT') {
			// A concurrent release rmdir'd the lock dir between our ensureDir and now.
			// Recreate it and retry once; on any repeat, fall back to the retry loop.
			ensureDir(join(metaPath, '..'));
			try {
				fs.writeFileSync(metaPath, body, {flag: 'wx'});
				return true;
			} catch (err2) {
				return false;
			}
		}
		throw err;
	}
}

// Remove a meta file only if it still carries the token we expect — so we never
// delete a claim a different owner created in the meantime.
function removeMetaIfToken(metaPath, token) {
	const cur = readMetaAt(metaPath);
	if (cur && cur.token === token) {
		try {
			fs.rmSync(metaPath, {force: true});
		} catch {
			// already gone
		}
	}
}

function writeResultAtomic(resultPath, obj) {
	ensureDir(join(resultPath, '..'));
	const tmp = `${resultPath}.${process.pid}.${makeToken()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
	fs.renameSync(tmp, resultPath);
}

// Return the parsed result iff it exists and is within ttl; else null. Reading
// here (not just stat) closes the race where a result vanishes between a
// freshness check and a later read.
function readFreshResult(resultPath, ttlMs, now) {
	if (!resultPath) return null;
	try {
		const st = fs.statSync(resultPath);
		if (now - st.mtimeMs > ttlMs) return null;
		return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
	} catch {
		return null;
	}
}

// --- the coordinator --------------------------------------------------------

function coordinate(opts) {
	const o = {...DEFAULTS, ...opts};
	for (const k of ['pollMs', 'timeoutMs', 'ttlMs']) {
		if (o[k] === undefined) o[k] = DEFAULTS[k];
	}
	const now = o.now || (() => Date.now());
	if (!o.lockKey) throw new Error('coordinate requires lockKey');
	if (!o.sig) throw new Error('coordinate requires sig');
	if (!o.locksDir) throw new Error('coordinate requires locksDir');
	const lockDir = join(o.locksDir, lockDirName(o.lockKey));
	const metaPath = metaPathOf(lockDir);
	const start = now();
	let everWaited = false;

	for (;;) {
		// 1. A fresh result wins over taking the lock — the coalesce path. resultPath
		//    is keyed by signature, so this only matches a same-sig run.
		const result = readFreshResult(o.resultPath, o.ttlMs, now());
		if (result) {
			return {role: everWaited ? 'coalesced' : 'cached', result, lockDir, resultPath: o.resultPath};
		}
		// 2. Try to claim ownership via an exclusive meta create.
		ensureDir(lockDir);
		const token = makeToken();
		if (tryClaim(metaPath, {pid: process.pid, token, startedAt: now(), sig: o.sig, state: o.state})) {
			return {role: 'leader', lockDir, metaPath, resultPath: o.resultPath, token};
		}
		// 3. Someone owns it. Reclaim only a provably-dead owner; otherwise wait.
		const meta = readMetaAt(metaPath);
		if (meta && !isAlive(meta.pid)) {
			removeMetaIfToken(metaPath, meta.token);
			continue;
		}
		if (!meta) continue; // owner mid-create or just released — retry the claim
		if (now() - start > o.timeoutMs) {
			throw new Error(
				`runbook lock timeout for "${o.lockKey}" after ${o.timeoutMs}ms (held by sig=${meta.sig}, pid=${meta.pid})`,
			);
		}
		everWaited = true;
		sleepMs(o.pollMs);
	}
}

// Release a lock the caller leads: remove our own meta (token-matched). We do NOT
// rmdir the (now-empty) lock dir — ownership is the meta FILE, so an empty dir is
// simply unlocked, and never removing it avoids a concurrent mkdir-vs-rmdir race
// on the same path. Empty lock dirs are harmless residue. Safe because a live
// leader is never reclaimed, so nothing else races to delete our meta.
function release(lease) {
	if (!lease || lease.role !== 'leader' || !lease.metaPath) return;
	removeMetaIfToken(lease.metaPath, lease.token);
}

module.exports = {coordinate, release, writeResultAtomic};

// --- CLI: --self-test (real multi-process proof) and --worker ---------------

if (require.main === module) {
	const argv = process.argv.slice(2);
	if (argv.includes('--worker')) {
		runWorker(argv);
	} else if (argv.includes('--self-test')) {
		selfTest().then((code) => process.exit(code));
	} else {
		process.stderr.write('usage: lock.js --self-test\n');
		process.exit(2);
	}
}

function argVal(argv, name, def) {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}

// A worker: coordinate as shared-dir (lockKey = resource), and if it leads,
// record its [enter,exit] critical-section window to ITS OWN file (no cross-process
// append contention) so the parent can soundly check for overlap.
function runWorker(argv) {
	const root = argVal(argv, '--root');
	const resource = argVal(argv, '--resource', 'R');
	const sig = argVal(argv, '--sig', 'sig');
	const holdMs = parseInt(argVal(argv, '--hold', '40'), 10);
	const lease = coordinate({
		lockKey: resource,
		sig,
		state: sig,
		locksDir: join(root, '.locks'),
		resultPath: join(root, '.results', `${sig}.json`),
		pollMs: parseInt(argVal(argv, '--poll', '10'), 10),
		ttlMs: parseInt(argVal(argv, '--ttl', '600000'), 10),
		timeoutMs: parseInt(argVal(argv, '--timeout', '60000'), 10),
	});
	const out = join(root, 'intervals', `${process.pid}-${Math.floor(Math.random() * 1e6)}.json`);
	ensureDir(join(root, 'intervals'));
	if (lease.role === 'leader') {
		const enter = Date.now();
		sleepMs(holdMs);
		const exit = Date.now();
		writeResultAtomic(lease.resultPath, {leaderPid: process.pid, sig});
		release(lease);
		fs.writeFileSync(out, JSON.stringify({role: 'leader', enter, exit}));
	} else {
		fs.writeFileSync(out, JSON.stringify({role: lease.role}));
	}
	process.stdout.write(`${lease.role}\n`);
	process.exit(0);
}

function spawnWorkers(n, makeArgs) {
	const {spawn} = require('node:child_process');
	return Promise.all(
		Array.from({length: n}, (_, i) =>
			new Promise((resolve) => {
				const child = spawn(process.execPath, [__filename, '--worker', ...makeArgs(i)], {
					stdio: ['ignore', 'pipe', 'inherit'],
				});
				let outBuf = '';
				child.stdout.on('data', (d) => (outBuf += d));
				child.on('exit', (code) => resolve({code, out: outBuf.trim()}));
			}),
		),
	);
}

// Read every per-worker interval file and report leader count, coalesced count,
// and whether any two leaders' [enter,exit] windows overlapped.
function analyzeIntervals(dir) {
	const leaders = [];
	let coalesced = 0;
	for (const f of fs.readdirSync(dir)) {
		const o = JSON.parse(fs.readFileSync(join(dir, f), 'utf8'));
		if (o.role === 'leader') leaders.push(o);
		else coalesced++;
	}
	leaders.sort((a, b) => a.enter - b.enter);
	let overlapped = false;
	for (let i = 1; i < leaders.length; i++) {
		if (leaders[i].enter < leaders[i - 1].exit) overlapped = true;
	}
	return {enters: leaders.length, coalesced, overlapped};
}

async function selfTest() {
	const {mkdtempSync, rmSync, readdirSync} = require('node:fs');
	const {tmpdir} = require('node:os');
	let failures = 0;
	const log = (ok, msg) => {
		if (!ok) failures++;
		process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${msg}\n`);
	};

	// Test A — mutual exclusion: distinct signatures on one resource must serialize.
	{
		const root = mkdtempSync(join(tmpdir(), 'rb-lock-mutex-'));
		const N = 6;
		await spawnWorkers(N, (i) => ['--root', root, '--resource', 'R', '--sig', `mutex-${i}`, '--hold', '40', '--poll', '8']);
		const {enters, overlapped} = analyzeIntervals(join(root, 'intervals'));
		log(!overlapped, 'mutex: no two leaders overlapped in the critical section');
		log(enters === N, `mutex: every distinct-sig run executed (enters=${enters}, want ${N})`);
		const held = readdirSync(join(root, '.locks')).filter((d) => fs.existsSync(join(root, '.locks', d, 'meta.json')));
		log(held.length === 0, `mutex: every leader released its lock (held=${held.length}, want 0)`);
		rmSync(root, {recursive: true, force: true});
	}

	// Test B — coalescing: identical signatures collapse onto ONE execution.
	{
		const root = mkdtempSync(join(tmpdir(), 'rb-lock-coalesce-'));
		const N = 6;
		const res = await spawnWorkers(N, () => ['--root', root, '--resource', 'R', '--sig', 'same', '--hold', '60', '--poll', '8']);
		const {enters, coalesced} = analyzeIntervals(join(root, 'intervals'));
		log(enters === 1, `coalesce: exactly one leader executed (enters=${enters}, want 1)`);
		log(coalesced === N - 1, `coalesce: the rest reused the result (coalesced=${coalesced}, want ${N - 1})`);
		log(res.filter((r) => r.out === 'leader').length === 1, 'coalesce: one process reported leader');
		rmSync(root, {recursive: true, force: true});
	}

	// Test C — dead-holder reclaim: a meta with a dead PID is reclaimed.
	{
		const root = mkdtempSync(join(tmpdir(), 'rb-lock-dead-'));
		const locks = join(root, '.locks');
		const dir = join(locks, lockDirName('R'));
		ensureDir(dir);
		fs.writeFileSync(metaPathOf(dir), JSON.stringify({pid: 2 ** 30, token: 'dead', startedAt: 0, sig: 'old', state: 'old'}));
		const lease = coordinate({lockKey: 'R', sig: 'new', state: 'new', locksDir: locks, resultPath: join(root, '.results', 'new.json'), pollMs: 5, timeoutMs: 5000});
		log(lease.role === 'leader', `dead-holder: reclaimed a dead owner's lock (role=${lease.role}, want leader)`);
		release(lease);
		rmSync(root, {recursive: true, force: true});
	}

	// Test D — a live but SLOW leader is never evicted (the mutex-correctness regression).
	{
		const root = mkdtempSync(join(tmpdir(), 'rb-lock-slow-'));
		const N = 4;
		// One long hold (300ms) + others; tiny poll. Liveness-authoritative => no eviction => no overlap.
		await spawnWorkers(N, (i) => ['--root', root, '--resource', 'R', '--sig', `slow-${i}`, '--hold', i === 0 ? '300' : '40', '--poll', '5']);
		const {enters, overlapped} = analyzeIntervals(join(root, 'intervals'));
		log(!overlapped, 'slow-leader: a long-running live leader is never evicted (no overlap)');
		log(enters === N, `slow-leader: all runs executed (enters=${enters}, want ${N})`);
		rmSync(root, {recursive: true, force: true});
	}

	process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'} — lock self-test\n`);
	return failures === 0 ? 0 : 1;
}
