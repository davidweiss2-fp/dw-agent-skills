// Behaviour of the status page's client filter, run against the mini DOM in tests/support.
// The other suite asserts the rendered markup; this one asserts what the page DOES with it.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

import {makeEnv, makeLocalStorage, runClient} from './support/mini-dom.mjs';
import {buildPage, laneCount, visibleKeys, activeFilter, clickFilter} from './support/queue-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dashboard = require(join(HERE, '..', 'skills', 'dw-review-prs-skill', 'scripts', 'review-prs-dashboard.js'));

const FILTER_KEY = 'dw-review-queue-filter-v1';
const FEEDBACK_KEY = 'dw-review-queue-feedback-v1';

// Two of yours in one lane, one of theirs in another, plus a lane holding only theirs - enough
// for a lane to empty out under one filter and not the other.
const CARDS = [
	{key: 'a/b#1', side: 'yours', lane: 'needs-you', cta: 'Approve the PR'},
	{key: 'a/b#2', side: 'yours', lane: 'waiting-author'},
	{key: 'a/b#3', side: 'theirs', lane: 'needs-you', cta: 'Approve the PR'},
	{key: 'a/b#4', side: 'theirs', lane: 'delegated'},
];

function mount({cards = CARDS, storage = {}, empty} = {}) {
	const page = buildPage({cards, empty});
	const store = makeLocalStorage(storage);
	const env = makeEnv(page, store);
	runClient(dashboard.dashboardClient, env);
	return {page, store, env};
}

describe('queue page filter behaviour', () => {
	it('shows everything on All and hides the other side when a side is chosen', () => {
		const {page} = mount();
		assert.deepEqual(visibleKeys(page), ['a/b#1', 'a/b#3', 'a/b#2', 'a/b#4']);

		clickFilter(page, 'yours');
		assert.deepEqual(visibleKeys(page), ['a/b#1', 'a/b#2']);

		clickFilter(page, 'theirs');
		assert.deepEqual(visibleKeys(page), ['a/b#3', 'a/b#4']);

		clickFilter(page, 'all');
		assert.equal(visibleKeys(page).length, 4);
	});

	it('hides a lane once the filter empties it, and restores it', () => {
		const {page} = mount();
		const delegated = page.querySelector('.lane[id="delegated"]');
		assert.equal(delegated.hidden, false);

		clickFilter(page, 'yours');
		assert.equal(delegated.hidden, true, 'delegated holds only theirs, so it should collapse');
		assert.equal(page.querySelector('.lane[id="needs-you"]').hidden, false);

		clickFilter(page, 'all');
		assert.equal(delegated.hidden, false);
	});

	it('re-derives every lane count from what the filter leaves visible', () => {
		const {page} = mount();
		assert.deepEqual([laneCount(page, 'needs-you'), laneCount(page, 'waiting-author'), laneCount(page, 'delegated')], ['2', '1', '1']);

		clickFilter(page, 'yours');
		assert.deepEqual([laneCount(page, 'needs-you'), laneCount(page, 'waiting-author'), laneCount(page, 'delegated')], ['1', '1', '0']);
		assert.equal(page.querySelector('.count[data-lane="delegated"]').classList.contains('zero'), true);

		clickFilter(page, 'theirs');
		assert.deepEqual([laneCount(page, 'needs-you'), laneCount(page, 'waiting-author'), laneCount(page, 'delegated')], ['1', '0', '1']);
	});

	it('moves the pressed state and the highlight together', () => {
		const {page} = mount();
		assert.equal(activeFilter(page), 'all');

		clickFilter(page, 'theirs');
		assert.equal(activeFilter(page), 'theirs');
		assert.equal(page.querySelector('.side-filter[data-filter="theirs"]').getAttribute('aria-pressed'), 'true');
		assert.equal(page.querySelector('.side-filter[data-filter="all"]').getAttribute('aria-pressed'), 'false');
	});

	it('remembers the chosen side under its own key, leaving feedback state alone', () => {
		const {page, store} = mount({storage: {[FEEDBACK_KEY]: JSON.stringify({comments: [], decisions: {'a/b#1': 'Approve the PR'}})}});
		clickFilter(page, 'theirs');
		assert.equal(store.getItem(FILTER_KEY), 'theirs');
		// The feedback entry must survive untouched: sharing the key would overwrite this JSON
		// with a bare filter id and lose every recorded comment on the next load.
		assert.deepEqual(JSON.parse(store.getItem(FEEDBACK_KEY)).decisions, {'a/b#1': 'Approve the PR'});
	});

	it('opens on the remembered side, and falls back to All for a value it does not offer', () => {
		const remembered = mount({storage: {[FILTER_KEY]: 'theirs'}});
		assert.equal(activeFilter(remembered.page), 'theirs');
		assert.deepEqual(visibleKeys(remembered.page), ['a/b#3', 'a/b#4']);

		const garbage = mount({storage: {[FILTER_KEY]: 'bogus-side'}});
		assert.equal(activeFilter(garbage.page), 'all');
		assert.equal(visibleKeys(garbage.page).length, 4, 'an unknown filter must not blank the page');
	});

	it('explains an empty side, and lets the queue-empty message stand', () => {
		const {page} = mount({empty: {yours: 'None of yours.', theirs: 'None of theirs.'}, cards: CARDS.filter((c) => c.side === 'theirs')});
		const note = page.querySelector('.empty-note');
		assert.equal(note.hidden, true);

		clickFilter(page, 'yours');
		assert.equal(note.hidden, false);
		assert.equal(note.textContent, 'None of yours.');

		clickFilter(page, 'all');
		assert.equal(note.hidden, true);
	});

	it('keeps the queue-empty message even with a side remembered', () => {
		const {page} = mount({cards: [], storage: {[FILTER_KEY]: 'theirs'}, empty: {all: 'No PRs recorded yet.'}});
		const note = page.querySelector('.empty-note');
		assert.equal(note.hidden, false);
		// The queue is empty, not the side: saying "none of theirs" would imply some of yours exist.
		assert.equal(note.textContent, 'No PRs recorded yet.');
	});
});

describe('feedback the filter is hiding', () => {
	const withDecision = {
		[FEEDBACK_KEY]: JSON.stringify({comments: [], decisions: {'a/b#3': 'Approve the PR'}}),
	};

	it('stays silent while the card carrying it is visible', () => {
		const {page} = mount({storage: withDecision});
		assert.equal(page.querySelector('.btn.reveal').hidden, true);
	});

	it('announces the buried PR once the filter hides it, and clears again', () => {
		const {page} = mount({storage: withDecision});
		clickFilter(page, 'yours');
		const reveal = page.querySelector('.btn.reveal');
		assert.equal(reveal.hidden, false);
		assert.match(reveal.textContent, /1 PR hidden by the filter/);

		clickFilter(page, 'all');
		assert.equal(reveal.hidden, true);
	});

	it('counts each buried PR once, however much feedback it carries', () => {
		const {page} = mount({
			storage: {
				[FEEDBACK_KEY]: JSON.stringify({
					comments: [
						{id: 'c1', key: 'a/b#3', quote: 'q', text: 't'},
						{id: 'c2', key: 'a/b#3', quote: 'q2', text: 't2'},
					],
					decisions: {'a/b#3': 'Approve the PR', 'a/b#4': 'Acknowledge'},
				}),
			},
		});
		clickFilter(page, 'yours');
		assert.match(page.querySelector('.btn.reveal').textContent, /2 PRs hidden by the filter/);
	});

	it('brings the buried feedback back into view when clicked', () => {
		const {page, store} = mount({storage: withDecision});
		clickFilter(page, 'yours');
		page.querySelector('.btn.reveal').click();
		assert.equal(activeFilter(page), 'all');
		assert.equal(store.getItem(FILTER_KEY), 'all', 'the reveal is a real filter change, so it persists');
		assert.ok(visibleKeys(page).includes('a/b#3'));
	});

	it('still ships a hidden card decision in the copied payload', () => {
		const {page} = mount({storage: withDecision});
		clickFilter(page, 'yours');
		assert.equal(page.querySelector('.card[data-key="a/b#3"]').hidden, true);
		page.querySelector('[id="handoff-copy"]').click();
		// A filter is a view; the payload is the record of what was decided.
		assert.match(page.querySelector('[id="payload"]').value, /a\/b#3/);
	});
});
