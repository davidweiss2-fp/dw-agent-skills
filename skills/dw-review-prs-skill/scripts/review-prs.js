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
const dash = require('./review-prs-dashboard.js');

const USAGE = `dw-review-prs - draft [dev-review-ai] comments as an unsubmitted review

  queue [--json] [--participation] [--days N] [--all-time]
                                     PRs requested of you or your teams, reviewed by
                                     you, or mentioning you - classified
  surfaces <pr>                      every comment surface + your own pending drafts
  threads <pr>                       review threads with node ids (for reply)
  draft <pr> --path P --line N [--side RIGHT|LEFT] --body-file F
  reply <pr> --thread ID --body-file F
  edit --comment NODE_ID --body-file F        rewrite one of your draft comments
  drop --comment NODE_ID                      delete one of your draft comments
  submit <pr> --event COMMENT|APPROVE|REQUEST_CHANGES
  state-set <pr> --sha SHA --status STATUS    STATUS: drafted|submitted|declined
  log <pr> --status S --weight W --finding TEXT [--url URL]
  watch                              long-running: new comments on every PR in scope,
                                     plus newly actionable PRs from the queue
  cleanup <pr> [--delete --authorized-by ID[,ID]]
                                     list (default) what can come off your OWN PR: superseded inner
                                     drafts + your published comments in finished threads. Removing
                                     needs the id of the comment that asked for the cleanup
  dashboard --out FILE [--actions FILE] [--title T]   build the status page
  dashboard-url [--set URL]          the artifact url the page is published to

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
	if (!lib.hasDraftTag(body)) {
		fail(`comment body must carry ${lib.REVIEW_TAG} (reviewing) or ${lib.AUTHOR_TAG} (acting for the author)`);
	}
	// The `Ask:` line is a reviewer's obligation - it names the action that closes the thread.
	// A comment signed as the author's side is answering one, so requiring an ask there would
	// force every reply into the wrong shape.
	// signedSide, not tagSide: the side is whoever SIGNED the comment, and an author-side reply
	// that quotes the reviewer's tag while answering it must not be forced into the Ask shape.
	if (lib.signedSide(body) !== 'author' && !lib.hasAskLine(body)) {
		fail(`comment body must open on an "Ask: <closeable action>" line after the ${lib.REVIEW_TAG} tag`);
	}
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
// A review request is not the only reason a PR belongs on this list. Once a review is
// submitted the request is gone, so `--review-requested` alone drops the PR the moment
// the reviewer is waiting on an answer - which is exactly when they still need to see it.
//
// `windowed` sources are pruned by --days, because "I reviewed this once" reaches back
// years. A request aimed at the reviewer or their team never is: an unanswered request
// is work no matter how long it has been sitting.
const QUEUE_SEARCHES = [
	{source: 'requested', args: ['--review-requested=@me'], windowed: false},
	{source: 'reviewed', args: ['--reviewed-by=@me'], windowed: true},
	{source: 'mentioned', args: ['--mentions=@me'], windowed: true},
	{source: 'commented', args: ['--commenter=@me'], windowed: true, optIn: true},
	// Own PRs are not review work, but they carry the reviewer's own review threads. Windowed:
	// an abandoned PR of theirs from a year ago is not something to keep polling.
	{source: 'mine', args: ['--author=@me'], windowed: true},
];

// Resolved per run rather than configured, so the skill carries no one's team names.
// A token without the org scope simply returns nothing, which costs a source, not a run.
function myTeams() {
	const res = ghJsonSoft(['api', '/user/teams', '--paginate']);
	if (!res.ok || !Array.isArray(res.data)) return [];
	return res.data
		.map((t) => (t && t.organization && t.slug ? `${t.organization.login}/${t.slug}` : null))
		.filter(Boolean);
}

// YYYY-MM-DD, `days` before today, for the --updated qualifier.
function sinceDate(days) {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - days);
	return d.toISOString().slice(0, 10);
}

function queueHits(flags) {
	const days = Number(flags.days) > 0 ? Number(flags.days) : 14;
	const since = flags['all-time'] ? null : sinceDate(days);
	const searches = QUEUE_SEARCHES.filter((q) => (q.optIn ? Boolean(flags.participation) : true));
	for (const team of myTeams()) {
		searches.push({source: 'team', args: [`--review-requested=${team}`], windowed: false, team});
	}

	const byKey = new Map();
	const add = (hit, source) => {
		const nameWithOwner = hit.repository && (hit.repository.nameWithOwner || hit.repository.name);
		const key = `${nameWithOwner}#${hit.number}`;
		const seen = byKey.get(key);
		if (seen) {
			if (!seen.sources.includes(source)) seen.sources.push(source);
			return;
		}
		byKey.set(key, {...hit, nameWithOwner, sources: [source]});
	};

	for (const search of searches) {
		const args = [
			'search',
			'prs',
			...search.args,
			'--state=open',
			'--archived=false',
			'--sort',
			'updated',
			'--order',
			'desc',
			'--limit',
			'100',
			'--json',
			'number,repository,url,title,updatedAt',
		];
		if (since && search.windowed) args.push(`--updated=>${since}`);
		const res = ghJsonSoft(args);
		if (!res.ok) {
			process.stderr.write(`warning: ${search.source} search failed, continuing: ${res.error}\n`);
			continue;
		}
		for (const hit of res.data || []) add(hit, search.source);
	}

	// Retention, so the window can prune discovery without hiding work in flight. Only
	// PRs the store records as `drafted` qualify: those carry unsubmitted drafts and must
	// never age out. A submitted or declined one needs no rescue - if it is still open and
	// still moving, the windowed searches find it, and if it merged it is history.
	const stateFile = paths.statePath();
	const tracked = existsSync(stateFile) ? lib.parseStateMd(readFileSync(stateFile, 'utf8')) : {};
	for (const key of Object.keys(tracked)) {
		if (tracked[key].status !== 'drafted') continue;
		const r = lib.parsePrRef(key);
		if (!r || byKey.has(key)) continue;
		byKey.set(key, {number: r.number, repository: {nameWithOwner: `${r.owner}/${r.repo}`}, nameWithOwner: `${r.owner}/${r.repo}`, url: '', title: '', sources: ['tracked']});
	}
	return [...byKey.values()];
}

function maxTimestamp(rows, pick) {
	let latest = '';
	for (const row of rows || []) {
		const at = pick(row);
		if (at && String(at) > latest) latest = String(at);
	}
	return latest;
}

// Did anyone comment after this reviewer's last submitted review? Asked only for a head
// already reviewed, so the extra call is not paid on every hit. The reviews array is the
// one the caller already fetched, and the timestamps are compared in JS rather than
// through `--jq`, whose bare-string output is not JSON and silently failed to parse.
function authorRepliedSinceMyReview(r, login, reviews) {
	const mine = maxTimestamp(
		(reviews || []).filter((v) => v.user && v.user.login === login && v.state !== 'PENDING'),
		(v) => v.submitted_at,
	);
	if (!mine) return false;
	const res = ghJsonSoft(['api', `repos/${r.owner}/${r.repo}/pulls/${r.number}/comments`, '--paginate']);
	if (!res.ok) return false;
	const theirs = maxTimestamp(
		(res.data || []).filter((c) => c.user && c.user.login !== login),
		(c) => c.created_at,
	);
	return Boolean(theirs) && theirs > mine;
}

// Others' standing review states, from the reviews this run already fetched.
function othersDecisions(reviews, login) {
	const latest = new Map();
	for (const v of reviews) {
		const who = v.user && v.user.login;
		if (!who || who === login || v.state === 'PENDING' || v.state === 'COMMENTED') continue;
		latest.set(who, v.state);
	}
	const states = [...latest.values()];
	return {
		approvedByAnyone: states.includes('APPROVED'),
		changesRequestedStands: states.includes('CHANGES_REQUESTED'),
	};
}

// Per-author review instructions from authors.json. Shape and normalization live in the lib.
function authorNotes() {
	return lib.normalizeAuthorNotes(readJsonOr(paths.authorNotesPath(), {}));
}

function notesFor(login) {
	return authorNotes().get(String(login || '').toLowerCase()) || null;
}

// Shared by `queue` and the watch's queue sweep, so both classify a PR the same way and a
// change to the rules lands in one place.
function queueRows(flags, login) {
	const hits = queueHits(flags);
	const notes = authorNotes();
	const state = existsSync(paths.statePath())
		? lib.parseStateMd(readFileSync(paths.statePath(), 'utf8'))
		: {};

	const rows = [];
	for (const hit of hits) {
		const r = lib.parsePrRef(`${hit.nameWithOwner}#${hit.number}`);
		if (!r) continue;
		const pr = prMeta(r);
		const {pending, submittedShas} = pendingReviewFor(r, login);
		const headSha = pr.head && pr.head.sha;
		const stored = state[r.key];
		// The reply check costs an API call, so it is asked only where the answer can
		// change the status: a head this reviewer has already reviewed.
		const reviewedThisHead =
			Boolean(headSha) &&
			(submittedShas.includes(headSha) || (stored && stored.sha === headSha && stored.status === 'submitted'));
		const reviews = reviewedThisHead ? reviewsFor(r) : [];
		const decisions = reviewedThisHead ? othersDecisions(reviews, login) : {};
		const cls = lib.classifyPr(
			{
				key: r.key,
				headSha,
				isDraft: Boolean(pr.draft),
				isOpen: pr.state === 'open',
				authoredByMe: Boolean(pr.user && pr.user.login === login),
				pendingReview: pending ? {id: pending.id, draftCount: pending.draftCount} : null,
				submittedShas,
				sources: hit.sources,
				...decisions,
				authorRepliedSinceMyReview: reviewedThisHead && authorRepliedSinceMyReview(r, login, reviews),
			},
			stored,
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
			sources: hit.sources,
			authorNotes: Boolean(notes.get(String((pr.user && pr.user.login) || '').toLowerCase())),
			mine: Boolean(pr.user && pr.user.login === login),
		});
	}

	return lib.sortQueue(rows);
}

function cmdQueue(flags) {
	const login = me();
	const sorted = queueRows(flags, login);
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
		process.stdout.write(
			`${mark} [${row.status}] ${row.key} - ${row.reason}` +
				`${row.mine ? '  [yours]' : ''}${row.authorNotes ? '  [author notes]' : ''}\n`,
		);
		process.stdout.write(`    ${row.title}\n`);
		process.stdout.write(`    ${row.url}${row.isDraftPr ? '  (draft PR)' : ''}\n`);
	}
}

function cmdSurfaces(arg) {
	const r = ref(arg);
	const login = me();
	const {pending, submittedShas} = pendingReviewFor(r, login);
	const pr = prMeta(r);
	const author = (pr.user && pr.user.login) || '';
	const out = {
		pr: r.key,
		me: login,
		author,
		// Step 2 makes `surfaces` mandatory before drafting, so per-author instructions ride
		// here rather than in a command someone can forget to run.
		authorNotes: notesFor(author),
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

// Convergence cleanup on your OWN PR: list by default, delete only when told twice.
// Deleting a published comment is irreversible and outward-facing, so the default output is a
// proposal a human reads. The guards live in lib.cleanupCandidates; this only fetches and prints.
function cmdCleanup(arg, flags) {
	const r = ref(arg);
	const login = me();
	const pr = prMeta(r);
	const inline = ghJson(['api', '--paginate', `repos/${r.owner}/${r.repo}/pulls/${r.number}/comments`]) || [];
	const issue = ghJson(['api', '--paginate', `repos/${r.owner}/${r.repo}/issues/${r.number}/comments`]) || [];
	const rows = [
		...inline.map((c) => ({id: c.id, author: c.user && c.user.login, inReplyTo: c.in_reply_to_id, body: c.body, kind: 'inline'})),
		...issue.map((c) => ({id: c.id, author: c.user && c.user.login, inReplyTo: null, body: c.body, kind: 'issue'})),
	];
	const res = lib.cleanupCandidates({prAuthor: pr.user && pr.user.login, me: login, comments: rows});
	if (res.blocked) fail(`cleanup refused: ${res.blocked}`);

	// Unsubmitted drafts are invisible on every other surface, so a cleanup that skipped them
	// reported "0 removable" with a pile of superseded ones sitting on the PR.
	const {pending} = pendingReviewFor(r, login);
	// Who is in each published thread, so a draft answering a person can be told from one
	// answering your own agent. Keyed by the thread root a reply hangs off.
	// Indexed by EVERY comment id in a thread, not just its root: a draft can reply to a human's
	// reply rather than to the comment that opened it, and a root-only index misses that - which
	// would file a reply owed to a person as inner clutter and propose deleting it.
	const byRoot = {};
	const rootOf = {};
	for (const c of inline) {
		const root = c.in_reply_to_id || c.id;
		rootOf[c.id] = root;
		(byRoot[root] = byRoot[root] || []).push({
			login: c.user && c.user.login,
			isBot: Boolean(c.user && c.user.type === 'Bot'),
		});
	}
	const threadAuthors = {};
	for (const [id, root] of Object.entries(rootOf)) threadAuthors[id] = byRoot[root] || [];
	const drafts = ((pending && pending.drafts) || []).map((c) => {
		const d = {
			nodeId: c.node_id,
			path: c.path,
			line: c.line,
			inReplyTo: c.in_reply_to_id,
			createdAt: c.created_at,
			body: c.body,
		};
		return {...d, outer: lib.isOuterDraft(d, threadAuthors, login)};
	});
	const stale = lib.supersededDrafts(drafts);
	const outerKept = drafts.filter((d) => d.outer);

	const short = (b) => String(b || '').replace(/\s+/g, ' ').slice(0, 88);
	process.stdout.write(
		`${r.key}: ${stale.length} superseded inner draft(s), ${res.internal.length} marked internal, ` +
			`${res.answered.length} published in a person's thread, ${outerKept.length} draft(s) owed to a person, ` +
			`${res.unanswered.length} published kept, ${res.others} not yours\n`,
	);
	// Node ids for drafts, database ids for published: they are deleted through different APIs,
	// and printing the wrong one is a failed call the reader only discovers by making it.
	if (stale.length) {
		process.stdout.write(`\nsuperseded inner drafts - between your own agents, drop takes these node ids:\n`);
		for (const d of stale) process.stdout.write(`  ${d.nodeId}  ${short(d.body)}\n`);
	}
	if (res.internal.length) {
		process.stdout.write(`\nmarked internal - agent-to-agent, the two sides can clear these by agreeing:\n`);
		for (const c of res.internal) process.stdout.write(`  ${c.kind} ${c.id} ${short(c.body)}\n`);
	}
	if (res.answered.length) {
		process.stdout.write(`\npublished, in a thread a person wrote in - only you can clear these:\n`);
		for (const c of res.answered) process.stdout.write(`  ${c.kind} ${c.id} [${lib.tagSide(c.body) || 'you'}] ${short(c.body)}\n`);
	}
	if (res.unanswered.length) {
		process.stdout.write(`\npublished, kept - nobody replied under these, so the exchange did not finish:\n`);
		for (const c of res.unanswered) process.stdout.write(`  ${c.kind} ${c.id} ${short(c.body)}\n`);
	}
	if (outerKept.length) {
		process.stdout.write(`\ndrafts kept - these answer a person, and stay however stale they look:\n`);
		for (const d of outerKept) process.stdout.write(`  ${d.nodeId}  ${short(d.body)}\n`);
	}
	if (!flags.delete) {
		process.stdout.write(
			'\nnothing removed. to remove: --delete --authorized-by <comment-id[,id]>\n' +
				'  the id of the comment asking for the cleanup - yours untagged, or one from each agent side.\n',
		);
		return;
	}
	// The free text that asks for a cleanup is judged by the agent; WHO asked is checked here.
	// Naming the comment also leaves an audit trail: the run says what it read as its instruction.
	const named = String(flags['authorized-by'] || '')
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean);
	if (!named.length) fail('--delete needs --authorized-by <comment-id>: name the comment asking for the cleanup');
	const all = [...rows, ...(issue || []).map((c) => ({id: c.id, author: c.user && c.user.login, body: c.body}))];
	const triggers = named.map((id) => {
		const hit = all.find((c) => String(c.id) === id) || (inline.concat(issue)).find((c) => String(c.id) === id);
		if (!hit) fail(`--authorized-by ${id} is not a comment on ${r.key}`);
		const raw = inline.concat(issue).find((c) => String(c.id) === id);
		return {id, author: hit.author || (raw && raw.user && raw.user.login), body: hit.body, isBot: Boolean(raw && raw.user && raw.user.type === 'Bot')};
	});
	const auth = lib.cleanupAuthorization(triggers, {prAuthor: pr.user && pr.user.login, me: login});
	if (!auth.authorized) fail(`cleanup not authorized: ${auth.why}`);
	process.stdout.write(`\nauthorized (${auth.by}): ${auth.why}\n`);
	for (const c of auth.comments) process.stdout.write(`  trigger ${c.id}: ${short(c.body)}\n`);
	// The two agents agreeing reaches only what they had to themselves; a thread a person wrote
	// in is a conversation with them, and clearing the owner's side of it is the owner's call.
	const removable = auth.scope === 'all' ? res.eligible : res.internal;
	if (auth.scope !== 'all' && res.answered.length) {
		process.stdout.write(
			`  scope: internal only - leaving ${res.answered.length} comment(s) that were addressed to a person\n`,
		);
	}
	for (const d of stale) {
		graphql(`mutation($id:ID!){ deletePullRequestReviewComment(input:{id:$id}){ clientMutationId } }`, {id: d.nodeId});
		process.stdout.write(`dropped draft ${d.nodeId}\n`);
	}
	for (const c of removable) {
		const path = c.kind === 'inline'
			? `repos/${r.owner}/${r.repo}/pulls/comments/${c.id}`
			: `repos/${r.owner}/${r.repo}/issues/comments/${c.id}`;
		gh(['api', '--method', 'DELETE', path]);
		process.stdout.write(`deleted ${c.kind} ${c.id}\n`);
	}
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
	// GitHub rejects APPROVE and REQUEST_CHANGES on your own PR with an opaque error. Say
	// which one applies here rather than letting the mutation fail three calls deep.
	if (event !== 'COMMENT') {
		const author = prMeta(r).user;
		if (author && author.login === login) {
			fail(`${r.key} is your own PR - GitHub only allows --event COMMENT on it`);
		}
	}
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
// The pending review's own comments are a real channel and appear on no published endpoint:
// the reviewer answers their own PR as a draft, and nothing else would ever surface it.
// Resolved per pass because the pending review id changes when a review is submitted and reopened.
function draftSurface(r, login) {
	const mine = (ghJsonSoft(['api', '--paginate', `repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews`]).data || [])
		.filter((v) => v.user && v.user.login === login);
	const pending = mine.find((v) => v.state === 'PENDING');
	if (!pending) return null;
	return {
		name: 'draft',
		args: ['api', '--paginate', `repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews/${pending.id}/comments`],
		map: (c) => ({
			id: c.id,
			user: c.user && c.user.login,
			isBot: false,
			where: `${c.path}:${c.line || c.original_line || '?'} (unsubmitted)`,
			body: c.body || '',
			url: c.html_url,
		}),
	};
}

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
	const surfaces = [...watchSurfaces(r), draftSurface(r, opts.myLogin)].filter(Boolean);
	for (const surface of surfaces) {
		const res = ghJsonSoft(surface.args);
		if (!res.ok) return {key, prState, error: `${surface.name}: ${res.error}`};
		const rows = (res.data || []).map(surface.map).filter((c) => String(c.body || '').trim() !== '');
		const seen = lib.unseenComments(rows, entry[surface.name], {
			ownSide: opts.ownSide,
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

// Two clocks, not one. A comment pass hits three endpoints per known PR; the queue sweep
// re-resolves every review request through the PR endpoint, so it costs far more. Running
// both at the comment cadence would multiply the API cost of a question whose answer changes
// a few times a day.
const COMMENT_POLL_MS = 120_000;
const QUEUE_POLL_MS = 900_000;

// `reportAll` is the first sweep of a process: queueSeen outlives the process, so deduping
// against it on startup would open a session blind to work already waiting (references/watch.md).
function sweepQueue(watchState, login, {reportAll = false} = {}) {
	const rows = queueRows({}, login);
	const {fresh, seen} = lib.unseenQueueRows(rows, reportAll ? {} : watchState.queueSeen);
	watchState.queueSeen = seen;
	// Everything open the sweep saw stays a comment target until the next sweep, which is how
	// a PR that is not in state.md - notably the reviewer's own - gets its replies polled.
	watchState.queueTargets = rows.filter((r) => r.status !== 'closed').map((r) => r.key);
	for (const row of fresh) {
		process.stdout.write(`\n[queue] ${row.key} - ${row.status}: ${row.reason}\n`);
		process.stdout.write(`  ${row.title}\n`);
		process.stdout.write(`  ${row.url}${row.isDraftPr ? '  (draft PR)' : ''}\n`);
	}
	return {count: fresh.length, scanned: rows.length};
}

async function cmdWatch() {
	const myLogin = me();
	// This watch is the reviewing side, so its own [dev-review-ai] output is the only echo to skip.
	const opts = {includeBots: false, openOnly: false, myLogin, ownSide: 'review'};
	const stateFile = paths.statePath();
	process.stdout.write(`[watch] store=${stateFile} me=${myLogin}\n`);
	let nextQueueAt = 0;
	let firstSweep = true;

	for (;;) {
		const entries = existsSync(stateFile) ? lib.parseStateMd(readFileSync(stateFile, 'utf8')) : {};
		const watchState = loadWatchState();
		if (Date.now() >= nextQueueAt) {
			const q = sweepQueue(watchState, myLogin, {reportAll: firstSweep});
			saveWatchState(watchState);
			nextQueueAt = Date.now() + QUEUE_POLL_MS;
			process.stdout.write(`[queue] ${q.count} ${firstSweep ? 'actionable' : 'new'} of ${q.scanned} classified\n`);
			firstSweep = false;
		}
		const targets = lib.watchTargets(entries, watchState.queueTargets);
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
		await new Promise((resolve) => setTimeout(resolve, COMMENT_POLL_MS));
	}
}

// Live facts for one recorded PR. A PR that cannot be read still gets a card, so a
// revoked token on one repo does not quietly drop it off the reviewer's list.
function dashboardFacts(key, login) {
	const r = lib.parsePrRef(key);
	if (!r) return null;
	const base = {
		key,
		filesUrl: `https://github.com/${r.owner}/${r.repo}/pull/${r.number}/files`,
	};
	const meta = ghJsonSoft([
		'pr', 'view', String(r.number), '--repo', `${r.owner}/${r.repo}`,
		'--json', 'title,author,headRefOid,state,mergeable,reviewDecision,statusCheckRollup',
	]);
	if (!meta.ok || !meta.data) return {...base, title: '(unreadable)', unreadable: meta.error || 'no data'};
	const d = meta.data;
	const rollup = Array.isArray(d.statusCheckRollup) ? d.statusCheckRollup : [];
	let pendingDrafts = 0;
	try {
		pendingDrafts = (pendingReviewFor(r, login).pending || {drafts: []}).drafts.length;
	} catch {
		pendingDrafts = 0;
	}
	return {
		...base,
		title: d.title,
		author: d.author && d.author.login,
		headSha: d.headRefOid,
		prState: String(d.state || '').toLowerCase(),
		mergeable: d.mergeable,
		reviewDecision: d.reviewDecision,
		checksFailing: rollup.filter((c) => c && c.conclusion === 'FAILURE').length,
		pendingDrafts,
	};
}

function readJsonOr(file, fallback) {
	if (!file || !existsSync(file)) return fallback;
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		fail(`could not parse ${file}: ${err.message}`);
	}
}

function cmdDashboard(flags) {
	const out = flags.out;
	if (typeof out !== 'string') fail('--out FILE is required (where to write the dashboard HTML)');
	const login = me();
	const stateFile = paths.statePath();
	const entries = existsSync(stateFile) ? lib.parseStateMd(readFileSync(stateFile, 'utf8')) : {};
	const ledger = existsSync(paths.commentsLogPath())
		? lib.parseLedger(readFileSync(paths.commentsLogPath(), 'utf8'))
		: [];
	const actions = readJsonOr(flags.actions, {prs: {}});

	const prs = [];
	for (const key of Object.keys(entries).sort()) {
		const facts = dashboardFacts(key, login);
		if (facts) prs.push({...facts, storeStatus: entries[key].status, mine: facts.author === login});
	}
	const model = lib.dashboardModel({prs, ledger, actions, generatedAt: new Date().toISOString()});
	const html = dash.renderDashboard(model, {title: flags.title || 'Review queue', reviewer: login});
	writeFileSync(out, html);

	const stored = readJsonOr(paths.dashboardStatePath(), {});
	process.stdout.write(`dashboard: ${out} (${model.cards.length} PRs, ${model.needsYou} waiting on you)\n`);
	if (model.missingNext.length) {
		process.stdout.write(`dashboard: no next step written for ${model.missingNext.join(', ')}\n`);
	}
	if (model.missingCta.length) {
		process.stdout.write(`dashboard: no cta button for ${model.missingCta.join(', ')}\n`);
	}
	// Printed rather than left to the agent's judgment: the identity of this page has
	// to be the same for every user on every run, or the tab and the gallery card move.
	process.stdout.write('\npublish with exactly:\n');
	process.stdout.write(`  file_path:   ${out}\n`);
	process.stdout.write(`  title:       ${dash.ARTIFACT.title}\n`);
	process.stdout.write(`  description: ${dash.ARTIFACT.description}\n`);
	process.stdout.write(`  favicon:     ${dash.ARTIFACT.favicon}\n`);
	process.stdout.write(
		stored.url
			? `  url:         ${stored.url}\n`
			: '  url:         (none yet - after publishing, run: dashboard-url --set <url>)\n',
	);
}

function cmdDashboardUrl(flags) {
	const file = paths.dashboardStatePath();
	if (typeof flags.set === 'string') {
		if (!/^https:\/\/\S+$/.test(flags.set)) fail('--set expects the published artifact https URL');
		paths.ensureDir(paths.reviewNotesDir());
		writeFileSync(file, JSON.stringify({url: flags.set, at: new Date().toISOString()}, null, '\t') + '\n');
		process.stdout.write(`dashboard url recorded: ${flags.set}\n`);
		return;
	}
	const stored = readJsonOr(file, {});
	process.stdout.write(stored.url ? `${stored.url}\n` : '(none recorded)\n');
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
		case 'cleanup':
			return cmdCleanup(positional[1], flags);
		case 'dashboard':
			return cmdDashboard(flags);
		case 'dashboard-url':
			return cmdDashboardUrl(flags);
		case 'watch':
			return cmdWatch(flags).catch((err) => fail(`watch: ${err instanceof Error ? err.message : String(err)}`));
		default:
			process.stdout.write(USAGE + '\n');
			process.exit(cmd ? 1 : 0);
	}
}

if (require.main === module) main();

module.exports = {parseArgs};
