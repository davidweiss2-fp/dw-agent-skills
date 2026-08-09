'use strict';

// GENERATED from utils/agent-tags.js by utils/sync-utils.js - do not edit here.
// Edit the source and re-run `node utils/sync-utils.js`; CI fails on drift.

// Who signed a PR comment, and whether it was meant for a person.
//
// Two agents write on the same PR under the SAME account, so author identity cannot tell them
// apart, nor tell either from the human. The signature is the only discriminator, which is why
// both skills have to read it identically - one of them classifying a comment differently from
// the other is how an agent's own words get obeyed as the user's.
//
//   [dev-review-ai]              the reviewing agent, addressed to whoever reads the PR
//   [dev-author-ai | internal]   the author's agent, agent-to-agent, never for a human
//   (no signature)               a person - they sign nothing, which is what makes it the
//                                deciding voice

const REVIEW_TAG = '[dev-review-ai]';
const AUTHOR_TAG = '[dev-author-ai]';
// Recognised on read, never written: comments already on PRs and rows already in ledgers carry
// them. `[dev-ai]` was worn by both sides before the split and resolves to the reviewing one,
// which is what it meant in this suite's own output.
const LEGACY_TAGS = ['[dev-ai]', '[author-ai]'];

const SIGNATURE = /^\[(dev-review-ai|dev-author-ai|dev-ai|author-ai)(\s*\|\s*internal)?\]/;

// A signature only counts when it OPENS the comment, and emphasis and case are cosmetic.
// Matching anywhere would read a person quoting a tag as the agent that wrote it; failing to
// match through `**[DEV-AI]**` - the form one skill actually wrote - reads an agent as a person.
// `>` is deliberately not stripped: a blockquote is someone citing an agent, not one signing.
function signature(body) {
	const first = String(body || '').split('\n').find((l) => l.trim() !== '');
	if (!first) return {side: null, internal: false};
	const m = SIGNATURE.exec(first.trim().replace(/^[*_`\s]+/, '').toLowerCase());
	if (!m) return {side: null, internal: false};
	const side = m[1] === 'dev-author-ai' || m[1] === 'author-ai' ? 'author' : 'review';
	return {side, internal: Boolean(m[2])};
}

function signedSide(body) {
	return signature(body).side;
}

module.exports = {REVIEW_TAG, AUTHOR_TAG, LEGACY_TAGS, SIGNATURE, signature, signedSide};
