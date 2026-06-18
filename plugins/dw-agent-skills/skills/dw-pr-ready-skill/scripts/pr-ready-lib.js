'use strict';

const NOISE_BOT_LOGINS = new Set([
	'github-actions',
	'github-actions[bot]',
	'codecov',
	'codecov-commenter',
	'dependabot',
	'dependabot[bot]',
]);

const CLEAN_SCAN_BOT_LOGINS = new Set([
	'cursor',
	'cursoragent',
	'ox-security',
	'ox-security[bot]',
]);

const USER_DIRECTIVE_LOGINS = new Set(['davidweiss2-fp']);

function bodyPreview(body, max = 240) {
	const compact = String(body || '').replace(/\s+/g, ' ').trim();
	return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function isCleanScanComment(body) {
	const normalized = String(body || '').replace(/\s+/g, ' ').trim();
	if (!normalized) return true;
	const lower = normalized.toLowerCase();
	if (lower.includes('no issues found') || lower.includes('nothing to fix')) return true;
	if (lower.includes('found no bugs') || lower.includes('found no issues')) return true;
	if (lower.includes('found 0 potential')) return true;
	if (normalized.includes('BUGBOT_REVIEW') && lower.includes('found 0 potential')) return true;
	return false;
}

function isNoiseComment(authorLogin, body) {
	if (NOISE_BOT_LOGINS.has(authorLogin)) return true;
	if (CLEAN_SCAN_BOT_LOGINS.has(authorLogin) && isCleanScanComment(body)) return true;
	if (String(body || '').trim().includes('Bundle Analysis')) return true;
	return false;
}

function collectActionableComments(threads, issueComments, reviews) {
	const actionable = [];

	for (const thread of threads) {
		if (thread.isResolved) continue;
		for (const comment of thread.comments) {
			if (isNoiseComment(comment.authorLogin, comment.body)) continue;
			actionable.push({
				id: comment.id,
				kind: 'review-thread',
				authorLogin: comment.authorLogin,
				bodyPreview: bodyPreview(comment.body),
				url: comment.url,
				threadId: thread.id,
				isResolved: thread.isResolved,
				isOutdated: thread.isOutdated,
			});
		}
	}

	for (const comment of issueComments) {
		if (isNoiseComment(comment.authorLogin, comment.body)) continue;
		actionable.push({
			id: comment.id,
			kind: 'issue-comment',
			authorLogin: comment.authorLogin,
			bodyPreview: bodyPreview(comment.body),
			url: comment.url,
		});
	}

	for (const review of reviews) {
		if (review.state !== 'CHANGES_REQUESTED') continue;
		actionable.push({
			id: review.id,
			kind: 'changes-requested-review',
			authorLogin: review.authorLogin,
			bodyPreview: bodyPreview(review.body || '(no review body)'),
			url: review.url,
		});
	}

	return actionable;
}

function collectFailures(checks, headRefOid) {
	return checks
		.filter((check) => {
			const bucket = (check.bucket || '').toLowerCase();
			const state = (check.state || '').toUpperCase();
			return bucket === 'fail' || state === 'FAILURE' || state === 'ERROR' || state === 'TIMED_OUT';
		})
		.map((check) => ({
			key: `${headRefOid}:${check.name}:${check.link || check.workflow || 'unknown'}`,
			name: check.name,
			state: check.state,
			workflow: check.workflow,
			link: check.link,
		}));
}

/**
 * Count checks that are still running / not yet conclusive.
 * `gh pr checks` buckets these as `pending`; states vary by provider.
 */
function collectPending(checks) {
	return checks.filter((check) => {
		const bucket = (check.bucket || '').toLowerCase();
		const state = (check.state || '').toUpperCase();
		return bucket === 'pending'
			|| state === 'PENDING' || state === 'QUEUED'
			|| state === 'IN_PROGRESS' || state === 'WAITING'
			|| state === 'REQUESTED' || state === 'EXPECTED';
	}).length;
}

function isUserDirective(comment) {
	return USER_DIRECTIVE_LOGINS.has(comment.authorLogin);
}

function hasMergeConflict(summary) {
	return summary.mergeable === 'CONFLICTING' || summary.mergeStateStatus === 'DIRTY';
}

function isBenignUpdateBranchError(error) {
	return String(error || '').includes('There are no new commits on the base branch');
}

/**
 * Whether branch update from base is allowed per plan rules.
 */
function canUpdateBranch(summary, {mergeQueueEnabled}) {
	if (summary.isDraft) {
		return {allowed: false, reason: 'draft-pr-no-update'};
	}
	if (mergeQueueEnabled) {
		return {allowed: false, reason: 'merge-queue-enabled'};
	}
	if (summary.reviewDecision === 'CHANGES_REQUESTED') {
		return {allowed: false, reason: 'changes-requested'};
	}
	if (summary.reviewDecision === 'REVIEW_REQUIRED') {
		return {allowed: false, reason: 'review-required'};
	}
	return {allowed: true, reason: 'ok'};
}

function shouldUpdateBranch(summary, state, gate) {
	if (!gate.allowed) return false;

	const key = String(summary.number);
	const previousBase = state.lastBaseRefOid[key];
	state.lastBaseRefOid[key] = summary.baseRefOid;

	if (summary.mergeStateStatus === 'BEHIND') return true;
	if (previousBase && previousBase !== summary.baseRefOid) return true;
	return false;
}

function unseenComments(prNumber, comments, state) {
	const seen = new Set(state.seenCommentIds[String(prNumber)] ?? []);
	return comments.filter((comment) => {
		if (isUserDirective(comment) && comment.kind === 'review-thread') {
			return !comment.isResolved;
		}
		return !seen.has(comment.id);
	});
}

function unseenFailures(prNumber, failures, state) {
	const seen = new Set(state.seenFailureKeys[String(prNumber)] ?? []);
	return failures.filter((failure) => !seen.has(failure.key));
}

function rememberComments(prNumber, comments, state) {
	const key = String(prNumber);
	const existing = new Set(state.seenCommentIds[key] ?? []);
	for (const comment of comments) {
		if (isUserDirective(comment) && comment.kind === 'review-thread') continue;
		existing.add(comment.id);
	}
	state.seenCommentIds[key] = [...existing];
}

function rememberFailures(prNumber, failures, state) {
	const key = String(prNumber);
	const existing = new Set(state.seenFailureKeys[key] ?? []);
	for (const failure of failures) {
		existing.add(failure.key);
	}
	state.seenFailureKeys[key] = [...existing];
}

function isNewMergeConflict(summary, state) {
	if (!hasMergeConflict(summary)) return false;
	const key = String(summary.number);
	const seenHead = state.lastConflictHeadOid[key];
	if (seenHead === summary.headRefOid) return false;
	state.lastConflictHeadOid[key] = summary.headRefOid;
	return true;
}

function emptyState() {
	return {
		version: 1,
		seenCommentIds: {},
		seenFailureKeys: {},
		lastBaseRefOid: {},
		notifiedReadyPrNumbers: [],
		prNumbersWithPriorIssues: [],
		lastConflictHeadOid: {},
	};
}

function parseMergeQueueFromRulesets(rulesets, baseRefName) {
	for (const ruleset of rulesets) {
		const refs = ruleset?.conditions?.refName;
		const includes = refs?.include ?? [];
		const excludes = refs?.exclude ?? [];
		const matchesRef =
			includes.length === 0
			|| includes.some((pattern) => refMatchesPattern(baseRefName, pattern));
		const excluded = excludes.some((pattern) => refMatchesPattern(baseRefName, pattern));
		if (!matchesRef || excluded) continue;
		// `rules` comes back as a GraphQL connection ({nodes:[...]}); tolerate a
		// plain array too so the function is easy to unit-test.
		const rules = ruleset.rules?.nodes ?? ruleset.rules ?? [];
		for (const rule of rules) {
			if (rule.type === 'MERGE_QUEUE') return true;
		}
	}
	return false;
}

function refMatchesPattern(refName, pattern) {
	if (!pattern || pattern === 'refs/heads/**') return true;
	if (pattern.endsWith('/**')) {
		const prefix = pattern.slice(0, -3);
		return refName.startsWith(prefix.replace('refs/heads/', ''));
	}
	return refName === pattern.replace('refs/heads/', '');
}

module.exports = {
	NOISE_BOT_LOGINS,
	USER_DIRECTIVE_LOGINS,
	bodyPreview,
	isNoiseComment,
	collectActionableComments,
	collectFailures,
	collectPending,
	isUserDirective,
	hasMergeConflict,
	isBenignUpdateBranchError,
	canUpdateBranch,
	shouldUpdateBranch,
	unseenComments,
	unseenFailures,
	rememberComments,
	rememberFailures,
	isNewMergeConflict,
	emptyState,
	parseMergeQueueFromRulesets,
};
