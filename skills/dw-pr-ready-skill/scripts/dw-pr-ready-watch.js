#!/usr/bin/env node
'use strict';

const {readFileSync, writeFileSync, existsSync} = require('node:fs');
const {join} = require('node:path');
const utils = require('./utils');
const lib = require('./pr-ready-lib');

const DEFAULT_POLL_MS = 120_000;

function parseCliOptions() {
	const args = utils.parseArgs(process.argv);
	const pollMsRaw = utils.getStringArg(args, 'poll-ms', 'DW_PR_READY_POLL_MS', String(DEFAULT_POLL_MS));
	const pollMs = Number.parseInt(pollMsRaw, 10);
	const positional = args._ ?? [];
	const prUrl = positional[0] || utils.getStringArg(args, 'pr', 'DW_PR_READY_URL', '');
	return {
		prUrl,
		once: args.once === true,
		noUpdate: args['no-update'] === true,
		resetState: args['reset-state'] === true,
		pollMs: Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_POLL_MS,
		statePath: utils.getStringArg(args, 'state', 'DW_PR_READY_STATE', defaultStatePath(prUrl)),
	};
}

function defaultStatePath(prUrl) {
	let slug = 'default';
	try {
		if (prUrl) {
			const {owner, repo, number} = utils.parsePrUrl(prUrl);
			slug = `${owner}-${repo}-${number}`;
		}
	} catch {
		// fall through
	}
	return join(utils.defaultStateDir(), slug, 'state.json');
}

function defaultInterruptDir(prUrl) {
	const options = parseCliOptions();
	const base = join(utils.defaultStateDir(), 'interrupts');
	if (prUrl) {
		try {
			const {owner, repo, number} = utils.parsePrUrl(prUrl);
			return join(base, `${owner}-${repo}-${number}`);
		} catch {
			// fall through
		}
	}
	return base;
}

function loadState(statePath, resetState) {
	if (resetState || !existsSync(statePath)) return lib.emptyState();
	try {
		const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
		return {...lib.emptyState(), ...parsed};
	} catch {
		return lib.emptyState();
	}
}

function saveState(statePath, state) {
	utils.ensureParentDir(statePath);
	state.lastPolledAt = new Date().toISOString();
	writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function ghJsonCapture(args) {
	return utils.runCommandCapture('gh', args, utils.ghEnv());
}

function parseGhJson(args, context) {
	const result = ghJsonCapture(args);
	if (result.error) throw new Error(`${context}: ${result.error.message}`);
	if (result.status !== 0) {
		throw new Error(`${context}: gh exited with code ${result.status ?? 'unknown'}: ${result.stdout}`);
	}
	return JSON.parse(result.stdout);
}

function verifyGhAuth() {
	const result = ghJsonCapture(['auth', 'status']);
	if (result.status !== 0) {
		throw new Error('GitHub CLI auth is invalid. Run: gh auth refresh -h github.com');
	}
}

function fetchAuthedLogin() {
	const result = ghJsonCapture(['api', 'user', '--jq', '.login']);
	if (result.status !== 0) return '';
	return String(result.stdout || '').trim();
}

function fetchPrSummary(owner, repo, number) {
	return parseGhJson(
		[
			'pr', 'view', String(number),
			'--repo', `${owner}/${repo}`,
			'--json',
			'number,title,url,state,isDraft,reviewDecision,headRefName,baseRefName,headRefOid,baseRefOid,mergeStateStatus,mergeable,id',
		],
		`fetch PR #${number}`,
	);
}

function fetchReviewThreads(owner, repo, prNumber) {
	const query = `query($owner:String!,$repo:String!,$pr:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{
          id isResolved isOutdated
          comments(first:50){nodes{id body url author{login}}}
        }
      }
    }
  }
}`;

	const threads = [];
	let after = '';
	for (;;) {
		const variables = {owner, repo, pr: String(prNumber)};
		if (after) variables.after = after;
		const result = utils.ghGraphqlCapture(query, variables);
		if (result.status !== 0) {
			throw new Error(`fetch review threads: gh exited ${result.status}`);
		}
		const payload = JSON.parse(result.stdout);
		if (payload.errors?.length) {
			throw new Error(payload.errors.map((e) => e.message).join('; '));
		}
		const page = payload.data?.repository?.pullRequest?.reviewThreads;
		for (const node of page?.nodes ?? []) {
			threads.push({
				id: node.id,
				isResolved: node.isResolved,
				isOutdated: node.isOutdated,
				comments: (node.comments?.nodes ?? []).map((c) => ({
					id: c.id,
					body: c.body,
					url: c.url,
					authorLogin: c.author?.login ?? 'unknown',
				})),
			});
		}
		if (!page?.pageInfo?.hasNextPage) break;
		after = page.pageInfo.endCursor ?? '';
		if (!after) break;
	}
	return threads;
}

function fetchIssueComments(owner, repo, prNumber) {
	const payload = parseGhJson(
		['pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`, '--json', 'comments'],
		`fetch issue comments for PR ${prNumber}`,
	);
	return (payload.comments ?? []).map((row) => ({
		id: row.id,
		body: row.body,
		url: row.url,
		authorLogin: row.author?.login ?? 'unknown',
		authorAssociation: row.authorAssociation ?? '',
	}));
}

function fetchReviews(owner, repo, prNumber) {
	const payload = parseGhJson(
		['pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`, '--json', 'reviews'],
		`fetch reviews for PR ${prNumber}`,
	);
	return (payload.reviews ?? []).map((row) => ({
		id: row.id,
		body: row.body,
		state: row.state,
		authorLogin: row.author?.login ?? 'unknown',
		url: row.url ?? '',
	}));
}

function fetchChecks(owner, repo, prNumber) {
	// `gh pr checks` intentionally exits non-zero by status: 1 = a check
	// failed, 8 = checks pending. It still prints the JSON array to stdout in
	// those cases, so we must NOT route this through parseGhJson (which throws
	// on any non-zero exit). verifyGhAuth() already ran in pollOnce, so genuine
	// auth/connection failures are surfaced before we ever get here.
	const result = ghJsonCapture([
		'pr', 'checks', String(prNumber),
		'--repo', `${owner}/${repo}`,
		'--json', 'name,bucket,state,workflow,link',
	]);
	if (result.error) {
		throw new Error(`fetch checks for PR ${prNumber}: ${result.error.message}`);
	}
	const stdout = (result.stdout || '').trim();
	if (stdout) {
		try {
			const parsed = JSON.parse(stdout);
			if (Array.isArray(parsed)) return parsed;
		} catch {
			// Non-JSON notice (e.g. "no checks reported") — fall through to [].
		}
	}
	return [];
}

function fetchMergeQueueEnabled(owner, repo, baseRefName) {
	const query = `query($owner:String!,$repo:String!){
  repository(owner:$owner,name:$repo){
    rulesets(first:20){
      nodes{
        conditions{refName{include exclude}}
        rules(first:50){ nodes { type } }
      }
    }
  }
}`;
	const result = utils.ghGraphqlCapture(query, {owner, repo});
	if (result.status !== 0) return false;
	try {
		const payload = JSON.parse(result.stdout);
		const nodes = payload.data?.repository?.rulesets?.nodes ?? [];
		return lib.parseMergeQueueFromRulesets(nodes, baseRefName);
	} catch {
		return false;
	}
}

function updatePullRequestBranch(summary) {
	const mutation = `mutation($id:ID!){
  updatePullRequestBranch(input:{pullRequestId:$id}){
    pullRequest{headRefOid mergeStateStatus mergeable}
  }
}`;
	const result = utils.ghGraphqlCapture(mutation, {id: summary.id});
	if (result.status !== 0) {
		return {ok: false, error: result.stdout || `gh exited with code ${result.status}`};
	}
	try {
		const payload = JSON.parse(result.stdout);
		if (payload.errors?.length) {
			return {ok: false, error: payload.errors.map((e) => e.message).join('; ')};
		}
		const pullRequest = payload.data?.updatePullRequestBranch?.pullRequest;
		const headRefOid = pullRequest?.headRefOid;
		if (!headRefOid) return {ok: false, error: 'updatePullRequestBranch returned no headRefOid'};
		return {
			ok: true,
			headRefOid,
			mergeStateStatus: pullRequest?.mergeStateStatus,
			mergeable: pullRequest?.mergeable,
		};
	} catch (err) {
		return {ok: false, error: `failed to parse update-branch response: ${String(err)}`};
	}
}

function markPriorIssue(state, prNumber) {
	const key = String(prNumber);
	if (!state.prNumbersWithPriorIssues.includes(key)) {
		state.prNumbersWithPriorIssues.push(key);
	}
}

function recommendedNextCommands(owner, repo, prNumber, reason) {
	const repoFlag = ['--repo', `${owner}/${repo}`];
	switch (reason) {
		case 'new-comment':
		case 'user-directive':
			return [
				`gh pr view ${prNumber} ${repoFlag.join(' ')} --comments`,
				`gh api graphql -f query='query{repository(owner:"${owner}",name:"${repo}"){pullRequest(number:${prNumber}){reviewThreads(first:20){nodes{id isResolved comments(first:5){nodes{body author{login}}}}}}}'`,
			];
		case 'ci-failure':
			return [
				`gh pr checks ${prNumber} ${repoFlag.join(' ')}`,
				`gh pr checks ${prNumber} ${repoFlag.join(' ')} --watch --fail-fast`,
			];
		case 'update-branch-failed':
		case 'merge-conflict':
			return [
				`gh pr view ${prNumber} ${repoFlag.join(' ')} --json headRefName,mergeable,mergeStateStatus`,
				`gh pr diff ${prNumber} ${repoFlag.join(' ')}`,
			];
		case 'auth-api-failed':
			return ['gh auth status', 'gh auth refresh -h github.com'];
		case 'waiting-checks':
			return [`gh pr checks ${prNumber} ${repoFlag.join(' ')}`];
		case 'pr-ready':
			return [
				`gh pr checks ${prNumber} ${repoFlag.join(' ')}`,
				`gh pr view ${prNumber} ${repoFlag.join(' ')}`,
			];
		case 'waiting-review':
		case 'waiting-draft':
			return [`gh pr view ${prNumber} ${repoFlag.join(' ')}`];
		default:
			return [];
	}
}

function writeInterruptArtifact(prUrl, payload) {
	const dir = defaultInterruptDir(prUrl);
	utils.ensureParentDir(join(dir, 'placeholder'));
	const filePath = join(dir, `interrupt-${Date.now()}.json`);
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

function printInterrupt(result, localBranch, artifactPath) {
	const {summary, owner, repo, reason} = result;
	console.log('');
	console.log('=== DW PR READY WATCHER INTERRUPT ===');
	console.log(`localBranch: ${localBranch}`);
	console.log(`reason: ${reason}`);
	console.log(`pr: #${summary.number} ${summary.title}`);
	console.log(`url: ${summary.url}`);
	console.log(`head: ${summary.headRefName} @ ${summary.headRefOid}`);
	console.log(`base: ${summary.baseRefName} @ ${summary.baseRefOid}`);
	console.log(`isDraft: ${summary.isDraft}`);
	console.log(`reviewDecision: ${summary.reviewDecision ?? 'NONE'}`);
	console.log(`mergeStateStatus: ${summary.mergeStateStatus}`);
	if (result.gateReason) console.log(`updateGate: ${result.gateReason}`);
	if (result.updateError) console.log(`updateError: ${result.updateError}`);
	if (result.readyHeadline) console.log(`readyHeadline: ${result.readyHeadline}`);

	if (result.comments?.length > 0) {
		console.log('');
		console.log('comments:');
		for (const comment of result.comments) {
			console.log(
				`- [${comment.kind}] ${comment.authorLogin}: ${comment.bodyPreview}${comment.url ? ` (${comment.url})` : ''}`,
			);
		}
	}

	if (result.failures?.length > 0) {
		console.log('');
		console.log('ciFailures:');
		for (const failure of result.failures) {
			console.log(`- ${failure.name} (${failure.state}) ${failure.link || failure.workflow}`);
		}
	}

	const commands = recommendedNextCommands(owner, repo, summary.number, reason);
	if (commands.length > 0) {
		console.log('');
		console.log('nextCommands:');
		for (const command of commands) {
			console.log(`- ${command}`);
		}
	}

	console.log('');
	console.log(`artifact: ${artifactPath}`);
}

function inspectPr(owner, repo, summary, state, options, mergeQueueEnabled, directiveLogins) {
	const threads = fetchReviewThreads(owner, repo, summary.number);
	const issueComments = fetchIssueComments(owner, repo, summary.number);
	const reviews = fetchReviews(owner, repo, summary.number);
	const checks = fetchChecks(owner, repo, summary.number);

	const actionableComments = lib.collectActionableComments(threads, issueComments, reviews);
	const failures = lib.collectFailures(checks, summary.headRefOid);
	const pendingCount = lib.collectPending(checks);
	const newComments = lib.unseenComments(summary.number, actionableComments, state, directiveLogins);
	const newFailures = lib.unseenFailures(summary.number, failures, state);
	const gate = lib.canUpdateBranch(summary, {mergeQueueEnabled});

	if (!options.noUpdate && lib.shouldUpdateBranch(summary, state, gate)) {
		const update = updatePullRequestBranch(summary);
		if (update.ok === false) {
			if (lib.isBenignUpdateBranchError(update.error)) {
				console.log(`[dw-pr-ready] #${summary.number} already current with base; skipping update`);
			} else {
				return {
					summary, owner, repo,
					reason: 'update-branch-failed',
					comments: newComments,
					failures: newFailures,
					updateError: update.error,
					gateReason: gate.reason,
				};
			}
		} else {
			summary.headRefOid = update.headRefOid;
			if (update.mergeStateStatus) summary.mergeStateStatus = update.mergeStateStatus;
			if (update.mergeable) summary.mergeable = update.mergeable;
			console.log(`[dw-pr-ready] updated branch for #${summary.number}; new head ${update.headRefOid}`);
			if (lib.hasMergeConflict(summary) && lib.isNewMergeConflict(summary, state)) {
				markPriorIssue(state, summary.number);
				return {
					summary, owner, repo,
					reason: 'merge-conflict',
					comments: [],
					failures: [],
					updateError: 'updatePullRequestBranch left merge conflicts',
					gateReason: gate.reason,
				};
			}
		}
		return null;
	}

	state.lastBaseRefOid[String(summary.number)] = summary.baseRefOid;

	if (lib.isNewMergeConflict(summary, state)) {
		markPriorIssue(state, summary.number);
		return {summary, owner, repo, reason: 'merge-conflict', comments: [], failures: [], gateReason: gate.reason};
	}

	if (newComments.length > 0) {
		const userDirectives = newComments.filter((c) => lib.isUserDirective(c, directiveLogins));
		const reason = userDirectives.length > 0 ? 'user-directive' : 'new-comment';
		const comments = userDirectives.length > 0 ? userDirectives : newComments;
		lib.rememberComments(summary.number, newComments, state, directiveLogins);
		markPriorIssue(state, summary.number);
		return {summary, owner, repo, reason, comments, failures: [], gateReason: gate.reason};
	}

	if (newFailures.length > 0) {
		lib.rememberFailures(summary.number, newFailures, state);
		markPriorIssue(state, summary.number);
		return {summary, owner, repo, reason: 'ci-failure', comments: [], failures: newFailures, gateReason: gate.reason};
	}

	lib.rememberComments(summary.number, actionableComments, state, directiveLogins);
	lib.rememberFailures(summary.number, failures, state);

	const prKey = String(summary.number);
	if (summary.isDraft && actionableComments.length === 0 && failures.length === 0) {
		return {
			summary, owner, repo,
			reason: 'waiting-draft',
			comments: [],
			failures: [],
			gateReason: gate.reason,
			readyHeadline: `Draft PR #${summary.number} — comments resolved; mark ready when appropriate`,
		};
	}

	if (
		(summary.reviewDecision === 'REVIEW_REQUIRED' || summary.reviewDecision === 'CHANGES_REQUESTED')
		&& actionableComments.length === 0
		&& failures.length === 0
	) {
		return {
			summary, owner, repo,
			reason: 'waiting-review',
			comments: [],
			failures: [],
			gateReason: gate.reason,
			readyHeadline: `PR #${summary.number} waiting for review (${summary.reviewDecision})`,
		};
	}

	if (
		pendingCount > 0
		&& actionableComments.length === 0
		&& failures.length === 0
		&& !summary.isDraft
	) {
		// Loop mode keeps polling quietly while checks run; --once surfaces a
		// calm "still waiting" interrupt (exit 0), never a premature pr-ready.
		if (!options.once) return null;
		return {
			summary, owner, repo,
			reason: 'waiting-checks',
			comments: [],
			failures: [],
			gateReason: gate.reason,
			readyHeadline: `PR #${summary.number} — ${pendingCount} check(s) still running`,
		};
	}

	if (
		state.prNumbersWithPriorIssues.includes(prKey)
		&& !state.notifiedReadyPrNumbers.includes(prKey)
		&& actionableComments.length === 0
		&& failures.length === 0
		&& summary.mergeable !== 'CONFLICTING'
		&& !summary.isDraft
		&& pendingCount === 0
	) {
		state.notifiedReadyPrNumbers.push(prKey);
		return {
			summary, owner, repo,
			reason: 'pr-ready',
			comments: [],
			failures: [],
			gateReason: gate.reason,
			readyHeadline: `PR #${summary.number} green — ready for review/merge`,
		};
	}

	if (
		!state.prNumbersWithPriorIssues.includes(prKey)
		&& actionableComments.length === 0
		&& failures.length === 0
		&& summary.mergeable !== 'CONFLICTING'
		&& !summary.isDraft
		&& summary.reviewDecision !== 'REVIEW_REQUIRED'
		&& summary.reviewDecision !== 'CHANGES_REQUESTED'
		&& pendingCount === 0
	) {
		return {
			summary, owner, repo,
			reason: 'pr-ready',
			comments: [],
			failures: [],
			gateReason: gate.reason,
			readyHeadline: `PR #${summary.number} green — ready for review/merge`,
		};
	}

	return null;
}

function pollOnce(prUrl, state, options, directiveLogins) {
	verifyGhAuth();
	const {owner, repo, number} = utils.parsePrUrl(prUrl);
	const summary = fetchPrSummary(owner, repo, number);

	if (summary.state === 'MERGED') {
		return {summary, owner, repo, reason: 'merged', comments: [], failures: []};
	}
	if (summary.state === 'CLOSED') {
		return {summary, owner, repo, reason: 'closed', comments: [], failures: []};
	}

	const mergeQueueEnabled = fetchMergeQueueEnabled(owner, repo, summary.baseRefName);
	return inspectPr(owner, repo, summary, state, options, mergeQueueEnabled, directiveLogins);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGhError(message) {
	const lower = String(message).toLowerCase();
	return lower.includes('connection reset')
		|| lower.includes('connection refused')
		|| lower.includes('timeout')
		|| lower.includes('rate limit')
		|| lower.includes('502')
		|| lower.includes('503')
		|| lower.includes('504');
}

async function main() {
	const options = parseCliOptions();
	if (!options.prUrl) {
		console.error('Usage: node dw-pr-ready-watch.js <full-pr-url> [--once] [--no-update] [--poll-ms N]');
		process.exit(1);
	}

	const state = loadState(options.statePath, options.resetState);
	const localBranch = utils.getCurrentBranchName();
	const directiveLogins = lib.resolveDirectiveLogins(process.env, [fetchAuthedLogin()]);

	console.log(`[dw-pr-ready] pr=${options.prUrl}`);
	console.log(`[dw-pr-ready] localBranch=${localBranch}`);
	console.log(`[dw-pr-ready] state=${options.statePath}`);
	console.log(`[dw-pr-ready] directiveLogins=${[...directiveLogins].join(',') || '(none)'}`);
	console.log(
		`[dw-pr-ready] mode=${options.once ? 'once' : 'loop'} update=${options.noUpdate ? 'disabled' : 'enabled'} pollMs=${options.pollMs}`,
	);

	for (;;) {
		try {
			const attention = pollOnce(options.prUrl, state, options, directiveLogins);
			saveState(options.statePath, state);

			if (attention) {
				if (attention.reason === 'merged') {
					console.log(`[dw-pr-ready] PR #${attention.summary.number} merged; exiting.`);
					process.exit(0);
				}
				if (attention.reason === 'closed') {
					console.log(`[dw-pr-ready] PR #${attention.summary.number} closed; exiting.`);
					process.exit(0);
				}

				const artifactPath = writeInterruptArtifact(options.prUrl, {
					localBranch,
					interruptedAt: new Date().toISOString(),
					prUrl: options.prUrl,
					...attention,
				});
				printInterrupt(attention, localBranch, artifactPath);
				process.exit(['pr-ready', 'waiting-review', 'waiting-draft', 'waiting-checks'].includes(attention.reason) ? 0 : 2);
			}

			console.log(`[dw-pr-ready] quiet at ${new Date().toISOString()}`);
			if (options.once) process.exit(0);
			await sleep(options.pollMs);
		} catch (err) {
			saveState(options.statePath, state);
			const message = err instanceof Error ? err.message : String(err);
			if (!options.once && isTransientGhError(message)) {
				console.warn(`[dw-pr-ready] transient error; retrying in ${options.pollMs}ms: ${message}`);
				await sleep(options.pollMs);
				continue;
			}
			const attention = {
				summary: {number: 0, title: 'auth/api failure', url: options.prUrl},
				owner: '', repo: '',
				reason: 'auth-api-failed',
				comments: [],
				failures: [],
				updateError: message,
			};
			const artifactPath = writeInterruptArtifact(options.prUrl, {
				localBranch,
				interruptedAt: new Date().toISOString(),
				prUrl: options.prUrl,
				...attention,
			});
			printInterrupt(attention, localBranch, artifactPath);
			process.exit(1);
		}
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error('[dw-pr-ready] fatal:', err);
		process.exit(1);
	});
}

module.exports = {
	parseCliOptions,
	pollOnce,
	loadState,
	saveState,
	recommendedNextCommands,
};
