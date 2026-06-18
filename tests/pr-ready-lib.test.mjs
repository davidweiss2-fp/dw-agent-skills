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
