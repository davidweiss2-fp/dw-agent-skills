import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {parsePrUrl} from '../skills/dw-pr-ready-skill/scripts/utils.js';
import {
	canUpdateBranch,
	shouldUpdateBranch,
	parseMergeQueueFromRulesets,
	collectActionableComments,
	collectFailures,
	collectPending,
	isNoiseComment,
	emptyState,
	resolveDirectiveLogins,
	isUserDirective,
	unseenComments,
	rememberComments,
} from '../skills/dw-pr-ready-skill/scripts/pr-ready-lib.js';

describe('parsePrUrl', () => {
	it('parses standard GitHub PR URLs', () => {
		const r = parsePrUrl('https://github.com/40nuggets/dashboard/pull/10471');
		assert.equal(r.owner, '40nuggets');
		assert.equal(r.repo, 'dashboard');
		assert.equal(r.number, 10471);
	});

	it('rejects non-GitHub URLs', () => {
		assert.throws(() => parsePrUrl('https://gitlab.com/a/b/merge_requests/1'));
	});
});

describe('canUpdateBranch', () => {
	const base = {
		number: 1,
		isDraft: false,
		reviewDecision: null,
		mergeStateStatus: 'CLEAN',
		mergeable: 'MERGEABLE',
		baseRefOid: 'abc',
	};

	it('blocks draft PRs', () => {
		const r = canUpdateBranch({...base, isDraft: true}, {mergeQueueEnabled: false});
		assert.equal(r.allowed, false);
		assert.equal(r.reason, 'draft-pr-no-update');
	});

	it('blocks merge queue repos', () => {
		const r = canUpdateBranch(base, {mergeQueueEnabled: true});
		assert.equal(r.allowed, false);
		assert.equal(r.reason, 'merge-queue-enabled');
	});

	it('blocks changes requested', () => {
		const r = canUpdateBranch({...base, reviewDecision: 'CHANGES_REQUESTED'}, {mergeQueueEnabled: false});
		assert.equal(r.allowed, false);
		assert.equal(r.reason, 'changes-requested');
	});

	it('blocks review required', () => {
		const r = canUpdateBranch({...base, reviewDecision: 'REVIEW_REQUIRED'}, {mergeQueueEnabled: false});
		assert.equal(r.allowed, false);
		assert.equal(r.reason, 'review-required');
	});

	it('allows when clean', () => {
		const r = canUpdateBranch(base, {mergeQueueEnabled: false});
		assert.equal(r.allowed, true);
	});
});

describe('shouldUpdateBranch', () => {
	it('updates when BEHIND and gate allows', () => {
		const state = emptyState();
		const summary = {
			number: 42,
			mergeStateStatus: 'BEHIND',
			baseRefOid: 'new-base',
		};
		const gate = {allowed: true, reason: 'ok'};
		assert.equal(shouldUpdateBranch(summary, state, gate), true);
	});

	it('skips when gate blocks', () => {
		const state = emptyState();
		const summary = {
			number: 42,
			mergeStateStatus: 'BEHIND',
			baseRefOid: 'new-base',
		};
		const gate = {allowed: false, reason: 'draft-pr-no-update'};
		assert.equal(shouldUpdateBranch(summary, state, gate), false);
	});
});

describe('parseMergeQueueFromRulesets', () => {
	it('detects MERGE_QUEUE rule on matching branch', () => {
		const rulesets = [{
			conditions: {refName: {include: ['refs/heads/master'], exclude: []}},
			rules: [{type: 'MERGE_QUEUE'}],
		}];
		assert.equal(parseMergeQueueFromRulesets(rulesets, 'master'), true);
	});

	it('returns false when no merge queue rule', () => {
		const rulesets = [{
			conditions: {refName: {include: ['refs/heads/master'], exclude: []}},
			rules: [{type: 'PULL_REQUEST'}],
		}];
		assert.equal(parseMergeQueueFromRulesets(rulesets, 'master'), false);
	});

	it('detects MERGE_QUEUE in the real GraphQL connection shape (rules.nodes)', () => {
		const rulesets = [{
			conditions: {refName: {include: ['refs/heads/master'], exclude: []}},
			rules: {nodes: [{type: 'PULL_REQUEST'}, {type: 'MERGE_QUEUE'}]},
		}];
		assert.equal(parseMergeQueueFromRulesets(rulesets, 'master'), true);
	});
});

describe('resolveDirectiveLogins', () => {
	it('parses DW_PR_DIRECTIVE_LOGINS (comma/space separated, lowercased)', () => {
		const s = resolveDirectiveLogins({DW_PR_DIRECTIVE_LOGINS: 'Alice, bob  charlie'}, ['fallback']);
		assert.deepEqual([...s].sort(), ['alice', 'bob', 'charlie']);
	});

	it('falls back to the provided logins when the env is unset', () => {
		assert.deepEqual([...resolveDirectiveLogins({}, ['Me'])], ['me']);
	});

	it('is empty when neither env nor fallback is present', () => {
		assert.equal(resolveDirectiveLogins({}, []).size, 0);
	});
});

describe('comment filtering', () => {
	it('filters noise bots', () => {
		assert.equal(isNoiseComment('github-actions[bot]', 'CI passed'), true);
		assert.equal(isNoiseComment('human', 'please fix this'), false);
	});

	it('collects unresolved review threads', () => {
		const comments = collectActionableComments(
			[{
				id: 't1',
				isResolved: false,
				isOutdated: false,
				comments: [{id: 'c1', body: 'fix line 42', url: 'http://x', authorLogin: 'reviewer'}],
			}],
			[],
			[],
		);
		assert.equal(comments.length, 1);
		assert.equal(comments[0].kind, 'review-thread');
	});
});

describe('check buckets', () => {
	const head = 'deadbeef';

	it('collectFailures flags failing checks but NOT pending ones', () => {
		const checks = [
			{name: 'unit', bucket: 'fail', state: 'FAILURE', workflow: 'ci', link: 'http://f'},
			{name: 'lint', bucket: 'pending', state: 'IN_PROGRESS', workflow: 'ci', link: 'http://p'},
			{name: 'build', bucket: 'pass', state: 'SUCCESS', workflow: 'ci', link: 'http://s'},
		];
		const failures = collectFailures(checks, head);
		assert.equal(failures.length, 1);
		assert.equal(failures[0].name, 'unit');
	});

	it('collectPending counts only still-running checks', () => {
		assert.equal(collectPending([{bucket: 'pending'}]), 1);
		assert.equal(collectPending([{state: 'IN_PROGRESS'}, {state: 'QUEUED'}]), 2);
		assert.equal(collectPending([{bucket: 'pass'}, {bucket: 'fail'}]), 0);
		assert.equal(collectPending([]), 0);
	});
});

describe('what counts as a directive from the user', () => {
	const logins = new Set(['davidweiss2-fp']);
	const from = (body) => isUserDirective({authorLogin: 'davidweiss2-fp', body}, logins);

	it('takes the human unsigned, and never an agent wearing the same account', () => {
		assert.equal(from('please also handle the null case'), true);
		// Both agents post under the user's login, so a login match alone obeyed this skill's
		// own words as if the user had written them.
		assert.equal(from('[dev-author-ai] Fixed in abc1234'), false);
		assert.equal(from('[dev-review-ai] Ask: restore the clause'), false);
		// An unreadable signature used to be promoted to a directive - the conflation this closes.
		assert.equal(from('**[DEV-AI]** Good catch — taken'), false);
		assert.equal(from('**[dev-author-ai]** applied'), false);
		// Quoting an agent is a person writing, so it stays a directive.
		assert.equal(from('> [dev-review-ai] Ask: do it'), true);
	});

	it('still ignores everyone who is not a directive author', () => {
		assert.equal(isUserDirective({authorLogin: 'someone-else', body: 'do this'}, logins), false);
		assert.equal(isUserDirective({authorLogin: 'davidweiss2-fp', body: 'x'}, new Set()), false);
	});
});

describe('a handled directive is not re-reported every poll', () => {
	// An unsigned review-thread comment from the directive author on an unresolved thread. It used
	// to bypass the seen set and re-interrupt forever, because the agent may never resolve the
	// thread. It must now fire once, like every other comment.
	const directive = {
		id: 'PRRC_1', kind: 'review-thread', authorLogin: 'davidweiss2-fp',
		body: 'please also handle the null case', isResolved: false,
	};

	it('fires an unresolved directive once, then treats it as seen', () => {
		const state = emptyState();
		const first = unseenComments(57198, [directive], state);
		assert.deepEqual(first.map((c) => c.id), ['PRRC_1']);
		rememberComments(57198, first, state);
		const second = unseenComments(57198, [directive], state);
		assert.deepEqual(second, [], 'the same unresolved directive must not re-fire on the next poll');
	});

	it('still surfaces a genuinely new directive in the same thread', () => {
		const state = emptyState();
		rememberComments(57198, [directive], state);
		const next = {...directive, id: 'PRRC_2', body: 'and also this'};
		const unseen = unseenComments(57198, [directive, next], state);
		assert.deepEqual(unseen.map((c) => c.id), ['PRRC_2']);
	});
});
