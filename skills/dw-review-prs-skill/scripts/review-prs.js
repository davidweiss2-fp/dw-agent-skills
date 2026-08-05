'use strict';

// dw-review-prs mechanics: read the review queue, read every comment surface,
// and write review comments as an UNSUBMITTED (pending) review. Nothing here
// publishes anything except `submit`.
//
// Node + CommonJS, node: builtins only. Every GitHub call goes through `gh`.
// Bodies are passed as files so no comment text ever reaches a shell.

const {spawnSync} = require('node:child_process');
const {readFileSync, writeFileSync, existsSync, appendFileSync} = require('node:fs');
const lib = require('./review-prs-lib.js');
const paths = require('./review-prs-paths.js');

const USAGE = `dw-review-prs - draft [dev-ai] review comments as an unsubmitted review

  queue [--json]                     PRs where review is requested of you, classified
  surfaces <pr>                      every comment surface + your own pending drafts
  threads <pr>                       review threads with node ids (for reply)
  draft <pr> --path P --line N [--side RIGHT|LEFT] --body-file F
  reply <pr> --thread ID --body-file F
  edit --comment NODE_ID --body-file F        rewrite one of your draft comments
  drop --comment NODE_ID                      delete one of your draft comments
  submit <pr> --event COMMENT|APPROVE|REQUEST_CHANGES
  state-set <pr> --sha SHA --status STATUS    STATUS: drafted|submitted|declined
  log <pr> --status S --weight W --finding TEXT [--url URL]
  watch [--once] [--poll-ms N] [--include-bots] [--open-only]
                                     new comments on every PR the store records

<pr> is a PR URL, owner/repo#123, or owner/repo/123.`;

function fail(msg) {
	process.stderr.write(`error: ${msg}\n`);
	process.exit(1);
}

function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) flags[key] = true;
			else {
				flags[key] = next;
				i++;
			}
		} else positional.push(a);
	}
	return {positional, flags};
}

function gh(args) {
	const res = spawnSync('gh', args, {
		encoding: 'utf8',
		env: {...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_NO_TTY: '1'},
	});
	if (res.error) fail(`gh not runnable: ${res.error.message}`);
	if (res.status !== 0) fail(`gh ${args.slice(0, 2).join(' ')} failed: ${(res.stderr || '').trim()}`);
	return res.stdout;
}

function ghJson(args) {
	const out = gh(args).trim();
	if (!out) return null;
	try {
		return JSON.parse(out);
	} catch (err) {
		fail(`could not parse gh JSON output: ${err.message}`);
	}
}

function graphql(query, variables) {
	const args = ['api', 'graphql', '-f', `query=${query}`];
	for (const [k, v] of Object.entries(variables || {})) {
		if (typeof v === 'object' && v && v.file) args.push('-F', `${k}=@${v.file}`);
		else args.push('-F', `${k}=${v}`);
	}
	return ghJson(args);
}

function ref(arg) {
	const parsed = lib.parsePrRef(arg);
	if (!parsed) fail(`not a PR reference: ${arg}`);
	return parsed;
}

function bodyFile(flags) {
	const f = flags['body-file'];
	if (typeof f !== 'string') fail('--body-file is required (a file holding the comment markdown)');
	if (!existsSync(f)) fail(`--body-file not found: ${f}`);
	const body = readFileSync(f, 'utf8');
	if (!body.trim()) fail('--body-file is empty');
	if (!lib.hasDraftTag(body)) fail(`comment body must carry the ${lib.DRAFT_TAG} tag`);
	if (!lib.hasAskLine(body)) fail(`comment body must open on an "Ask: <closeable action>" line after the ${lib.DRAFT_TAG} tag`);
	return {file: f, body};
}

// --jq prints a bare string, not JSON, so this reads stdout directly.
function me() {
	const login = gh(['api', 'user', '--jq', '.login']).trim();
	if (!login) fail('could not resolve the gh-authenticated login (gh auth status)');
	return login;
}

function prMeta(r) {
	const pr = ghJson(['api', `repos/${r.owner}/${r.repo}/pulls/${r.number}`]);
	if (!pr) fail(`could not read ${r.key}`);
	return pr;
}

function reviewsFor(r) {
	return ghJson(['api', '--paginate', `repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews`]) || [];
}

function pendingReviewFor(r, login) {
	const mine = reviewsFor(r).filter((v) => v.user && v.user.login === login);
	const pending = mine.find((v) => v.state === 'PENDING');
	if (!pending) return {pending: null, submittedShas: mine.map((v) => v.commit_id).filter(Boolean)};
	const drafts =
		ghJson([
			'api',
			`repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews/${pending.id}/comments`,
		]) || [];
	return {
		pending: {id: pending.id, nodeId: pending.node_id, draftCount: drafts.length, drafts},
		submittedShas: mine.filter((v) => v.state !== 'PENDING').map((v) => v.commit_id).filter(Boolean),
	};
}

// The search index lags live PR state, so every hit is re-resolved through the
// PR endpoint and anything not open is dropped.
function cmdQueue(flags) {
	const login = me();
	const hits =
		ghJson([
			'search',
			'prs',
			'--review-requested=@me',
			'--state=open',
			'--limit',
			'100',
			'--json',
			'number,repository,url,title,updatedAt',
		]) || [];
	const state = existsSync(paths.statePath())
		? lib.parseStateMd(readFileSync(paths.statePath(), 'utf8'))
		: {};

	const rows = [];
	for (const hit of hits) {
		const nameWithOwner = hit.repository && (hit.repository.nameWithOwner || hit.repository.name);
		const r = lib.parsePrRef(`${nameWithOwner}#${hit.number}`);
		if (!r) continue;
		const pr = prMeta(r);
		const {pending, submittedShas} = pendingReviewFor(r, login);
		const cls = lib.classifyPr(
			{
				key: r.key,
				headSha: pr.head && pr.head.sha,
				isDraft: Boolean(pr.draft),
				isOpen: pr.state === 'open',
				authoredByMe: Boolean(pr.user && pr.user.login === login),
				pendingReview: pending ? {id: pending.id, draftCount: pending.draftCount} : null,
				submittedShas,
			},
			state[r.key],
		);
		rows.push({
			key: r.key,
			url: pr.html_url || hit.url,
			title: pr.title || hit.title,
			author: pr.user && pr.user.login,
			isDraftPr: Boolean(pr.draft),
			headSha: pr.head && pr.head.sha,
			draftComments: pending ? pending.draftCount : 0,
			updatedAt: hit.updatedAt,
			status: cls.status,
			reason: cls.reason,
		});
	}

	const sorted = lib.sortQueue(rows);
	if (flags.json) {
		process.stdout.write(JSON.stringify({me: login, counts: lib.summarize(sorted), queue: sorted}, null, 2) + '\n');
		return;
	}
	const counts = lib.summarize(sorted);
	process.stdout.write(`reviewer: ${login}\n`);
	process.stdout.write(
		Object.keys(counts).length ? `counts: ${JSON.stringify(counts)}\n\n` : 'no open review requests\n',
	);
	for (const row of sorted) {
		const mark = lib.isActionable(row.status) ? '*' : ' ';
		process.stdout.write(`${mark} [${row.status}] ${row.key} - ${row.reason}\n`);
		process.stdout.write(`    ${row.title}\n`);
		process.stdout.write(`    ${row.url}${row.isDraftPr ? '  (draft PR)' : ''}\n`);
	}
}

function cmdSurfaces(arg) {
	const r = ref(arg);
	const login = me();
	const {pending, submittedShas} = pendingReviewFor(r, login);
	const out = {
		pr: r.key,
		me: login,
		mySubmittedShas: submittedShas,
		myPendingDrafts: pending
			? pending.drafts.map((c) => ({
					nodeId: c.node_id,
					id: c.id,
					path: c.path,
					line: c.line,
					body: c.body,
				}))
			: [],
		reviews: reviewsFor(r).map((v) => ({
			user: v.user && v.user.login,
			state: v.state,
			commit: v.commit_id,
			body: v.body,
		})),
		reviewComments: (
			ghJson(['api', '--paginate', `repos/${r.owner}/${r.repo}/pulls/${r.number}/comments`]) || []
		).map((c) => ({
			user: c.user && c.user.login,
			isBot: Boolean(c.user && c.user.type === 'Bot'),
			path: c.path,
			line: c.line,
			inReplyTo: c.in_reply_to_id,
			body: c.body,
		})),
		issueComments: (
			ghJson(['api', '--paginate', `repos/${r.owner}/${r.repo}/issues/${r.number}/comments`]) || []
		).map((c) => ({
			user: c.user && c.user.login,
			isBot: Boolean(c.user && c.user.type === 'Bot'),
			body: c.body,
		})),
	};
	process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

const THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){ pullRequest(number:$number){
    reviewThreads(first:100){ nodes{ id path line isResolved isOutdated
      comments(first:1){ nodes{ author{login} body } } } } } } }`;

function cmdThreads(arg) {
	const r = ref(arg);
	const data = graphql(THREADS_QUERY, {owner: r.owner, repo: r.repo, number: r.number});
	const nodes =
		(data && data.data && data.data.repository.pullRequest.reviewThreads.nodes) || [];
	process.stdout.write(
		JSON.stringify(
			nodes.map((t) => ({
				threadId: t.id,
				path: t.path,
				line: t.line,
				isResolved: t.isResolved,
				isOutdated: t.isOutdated,
				author: t.comments.nodes[0] && t.comments.nodes[0].author && t.comments.nodes[0].author.login,
				first: t.comments.nodes[0] && t.comments.nodes[0].body,
			})),
			null,
			2,
		) + '\n',
	);
}

// One pending review per user per PR is a hard GitHub limit, so reuse the open
// one and only create when there is none.
function ensurePendingReview(r, login) {
	const {pending} = pendingReviewFor(r, login);
	if (pending) return pending.nodeId;
	const pr = prMeta(r);
	const created = graphql(
		`mutation($prId:ID!){ addPullRequestReview(input:{pullRequestId:$prId}){
      pullRequestReview{ id state } } }`,
		{prId: pr.node_id},
	);
	const review = created && created.data && created.data.addPullRequestReview.pullRequestReview;
	if (!review) fail('could not open a pending review');
	return review.id;
}

function cmdDraft(arg, flags) {
	const r = ref(arg);
	const body = bodyFile(flags);
	const path = flags.path;
	const line = Number(flags.line);
	if (typeof path !== 'string') fail('--path is required');
	if (!Number.isInteger(line) || line <= 0) fail('--line must be a positive integer');
	const side = flags.side === 'LEFT' ? 'LEFT' : 'RIGHT';
	const reviewId = ensurePendingReview(r, me());
	const res = graphql(
		`mutation($reviewId:ID!,$path:String!,$line:Int!,$side:DiffSide!,$body:String!){
      addPullRequestReviewThread(input:{pullRequestReviewId:$reviewId,path:$path,line:$line,side:$side,body:$body}){
        thread{ id path line } } }`,
		{reviewId, path, line, side, body: {file: body.file}},
	);
	const thread = res && res.data && res.data.addPullRequestReviewThread.thread;
	if (!thread) fail('draft comment was not created');
	process.stdout.write(`drafted (unsubmitted) ${r.key} ${thread.path}:${thread.line} thread=${thread.id}\n`);
}

function cmdReply(arg, flags) {
	const r = ref(arg);
	const body = bodyFile(flags);
	const threadId = flags.thread;
	if (typeof threadId !== 'string') fail('--thread is required (see `threads`)');
	const reviewId = ensurePendingReview(r, me());
	const res = graphql(
		`mutation($reviewId:ID!,$threadId:ID!,$body:String!){
      addPullRequestReviewThreadReply(input:{pullRequestReviewId:$reviewId,pullRequestReviewThreadId:$threadId,body:$body}){
        comment{ id state } } }`,
		{reviewId, threadId, body: {file: body.file}},
	);
	const comment = res && res.data && res.data.addPullRequestReviewThreadReply.comment;
	if (!comment) fail('draft reply was not created');
	process.stdout.write(`drafted reply (${comment.state}) on ${r.key} thread=${threadId}\n`);
}

// REST cannot touch a comment that belongs to a pending review (404), so edits
// and deletes go through GraphQL node ids.
function cmdEdit(flags) {
	const body = bodyFile(flags);
	const id = flags.comment;
	if (typeof id !== 'string') fail('--comment NODE_ID is required (see `surfaces`)');
	const res = graphql(
		`mutation($id:ID!,$body:String!){ updatePullRequestReviewComment(input:{pullRequestReviewCommentId:$id,body:$body}){
      pullRequestReviewComment{ id state } } }`,
		{id, body: {file: body.file}},
	);
	const c = res && res.data && res.data.updatePullRequestReviewComment.pullRequestReviewComment;
	if (!c) fail('draft comment was not updated');
	process.stdout.write(`updated ${c.id} (${c.state})\n`);
}

function cmdDrop(flags) {
	const id = flags.comment;
	if (typeof id !== 'string') fail('--comment NODE_ID is required (see `surfaces`)');
	graphql(
		`mutation($id:ID!){ deletePullRequestReviewComment(input:{id:$id}){ clientMutationId } }`,
		{id},
	);
	process.stdout.write(`deleted draft comment ${id}\n`);
}

const EVENTS = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];

function cmdSubmit(arg, flags) {
	const r = ref(arg);
	const event = flags.event;
	if (!EVENTS.includes(event)) fail(`--event must be one of ${EVENTS.join(' | ')}`);
	const login = me();
	const {pending} = pendingReviewFor(r, login);
	if (!pending) fail(`no pending review on ${r.key} to submit`);
	if (pending.draftCount === 0) fail('pending review has no comments - drop it or draft first');
	const res = graphql(
		`mutation($reviewId:ID!,$event:PullRequestReviewEvent!){
      submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:$event}){
        pullRequestReview{ state url } } }`,
		{reviewId: pending.nodeId, event},
	);
	const review = res && res.data && res.data.submitPullRequestReview.pullRequestReview;
	if (!review) fail('submit failed');
	process.stdout.write(`submitted ${review.state} with ${pending.draftCount} comment(s): ${review.url}\n`);
}

function cmdStateSet(arg, flags) {
	const r = ref(arg);
	const status = flags.status;
	if (!['drafted', 'submitted', 'declined'].includes(status)) {
		fail('--status must be drafted | submitted | declined');
	}
	const sha = typeof flags.sha === 'string' ? flags.sha : (prMeta(r).head || {}).sha;
	paths.ensureDir(paths.reviewNotesDir());
	const file = paths.statePath();
	const current = existsSync(file) ? lib.parseStateMd(readFileSync(file, 'utf8')) : {};
	const next = lib.upsertState(current, r.key, {sha, status, at: new Date().toISOString()});
	writeFileSync(file, lib.renderStateMd(next));
	process.stdout.write(`state: ${r.key} sha=${sha} status=${status}\n`);
}

// gh, but a failure is data rather than an exit: one unreachable PR must not end
// a watch that is covering the rest of the queue.
function ghJsonSoft(args) {
	const res = spawnSync('gh', args, {
		encoding: 'utf8',
		env: {...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_NO_TTY: '1'},
	});
	if (res.error) return {ok: false, error: `gh not runnable: ${res.error.message}`};
	if (res.status !== 0) return {ok: false, error: (res.stderr || `gh exited ${res.status}`).trim()};
	const out = (res.stdout || '').trim();
	if (!out) return {ok: true, data: null};
	try {
		return {ok: true, data: JSON.parse(out)};
	} catch (err) {
		return {ok: false, error: `unparseable gh output: ${err.message}`};
	}
}

function loadWatchState() {
	const file = paths.watchStatePath();
	if (!existsSync(file)) return {};
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8'));
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		// A corrupt watermark file re-seeds instead of ending the watch.
		return {};
	}
}

function saveWatchState(state) {
	paths.ensureDir(paths.reviewNotesDir());
	writeFileSync(paths.watchStatePath(), JSON.stringify(state, null, '\t') + '\n');
}

// The three surfaces a reply can land on, each normalized to {id, user, isBot, body, url, ...}.
function watchSurfaces(r) {
	const base = `repos/${r.owner}/${r.repo}`;
	return [
		{
			name: 'review-comment',
			args: ['api', '--paginate', `${base}/pulls/${r.number}/comments`],
			map: (c) => ({
				id: c.id,
				user: c.user && c.user.login,
				isBot: Boolean(c.user && c.user.type === 'Bot'),
				where: `${c.path}:${c.line || c.original_line || '?'}`,
				body: c.body || '',
				url: c.html_url,
			}),
		},
		{
			name: 'pr-comment',
			args: ['api', '--paginate', `${base}/issues/${r.number}/comments`],
			map: (c) => ({
				id: c.id,
				user: c.user && c.user.login,
				isBot: Boolean(c.user && c.user.type === 'Bot'),
				where: '(conversation)',
				body: c.body || '',
				url: c.html_url,
			}),
		},
		{
			name: 'review',
			args: ['api', '--paginate', `${base}/pulls/${r.number}/reviews`],
			map: (v) => ({
				id: v.id,
				user: v.user && v.user.login,
				isBot: Boolean(v.user && v.user.type === 'Bot'),
				where: `(review ${v.state})`,
				body: v.body || '',
				url: v.html_url,
			}),
		},
	];
}

function watchOnePr(key, watchState, opts) {
	const r = lib.parsePrRef(key);
	if (!r) return {key, error: 'unparseable PR ref in state.md'};
	const meta = ghJsonSoft(['api', `repos/${r.owner}/${r.repo}/pulls/${r.number}`]);
	if (!meta.ok) return {key, error: meta.error};
	const prState = meta.data && (meta.data.merged_at ? 'merged' : meta.data.state);
	if (opts.openOnly && prState !== 'open') return {key, prState, skipped: true, fresh: []};

	const entry = watchState[key] || {};
	const seeding = lib.isFirstWatch(entry);
	const next = {...entry};
	const fresh = [];
	for (const surface of watchSurfaces(r)) {
		const res = ghJsonSoft(surface.args);
		if (!res.ok) return {key, prState, error: `${surface.name}: ${res.error}`};
		const rows = (res.data || []).map(surface.map).filter((c) => String(c.body || '').trim() !== '');
		const seen = lib.unseenComments(rows, entry[surface.name], {
			myLogin: opts.myLogin,
			includeBots: opts.includeBots,
		});
		next[surface.name] = seen.watermark;
		if (!seeding) for (const c of seen.fresh) fresh.push({...c, surface: surface.name});
	}
	watchState[key] = next;
	return {key, prState, seeding, fresh};
}

function printWatchResult(res) {
	if (res.error) {
		process.stdout.write(`[watch] ${res.key} error (continuing): ${res.error}\n`);
		return;
	}
	if (res.seeding) {
		process.stdout.write(`[watch] ${res.key} (${res.prState}) first pass - marks seeded, nothing reported\n`);
		return;
	}
	if (!res.fresh.length) return;
	process.stdout.write(`[watch] ${res.key} (${res.prState}) ${res.fresh.length} new\n`);
	for (const c of res.fresh) {
		const excerpt = String(c.body).replace(/\s+/g, ' ').trim().slice(0, 240);
		process.stdout.write(`  - ${c.surface} ${c.user} ${c.where}\n    ${excerpt}\n    ${c.url}\n`);
	}
}

async function cmdWatch(flags) {
	const pollMs = Number(flags['poll-ms']) > 0 ? Number(flags['poll-ms']) : 120_000;
	const opts = {
		includeBots: Boolean(flags['include-bots']),
		openOnly: Boolean(flags['open-only']),
		myLogin: me(),
	};
	const stateFile = paths.statePath();
	process.stdout.write(`[watch] store=${stateFile} me=${opts.myLogin} mode=${flags.once ? 'once' : 'loop'}\n`);

	for (;;) {
		const entries = existsSync(stateFile) ? lib.parseStateMd(readFileSync(stateFile, 'utf8')) : {};
		const targets = lib.watchTargets(entries);
		const watchState = loadWatchState();
		// Re-read state.md every pass, so a PR reviewed by another run joins the
		// watch without a restart.
		process.stdout.write(`[watch] pass ${new Date().toISOString()} prs=${targets.length}\n`);
		const pass = lib.watchPass(
			targets,
			(key) => watchOnePr(key, watchState, opts),
			(res) => {
				printWatchResult(res);
				// Saved per result: a crash mid-pass cannot replay comments already shown.
				saveWatchState(watchState);
			},
		);

		if (!pass.fresh) {
			process.stdout.write(`[watch] quiet - ${targets.length - pass.failed}/${targets.length} PRs reachable\n`);
		}
		if (flags.once) return;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
}

function cmdLog(arg, flags) {
	const r = ref(arg);
	const finding = flags.finding;
	if (typeof finding !== 'string') fail('--finding TEXT is required');
	paths.ensureDir(paths.reviewNotesDir());
	const file = paths.commentsLogPath();
	if (!existsSync(file)) {
		writeFileSync(
			file,
			'# dw-review-prs comment ledger\n\nEvery comment this skill drafted or submitted. Read before drafting so a finding is never delivered twice.\n\n| when | pr | status | weight | finding | url |\n| --- | --- | --- | --- | --- | --- |\n',
		);
	}
	appendFileSync(
		file,
		lib.ledgerLine({
			at: new Date().toISOString(),
			key: r.key,
			url: typeof flags.url === 'string' ? flags.url : '',
			status: typeof flags.status === 'string' ? flags.status : 'drafted',
			weight: typeof flags.weight === 'string' ? flags.weight : '',
			finding,
		}) + '\n',
	);
	process.stdout.write(`logged ${r.key}\n`);
}

function main() {
	const {positional, flags} = parseArgs(process.argv.slice(2));
	const cmd = positional[0];
	switch (cmd) {
		case 'queue':
			return cmdQueue(flags);
		case 'surfaces':
			return cmdSurfaces(positional[1]);
		case 'threads':
			return cmdThreads(positional[1]);
		case 'draft':
			return cmdDraft(positional[1], flags);
		case 'reply':
			return cmdReply(positional[1], flags);
		case 'edit':
			return cmdEdit(flags);
		case 'drop':
			return cmdDrop(flags);
		case 'submit':
			return cmdSubmit(positional[1], flags);
		case 'state-set':
			return cmdStateSet(positional[1], flags);
		case 'log':
			return cmdLog(positional[1], flags);
		case 'watch':
			return cmdWatch(flags).catch((err) => fail(`watch: ${err instanceof Error ? err.message : String(err)}`));
		default:
			process.stdout.write(USAGE + '\n');
			process.exit(cmd ? 1 : 0);
	}
}

if (require.main === module) main();

module.exports = {parseArgs};
