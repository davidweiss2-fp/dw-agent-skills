// Builds the status page's structure for the mini DOM: the elements `dashboardClient` looks up,
// with the same ids, classes and data attributes the renderer emits. Kept beside the harness
// rather than parsed out of the HTML, because the markup-to-selector contract is asserted
// separately against the real rendered page.

import {El} from './mini-dom.mjs';

const LANES = ['needs-you', 'waiting-author', 'delegated', 'done'];

// cards: [{key, side, lane, cta}]
export function buildPage({cards = [], sides = ['yours', 'theirs'], empty = {}} = {}) {
	const wrap = new El('div', {class: 'wrap'});

	const filters = new El('div', {class: 'side-filters'});
	for (const id of ['all', ...sides]) {
		const n = id === 'all' ? cards.length : cards.filter((c) => c.side === id).length;
		const button = new El('button', {
			class: 'side-filter' + (id === 'all' ? ' on' : ''),
			'data-filter': id,
			'aria-pressed': id === 'all' ? 'true' : 'false',
		});
		button.appendChild(new El('span', {}, id));
		button.appendChild(new El('b', {}, String(n)));
		filters.appendChild(button);
	}
	wrap.appendChild(filters);

	const counts = new El('nav', {class: 'counts'});
	for (const lane of LANES) {
		const n = cards.filter((c) => c.lane === lane).length;
		const anchor = new El('a', {class: 'count ' + lane + (n ? '' : ' zero'), 'data-lane': lane});
		anchor.appendChild(new El('b', {}, String(n)));
		counts.appendChild(anchor);
	}
	wrap.appendChild(counts);

	// Only lanes holding cards are rendered, matching the server.
	for (const lane of LANES) {
		const inLane = cards.filter((c) => c.lane === lane);
		if (!inLane.length) continue;
		const section = new El('section', {class: 'lane', id: lane});
		for (const card of inLane) {
			const article = new El('article', {
				class: 'card ' + lane,
				'data-key': card.key,
				'data-side': card.side,
			});
			if (card.cta) {
				const cta = new El('button', {class: 'cta', 'data-phrase': card.cta, 'data-label': card.cta}, card.cta);
				article.appendChild(cta);
			}
			section.appendChild(article);
		}
		wrap.appendChild(section);
	}

	const note = new El('p', {class: 'empty-note', id: 'empty-note', role: 'status'});
	for (const id of sides) note.setAttribute('data-' + id, empty[id] || `nothing on ${id}`);
	if (cards.length) note.hidden = true;
	else note.textContent = empty.all || 'No PRs recorded yet.';
	wrap.appendChild(note);

	const bar = new El('div', {class: 'handoff', id: 'handoff'});
	bar.appendChild(new El('span', {class: 'handoff-count', id: 'handoff-count'}, 'Nothing selected yet'));
	const reveal = new El('button', {class: 'btn reveal', id: 'reveal-hidden'});
	reveal.hidden = true;
	bar.appendChild(reveal);
	bar.appendChild(new El('button', {class: 'btn primary', id: 'handoff-copy'}, 'Copy comments'));
	bar.appendChild(new El('button', {class: 'btn', id: 'handoff-clear'}, 'Clear'));
	bar.appendChild(new El('span', {class: 'handoff-note', id: 'handoff-note'}));
	const payload = new El('textarea', {id: 'payload'});
	payload.hidden = true;
	bar.appendChild(payload);
	wrap.appendChild(bar);

	// The select-to-comment furniture. Present because the client wires it at startup; inert
	// because the fake selection is always collapsed.
	const pill = new El('button', {class: 'selpill', id: 'selpill'});
	pill.hidden = true;
	wrap.appendChild(pill);
	const pop = new El('div', {class: 'annopop', id: 'annopop'});
	pop.hidden = true;
	pop.appendChild(new El('div', {class: 'annopop-quote', id: 'annopop-quote'}));
	pop.appendChild(new El('textarea', {id: 'annopop-input'}));
	pop.appendChild(new El('button', {id: 'annopop-cancel'}));
	pop.appendChild(new El('button', {id: 'annopop-save'}));
	wrap.appendChild(pop);

	return wrap;
}

export function laneCount(page, lane) {
	return page.querySelector(`.count[data-lane="${lane}"]`).querySelector('b').textContent;
}

export function visibleKeys(page) {
	return page.querySelectorAll('.card:not([hidden])').map((c) => c.dataset.key);
}

export function activeFilter(page) {
	const on = page.querySelector('.side-filter.on');
	return on ? on.dataset.filter : null;
}

export function clickFilter(page, id) {
	page.querySelector(`.side-filter[data-filter="${id}"]`).click();
}
