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
	ledgerLine,
};
