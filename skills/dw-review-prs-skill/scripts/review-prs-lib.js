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
// `sources` says why a PR is in the queue: 'requested' (review requested of me),
// 'reviewed' (I have a review on it), 'commented' (I only took part in a thread).
function hasSource(pr, source) {
	return Array.isArray(pr.sources) && pr.sources.includes(source);
}

// What "I already reviewed this head" resolves to. `reviewed` on its own hid three
// different situations: the author answered and it is back with me, nobody ever
// decided, and someone's CHANGES_REQUESTED still stands.
function settledStatus(pr) {
	if (pr.authorRepliedSinceMyReview) {
		return {status: 'answered', reason: 'the author replied after your review'};
	}
	if (pr.approvedByAnyone) {
		return {status: 'reviewed', reason: 'reviewed and approved'};
	}
	if (pr.changesRequestedStands) {
		return {status: 'changes-requested', reason: 'changes requested and not yet resolved'};
	}
	return {status: 'undecided', reason: 'you reviewed it and nobody has approved it'};
}

function classifyPr(pr, state) {
	if (!pr.isOpen) {
		// Only reachable for a PR the store still records as carrying drafts: those are
		// retained past the search window, so say what clears it rather than repeating
		// the same dead line every run.
		if (hasSource(pr, 'tracked')) {
			return {status: 'closed', reason: 'closed while the store still records drafts - clear it with state-set'};
		}
		return {status: 'closed', reason: 'PR is no longer open'};
	}
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
	// Checked after the drafts: an author who reopens a PR as WIP does not release the
	// pending-review slot, so submitting or dropping those drafts still comes first.
	if (pr.isDraft) {
		return {status: 'not-ready', reason: 'the author has it back in draft'};
	}

	const submitted = Array.isArray(pr.submittedShas) ? pr.submittedShas : [];
	if (pr.headSha && submitted.includes(pr.headSha)) {
		return settledStatus(pr);
	}
	// The store is consulted before the older submitted SHAs: a run that reviewed this
	// exact head and found nothing new records it here without publishing a review, and
	// treating that as "pushed to since your last review" re-delivers work already done.
	if (state && pr.headSha && state.sha === pr.headSha && state.status === 'submitted') {
		return settledStatus(pr);
	}
	if (state && pr.headSha && state.sha === pr.headSha && state.status === 'declined') {
		return {status: 'skip', reason: 'declined at this head'};
	}
	if (submitted.length > 0) {
		return {status: 'needs-draft', reason: 'pushed to since your last submitted review'};
	}
	// Taking part in someone's thread is not a review request. Such a PR stays visible
	// so a reply to it can still be noticed, but it never becomes work on its own.
	if (Array.isArray(pr.sources) && pr.sources.length > 0 && !hasSource(pr, 'requested')) {
		return {status: 'watching', reason: 'you took part, but review was never requested of you'};
	}
	return {status: 'needs-draft', reason: 'no review from you yet'};
}

// Statuses the reviewer has to act on, in the order they should be reported.
const ACTIONABLE = ['draft-waiting', 'answered', 'needs-draft', 'draft-empty'];

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

// `watchTargets` only ever yields PRs the store has already recorded, so a PR whose
// review was requested since the last run cannot reach the watch through it. The queue
// sweep covers that gap, and this decides which of its rows are worth reporting: an
// actionable row is new when the reviewer has not been shown it at this status and head.
// Keying on status+head rather than key alone means a PR that is pushed to, or that moves
// needs-draft -> answered, surfaces again, while a quiet actionable PR stays quiet.
function unseenQueueRows(rows, seen) {
	const next = {...(seen || {})};
	const fresh = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		if (!row || !row.key || !isActionable(row.status)) continue;
		const stamp = `${row.status}@${row.headSha || 'unknown'}`;
		if (next[row.key] === stamp) continue;
		next[row.key] = stamp;
		fresh.push(row);
	}
	// A row that left the actionable set is forgotten, so returning to it later reports.
	const live = new Set((Array.isArray(rows) ? rows : []).filter((r) => r && isActionable(r.status)).map((r) => r.key));
	for (const key of Object.keys(next)) {
		if (!live.has(key)) delete next[key];
	}
	return {fresh, seen: next};
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

// The ledger is append-only markdown; read it back so the dashboard can show what
// was drafted per PR without re-deriving it from GitHub.
function parseLedger(text) {
	const rows = [];
	for (const line of String(text || '').split('\n')) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line.split('|').slice(1, -1).map((c) => c.trim());
		if (cells.length < 5) continue;
		const [at, key, status, weight, finding, url] = cells;
		if (at === 'when' || /^-+$/.test(at)) continue;
		if (!parsePrRef(key || '')) continue;
		rows.push({at, key, status, weight, finding, url: url || ''});
	}
	return rows;
}

const LANES = ['needs-you', 'waiting-author', 'delegated', 'done'];

// Which lane a PR sits in when the reviewer has not named one: an unsubmitted draft
// is the only thing that strictly needs a human click, a declined PR belongs to
// someone else's routine, and a merged or closed PR is history.
function defaultLane(pr) {
	if (Number(pr.pendingDrafts) > 0) return 'needs-you';
	if (pr.storeStatus === 'declined') return 'delegated';
	if (pr.prState && pr.prState !== 'open') return 'done';
	return 'waiting-author';
}

// Live PR facts + the ledger + the reviewer's own "next step" prose, merged into what
// the dashboard renders. Pure, so the shape is testable without gh or a browser.
function dashboardModel({prs, ledger, actions, generatedAt} = {}) {
	const byKey = {};
	for (const row of parseLedger_(ledger)) {
		(byKey[row.key] = byKey[row.key] || []).push(row);
	}
	const acts = (actions && actions.prs) || {};
	const cards = (prs || []).map((pr) => {
		const act = acts[pr.key] || {};
		const comments = (byKey[pr.key] || []).filter((r) => r.weight !== 'none' || r.status === 'dropped');
		return {
			...pr,
			lane: LANES.includes(act.lane) ? act.lane : defaultLane(pr),
			next: typeof act.next === 'string' && act.next.trim() ? act.next.trim() : '',
			// Short imperative for the one button in the next-step box ("Approve the PR").
			cta: typeof act.cta === 'string' ? act.cta.trim() : '',
			notes: Array.isArray(act.notes) ? act.notes.filter((n) => typeof n === 'string') : [],
			comments,
			ledgerCount: (byKey[pr.key] || []).length,
		};
	});
	const rank = Object.fromEntries(LANES.map((l, i) => [l, i]));
	cards.sort((a, b) => (rank[a.lane] - rank[b.lane]) || a.key.localeCompare(b.key));
	const counts = Object.fromEntries(LANES.map((l) => [l, cards.filter((c) => c.lane === l).length]));
	return {
		generatedAt: generatedAt || '',
		cards,
		counts,
		lanes: LANES,
		needsYou: cards.filter((c) => c.lane === 'needs-you').length,
		missingNext: cards.filter((c) => !c.next).map((c) => c.key),
		// A card with no CTA has no button, so the reviewer cannot hand that decision
		// back. Reported so a run cannot leave one silently blank. A card with drafts
		// waiting gets the submit-resolution buttons instead, so it needs no `cta`.
		missingCta: cards.filter((c) => c.next && !c.cta && !(Number(c.pendingDrafts) > 0)).map((c) => c.key),
	};
}

// parseLedger accepts either raw text or already-parsed rows, so a caller that
// already read the file does not parse it twice.
function parseLedger_(ledger) {
	if (Array.isArray(ledger)) return ledger;
	return parseLedger(ledger);
}

function ledgerLine({at, key, url, status, weight, finding}) {
	const cells = [at || '', key || '', status || '', weight || '', (finding || '').replace(/\s+/g, ' ').trim(), url || ''];
	return `| ${cells.join(' | ')} |`;
}

module.exports = {
	DRAFT_TAG,
	settledStatus,
	hasSource,
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
	unseenQueueRows,
	unseenComments,
	isFirstWatch,
	watchPass,
	parseLedger,
	defaultLane,
	dashboardModel,
	LANES,
	ledgerLine,
};
