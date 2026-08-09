'use strict';

// Pure decision logic for dw-review-prs: PR refs, state file, and queue
// classification. No I/O and no gh calls - the CLI fetches, this decides.

// The comment signature - which side wrote it, and whether it was for a person - is shared with
// dw-pr-ready, which has to read it identically. Source: utils/agent-tags.js.
const {REVIEW_TAG, AUTHOR_TAG, LEGACY_TAGS, signature, signedSide} = require('./_shared-agent-tags.js');
const DRAFT_TAG = REVIEW_TAG;

// agents and a human are all writing in it.
//
// The old tag was `[dev-ai]`, which named "an AI" and not a side - and that genericness is what
// broke: the PR-babysitting skill, acting FOR the author, signed the reviewer's tag, so the
// distinction the tag exists to carry was gone. These two are parallel on purpose, so picking
// the wrong one reads as wrong.
// Recognised on read only, never emitted: comments already on PRs and rows already in the
// ledger carry it, and a later run still has to know they were ours.
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
	// An own PR is classified exactly like anyone else's - same statuses, same lifecycle - so
	// it earns the same review rather than a glance. `authoredByMe` rides on the row instead
	// of becoming a status, because whose PR it is and what state the review is in are two
	// different facts. The only mechanical difference is that GitHub refuses to let you
	// APPROVE your own PR; a pending review and a COMMENT submit are both allowed.
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
	// Your own PR is never this: nobody requests review of you on it, and that absence is
	// not a signal that it needs less review than anyone else's.
	if (!pr.authoredByMe && Array.isArray(pr.sources) && pr.sources.length > 0 && !hasSource(pr, 'requested')) {
		return {status: 'watching', reason: 'you took part, but review was never requested of you'};
	}
	return {status: 'needs-draft', reason: 'no review from you yet'};
}

// authors.json -> a lookup of per-author review instructions. Case-insensitive, because
// GitHub logins are and a config typed with the wrong case would silently do nothing. A bare
// string is shorthand for {instructions: "..."} so the common case stays one line.
function normalizeAuthorNotes(raw) {
	const out = new Map();
	for (const [login, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
		if (typeof login !== 'string' || !login.trim()) continue;
		const notes = typeof value === 'string' ? {instructions: value} : value;
		if (notes && typeof notes === 'object' && !Array.isArray(notes)) out.set(login.toLowerCase(), notes);
	}
	return out;
}

// Handed to whichever agent is doing the work on the PR. Deliberately says nothing about the
// change itself: the comments on the PR are the brief, and duplicating them here would create a
// second copy to drift. All it establishes is where to look and how to talk back.
function authorHandoffPrompt(pr) {
	const url = (pr && pr.url) || (pr && pr.filesUrl ? String(pr.filesUrl).replace(/\/files$/, '') : '');
	return [
		`There are review comments waiting on ${url}`,
		'',
		'Read every comment on that pull request and act on it. The comments are the brief - work from',
		'them, not from anything I tell you here. Everything you need to say back goes on the PR too:',
		'',
		'**Replying**',
		'',
		'- Answer inside the thread the comment is in, so the answer sits with what it answers.',
		`- Start every comment you write with \`${AUTHOR_TAG}\`, then your text. That tag marks you as the`,
		'  agent acting for the PR author.',
		`- If a comment is for the reviewing agent rather than for a person, sign it`,
		`  \`${AUTHOR_TAG.slice(0, -1)} | internal]\` instead. Those are cleared once both sides agree they are`,
		'  done; anything addressed to a human is kept.',
		`- Comments starting with \`${DRAFT_TAG}\` come from the reviewing agent. Comments with no tag are`,
		'  from a human, and a human is the deciding voice when the two disagree.',
		'- Leave threads unresolved, and do not reply to bot comments.',
		'',
		'**Pushing back is expected.** If a comment is wrong, say so in its thread with the evidence -',
		'the file and line, what the code actually does, what you ran. A finding you can refute should be',
		'refuted rather than quietly applied. If a comment is right, make the change and reply saying what',
		'you changed.',
		'',
		'Nothing needs to come back to me outside the PR.',
	].join('\n');
}

// Which comments a convergence cleanup may remove from your own PR.
//
// Three guards, and they are the whole point of doing this in code rather than by eye:
// the PR must be yours, every candidate must be authored by you, and a comment nobody else
// replied under is left alone. That last one is what stops a cleanup from deleting an ask that
// was never answered - the thread reads quiet either way, so "no reply" is the signal that the
// conversation did not finish rather than that it did.
//
// Other people's comments are never candidates, at any tag, under any agreement. The protocol
// is an agreement between your own agents about your own words.
function cleanupCandidates({prAuthor, me, comments} = {}) {
	const reason = (r) => ({eligible: [], unanswered: [], others: 0, blocked: r});
	if (!prAuthor || !me) return reason('missing pr author or viewer');
	if (prAuthor !== me) return reason(`not your PR - authored by ${prAuthor}`);

	const rows = Array.isArray(comments) ? comments : [];
	const mine = rows.filter((c) => c && c.author === me);
	const others = rows.filter((c) => c && c.author !== me);
	// A reply from someone else under a root means that root was part of a real exchange; the
	// roots nobody answered are the ones still owed something.
	const answeredRoots = new Set(
		others.map((c) => c.inReplyTo || c.id).filter((id) => id !== undefined && id !== null),
	);
	// Two classes of removable, because what proves a thread finished differs by who was in it.
	//
	// A thread only the agents used has no third party to reply, so "someone answered" can never
	// fire there and the old rule would have kept agent chatter forever. What settles those is the
	// two sides agreeing. A thread a person wrote in still needs their reply as the proof, and
	// only the owner may clear it.
	// Three classes, decided by what the writer declared rather than by thread shape.
	//
	// `| internal` is agent-to-agent by declaration and was never for a person, so agreement
	// between the two sides clears it. This replaced inferring it from the thread: "no human has
	// replied" reads identically to "a human was addressed and has not answered yet", and on a
	// live PR that inference offered an agent's message to a reviewer for deletion.
	const internal = [];
	const answered = [];
	const unanswered = [];
	for (const c of mine) {
		const root = c.inReplyTo || c.id;
		if (signature(c.body).internal) internal.push(c);
		else if (answeredRoots.has(root)) answered.push(c);
		else unanswered.push(c);
	}
	// `eligible` is the owner-scoped set - everything a full authorization may remove.
	return {eligible: [...internal, ...answered], internal, answered, unanswered, others: others.length, blocked: null};
}

// Pending drafts the cleanup can drop: every one but the newest on each thread.
//
// A cleanup that only looks at published comments reports "0 removable" while a pile of
// superseded drafts sits on the PR - they are unpublished, so nothing else surfaces them either.
// Supersession is the one thing that IS computable here: two of your drafts on one thread means
// the older one was rewritten rather than answered, which is exactly how "Agreed, this comes out"
// ends up shipping alongside "Done in <sha>".
//
// Grouped by the thread a draft belongs to - its in-reply-to when it joins one, otherwise the
// line it opens. Order is the tiebreak, so a draft with no timestamp still resolves.
// `outer` marks a draft that answers a human: someone else is in its thread and waiting. Those
// are never proposed for removal however stale they look, because the cost is asymmetric - a
// superseded inner draft is clutter between two of your own agents, while a dropped outer draft
// is a reply a person is still waiting for, and nothing afterwards shows it went missing.
function supersededDrafts(drafts) {
	const all = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
	const rows = all.filter((d) => !d.outer);
	const byThread = new Map();
	rows.forEach((d, i) => {
		const key = d.inReplyTo ? `r:${d.inReplyTo}` : `l:${d.path || ''}:${d.line ?? ''}`;
		if (!byThread.has(key)) byThread.set(key, []);
		byThread.get(key).push({...d, _i: i});
	});
	const superseded = [];
	for (const group of byThread.values()) {
		if (group.length < 2) continue;
		const ordered = [...group].sort((a, b) => {
			const at = Date.parse(a.createdAt || '') || 0;
			const bt = Date.parse(b.createdAt || '') || 0;
			return at - bt || a._i - b._i;
		});
		// Keep the last: it is the one that says what the author currently means.
		superseded.push(...ordered.slice(0, -1).map(({_i, ...d}) => d));
	}
	return superseded;
}

// Whose thread is it. A draft is outer when a human other than you has written in the thread it
// replies to; a draft opening a fresh thread is inner, since nobody is in it yet. Bots do not
// count - we never reply to them, so a bot-rooted thread is not an exchange with a person.
function isOuterDraft(draft, threadAuthors, me) {
	const root = draft && draft.inReplyTo;
	if (!root) return false;
	const authors = (threadAuthors && threadAuthors[root]) || [];
	return authors.some((a) => a && a.login !== me && !a.isBot);
}

// Does the cleanup have authorization, and from whom.
//
// The trigger lives on the PR as free text - "cleanup the PR from agents comments", or whatever
// wording the moment produced - so recognising it is judgment and stays in prose. What is checked
// here is the part judgment gets wrong: WHO said it. The agent names the comment it read as the
// trigger, and this decides whether that comment could authorize anything.
//
// The owner's own comment is enough on its own. Two agent comments, one from each side, also
// count - that is the sides agreeing the exchange is over. Anyone else saying "clean this up" is
// a person making a suggestion in a thread, not an instruction to delete the owner's words, and a
// bot saying it is not even that.
function cleanupAuthorization(triggers, {prAuthor, me} = {}) {
	const rows = (Array.isArray(triggers) ? triggers : []).filter(Boolean);
	if (!rows.length) return {authorized: false, why: 'no trigger comment named'};

	// Untagged is the tell. Both agents post under the owner's account, so author identity alone
	// cannot separate "the owner said so" from "the owner's agent said so" - and treating an
	// agent's suggestion as the owner's instruction would let the agents authorize themselves.
	// The human is the one who signs nothing, which is what the tag scheme already means.
	// What each authorization is allowed to reach. The owner speaks for the whole PR. The two
	// agents agreeing speaks only for threads they had to themselves - agreement between them
	// says nothing about a thread a person is in, and that is the one the owner must rule on.
	const owner = rows.find(
		(t) => t.author && t.author === prAuthor && t.author === me && !t.isBot && tagSide(t.body) === null,
	);
	if (owner) {
		return {authorized: true, by: 'owner', scope: 'all', comments: [owner], why: `${owner.author} asked for it on the PR`};
	}

	const sides = new Map();
	for (const t of rows) {
		if (t.isBot) continue;
		const side = tagSide(t.body);
		if (side && !sides.has(side)) sides.set(side, t);
	}
	if (sides.size >= 2) {
		return {
			authorized: true,
			by: 'both-sides',
			scope: 'internal-only',
			comments: [...sides.values()],
			why: 'both review sides agreed - limited to comments marked internal',
		};
	}
	const outsider = rows.find((t) => t.author && t.author !== prAuthor);
	if (outsider) {
		return {authorized: false, why: `${outsider.author} is not the PR owner - only the owner can authorize removing their comments`};
	}
	return {authorized: false, why: `only the ${[...sides.keys()][0] || 'one'} side asked - needs the owner, or the other side too`};
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
	// A signature opening the body counts, including the `| internal` form, which contains none
	// of the bare tags as a substring.
	if (signature(body).side) return true;
	const text = String(body || '');
	return [REVIEW_TAG, AUTHOR_TAG, ...LEGACY_TAGS].some((t) => text.includes(t));
}

// Which side signed it, for a run reading a thread back. Null means a human wrote it, and an
// untagged comment is the deciding voice precisely because people do not sign.
function hasDraftTag(body) {
	// A signature opening the body counts, including the `| internal` form, which contains none
	// of the bare tags as a substring.
	if (signature(body).side) return true;
	const text = String(body || '');
	return [REVIEW_TAG, AUTHOR_TAG, ...LEGACY_TAGS].some((t) => text.includes(t));
}

// Which side signed it, for a run reading a thread back. Null means a human wrote it, and an
// untagged comment is the deciding voice precisely because people do not sign.
// A tag only counts as a signature when it OPENS the comment, which is where both agents put it.
// Matching anywhere would let a human quoting "[dev-review-ai]" in a question be mistaken for the
// agent that wrote it, and that comment is exactly the one worth surfacing.
function tagSide(body) {
	const text = String(body || '');
	if (text.includes(REVIEW_TAG) || text.includes('[dev-ai]')) return 'review';
	if (text.includes(AUTHOR_TAG) || text.includes('[author-ai]')) return 'author';
	return null;
}

// The author reads one line and knows what closes the thread, so the ask leads
// every body: the tag, then `Ask:` on the first line that carries any text.
function hasAskLine(body) {
	const lines = String(body || '').split('\n');
	// Skip the signature by PARSING it, not by matching one of the bare tags: a signature
	// carrying `| internal` equals none of them, so it was read as the first content line and
	// the gate rejected every internally-signed review comment - the marker was unusable from
	// the one side that has to lead with an ask.
	const first = lines.findIndex((l) => l.trim() !== '' && !signature(l).side);
	return first !== -1 && /^Ask:\s*\S/.test(lines[first].trim());
}

// Every PR the store has ever recorded, in the order `watch` should poll them:
// the ones this reviewer drafted on first, since those are the threads someone is
// most likely answering.
// `extra` carries the keys the last queue sweep saw. Without it the watch could only poll
// PRs the store had already recorded, which leaves out the reviewer's own PRs - nothing is
// ever drafted on those first, so they never reach state.md, and a review left on one would
// never surface.
function watchTargets(entries, extra) {
	const rows = Array.isArray(entries) ? entries : Object.values(entries || {});
	const order = {drafted: 0, submitted: 1, declined: 2};
	const keys = rows
		.filter((r) => r && r.key)
		.slice()
		.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
		.map((r) => r.key);
	const seen = new Set(keys);
	for (const key of Array.isArray(extra) ? extra : []) {
		if (key && !seen.has(key)) {
			seen.add(key);
			keys.push(key);
		}
	}
	return keys;
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
// What a watch reports. The filter is by SIGNATURE, not by author, because both agents post under
// the watcher's own account: filtering on login silenced the human's own comments on their own PR
// - drafts included - which is the one channel they have to talk to the agent there.
//
// Skipped: this side's own output, which is echo. Reported: anything unsigned, whoever wrote it,
// including the watcher's own human; and the OTHER side's comments, so a message from the author's
// agent reaches the reviewing watcher and back.
function unseenComments(comments, watermark, {ownSide, includeBots} = {}) {
	const mark = Number(watermark) || 0;
	const fresh = [];
	let next = mark;
	for (const c of comments || []) {
		const id = Number(c && c.id) || 0;
		if (id > next) next = id;
		if (id <= mark) continue;
		if (c.isBot && !includeBots) continue;
		if (ownSide && signedSide(c.body) === ownSide) continue;
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
			// Only your own PR gets one: it is the card where the next move is someone else
			// doing the work, so the page's job is to hand that person a brief.
			handoffPrompt: pr.mine ? authorHandoffPrompt(pr) : '',
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
	REVIEW_TAG,
	AUTHOR_TAG,
	LEGACY_TAGS,
	tagSide,
	signedSide,
	signature,
	cleanupCandidates,
	supersededDrafts,
	isOuterDraft,
	cleanupAuthorization,
	authorHandoffPrompt,
	settledStatus,
	hasSource,
	ACTIONABLE,
	parsePrRef,
	parseStateMd,
	renderStateMd,
	upsertState,
	classifyPr,
	normalizeAuthorNotes,
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
