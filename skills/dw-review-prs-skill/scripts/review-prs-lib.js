'use strict';

// Pure decision logic for dw-review-prs: PR refs, state file, and queue
// classification. No I/O and no gh calls - the CLI fetches, this decides.

const DRAFT_TAG = '[dev-ai]';

// Accepts a PR URL (with or without /files and a fragment), owner/repo#123,
// or owner/repo/123. Returns {owner, repo, number, key} or null.
function parsePrRef(ref) {
	const s = String(ref || '').trim();
	const url = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
	const short = s.match(/^([^/\s#]+)\/([^/\s#]+)(?:#|\/)(\d+)$/);
	const m = url || short;
	if (!m) return null;
	const number = Number(m[3]);
	if (!Number.isInteger(number) || number <= 0) return null;
	return {owner: m[1], repo: m[2], number, key: `${m[1]}/${m[2]}#${number}`};
}

// state.md is one line per PR so a human can read and edit it:
//   - owner/repo#123 | sha=<head sha> | status=<status> | at=<iso>
function parseStateMd(text) {
	const entries = {};
	for (const line of String(text || '').split('\n')) {
		const m = line.match(
			/^\s*-\s+(\S+\/\S+#\d+)\s*\|\s*sha=(\S*)\s*\|\s*status=(\S*)\s*(?:\|\s*at=(\S*))?/,
		);
		if (!m) continue;
		entries[m[1]] = {key: m[1], sha: m[2] || '', status: m[3] || '', at: m[4] || ''};
	}
	return entries;
}

function renderStateMd(entries) {
	const keys = Object.keys(entries).sort();
	const lines = [
		'# dw-review-prs state',
		'',
		'One line per PR: the head SHA this reviewer last drafted or submitted against.',
		'A matching SHA means the PR is already handled; a different SHA means review the delta.',
		'',
	];
	for (const k of keys) {
		const e = entries[k];
		lines.push(`- ${k} | sha=${e.sha || ''} | status=${e.status || ''} | at=${e.at || ''}`);
	}
	return lines.join('\n') + '\n';
}

function upsertState(entries, key, {sha, status, at}) {
	return {...entries, [key]: {key, sha: sha || '', status: status || '', at: at || ''}};
}

// Classify one PR against what this reviewer has already done to it.
//
// pr: {key, headSha, isDraft, isOpen, authoredByMe,
//      pendingReview: {id, draftCount} | null,
//      submittedShas: [sha, ...]}   // head SHAs this reviewer already submitted against
// state: the parsed state.md entry for this PR, or undefined.
function classifyPr(pr, state) {
	if (!pr.isOpen) return {status: 'closed', reason: 'PR is no longer open'};
	if (pr.authoredByMe) return {status: 'skip', reason: 'own PR'};

	const pending = pr.pendingReview;
	if (pending && pending.draftCount > 0) {
		return {
			status: 'draft-waiting',
			reason: `${pending.draftCount} unsubmitted draft comment(s) waiting on you`,
		};
	}
	if (pending) {
		// An empty pending review still blocks REST comment posting on this PR.
		return {status: 'draft-empty', reason: 'empty pending review holds the one-per-PR slot'};
	}

	const submitted = Array.isArray(pr.submittedShas) ? pr.submittedShas : [];
	if (pr.headSha && submitted.includes(pr.headSha)) {
		return {status: 'reviewed', reason: 'review submitted at current head'};
	}
	if (submitted.length > 0) {
		return {status: 'needs-draft', reason: 'pushed to since your last submitted review'};
	}
	if (state && pr.headSha && state.sha === pr.headSha && state.status === 'submitted') {
		return {status: 'reviewed', reason: 'state records a submitted review at this head'};
	}
	if (state && pr.headSha && state.sha === pr.headSha && state.status === 'declined') {
		return {status: 'skip', reason: 'declined at this head'};
	}
	return {status: 'needs-draft', reason: 'no review from you yet'};
}

// Statuses the reviewer has to act on, in the order they should be reported.
const ACTIONABLE = ['draft-waiting', 'needs-draft', 'draft-empty'];

function isActionable(status) {
	return ACTIONABLE.includes(status);
}

function sortQueue(rows) {
	const rank = (r) => {
		const i = ACTIONABLE.indexOf(r.status);
		return i === -1 ? ACTIONABLE.length : i;
	};
	return [...rows].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

function summarize(rows) {
	const counts = {};
	for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
	return counts;
}

// Every comment body this skill drafts carries the tag, so a later run can tell
// its own comments from a human's on the same thread.
function hasDraftTag(body) {
	return String(body || '').includes(DRAFT_TAG);
}

// The author reads one line and knows what closes the thread, so the ask leads
// every body: the tag, then `Ask:` on the first line that carries any text.
function hasAskLine(body) {
	const lines = String(body || '').split('\n');
	const first = lines.findIndex((l) => l.trim() !== '' && l.trim() !== DRAFT_TAG);
	return first !== -1 && /^Ask:\s*\S/.test(lines[first].trim());
}

// Every PR the store has ever recorded, in the order `watch` should poll them:
// the ones this reviewer drafted on first, since those are the threads someone is
// most likely answering.
function watchTargets(entries) {
	const rows = Array.isArray(entries) ? entries : Object.values(entries || {});
	const order = {drafted: 0, submitted: 1, declined: 2};
	return rows
		.filter((r) => r && r.key)
		.slice()
		.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
		.map((r) => r.key);
}

// GitHub's comment ids climb, so one high-water mark per surface separates a new
// comment from a seen one without storing every id. The mark advances past
// filtered-out comments too - a bot or self comment is seen, just not surfaced -
// so a later pass does not re-examine it.
function unseenComments(comments, watermark, {myLogin, includeBots} = {}) {
	const mark = Number(watermark) || 0;
	const fresh = [];
	let next = mark;
	for (const c of comments || []) {
		const id = Number(c && c.id) || 0;
		if (id > next) next = id;
		if (id <= mark) continue;
		if (c.isBot && !includeBots) continue;
		if (myLogin && c.user === myLogin) continue;
		fresh.push(c);
	}
	fresh.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
	return {fresh, watermark: next};
}

// A first pass has no marks, so surfacing months of history would bury the new
// comment the watch exists to catch. Seed the marks instead and report nothing.
function isFirstWatch(entry) {
	return !entry || Object.keys(entry).length === 0;
}

// One pass over the watched PRs. A PR that throws becomes a result carrying the
// error, never an end to the pass - the whole point of a watch is that the PR
// nobody can reach does not silence the five that can be. Reporting is wrapped
// for the same reason: a formatting bug must not cost the remaining PRs.
function watchPass(targets, pollOne, onResult) {
	const results = [];
	for (const key of targets || []) {
		let res;
		try {
			res = pollOne(key);
		} catch (err) {
			res = {key, error: err instanceof Error ? err.message : String(err)};
		}
		results.push(res);
		if (onResult) {
			try {
				onResult(res);
			} catch (err) {
				results[results.length - 1] = {...res, reportError: String(err)};
			}
		}
	}
	return {
		results,
		failed: results.filter((r) => r && r.error).length,
		fresh: results.reduce((n, r) => n + ((r && r.fresh) || []).length, 0),
	};
}

function ledgerLine({at, key, url, status, weight, finding}) {
	const cells = [at || '', key || '', status || '', weight || '', (finding || '').replace(/\s+/g, ' ').trim(), url || ''];
	return `| ${cells.join(' | ')} |`;
}

module.exports = {
	DRAFT_TAG,
	ACTIONABLE,
	parsePrRef,
	parseStateMd,
	renderStateMd,
	upsertState,
	classifyPr,
	isActionable,
	sortQueue,
	summarize,
	hasDraftTag,
	hasAskLine,
	watchTargets,
	unseenComments,
	isFirstWatch,
	watchPass,
	ledgerLine,
};
