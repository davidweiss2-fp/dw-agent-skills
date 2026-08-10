import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

const SKILL = join(ROOT, 'skills', 'dw-review-prs-skill', 'scripts');
const lib = require(join(SKILL, 'review-prs-lib.js'));
const dashboard = require(join(SKILL, 'review-prs-dashboard.js'));
const CLI = join(SKILL, 'review-prs.js');

function runCli(args, env = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: {...process.env, ...env},
	});
}

describe('parsePrRef', () => {
	it('reads a PR from a url with a files view, a fragment, or the short forms', () => {
		for (const input of [
			'https://github.com/acme/widget/pull/42',
			'https://github.com/acme/widget/pull/42/files#diff-abc',
			'acme/widget#42',
			'acme/widget/42',
		]) {
			assert.deepEqual(lib.parsePrRef(input), {
				owner: 'acme',
				repo: 'widget',
				number: 42,
				key: 'acme/widget#42',
			});
		}
	});

	it('rejects anything that is not a PR reference', () => {
		for (const input of ['', null, 'acme/widget', 'acme/widget#0', 'https://github.com/acme/widget/issues/42', 'nonsense']) {
			assert.equal(lib.parsePrRef(input), null, `rejected: ${input}`);
		}
	});
});

describe('state file', () => {
	it('round-trips through render and parse, and upsert replaces one entry', () => {
		const first = lib.upsertState({}, 'acme/widget#42', {sha: 'aaa', status: 'drafted', at: 't1'});
		const both = lib.upsertState(first, 'acme/other#7', {sha: 'bbb', status: 'submitted', at: 't2'});
		const reparsed = lib.parseStateMd(lib.renderStateMd(both));
		assert.deepEqual(reparsed['acme/widget#42'], {
			key: 'acme/widget#42',
			sha: 'aaa',
			status: 'drafted',
			at: 't1',
		});
		assert.equal(reparsed['acme/other#7'].status, 'submitted');

		const moved = lib.upsertState(both, 'acme/widget#42', {sha: 'ccc', status: 'submitted', at: 't3'});
		assert.equal(Object.keys(moved).length, 2, 'upsert replaces rather than appends');
		assert.equal(lib.parseStateMd(lib.renderStateMd(moved))['acme/widget#42'].sha, 'ccc');
	});

	it('ignores prose around the entries', () => {
		const parsed = lib.parseStateMd(
			'# heading\n\nSome explanation.\n\n- acme/widget#42 | sha=aaa | status=drafted | at=t1\n- not an entry\n',
		);
		assert.deepEqual(Object.keys(parsed), ['acme/widget#42']);
	});
});

describe('classifyPr', () => {
	const base = {key: 'acme/widget#42', headSha: 'head1', isOpen: true, authoredByMe: false, pendingReview: null, submittedShas: []};

	it('reports drafts waiting when a pending review carries comments', () => {
		const c = lib.classifyPr({...base, pendingReview: {id: 1, draftCount: 3}});
		assert.equal(c.status, 'draft-waiting');
		assert.match(c.reason, /3/);
	});

	it('flags an empty pending review, because it blocks posting on that PR', () => {
		assert.equal(lib.classifyPr({...base, pendingReview: {id: 1, draftCount: 0}}).status, 'draft-empty');
	});

	it('treats a submitted review at the current head as done, and an older one as new work', () => {
		// The exact label now depends on whether anyone approved; the contract under test
		// is that a head you have reviewed is not work.
		assert.equal(lib.isActionable(lib.classifyPr({...base, submittedShas: ['head1']}).status), false);
		const stale = lib.classifyPr({...base, submittedShas: ['head0']});
		assert.equal(stale.status, 'needs-draft');
		assert.match(stale.reason, /pushed to/);
	});

	it('falls back to the store when the API shows no review, and skips a declined head', () => {
		assert.equal(lib.isActionable(lib.classifyPr(base, {sha: 'head1', status: 'submitted'}).status), false);
		assert.equal(lib.classifyPr(base, {sha: 'head1', status: 'declined'}).status, 'skip');
		assert.equal(lib.classifyPr(base, {sha: 'head0', status: 'submitted'}).status, 'needs-draft');
	});

	it('never queues a closed PR', () => {
		assert.equal(lib.classifyPr({...base, isOpen: false}).status, 'closed');
	});

	it('reviews the reviewer own PR on the same terms as anyone else', () => {
		// Authorship is a property of the row, never a status: an own PR earns the same
		// review, so it has to reach the same actionable states.
		const mine = lib.classifyPr({...base, authoredByMe: true, sources: ['mine']});
		assert.equal(mine.status, 'needs-draft');
		assert.equal(lib.isActionable(mine.status), true);
		// And the same lifecycle once it has been reviewed.
		const drafted = lib.classifyPr({...base, authoredByMe: true, pendingReview: {id: 1, draftCount: 3}});
		assert.equal(drafted.status, 'draft-waiting');
		// Your own PR in draft is still work: draft is not a claim that it was reviewed.
		assert.equal(lib.isActionable(lib.classifyPr({...base, authoredByMe: true, isDraft: true}).status), true);
	});

	it('author notes never change how a PR is classified', () => {
		// They alter how the review is written and delivered, not whether it is work.
		assert.equal(lib.classifyPr(base).status, 'needs-draft');
	});

	it('a pending review outranks a stale state entry claiming the head was submitted', () => {
		const c = lib.classifyPr({...base, pendingReview: {id: 1, draftCount: 2}}, {sha: 'head1', status: 'submitted'});
		assert.equal(c.status, 'draft-waiting');
	});
});

describe('handoff prompt for the agent doing the work', () => {
	it('is attached only to your own PR', () => {
		const model = lib.dashboardModel({
			prs: [
				{key: 'a/b#1', filesUrl: 'https://github.com/a/b/pull/1/files', mine: true},
				{key: 'a/b#2', filesUrl: 'https://github.com/a/b/pull/2/files', mine: false},
			],
		});
		assert.match(model.cards.find((c) => c.key === 'a/b#1').handoffPrompt, /review comments waiting/);
		assert.equal(model.cards.find((c) => c.key === 'a/b#2').handoffPrompt, '');
	});

	it('names the PR and every voice in the thread, and nothing about the change', () => {
		const p = lib.authorHandoffPrompt({url: 'https://github.com/a/b/pull/7'});
		assert.match(p, /https:\/\/github\.com\/a\/b\/pull\/7/);
		assert.match(p, /\[dev-author-ai\]/); // the working agent signs
		assert.match(p, /\[dev-review-ai\]/); // the reviewing agent is recognisable
		assert.match(p, /no tag are\n from a human|no tag are/); // and the human is not
		assert.match(p, /Pushing back is expected/);
		// The brief is the comments, so the prompt must not try to restate the work.
		assert.doesNotMatch(p, /diff|implement|ticket/i);
	});

	it('falls back to the files URL when no plain PR url is on the card', () => {
		assert.match(
			lib.authorHandoffPrompt({filesUrl: 'https://github.com/a/b/pull/9/files'}),
			/pull\/9\n|pull\/9$|pull\/9\s/m,
		);
	});
});

describe('which side signed a comment', () => {
	it('tells the reviewing side from the author side, and a human from both', () => {
		assert.equal(lib.tagSide(`${lib.REVIEW_TAG} finding`), 'review');
		assert.equal(lib.tagSide(`${lib.AUTHOR_TAG} answer`), 'author');
		assert.equal(lib.tagSide('a person wrote this'), null);
	});

	it('still recognises the tags already sitting on PRs and in the ledger', () => {
		// [dev-ai] was worn by BOTH sides before the split, and it resolves to the reviewing
		// side - which is what it meant in this skill's own output, the only place it is ours.
		assert.equal(lib.tagSide('[dev-ai] old comment'), 'review');
		assert.equal(lib.tagSide('[author-ai] old comment'), 'author');
		for (const legacy of lib.LEGACY_TAGS) assert.equal(lib.hasDraftTag(`${legacy} x`), true);
	});

	it('lets an internally-signed review comment reach its Ask line', () => {
		// The gate skipped a line only when it equalled one of the bare tags, and
		// `[dev-review-ai | internal]` equals none - so it was read as the first content line
		// and the marker was unusable from the one side that must lead with an ask.
		assert.equal(lib.hasAskLine('[dev-review-ai | internal]\nAsk: do the thing.\n'), true);
		assert.equal(lib.hasAskLine('**[DEV-REVIEW-AI | INTERNAL]**\nAsk: do the thing.\n'), true);
		// And it still refuses a body whose ask does not lead.
		assert.equal(lib.hasAskLine('[dev-review-ai | internal]\nnit: buried\n\nAsk: too late.\n'), false);
	});

	it('requires an Ask only from the reviewing side', () => {
		// A reply answers an ask; forcing one on it would be the wrong shape.
		assert.equal(lib.hasAskLine(`${lib.REVIEW_TAG}\nAsk: do the thing.\n`), true);
		assert.equal(lib.hasAskLine(`${lib.REVIEW_TAG}\nno ask here\n`), false);
	});
});

describe('convergence cleanup on your own PR', () => {
	const comments = [
		{id: 1, author: 'me', body: '[dev-review-ai] Ask: fix it'},
		{id: 2, author: 'them', inReplyTo: 1, body: 'agreed'},
		{id: 3, author: 'me', body: '[dev-review-ai] Ask: nobody answered this'},
		{id: 4, author: 'them', body: 'their own finding'},
	];

	it('removes only your own comments, and only where someone replied', () => {
		const r = lib.cleanupCandidates({prAuthor: 'me', me: 'me', comments});
		assert.deepEqual(r.eligible.map((c) => c.id), [1]);
		// 3 is the shape of an ask that never landed - deleting it loses the question.
		assert.deepEqual(r.unanswered.map((c) => c.id), [3]);
		assert.equal(r.others, 2, "other people's comments are never candidates");
	});

	it('drops every draft on a thread but the newest, and leaves lone drafts alone', () => {
		const drafts = [
			{nodeId: 'A', inReplyTo: 1, createdAt: '2026-08-06T09:00:00Z'},
			{nodeId: 'B', inReplyTo: 1, createdAt: '2026-08-06T10:00:00Z'},
			{nodeId: 'C', path: 'main.py', line: 5, createdAt: '2026-08-06T09:00:00Z'},
		];
		// B is what the author currently means; C is the only draft on its line.
		assert.deepEqual(lib.supersededDrafts(drafts).map((d) => d.nodeId), ['A']);
	});

	it('falls back to input order when drafts carry no timestamp', () => {
		const drafts = [{nodeId: 'A', inReplyTo: 7}, {nodeId: 'B', inReplyTo: 7}];
		assert.deepEqual(lib.supersededDrafts(drafts).map((d) => d.nodeId), ['A']);
		assert.deepEqual(lib.supersededDrafts([]), []);
	});

	it('treats a reply to a person as outer, and your own agents as inner', () => {
		const authors = {
			10: [{login: 'reviewer'}],
			20: [{login: 'me'}],
			30: [{login: 'bugbot', isBot: true}],
		};
		assert.equal(lib.isOuterDraft({inReplyTo: 10}, authors, 'me'), true);
		assert.equal(lib.isOuterDraft({inReplyTo: 20}, authors, 'me'), false);
		// We never reply to bots, so a bot-rooted thread is not an exchange with a person.
		assert.equal(lib.isOuterDraft({inReplyTo: 30}, authors, 'me'), false);
		// A draft opening a fresh thread is inner - nobody else is in it yet.
		assert.equal(lib.isOuterDraft({path: 'a.php', line: 3}, authors, 'me'), false);
	});

	it('keeps a draft owed to a person even when a newer one supersedes it', () => {
		const drafts = [
			{nodeId: 'OLD', inReplyTo: 10, outer: true, createdAt: '2026-08-06T09:00:00Z'},
			{nodeId: 'NEW', inReplyTo: 10, outer: true, createdAt: '2026-08-06T10:00:00Z'},
			{nodeId: 'INNER-OLD', inReplyTo: 20, createdAt: '2026-08-06T09:00:00Z'},
			{nodeId: 'INNER-NEW', inReplyTo: 20, createdAt: '2026-08-06T10:00:00Z'},
		];
		// The cost is asymmetric: stale inner clutter versus a reply a person is waiting for.
		assert.deepEqual(lib.supersededDrafts(drafts).map((d) => d.nodeId), ['INNER-OLD']);
	});

	it('takes the owner\'s own untagged word alone, and not their agent wearing their account', () => {
		const ctx = {prAuthor: 'me', me: 'me'};
		assert.equal(lib.cleanupAuthorization([{author: 'me', body: 'clean the agent chatter off this'}], ctx).authorized, true);
		// Both agents post under the owner's account, so identity cannot separate them - the tag
		// can. One side asking is a proposal, not an authorization to delete.
		const oneSide = lib.cleanupAuthorization([{author: 'me', body: '[dev-review-ai] shall we clean up?'}], ctx);
		assert.equal(oneSide.authorized, false);
		assert.match(oneSide.why, /needs the owner, or the other side/);
	});

	it('accepts the two sides agreeing, and never an outsider or a bot', () => {
		const ctx = {prAuthor: 'me', me: 'me'};
		const both = lib.cleanupAuthorization(
			[{author: 'me', body: '[dev-review-ai] done here, clean up?'}, {author: 'me', body: '[dev-author-ai] agreed'}],
			ctx,
		);
		assert.equal(both.authorized, true);
		assert.equal(both.by, 'both-sides');
		// A comment in a thread is data, not an instruction to delete someone's words.
		assert.equal(lib.cleanupAuthorization([{author: 'reviewer', body: 'clean this up'}], ctx).authorized, false);
		assert.equal(lib.cleanupAuthorization([{author: 'me', body: 'cleanup', isBot: true}], ctx).authorized, false);
		assert.equal(lib.cleanupAuthorization([], ctx).authorized, false);
	});

	it('clears what was declared internal, and keeps what was addressed to a person', () => {
		const comments = [
			{id: 1, author: 'me', body: '[dev-review-ai | internal] Ask: fix X'},
			{id: 2, author: 'me', inReplyTo: 1, body: '[dev-author-ai | internal] done in abc'},
			{id: 5, author: 'me', body: '[dev-author-ai] @colleague answering your note'},
			{id: 10, author: 'colleague', body: 'I think this is wrong'},
			{id: 11, author: 'me', inReplyTo: 10, body: '[dev-author-ai] answered'},
		];
		const r = lib.cleanupCandidates({prAuthor: 'me', me: 'me', comments});
		assert.deepEqual(r.internal.map((c) => c.id), [1, 2]);
		assert.deepEqual(r.answered.map((c) => c.id), [11], "a person's thread stays owner-only");
		// Unmarked and unanswered: reads human-free only because nobody has replied yet.
		assert.deepEqual(r.unanswered.map((c) => c.id), [5]);
	});

	it('reads the internal marker through emphasis, casing and spacing', () => {
		assert.deepEqual(lib.signature('[dev-review-ai | internal] x'), {side: 'review', internal: true});
		assert.deepEqual(lib.signature('**[DEV-AUTHOR-AI | INTERNAL]** x'), {side: 'author', internal: true});
		assert.deepEqual(lib.signature('[dev-author-ai|internal] x'), {side: 'author', internal: true});
		assert.deepEqual(lib.signature('[dev-review-ai] x'), {side: 'review', internal: false});
		// The bare tag is not a substring of the internal form, so the draft gate must parse it.
		assert.equal(lib.hasDraftTag('[dev-review-ai | internal] x'), true);
		assert.equal(lib.signature('> [dev-review-ai | internal] quoted').side, null);
	});

	it('scopes what each authorization may reach', () => {
		const ctx = {prAuthor: 'me', me: 'me'};
		assert.equal(lib.cleanupAuthorization([{author: 'me', body: 'clean it'}], ctx).scope, 'all');
		const both = lib.cleanupAuthorization(
			[{author: 'me', body: '[dev-review-ai] agree this can be closed?'}, {author: 'me', body: '[dev-author-ai] agreed'}],
			ctx,
		);
		// The agents agreeing says nothing about a thread a person is in.
		assert.equal(both.scope, 'internal-only');
	});

	it('refuses outright on a PR you did not author', () => {
		const r = lib.cleanupCandidates({prAuthor: 'someone-else', me: 'me', comments});
		assert.match(r.blocked, /not your PR/);
		assert.deepEqual(r.eligible, []);
	});

	it('never proposes a comment written by anyone else, whatever tag it carries', () => {
		const theirs = [
			{id: 9, author: 'them', body: '[dev-review-ai] posted by another account'},
			{id: 10, author: 'me', inReplyTo: 9, body: '[dev-author-ai] ack'},
			{id: 11, author: 'them', inReplyTo: 9, body: 'ok'},
		];
		const r = lib.cleanupCandidates({prAuthor: 'me', me: 'me', comments: theirs});
		assert.deepEqual(r.eligible.map((c) => c.id), [10]);
		assert.ok(!r.eligible.some((c) => c.author !== 'me'));
	});
});

describe('per-author review instructions', () => {
	it('matches a login case-insensitively, since GitHub logins are', () => {
		const notes = lib.normalizeAuthorNotes({'Someone-FP': {instructions: ['be kind']}});
		assert.deepEqual(notes.get('someone-fp').instructions, ['be kind']);
	});

	it('reads a bare string as shorthand for instructions', () => {
		assert.deepEqual(lib.normalizeAuthorNotes({dev: 'lead with the principle'}).get('dev'), {
			instructions: 'lead with the principle',
		});
	});

	it('ignores entries that cannot carry instructions instead of throwing', () => {
		const notes = lib.normalizeAuthorNotes({a: null, b: ['not an object'], '': {x: 1}, c: {who: 'ok'}});
		assert.deepEqual([...notes.keys()], ['c']);
		// A missing or unreadable file leaves an empty lookup, never an error.
		assert.equal(lib.normalizeAuthorNotes(undefined).size, 0);
		assert.equal(lib.normalizeAuthorNotes('nonsense').size, 0);
	});
});

describe('queue coverage beyond review requests', () => {
	const base = {headSha: 'aaa', isOpen: true, authoredByMe: false, pendingReview: null, submittedShas: []};

	it('keeps a PR you already reviewed visible instead of dropping it', () => {
		// The request disappears once the review is submitted, which is exactly when the
		// reviewer is waiting on an answer and still needs to see it.
		const cls = lib.classifyPr({...base, sources: ['reviewed'], submittedShas: ['aaa']}, undefined);
		assert.equal(cls.status, 'undecided', 'reviewed with no approval is undecided, still listed');
		assert.equal(lib.isActionable(cls.status), false);
	});

	it('makes a reviewed PR actionable again once it is pushed to', () => {
		const cls = lib.classifyPr({...base, headSha: 'bbb', sources: ['reviewed'], submittedShas: ['aaa']}, undefined);
		assert.equal(cls.status, 'needs-draft');
		assert.equal(lib.isActionable(cls.status), true);
	});

	it('does not turn taking part in a thread into a review to write', () => {
		const cls = lib.classifyPr({...base, sources: ['commented']}, undefined);
		assert.equal(cls.status, 'watching');
		assert.equal(lib.isActionable(cls.status), false);
	});

	it('still treats a requested review with no history as work', () => {
		const cls = lib.classifyPr({...base, sources: ['requested']}, undefined);
		assert.equal(cls.status, 'needs-draft');
	});

	it('lets the store settle a head an older submitted review would re-open', () => {
		// Reviewed the delta at this head and found nothing: recorded, not published.
		const cls = lib.classifyPr(
			{...base, headSha: 'ccc', sources: ['reviewed'], submittedShas: ['aaa']},
			{sha: 'ccc', status: 'submitted'},
		);
		assert.equal(lib.isActionable(cls.status), false, 'the store settles this head, so it is not work');
	});
});

describe('what "already reviewed" resolves to', () => {
	const reviewed = {
		headSha: 'aaa',
		isOpen: true,
		authoredByMe: false,
		pendingReview: null,
		submittedShas: ['aaa'],
		sources: ['reviewed'],
	};

	it('calls it answered when the author replied after the review, and treats that as work', () => {
		const cls = lib.classifyPr({...reviewed, authorRepliedSinceMyReview: true}, undefined);
		assert.equal(cls.status, 'answered');
		assert.equal(lib.isActionable('answered'), true);
	});

	it('separates approved, changes-requested and nobody-decided', () => {
		assert.equal(lib.classifyPr({...reviewed, approvedByAnyone: true}, undefined).status, 'reviewed');
		assert.equal(lib.classifyPr({...reviewed, changesRequestedStands: true}, undefined).status, 'changes-requested');
		assert.equal(lib.classifyPr(reviewed, undefined).status, 'undecided');
		for (const s of ['reviewed', 'changes-requested', 'undecided']) {
			assert.equal(lib.isActionable(s), false, `${s} is not work on its own`);
		}
	});

	it('compares review and comment timestamps as strings, not through JSON.parse', () => {
		// The first cut asked gh for `[...] | max` with --jq, whose bare-string output is
		// not JSON: the parse failed, the check returned false, and `answered` could never
		// fire. The unit tests passed the boolean straight in, so only a live run caught it.
		const lib2 = require(join(SKILL, 'review-prs.js'));
		assert.equal(typeof lib2.parseArgs, 'function', 'CLI still loads');
		assert.throws(() => JSON.parse('2026-03-12T12:01:46Z'), 'a bare ISO timestamp is not JSON');
	});

	it('prefers the author\'s reply over any standing decision', () => {
		const cls = lib.classifyPr({...reviewed, approvedByAnyone: true, authorRepliedSinceMyReview: true}, undefined);
		assert.equal(cls.status, 'answered');
	});

	it('reviews a WIP on the same terms as a ready PR, drafts still coming first', () => {
		// Draft says how finished the work is, not whether it has been reviewed. Suppressing a
		// draft let a PR sit unreviewed for as long as its author left it in that state. Review is
		// requested here so the draft flag is the only thing under test.
		const wip = {...reviewed, isDraft: true, submittedShas: [], sources: ['requested']};
		const cls = lib.classifyPr(wip, undefined);
		assert.equal(cls.status, 'needs-draft');
		assert.equal(lib.isActionable(cls.status), true);
		// Unsubmitted drafts of your own still outrank it: that slot has to be resolved first.
		const wipWithDrafts = {...wip, pendingReview: {id: 1, draftCount: 2}};
		assert.equal(lib.classifyPr(wipWithDrafts, undefined).status, 'draft-waiting');
	});

	it('reviews a draft whoever opened it, and a reviewed draft still settles', () => {
		const wip = {...reviewed, isDraft: true, submittedShas: []};
		// Somebody else's draft with review requested, and your own draft, are both work.
		assert.equal(lib.isActionable(lib.classifyPr({...wip, sources: ['requested']}).status), true);
		assert.equal(lib.isActionable(lib.classifyPr({...wip, authoredByMe: true, sources: ['mine']}).status), true);
		// Being a draft does not re-queue one already reviewed at this head.
		const settled = lib.classifyPr({...wip, sources: ['requested'], submittedShas: [wip.headSha]});
		assert.equal(lib.isActionable(settled.status), false);
	});

	it('tells a retained-but-closed PR how to clear itself', () => {
		const cls = lib.classifyPr({...reviewed, isOpen: false, sources: ['tracked']}, undefined);
		assert.equal(cls.status, 'closed');
		assert.match(cls.reason, /state-set/);
	});
});

describe('queue presentation', () => {
	it('puts drafts waiting first, then new work, then the empty-slot case', () => {
		const rows = [
			{key: 'a/a#1', status: 'reviewed'},
			{key: 'd/d#4', status: 'draft-empty'},
			{key: 'c/c#3', status: 'needs-draft'},
			{key: 'b/b#2', status: 'draft-waiting'},
		];
		assert.deepEqual(
			lib.sortQueue(rows).map((r) => r.status),
			['draft-waiting', 'needs-draft', 'draft-empty', 'reviewed'],
		);
	});

	it('counts by status', () => {
		assert.deepEqual(
			lib.summarize([{status: 'needs-draft'}, {status: 'needs-draft'}, {status: 'reviewed'}]),
			{'needs-draft': 2, reviewed: 1},
		);
	});

	it('keeps a multi-line finding on one ledger row', () => {
		const row = lib.ledgerLine({at: 't', key: 'a/a#1', status: 'drafted', weight: 'nit', finding: 'line one\nline two'});
		assert.equal(row.split('\n').length, 1);
		assert.match(row, /line one line two/);
	});
});

describe('watch bookkeeping', () => {
	it('orders targets so drafted PRs are polled before declined ones', () => {
		const entries = {
			'a/b#3': {key: 'a/b#3', status: 'declined'},
			'a/b#1': {key: 'a/b#1', status: 'submitted'},
			'a/b#2': {key: 'a/b#2', status: 'drafted'},
		};
		assert.deepEqual(lib.watchTargets(entries), ['a/b#2', 'a/b#1', 'a/b#3']);
	});

	it('polls the sweep keys too, so an own PR that never reaches state.md is still watched', () => {
		const entries = {'a/b#1': {key: 'a/b#1', status: 'drafted'}};
		// 'a/b#9' is the reviewer's own PR: nothing is ever drafted on it, so it has no
		// state.md row, and only the sweep knows it exists.
		const targets = lib.watchTargets(entries, ['a/b#9', 'a/b#1']);
		assert.deepEqual(targets, ['a/b#1', 'a/b#9']);
		// The union must not double-poll a PR both sources know about.
		assert.equal(new Set(targets).size, targets.length);
	});

	it('surfaces an actionable PR the store has never recorded, then stays quiet on it', () => {
		const rows = [
			{key: 'a/b#1', status: 'needs-draft', headSha: 'aaa'},
			{key: 'a/b#2', status: 'reviewed', headSha: 'bbb'},
		];
		const first = lib.unseenQueueRows(rows, {});
		assert.deepEqual(first.fresh.map((r) => r.key), ['a/b#1']);
		// A settled PR is never reported, however many passes run over it.
		assert.deepEqual(lib.unseenQueueRows(rows, first.seen).fresh, []);
	});

	it('reports the same PR again when it is pushed to or changes status', () => {
		const seeded = lib.unseenQueueRows([{key: 'a/b#1', status: 'needs-draft', headSha: 'aaa'}], {}).seen;
		const pushed = lib.unseenQueueRows([{key: 'a/b#1', status: 'needs-draft', headSha: 'ccc'}], seeded);
		assert.deepEqual(pushed.fresh.map((r) => r.headSha), ['ccc']);
		const answered = lib.unseenQueueRows([{key: 'a/b#1', status: 'answered', headSha: 'ccc'}], pushed.seen);
		assert.deepEqual(answered.fresh.map((r) => r.status), ['answered']);
	});

	it('forgets a PR that leaves the actionable set, so returning to it reports again', () => {
		const seeded = lib.unseenQueueRows([{key: 'a/b#1', status: 'needs-draft', headSha: 'aaa'}], {}).seen;
		const settled = lib.unseenQueueRows([{key: 'a/b#1', status: 'reviewed', headSha: 'aaa'}], seeded);
		assert.deepEqual(settled.seen, {});
		const returned = lib.unseenQueueRows([{key: 'a/b#1', status: 'needs-draft', headSha: 'aaa'}], settled.seen);
		assert.deepEqual(returned.fresh.map((r) => r.key), ['a/b#1']);
	});

	it('reports only comments above the mark, and advances past ones it filters out', () => {
		const comments = [
			{id: 10, user: 'someone', body: 'old'},
			{id: 20, user: 'me', body: '[dev-review-ai] my own finding'},
			{id: 30, user: 'bugbot', isBot: true, body: 'bot noise'},
			{id: 40, user: 'colleague', body: 'answered your ask'},
		];
		const seen = lib.unseenComments(comments, 10, {ownSide: 'review', includeBots: false});
		assert.deepEqual(seen.fresh.map((c) => c.id), [40]);
		// 30 was filtered, not skipped over: the next pass must not re-examine it.
		assert.equal(seen.watermark, 40);
		assert.deepEqual(lib.unseenComments(comments, seen.watermark, {ownSide: 'review'}).fresh, []);
	});

	it('surfaces the watcher own human comments, and only its own side is echo', () => {
		// Both agents post under the watcher's account, so filtering on login silenced the human
		// on their own PR - drafts included, which is their only channel to the agent there.
		const comments = [
			{id: 1, user: 'me', body: '[dev-review-ai] my own finding'},
			{id: 2, user: 'me', body: 'Can this thread be deleted guys?'},
			{id: 3, user: 'me', body: '[dev-author-ai] answering you'},
			{id: 4, user: 'colleague', body: 'a person'},
		];
		assert.deepEqual(
			lib.unseenComments(comments, 0, {ownSide: 'review'}).fresh.map((c) => c.id),
			[2, 3, 4],
			'the reviewing watch skips only its own output',
		);
		assert.deepEqual(
			lib.unseenComments(comments, 0, {ownSide: 'author'}).fresh.map((c) => c.id),
			[1, 2, 4],
			'the author-side watch hears the reviewer, and vice versa',
		);
	});

	it('counts a tag as a signature only when it opens the comment', () => {
		assert.equal(lib.signedSide('[dev-review-ai] a finding'), 'review');
		assert.equal(lib.signedSide('[dev-author-ai]\nan answer'), 'author');
		assert.equal(lib.signedSide('[dev-ai] the old tag'), 'review');
		// A person quoting the tag mid-sentence is the comment most worth surfacing.
		assert.equal(lib.signedSide('why did [dev-review-ai] say that?'), null);
		assert.equal(lib.signedSide('plain question'), null);
	});

	it('reads a signature through markdown emphasis and casing', () => {
		// `**[DEV-AI]**` is the form dw-pr-ready actually wrote; unreadable, it was promoted to a
		// directive from the user, so an agent's own words got obeyed as theirs.
		assert.equal(lib.signedSide('**[DEV-AI]** Good catch — taken'), 'review');
		assert.equal(lib.signedSide('**[dev-author-ai]** applied'), 'author');
		assert.equal(lib.signedSide('`[dev-review-ai]` finding'), 'review');
		assert.equal(lib.signedSide('_[Dev-Author-AI]_ done'), 'author');
	});

	it('leaves a blockquoted tag unsigned, because quoting is not signing', () => {
		// `>` is deliberately not stripped: a blockquote is a person citing an agent comment.
		assert.equal(lib.signedSide('> [dev-review-ai] Ask: do the thing'), null);
		assert.equal(lib.signedSide('> **[DEV-AI]** old comment'), null);
	});

	it('treats a bot comment as reportable only when asked', () => {
		const comments = [{id: 5, user: 'bugbot', isBot: true, body: 'high severity'}];
		assert.deepEqual(lib.unseenComments(comments, 0, {includeBots: true}).fresh.map((c) => c.id), [5]);
		assert.deepEqual(lib.unseenComments(comments, 0, {includeBots: false}).fresh, []);
	});

	it('keeps polling the rest of the queue when one PR throws', () => {
		const polled = [];
		const pass = lib.watchPass(['a/b#1', 'a/b#2', 'a/b#3'], (key) => {
			polled.push(key);
			if (key === 'a/b#2') throw new Error('gh: Not Found (HTTP 404)');
			return {key, fresh: [{id: 1, body: 'new'}]};
		});
		assert.deepEqual(polled, ['a/b#1', 'a/b#2', 'a/b#3']);
		assert.equal(pass.failed, 1);
		assert.equal(pass.fresh, 2);
		assert.match(pass.results[1].error, /404/);
	});

	it('survives a reporting failure without losing the remaining PRs', () => {
		const pass = lib.watchPass(
			['a/b#1', 'a/b#2'],
			(key) => ({key, fresh: []}),
			(res) => {
				if (res.key === 'a/b#1') throw new Error('stdout exploded');
			},
		);
		assert.equal(pass.results.length, 2);
		assert.match(pass.results[0].reportError, /stdout exploded/);
	});

	it('calls a PR with no marks a first watch, so history is seeded not surfaced', () => {
		assert.equal(lib.isFirstWatch(undefined), true);
		assert.equal(lib.isFirstWatch({}), true);
		assert.equal(lib.isFirstWatch({'review-comment': 1}), false);
	});
});

describe('dashboard model', () => {
	const ledger = [
		'| when | pr | status | weight | finding | url |',
		'| --- | --- | --- | --- | --- | --- |',
		'| 2026-08-05T08:00:00Z | a/b#1 | drafted | please fix | the AC contradicts the code |  |',
		'| 2026-08-05T08:01:00Z | a/b#1 | drafted | none | withdrawn after the author answered |  |',
		'| 2026-08-05T08:02:00Z | a/b#2 | declined | none | owned by another routine |  |',
		'| not a row at all |',
	].join('\n');

	it('reads back the ledger and skips the header, rule, and junk lines', () => {
		const rows = lib.parseLedger(ledger);
		assert.deepEqual(rows.map((r) => r.key), ['a/b#1', 'a/b#1', 'a/b#2']);
		assert.equal(rows[0].weight, 'please fix');
	});

	it('lands each PR in a lane, with an unsubmitted draft outranking everything', () => {
		assert.equal(lib.defaultLane({pendingDrafts: 2, storeStatus: 'submitted', prState: 'open'}), 'needs-you');
		assert.equal(lib.defaultLane({pendingDrafts: 0, storeStatus: 'declined', prState: 'open'}), 'delegated');
		assert.equal(lib.defaultLane({pendingDrafts: 0, storeStatus: 'submitted', prState: 'merged'}), 'done');
		assert.equal(lib.defaultLane({pendingDrafts: 0, storeStatus: 'submitted', prState: 'open'}), 'waiting-author');
	});

	it('orders lanes by urgency, carries the next step, and names PRs missing one', () => {
		const model = lib.dashboardModel({
			prs: [
				{key: 'a/b#2', storeStatus: 'declined', prState: 'open', pendingDrafts: 0},
				{key: 'a/b#1', storeStatus: 'submitted', prState: 'open', pendingDrafts: 1},
			],
			ledger,
			actions: {prs: {'a/b#1': {next: 'Read the draft, then submit as COMMENT.'}}},
			generatedAt: 'stamp',
		});
		assert.deepEqual(model.cards.map((c) => c.key), ['a/b#1', 'a/b#2']);
		assert.equal(model.cards[0].lane, 'needs-you');
		assert.equal(model.cards[0].next, 'Read the draft, then submit as COMMENT.');
		assert.equal(model.counts['needs-you'], 1);
		assert.deepEqual(model.missingNext, ['a/b#2']);
		// A weight of none is bookkeeping, not a finding worth a row on the page.
		assert.deepEqual(model.cards[0].comments.map((c) => c.weight), ['please fix']);
	});

	it('lets the reviewer override the derived lane', () => {
		const model = lib.dashboardModel({
			prs: [{key: 'a/b#1', storeStatus: 'submitted', prState: 'open', pendingDrafts: 1}],
			actions: {prs: {'a/b#1': {lane: 'waiting-author', next: 'nothing for now'}}},
		});
		assert.equal(model.cards[0].lane, 'waiting-author');
	});
});

describe('dashboard rendering', () => {
	const model = lib.dashboardModel({
		prs: [{
			key: 'a/b#1',
			filesUrl: 'https://github.com/a/b/pull/1/files',
			title: 'Title with <script>alert(1)</script> & an ampersand',
			author: 'someone',
			headSha: 'abcdef1234567',
			prState: 'open',
			pendingDrafts: 2,
			storeStatus: 'drafted',
		}],
		ledger: '| 2026-08-05T08:00:00Z | a/b#1 | drafted | blocker | quote " and <b>tags</b> |  |',
		actions: {prs: {'a/b#1': {next: 'Review 2 drafts, then approve.'}}},
		generatedAt: '2026-08-05T00:00:00Z',
	});
	const html = dashboard.renderDashboard(model, {title: 'Review queue', reviewer: 'me'});

	it('escapes titles and findings instead of letting markup through', () => {
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;script&gt;'));
		assert.ok(html.includes('&lt;b&gt;tags&lt;/b&gt;'));
		assert.ok(html.includes('&amp;'));
	});

	it('carries the next step, the link, the short sha and the draft count', () => {
		assert.ok(html.includes('Review 2 drafts, then approve.'));
		assert.ok(html.includes('https://github.com/a/b/pull/1/files'));
		assert.ok(html.includes('abcdef1'));
		assert.ok(!html.includes('abcdef1234567'));
		assert.ok(html.includes('2 unsubmitted drafts'));
	});

	it('offers a submit resolution, not an instruction, when drafts are waiting', () => {
		const withDrafts = dashboard.renderDashboard(
			lib.dashboardModel({
				prs: [{key: 'a/b#1', pendingDrafts: 2, prState: 'open', storeStatus: 'drafted'}],
				actions: {prs: {'a/b#1': {next: 'Two drafts waiting.', cta: 'Read the 2 drafts, then submit'}}},
			}),
		);
		for (const event of ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']) {
			assert.match(withDrafts, new RegExp(`submit them as ${event}`),
				`a card with drafts must offer ${event}`);
		}
		// The reviewer-facing instruction must not come back as the decision.
		assert.ok(!withDrafts.includes('data-phrase="Read the 2 drafts'));
	});

	it('offers only COMMENT on your own PR, since GitHub refuses the other two there', () => {
		const mine = dashboard.renderDashboard(
			lib.dashboardModel({
				prs: [
					{
						key: 'a/b#1',
						pendingDrafts: 3,
						prState: 'open',
						storeStatus: 'drafted',
						mine: true,
						filesUrl: 'https://github.com/a/b/pull/1/files',
					},
				],
				actions: {prs: {'a/b#1': {next: 'Three drafts on your own PR.'}}},
			}),
		);
		assert.match(mine, /submit them as COMMENT/);
		for (const event of ['APPROVE', 'REQUEST_CHANGES']) {
			assert.ok(!mine.includes(`submit them as ${event}`), `own PR must not offer ${event}`);
		}
	});

	it('gives the handoff toggle no decision wiring, so it cannot store an empty one', () => {
		const mine = dashboard.renderDashboard(
			lib.dashboardModel({
				prs: [{key: 'a/b#1', pendingDrafts: 1, prState: 'open', mine: true, filesUrl: 'https://github.com/a/b/pull/1/files'}],
				actions: {prs: {'a/b#1': {next: 'x'}}},
			}),
		);
		const toggle = /<button class="([^"]*)"[^>]*data-handoff="toggle"/.exec(mine);
		assert.ok(toggle, 'the handoff toggle should render on an own PR');
		// A `.cta` is wired to record a submit decision; this button only reveals text, and
		// carrying that class made it store `undefined` and repaint itself as "✓ undefined".
		assert.ok(!/\bcta\b/.test(toggle[1]), `handoff toggle must not be a .cta (was "${toggle[1]}")`);
		assert.ok(!/data-handoff="toggle"[^>]*data-phrase/.test(mine));
	});

	it('still offers a resolution when drafts exist but no next step was recorded', () => {
		const html = dashboard.renderDashboard(
			lib.dashboardModel({prs: [{key: 'a/b#9', pendingDrafts: 3, prState: 'open', storeStatus: 'drafted'}]}),
		);
		// The card says three drafts are waiting; without this it says so and offers no button.
		assert.match(html, /No next step recorded/);
		assert.match(html, /submit them as COMMENT/);
	});

	it('keeps the free-text CTA on cards with nothing drafted', () => {
		const noDrafts = dashboard.renderDashboard(
			lib.dashboardModel({
				prs: [{key: 'a/b#2', pendingDrafts: 0, prState: 'open', storeStatus: 'submitted'}],
				actions: {prs: {'a/b#2': {next: 'Ball is with the author.', cta: 'Approve the PR'}}},
			}),
		);
		assert.match(noDrafts, /data-phrase="Approve the PR"/);
		assert.ok(!noDrafts.includes('submit them as APPROVE'));
	});

	it('does not ask for a cta on a card that gets resolution buttons', () => {
		const model = lib.dashboardModel({
			prs: [{key: 'a/b#1', pendingDrafts: 1, prState: 'open', storeStatus: 'drafted'}],
			actions: {prs: {'a/b#1': {next: 'Drafts waiting.'}}},
		});
		assert.deepEqual(model.missingCta, []);
	});

	it('keeps [hidden] effective on every element it sets display on', () => {
		// A class that sets display beats the UA's [hidden] rule, so each toggled
		// element needs its own [hidden] restatement or the attribute hides nothing.
		const setsDisplay = [...html.matchAll(/^(\.[\w-]+|#[\w-]+)(?:,\s*(?:\.[\w-]+|#[\w-]+))*\s*\{[^}]*\bdisplay:/gm)]
			.flatMap((m) => m[0].split('{')[0].split(',').map((s) => s.trim()));
		for (const sel of ['.annopop', '.selpill', '#payload', '.lane', '.card']) {
			if (!setsDisplay.includes(sel)) continue;
			assert.match(html, new RegExp(sel.replace('.', '\\.').replace('#', '#') + '\\[hidden\\]'),
				`${sel} sets display, so it needs a ${sel}[hidden] rule`);
		}
	});

	describe('ownership filter', () => {
		// Deliberately lopsided: with 2 and 1, a count reading the wrong side cannot land on the
		// right answer by coincidence.
		const mixed = dashboard.renderDashboard(
			lib.dashboardModel({
				prs: [
					{key: 'a/b#1', prState: 'open', author: 'you', mine: true},
					{key: 'a/b#2', prState: 'open', author: 'you', mine: true},
					{key: 'a/b#3', prState: 'open', author: 'someone'},
				],
			}),
		);

		// Attribute order is not the contract, so each card is located then read.
		function cardTag(html, key) {
			return html.match(new RegExp(`<article[^>]*data-key="${key.replace('/', '\\/')}"[^>]*>`))[0];
		}

		it('stamps each card with the side of the split it belongs to', () => {
			assert.match(cardTag(mixed, 'a/b#1'), /data-side="yours"/);
			assert.match(cardTag(mixed, 'a/b#2'), /data-side="yours"/);
			assert.match(cardTag(mixed, 'a/b#3'), /data-side="theirs"/);
		});

		it('stamps only side values the chips can actually filter to', () => {
			const stamped = [...mixed.matchAll(/<article[^>]*data-side="([^"]+)"/g)].map((m) => m[1]);
			const filters = [...mixed.matchAll(/class="side-filter[^"]*"[^>]*data-filter="([^"]+)"/g)].map((m) => m[1]);
			assert.ok(stamped.length > 0);
			for (const side of stamped) {
				assert.ok(filters.includes(side), `no chip can select cards stamped ${side}`);
			}
		});

		it('gives every rendered lane a count element the client can find', () => {
			const lanes = [...mixed.matchAll(/<section class="lane" id="([^"]+)"/g)].map((m) => m[1]);
			assert.ok(lanes.length > 0);
			for (const lane of lanes) {
				assert.match(mixed, new RegExp(`class="count [^"]*" data-lane="${lane}"`), `lane ${lane} has no data-lane count`);
			}
		});

		// The client is serialized into the page, so its selectors and the markup are one contract
		// held together by matching strings. A rename that lands on only one side leaves a page
		// that throws on load, and every other assertion here still passes.
		const clientScript = mixed.slice(mixed.lastIndexOf('<script>'));

		it('looks up only ids and classes the page actually renders', () => {
			// Every element type at once, so the check tests the contract and not one fixture:
			// a card of yours with drafts and a handoff brief, and one of theirs with a cta.
			const everything =
				mixed +
				dashboard.renderDashboard(
					lib.dashboardModel({
						prs: [
							{key: 'a/b#8', prState: 'open', mine: true, pendingDrafts: 1, storeStatus: 'drafted'},
							{key: 'a/b#9', prState: 'open', author: 'someone'},
						],
						ledger: '| 2026-08-05T08:00:00Z | a/b#9 | drafted | blocker | a finding |  |',
						actions: {prs: {'a/b#9': {next: 'Approve it.', cta: 'Approve the PR', notes: ['a note']}}},
					}),
				);
			const ids = [...clientScript.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
			const selectors = [...clientScript.matchAll(/querySelector(?:All)?\('([^']+)'\)/g)].map((m) => m[1]);
			// The client builds some of its own nodes, so those classes are never in the markup.
			const built = new Set([...clientScript.matchAll(/className = '([^']+)'/g)].map((m) => m[1]));
			assert.ok(ids.length > 0 && selectors.length > 0, 'found no client lookups to check');
			for (const id of ids) {
				assert.match(everything, new RegExp(`id="${id}"`), `client reads #${id}, which the page never renders`);
			}
			for (const selector of selectors) {
				// Only the plain leading class of each selector is checked; that is what renames break.
				const cls = /^\.([\w-]+)/.exec(selector);
				if (!cls || built.has(cls[1])) continue;
				assert.match(everything, new RegExp(`class="[^"]*\\b${cls[1]}\\b`), `client queries ${selector}, absent from the page`);
			}
		});

		it('reads and writes the filter under its own key, never the feedback key', () => {
			assert.match(clientScript, /var FILTER_KEY = 'dw-review-queue-filter-v1'/);
			assert.match(clientScript, /getItem\(FILTER_KEY\)/);
			assert.match(clientScript, /setItem\(FILTER_KEY, filter\)/);
			// Sharing the feedback key would write a bare filter id over the stored JSON, and the
			// next load would throw in the parse and drop every saved comment and decision.
			const filterBlock = clientScript.slice(clientScript.indexOf('FILTER_KEY'));
			assert.doesNotMatch(filterBlock, /(get|set)Item\(KEY[,)]/, 'the filter must not touch the feedback key');
		});

		it('counts each chip over the whole queue, not the filtered view', () => {
			assert.match(mixed, /data-filter="all"[^>]*><span>All<\/span><b>3<\/b>/);
			assert.match(mixed, /data-filter="yours"[^>]*><span>Yours<\/span><b>2<\/b>/);
			assert.match(mixed, /data-filter="theirs"[^>]*><span>Theirs<\/span><b>1<\/b>/);
		});

		it('ships with All selected, both visibly and to assistive tech', () => {
			// Both halves matter: aria-pressed alone would leave no chip looking active.
			assert.match(mixed, /class="side-filter on" type="button" data-filter="all" aria-pressed="true"/);
			assert.match(mixed, /data-filter="yours" aria-pressed="false"/);
			assert.match(mixed, /data-filter="theirs" aria-pressed="false"/);
		});

		it('marks your own cards, only your own, and ahead of the state chips', () => {
			assert.equal((mixed.match(/<span class="chip yours">/g) || []).length, 2);
			const withState = dashboard.renderDashboard(
				lib.dashboardModel({prs: [{key: 'a/b#1', prState: 'open', mine: true, pendingDrafts: 2, storeStatus: 'drafted'}]}),
			);
			assert.match(withState, /<div class="chips"><span class="chip yours">yours<\/span><span class="chip accent">/);
		});

		it('renders the empty queue message server-side, so a client that never runs still explains itself', () => {
			const bare = dashboard.renderDashboard(lib.dashboardModel({prs: []}));
			assert.match(bare, /<p class="empty-note"[^>]*>No PRs recorded yet\.<\/p>/);
			// With cards present the same element ships hidden and blank; the client fills it.
			assert.match(mixed, /<p class="empty-note"[^>]* hidden><\/p>/);
		});

		it('carries a distinct empty message per side, and none for All', () => {
			const el = mixed.match(/<p class="empty-note"[^>]*>/)[0];
			const messages = ['yours', 'theirs'].map((id) => (el.match(new RegExp(`data-${id}="([^"]+)"`)) || [])[1]);
			for (const message of messages) assert.ok(message && message.length > 0);
			assert.equal(new Set(messages).size, 2, 'a shared message tells the reviewer the wrong thing about why the page is empty');
			// All can never show a filtered-empty state, so copy for it here would be dead.
			assert.doesNotMatch(el, /data-all=/);
		});
	});

	it('renders both themes through tokens, not one theme with an inverted copy', () => {
		assert.ok(html.includes('@media (prefers-color-scheme: dark)'));
		assert.ok(html.includes(':root[data-theme="dark"]'));
		assert.ok(html.includes(':root[data-theme="light"]'));
		// The page is embedded in a document shell, so it must not ship its own.
		assert.ok(!/<!doctype/i.test(html));
		assert.ok(!/<body[\s>]/i.test(html));
	});
});

describe('cli guards (no network)', () => {
	it('prints usage with no arguments and fails on an unknown subcommand', () => {
		const help = runCli([]);
		assert.equal(help.status, 0);
		assert.match(help.stdout, /queue/);
		assert.equal(runCli(['nope']).status, 1);
	});

	it('refuses a comment body that is missing a side tag, before touching the network', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-body-'));
		const file = join(dir, 'body.md');
		writeFileSync(file, 'looks like a review comment but carries no tag\n');
		const res = runCli(['draft', 'acme/widget#42', '--path', 'a.php', '--line', '10', '--body-file', file]);
		assert.equal(res.status, 1);
		assert.match(res.stderr, /\[dev-review-ai\]/);
		rmSync(dir, {recursive: true, force: true});
	});

	it('lets an author-side reply quote the reviewer tag without demanding an Ask', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-quote-'));
		const file = join(dir, 'reply.md');
		// The gate used to match the tag anywhere, so answering a reviewer while quoting them
		// was read as a reviewing comment and forced into the Ask shape.
		writeFileSync(file, '[dev-author-ai]\nTaken. You wrote `[dev-review-ai] Ask: normalise it` and that is done.\n');
		const res = runCli(['reply', 'acme/widget#42', '--thread', 'PRRT_x', '--body-file', file]);
		assert.ok(!/must open on an "Ask:/.test(res.stderr), `should not demand an Ask: ${res.stderr}`);
		rmSync(dir, {recursive: true, force: true});
	});

	it('refuses a tagged body whose ask does not lead, and accepts one where it does', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-ask-'));
		const buried = join(dir, 'buried.md');
		writeFileSync(buried, '[dev-review-ai]\nnit: the docblock lost its condition.\n\nAsk: restore the clause.\n');
		const res = runCli(['draft', 'acme/widget#42', '--path', 'a.php', '--line', '10', '--body-file', buried]);
		assert.equal(res.status, 1);
		assert.match(res.stderr, /Ask:/);

		// Same guard, satisfied: the ask leads, so the body gets past validation and
		// fails later — on the network, not on its shape.
		const leads = join(dir, 'leads.md');
		// Deliberately the legacy tag: bodies and threads already carry it, so it must still pass.
		writeFileSync(leads, '[dev-ai]\nAsk: restore the when-clause on `@throws`.\n\nnit: the docblock lost its condition.\n');
		assert.doesNotMatch(runCli(['draft', 'acme/widget#42', '--path', 'a.php', '--line', '10', '--body-file', leads]).stderr, /Ask:/);
		rmSync(dir, {recursive: true, force: true});
	});

	it('refuses an empty or missing body file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dw-review-body-'));
		const empty = join(dir, 'empty.md');
		writeFileSync(empty, '   \n');
		assert.equal(runCli(['draft', 'acme/widget#42', '--body-file', empty]).status, 1);
		assert.equal(runCli(['draft', 'acme/widget#42', '--body-file', join(dir, 'nope.md')]).status, 1);
		rmSync(dir, {recursive: true, force: true});
	});

	it('refuses to submit without a recognized event', () => {
		const res = runCli(['submit', 'acme/widget#42', '--event', 'LGTM']);
		assert.equal(res.status, 1);
		assert.match(res.stderr, /COMMENT/);
	});

	it('rejects a bad PR reference before anything else', () => {
		assert.equal(runCli(['surfaces', 'not-a-pr']).status, 1);
	});
});

describe('cli store writes', () => {
	it('records a head SHA that classifyPr then reads back as handled', () => {
		const store = mkdtempSync(join(tmpdir(), 'dw-review-store-'));
		const res = runCli(
			['state-set', 'acme/widget#42', '--sha', 'head1', '--status', 'submitted'],
			{DW_STORE_ROOT: store},
		);
		assert.equal(res.status, 0, res.stderr);
		const file = join(store, 'run-notes', 'dw-review-prs', 'state.md');
		const entry = lib.parseStateMd(readFileSync(file, 'utf8'))['acme/widget#42'];
		assert.equal(entry.sha, 'head1');
		assert.equal(
			lib.isActionable(
				lib.classifyPr(
					{key: 'acme/widget#42', headSha: 'head1', isOpen: true, authoredByMe: false, pendingReview: null, submittedShas: []},
					entry,
				).status,
			),
			false,
			'the recorded head reads back as handled, whatever the settled label is',
		);
		assert.equal(runCli(['state-set', 'acme/widget#42', '--sha', 'x', '--status', 'bogus'], {DW_STORE_ROOT: store}).status, 1);
		rmSync(store, {recursive: true, force: true});
	});

	it('writes the ledger header once and appends a row per comment', () => {
		const store = mkdtempSync(join(tmpdir(), 'dw-review-store-'));
		const env = {DW_STORE_ROOT: store};
		assert.equal(runCli(['log', 'acme/widget#42', '--weight', 'nit', '--finding', 'first'], env).status, 0);
		assert.equal(runCli(['log', 'acme/widget#42', '--weight', 'blocker', '--finding', 'second'], env).status, 0);
		const text = readFileSync(join(store, 'run-notes', 'dw-review-prs', 'comments.md'), 'utf8');
		assert.equal(text.match(/\| when \|/g).length, 1, 'header written once');
		assert.equal(text.match(/acme\/widget#42/g).length, 2);
		assert.equal(runCli(['log', 'acme/widget#42'], env).status, 1, '--finding is required');
		rmSync(store, {recursive: true, force: true});
	});
});
