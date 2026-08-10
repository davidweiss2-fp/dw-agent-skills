'use strict';

// Renders the review-queue dashboard: one self-contained HTML page, published as an
// Artifact and re-published to the same URL every run. Pure string building - no I/O,
// no gh - so the markup is testable. Escaping is not optional here: PR titles and
// findings are other people's text.

const LANE_META = {
	'needs-you': {label: 'Waiting on you', hint: 'your click is the next move'},
	'waiting-author': {label: 'Waiting on the author', hint: 'answered or handed back'},
	delegated: {label: 'Someone else owns it', hint: 'another routine or reviewer'},
	done: {label: 'Closed out', hint: 'merged or closed'},
};

// Ownership is orthogonal to the lanes: a card is on exactly one side of the split, and the
// side's id is what gets stamped on the card, so the client filters on one string comparison.
const SIDES = [
	{
		id: 'yours',
		label: 'Yours',
		empty: 'No PRs you authored are in the queue.',
		holds: (card) => Boolean(card.mine),
	},
	{
		id: 'theirs',
		label: 'Theirs',
		empty: 'No PRs from anyone else are in the queue.',
		holds: (card) => !card.mine,
	},
];

// Not a side - the absence of a filter, which is why it holds everything.
const NO_FILTER = {id: 'all', label: 'All', empty: 'No PRs recorded yet.', holds: () => true};
const FILTERS = [NO_FILTER, ...SIDES];

function sideOf(card) {
	return SIDES.find((side) => side.holds(card)).id;
}

// The published page's identity, fixed here rather than chosen per run: a title or
// favicon that moves between runs reads as a different page in the tab and the
// gallery, and every user of this skill should get the same one.
const ARTIFACT = {
	title: 'Review queue',
	description: 'Every PR this reviewer has touched, the one next step per PR, and comments to copy back into the run.',
	favicon: '\u{1F50D}',
};

const WEIGHT_TONE = {
	blocker: 'crit',
	'please fix': 'warn',
	suggestion: 'info',
	question: 'info',
	nit: 'mute',
};

// Escapes markup, then renders every non-ASCII character as a numeric entity. The
// page is published into a document shell this module does not control, so emitting
// pure ASCII is what keeps an em dash in a PR title from arriving as mojibake.
function esc(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/[^\x20-\x7E\t\n\r]/g, (c) => `&#${c.codePointAt(0)};`);
}

function shortSha(sha) {
	return String(sha || '').slice(0, 7);
}

function stateChip(card) {
	const bits = [];
	if (Number(card.pendingDrafts) > 0) {
		const n = Number(card.pendingDrafts);
		bits.push({tone: 'accent', text: `${n} unsubmitted draft${n === 1 ? '' : 's'}`});
	}
	if (card.prState && card.prState !== 'open') bits.push({tone: 'good', text: esc(card.prState)});
	if (card.reviewDecision === 'APPROVED') bits.push({tone: 'good', text: 'approved'});
	if (card.reviewDecision === 'CHANGES_REQUESTED') bits.push({tone: 'crit', text: 'changes requested'});
	if (card.mergeable === 'CONFLICTING') bits.push({tone: 'crit', text: 'conflicting'});
	if (card.checksFailing) bits.push({tone: 'crit', text: `${card.checksFailing} check(s) failing`});
	return bits;
}

// A card with unsubmitted drafts needs a resolution, not an instruction. "Read the
// drafts, then submit" is addressed to the reviewer, so it comes back to the agent
// saying nothing about what to do; these three name the GitHub review event instead.
const RESOLUTIONS = [
	{event: 'COMMENT', label: 'Comment'},
	{event: 'APPROVE', label: 'Approve'},
	{event: 'REQUEST_CHANGES', label: 'Request changes'},
];

function submitPhrase(event) {
	return `I read the drafts — submit them as ${event}`;
}

// The next-step box holds this PR's one decision. The page cannot reach GitHub, so a
// button's honest job is to tell the agent what was decided - the label says the
// action, the confirmed state says who carries it out.
function renderNext(card) {
	let action = '';
	if (Number(card.pendingDrafts) > 0) {
		// GitHub refuses APPROVE and REQUEST_CHANGES on your own PR, so offering them is an
		// error the reviewer can only discover by clicking. COMMENT stays, and it is not
		// optional here: an unsubmitted draft is visible to nobody, so publishing is what
		// turns these into the comments the handoff brief tells the coding agent to read.
		const events = card.mine ? RESOLUTIONS.filter((r) => r.event === 'COMMENT') : RESOLUTIONS;
		const buttons = events
			.map(
				(r) =>
					`<button class="cta resolve" type="button" data-phrase="${esc(submitPhrase(r.event))}" data-label="${esc(r.label)}">${esc(r.label)}</button>`,
			)
			.join('');
		const lead = card.mine ? 'Publish them for the coding agent' : 'Read them, then submit as';
		action = `<div class="resolve-row"><span class="resolve-label">${lead}</span>${buttons}</div>`;
	} else if (card.cta) {
		action = `<button class="cta" type="button" data-phrase="${esc(card.cta)}" data-label="${esc(card.cta)}">${esc(card.cta)}</button>`;
	}
	// Unsubmitted drafts keep their resolution buttons even when no next step was recorded.
	// Otherwise the card shows "3 unsubmitted drafts" and offers no way to resolve them,
	// which is the one thing that card exists to let the reviewer do.
	if (!card.next) {
		return `<div class="next empty">
		<p>No next step recorded for this PR.</p>
		${action}
	</div>`;
	}
	return `<div class="next">
		<span class="next-label">Your next step</span>
		<p>${esc(card.next)}</p>
		${action}
	</div>`;
}

// Your own PR is the one card whose next move belongs to somebody else, so it carries a brief
// to hand them rather than an instruction to yourself. Rendered collapsed: it is long, and it is
// not what you are reading the page for.
function renderHandoff(card) {
	if (!card.handoffPrompt) return '';
	return `<div class="handoffbox">
		<button class="handoff-toggle" type="button" data-handoff="toggle">Prompt for the coding agent</button>
		<div class="handoff-body" hidden>
			<div class="handoff-row">
				<span class="handoff-hint">Copy as-is into the agent doing the work</span>
				<button class="btn primary" type="button" data-handoff="copy">Copy</button>
			</div>
			<textarea class="handoff-text" readonly rows="16">${esc(card.handoffPrompt)}</textarea>
		</div>
	</div>`;
}

function renderCard(card) {
	// Deliberately not a stateChip: that function's concern is the PR's state, and who wrote it
	// is not a state. It leads the row, because it says what you are looking at.
	const chips =
		(card.mine ? '<span class="chip yours">yours</span>' : '') +
		stateChip(card)
			.map((c) => `<span class="chip ${c.tone}">${esc(c.text)}</span>`)
			.join('');
	const comments = card.comments.length
		? `<ul class="findings">${card.comments
				.map((c) => {
					const tone = WEIGHT_TONE[c.weight] || 'mute';
					const weight = c.weight && c.weight !== 'none' ? c.weight : c.status;
					const struck = c.status === 'dropped' ? ' dropped' : '';
					return `<li class="${struck.trim()}"><span class="weight ${tone}">${esc(weight)}</span><span class="finding">${esc(c.finding)}</span></li>`;
				})
				.join('')}</ul>`
		: '';
	const notes = card.notes.length
		? `<ul class="notes">${card.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
		: '';
	return `<article class="card ${esc(card.lane)}" data-key="${esc(card.key)}" data-own="${esc(sideOf(card))}">
	<header>
		<div class="ident">
			<a class="key" href="${esc(card.filesUrl)}">${esc(card.key)}</a>
			<span class="meta">${esc(card.author || 'unknown')} &#183; ${esc(shortSha(card.headSha))}</span>
		</div>
		<h3>${esc(card.title || '(no title)')}</h3>
		<div class="chips">${chips}</div>
	</header>
	${renderNext(card)}
	${renderHandoff(card)}
	${notes}
	${comments}
</article>`;
}

// The page's own behaviour, written as a real function and serialized into a <script>
// so `node --check` parses it instead of it hiding inside a string literal. It closes
// over nothing: everything it needs is in the DOM. The page cannot reach GitHub, so
// every button here records an instruction for the agent and says so.
function dashboardClient() {
	'use strict';
	var KEY = 'dw-review-queue-feedback-v1';
	var state = {comments: [], decisions: {}};
	var seq = 0;
	var pendingRange = null;

	try {
		var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
		if (saved && typeof saved === 'object') {
			state.comments = Array.isArray(saved.comments) ? saved.comments : [];
			state.decisions = saved.decisions && typeof saved.decisions === 'object' ? saved.decisions : {};
		}
	} catch (err) {
		// A blocked or full localStorage costs persistence, not the page.
	}

	function persist() {
		try {
			localStorage.setItem(KEY, JSON.stringify(state));
		} catch (err) {
			/* nothing to do - the payload is still in memory and copyable */
		}
	}

	function flatten(value) {
		var one = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
		return one.length > 160 ? one.slice(0, 160) + '\u2026' : one;
	}

	var pill = document.getElementById('selpill');
	var pop = document.getElementById('annopop');
	var popQuote = document.getElementById('annopop-quote');
	var popInput = document.getElementById('annopop-input');
	var bar = document.getElementById('handoff');
	var barCount = document.getElementById('handoff-count');
	var payloadBox = document.getElementById('payload');

	function cardOf(node) {
		var el = node && node.nodeType === 1 ? node : node && node.parentElement;
		return el ? el.closest('.card') : null;
	}

	function hide(el) {
		el.hidden = true;
	}

	function currentSelection() {
		var sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		var text = String(sel.toString()).trim();
		if (text.length < 2) return null;
		var range = sel.getRangeAt(0);
		var card = cardOf(range.startContainer);
		if (!card || !card.contains(range.endContainer)) return null;
		if (range.startContainer.parentElement && range.startContainer.parentElement.closest('.next-label')) return null;
		return {range: range, text: text, card: card};
	}

	document.addEventListener('mouseup', function () {
		// Deferred so the browser has finished settling the selection.
		setTimeout(function () {
			if (!pop.hidden) return;
			var found = currentSelection();
			if (!found) {
				hide(pill);
				return;
			}
			var rect = found.range.getBoundingClientRect();
			pill.style.top = window.scrollY + rect.top - 38 + 'px';
			pill.style.left = window.scrollX + rect.left + 'px';
			pill.hidden = false;
		}, 0);
	});

	pill.addEventListener('click', function () {
		var found = currentSelection();
		if (!found) return;
		pendingRange = {range: found.range.cloneRange(), text: found.text, key: found.card.dataset.key};
		hide(pill);
		popQuote.textContent = found.text.length > 180 ? found.text.slice(0, 180) + '\u2026' : found.text;
		popInput.value = '';
		var rect = found.range.getBoundingClientRect();
		pop.style.top = window.scrollY + rect.bottom + 8 + 'px';
		pop.style.left = window.scrollX + Math.max(8, Math.min(rect.left, window.innerWidth - 340)) + 'px';
		pop.hidden = false;
		popInput.focus();
	});

	function closePop() {
		hide(pop);
		pendingRange = null;
		// Drop the selection too, or the next mouseup pops the pill straight back up
		// on the text the reviewer just declined to comment on.
		var sel = window.getSelection();
		if (sel) sel.removeAllRanges();
	}

	document.getElementById('annopop-cancel').addEventListener('click', closePop);

	// Clicking away dismisses, the way it does in a document editor.
	document.addEventListener('mousedown', function (ev) {
		if (pop.hidden) return;
		if (pop.contains(ev.target) || ev.target === pill) return;
		closePop();
	});

	document.getElementById('annopop-save').addEventListener('click', function () {
		var text = popInput.value.trim();
		if (!text || !pendingRange) return;
		var id = 'c' + ++seq + '-' + Date.now();
		// One line per quote: a selection that crossed the weight chip and the finding
		// carried a newline into the payload and broke its one-entry-per-line shape.
		var comment = {id: id, key: pendingRange.key, quote: flatten(pendingRange.text), text: text};
		var wrapped = false;
		try {
			var mark = document.createElement('mark');
			mark.className = 'anno';
			mark.dataset.anno = id;
			pendingRange.range.surroundContents(mark);
			wrapped = true;
		} catch (err) {
			try {
				var mark2 = document.createElement('mark');
				mark2.className = 'anno';
				mark2.dataset.anno = id;
				mark2.appendChild(pendingRange.range.extractContents());
				pendingRange.range.insertNode(mark2);
				wrapped = true;
			} catch (err2) {
				// A selection spanning elements stays unhighlighted; the quote still carries it.
			}
		}
		comment.highlighted = wrapped;
		state.comments.push(comment);
		persist();
		renderComment(comment);
		refresh();
		window.getSelection().removeAllRanges();
		closePop();
	});

	popInput.addEventListener('keydown', function (ev) {
		if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) document.getElementById('annopop-save').click();
	});

	document.addEventListener('keydown', function (ev) {
		if (ev.key !== 'Escape') return;
		closePop();
		hide(pill);
	});

	function cardFor(key) {
		return document.querySelector('.card[data-key="' + key.replace(/"/g, '\\"') + '"]');
	}

	function renderComment(comment) {
		var card = cardFor(comment.key);
		if (!card) return;
		var list = card.querySelector('.annos');
		if (!list) {
			list = document.createElement('ul');
			list.className = 'annos';
			card.appendChild(list);
		}
		var li = document.createElement('li');
		li.dataset.anno = comment.id;
		var quote = document.createElement('span');
		quote.className = 'anno-quote';
		quote.textContent = '\u201c' + comment.quote + '\u201d';
		var body = document.createElement('span');
		body.className = 'anno-text';
		body.textContent = comment.text;
		var drop = document.createElement('button');
		drop.type = 'button';
		drop.className = 'anno-drop';
		drop.setAttribute('aria-label', 'Remove this comment');
		drop.textContent = '\u00d7';
		drop.addEventListener('click', function () {
			state.comments = state.comments.filter(function (c) {
				return c.id !== comment.id;
			});
			persist();
			li.remove();
			var hl = document.querySelector('mark.anno[data-anno="' + comment.id + '"]');
			if (hl && hl.parentNode) {
				while (hl.firstChild) hl.parentNode.insertBefore(hl.firstChild, hl);
				hl.remove();
			}
			if (list && !list.children.length) list.remove();
			refresh();
		});
		li.appendChild(quote);
		li.appendChild(body);
		li.appendChild(drop);
		list.appendChild(li);
	}

	// One decision per card: a resolution group and a single CTA both resolve to one
	// stored phrase, so picking Approve after Comment replaces it rather than stacking.
	function paintCard(card) {
		var key = card.dataset.key;
		Array.prototype.forEach.call(card.querySelectorAll('.cta'), function (btn) {
			if (!btn.dataset.phrase) return;
			var chosen = state.decisions[key] === btn.dataset.phrase;
			btn.classList.toggle('sent', chosen);
			btn.textContent = chosen ? '\u2713 ' + btn.dataset.label : btn.dataset.label;
			btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
		});
	}

	Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
		var key = card.dataset.key;
		Array.prototype.forEach.call(card.querySelectorAll('.cta'), function (btn) {
			// A button with no phrase carries no decision. Without this guard one stores
			// undefined against the PR and repaints itself as a tick over the word 'undefined'.
			if (!btn.dataset.phrase) return;
			btn.addEventListener('click', function () {
				if (state.decisions[key] === btn.dataset.phrase) delete state.decisions[key];
				else state.decisions[key] = btn.dataset.phrase;
				persist();
				paintCard(card);
				refresh();
			});
		});
		paintCard(card);
	});

	// The handoff block is copy-only: it never reaches GitHub and carries no decision, so it
	// stays out of the feedback payload the rest of this page collects.
	Array.prototype.forEach.call(document.querySelectorAll('.handoffbox'), function (box) {
		var body = box.querySelector('.handoff-body');
		var area = box.querySelector('.handoff-text');
		var toggle = box.querySelector('[data-handoff="toggle"]');
		var copy = box.querySelector('[data-handoff="copy"]');
		toggle.addEventListener('click', function () {
			body.hidden = !body.hidden;
			toggle.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
			if (!body.hidden) area.focus();
		});
		copy.addEventListener('click', function () {
			area.focus();
			area.select();
			// execCommand first: this page runs sandboxed, where the async clipboard may not
			// be granted but a copy from a focused, selected textarea under a real click works.
			var ok = false;
			try {
				ok = document.execCommand('copy');
			} catch (err) {
				ok = false;
			}
			if (ok) {
				copy.textContent = 'Copied';
				setTimeout(function () {
					copy.textContent = 'Copy';
				}, 1500);
				return;
			}
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(area.value).then(
					function () {
						copy.textContent = 'Copied';
						setTimeout(function () {
							copy.textContent = 'Copy';
						}, 1500);
					},
					function () {
						copy.textContent = 'Select and copy';
					},
				);
				return;
			}
			copy.textContent = 'Select and copy';
		});
	});

	function payload() {
		var lines = ['## Review queue feedback \u2014 ' + new Date().toISOString(), ''];
		var keys = Object.keys(state.decisions);
		if (keys.length) {
			lines.push('### Do these');
			keys.forEach(function (k) {
				lines.push('- ' + k + ' \u2192 ' + state.decisions[k]);
			});
			lines.push('');
		}
		if (state.comments.length) {
			lines.push('### Comments');
			state.comments.forEach(function (c) {
				lines.push('- ' + c.key + ' \u2014 on \u201c' + flatten(c.quote) + '\u201d');
				lines.push('  ' + c.text);
			});
			lines.push('');
		}
		if (!keys.length && !state.comments.length) lines.push('_Nothing selected yet._');
		return lines.join('\n');
	}

	function refresh() {
		var n = state.comments.length;
		var d = Object.keys(state.decisions).length;
		var parts = [];
		if (d) parts.push(d + (d === 1 ? ' action' : ' actions'));
		if (n) parts.push(n + (n === 1 ? ' comment' : ' comments'));
		barCount.textContent = parts.length ? parts.join(' \u00b7 ') : 'Nothing selected yet';
		bar.classList.toggle('ready', Boolean(n || d));
		if (!payloadBox.hidden) payloadBox.value = payload();
	}

	document.getElementById('handoff-copy').addEventListener('click', function () {
		var text = payload();
		payloadBox.value = text;
		payloadBox.hidden = false;
		payloadBox.focus();
		payloadBox.select();
		var note = document.getElementById('handoff-note');
		function done(msg) {
			note.textContent = msg;
		}
		var OK = 'Copied \u2014 paste it in the chat.';
		var MANUAL = 'Select the text below and copy it manually.';

		// execCommand first, on purpose. This page runs in a sandboxed frame where the
		// async clipboard needs a permission the frame may not have been granted, while
		// a copy from a focused, selected textarea under a real click still works.
		try {
			if (document.execCommand('copy')) {
				done(OK);
				return;
			}
		} catch (err) {
			// fall through to the async API
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(
				function () {
					done(OK);
				},
				function () {
					done(MANUAL);
				},
			);
			return;
		}
		done(MANUAL);
	});

	document.getElementById('handoff-clear').addEventListener('click', function () {
		if (!state.comments.length && !Object.keys(state.decisions).length) return;
		state = {comments: [], decisions: {}};
		persist();
		Array.prototype.forEach.call(document.querySelectorAll('.annos'), function (el) {
			el.remove();
		});
		Array.prototype.forEach.call(document.querySelectorAll('mark.anno'), function (hl) {
			while (hl.firstChild) hl.parentNode.insertBefore(hl.firstChild, hl);
			hl.remove();
		});
		Array.prototype.forEach.call(document.querySelectorAll('.cta'), function (btn) {
			if (!btn.dataset.phrase) return;
			btn.classList.remove('sent');
			btn.textContent = btn.dataset.label;
			btn.setAttribute('aria-pressed', 'false');
		});
		document.getElementById('handoff-note').textContent = '';
		payloadBox.hidden = true;
		refresh();
	});

	// The ownership filter. Its own storage key on purpose: Clear replaces the feedback object
	// wholesale, and clearing your comments must not throw away which slice you were reading.
	var FILTER_KEY = 'dw-review-queue-filter-v1';
	var nothing = document.getElementById('nothing');
	var chips = document.querySelectorAll('.own');
	// An empty queue is a more fundamental truth than an empty side of it, and the server already
	// rendered it. Leaving that text alone stops a remembered filter claiming the slice is why
	// the page is bare when there is nothing in the queue at all.
	var anyCards = Boolean(document.querySelector('.card'));
	var filter = 'all';

	// The chips are the list of valid filters, so a stored value is checked against them rather
	// than against a copy of the ids kept over here, where a renamed slice would not reach.
	try {
		var storedFilter = localStorage.getItem(FILTER_KEY);
		var known = Array.prototype.some.call(chips, function (chip) {
			return chip.dataset.filter === storedFilter;
		});
		if (known) filter = storedFilter;
	} catch (err) {
		// A blocked localStorage costs the remembered slice, not the filter.
	}

	// Hides what the filter excludes, then re-derives every number from what is left. The lane
	// counts describe cards in view, so they follow the filter; the feedback count below does
	// not, because it describes decisions you recorded and those survive being scrolled past.
	function applyFilter() {
		var visible = 0;
		Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
			var show = filter === 'all' || card.dataset.own === filter;
			card.hidden = !show;
			if (show) visible++;
		});
		Array.prototype.forEach.call(document.querySelectorAll('.lane'), function (lane) {
			var shown = lane.querySelectorAll('.card:not([hidden])').length;
			lane.hidden = shown === 0;
			var count = document.querySelector('.count[data-lane="' + lane.id + '"]');
			if (!count) return;
			var num = count.querySelector('b');
			if (num) num.textContent = String(shown);
			count.classList.toggle('zero', shown === 0);
		});
		if (anyCards) nothing.textContent = nothing.dataset[filter];
		nothing.hidden = visible > 0;
		Array.prototype.forEach.call(chips, function (chip) {
			var on = chip.dataset.filter === filter;
			chip.classList.toggle('on', on);
			chip.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
	}

	Array.prototype.forEach.call(chips, function (chip) {
		chip.addEventListener('click', function () {
			filter = chip.dataset.filter;
			try {
				localStorage.setItem(FILTER_KEY, filter);
			} catch (err) {
				/* nothing to do - the filter still applies for this visit */
			}
			applyFilter();
		});
	});

	state.comments.forEach(renderComment);
	refresh();
	applyFilter();
}

function renderDashboard(model, opts = {}) {
	const title = opts.title || ARTIFACT.title;
	const reviewer = opts.reviewer ? ` &#183; ${esc(opts.reviewer)}` : '';
	const laneSections = model.lanes
		.filter((lane) => model.cards.some((c) => c.lane === lane))
		.map((lane) => {
			const meta = LANE_META[lane];
			const cards = model.cards.filter((c) => c.lane === lane).map(renderCard).join('\n');
			return `<section class="lane" id="${esc(lane)}">
	<h2><span class="dot ${esc(lane)}"></span>${esc(meta.label)}<span class="lane-hint">${esc(meta.hint)}</span></h2>
	${cards}
</section>`;
		})
		.join('\n');

	const countBar = model.lanes
		.map((lane) => {
			const n = model.counts[lane] || 0;
			return `<a class="count ${esc(lane)}${n ? '' : ' zero'}" data-lane="${esc(lane)}" href="#${esc(lane)}"><b>${n}</b><span>${esc(LANE_META[lane].label)}</span></a>`;
		})
		.join('');

	// Each chip counts over the whole queue, which is the only place the page can say what is on
	// the *other* side of the filter: the lane bar recomputes to whatever is active, so it can
	// never tell you Theirs has seven waiting. All ships pre-selected so the page is correct
	// before the script runs; `applyFilter` moves it when a filter was remembered.
	const ownerBar = FILTERS.map((f) => {
		const n = model.cards.filter(f.holds).length;
		const on = f === NO_FILTER;
		return `<button class="own${n ? '' : ' zero'}${on ? ' on' : ''}" type="button" data-filter="${esc(f.id)}" aria-pressed="${on ? 'true' : 'false'}"><span>${esc(f.label)}</span><b>${n}</b></button>`;
	}).join('');

	// One element for both ways the page can come up empty: nothing recorded at all, and nothing
	// on the side you filtered to. The server knows the first answer for certain, so it renders
	// it - a client that throws before wiring degrades to a page that still explains itself.
	const emptyCopy = FILTERS.map((f) => `data-${esc(f.id)}="${esc(f.empty)}"`).join(' ');
	const nothing = `<p class="nothing" id="nothing" ${emptyCopy}${model.cards.length ? ' hidden' : ''}>${model.cards.length ? '' : esc(NO_FILTER.empty)}</p>`;

	return `<title>${esc(title)}</title>
<style>
:root {
	--ground: #f6f7f9;
	--surface: #ffffff;
	--ink: #131a24;
	--ink-soft: #55606f;
	--ink-faint: #7c8797;
	--rule: #e2e6ec;
	--inset: #f0f3f6;
	--accent: #0e7490;
	--accent-soft: #e0f2f6;
	--good: #157347;
	--warn: #96620a;
	--crit: #b3261e;
	--info: #1f5fa8;
	--radius: 10px;
	--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
	:root {
		--ground: #0d1117;
		--surface: #161b22;
		--ink: #e7ebf1;
		--ink-soft: #a6b1c0;
		--ink-faint: #7d8895;
		--rule: #242c37;
		--inset: #1b222c;
		--accent: #35c0d8;
		--accent-soft: #12303a;
		--good: #4ec27f;
		--warn: #e0a63a;
		--crit: #f2776b;
		--info: #74aef0;
	}
}
:root[data-theme="dark"] {
	--ground: #0d1117;
	--surface: #161b22;
	--ink: #e7ebf1;
	--ink-soft: #a6b1c0;
	--ink-faint: #7d8895;
	--rule: #242c37;
	--inset: #1b222c;
	--accent: #35c0d8;
	--accent-soft: #12303a;
	--good: #4ec27f;
	--warn: #e0a63a;
	--crit: #f2776b;
	--info: #74aef0;
}
:root[data-theme="light"] {
	--ground: #f6f7f9;
	--surface: #ffffff;
	--ink: #131a24;
	--ink-soft: #55606f;
	--ink-faint: #7c8797;
	--rule: #e2e6ec;
	--inset: #f0f3f6;
	--accent: #0e7490;
	--accent-soft: #e0f2f6;
	--good: #157347;
	--warn: #96620a;
	--crit: #b3261e;
	--info: #1f5fa8;
}
body {
	margin: 0;
	padding: clamp(1.25rem, 4vw, 2.75rem) clamp(1rem, 4vw, 2rem) 4rem;
	background: var(--ground);
	color: var(--ink);
	font-family: var(--sans);
	line-height: 1.5;
	-webkit-font-smoothing: antialiased;
}
.wrap { max-width: 62rem; margin: 0 auto; display: flex; flex-direction: column; gap: 1.75rem; }
.masthead { display: flex; flex-direction: column; gap: 0.4rem; }
.masthead h1 {
	margin: 0;
	font-family: var(--mono);
	font-size: clamp(1.15rem, 2.4vw, 1.5rem);
	font-weight: 600;
	letter-spacing: -0.01em;
	text-wrap: balance;
}
.stamp { font-family: var(--mono); font-size: 0.75rem; color: var(--ink-faint); }
.owners { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.own {
	display: flex; align-items: baseline; gap: 0.4rem;
	font-family: var(--mono);
	font-size: 0.75rem;
	padding: 0.35rem 0.75rem;
	border-radius: 999px;
	border: 1px solid var(--rule);
	background: var(--surface);
	color: var(--ink-soft);
	cursor: pointer;
}
.own b { color: var(--ink-faint); }
.own.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.own.on b { color: var(--accent); }
.nothing { margin: 0; color: var(--ink-faint); font-style: italic; }
.counts { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.count {
	display: flex; align-items: baseline; gap: 0.45rem;
	padding: 0.5rem 0.8rem;
	background: var(--surface);
	border: 1px solid var(--rule);
	border-radius: var(--radius);
	text-decoration: none;
	color: var(--ink);
	border-left: 3px solid var(--ink-faint);
}
.count b { font-family: var(--mono); font-size: 1.05rem; }
.count span { font-size: 0.8rem; color: var(--ink-soft); }
.count.zero, .own.zero { opacity: 0.55; }
.count b, .own b { font-variant-numeric: tabular-nums; }
.count:focus-visible, .key:focus-visible, .own:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.count.needs-you { border-left-color: var(--accent); }
.count.waiting-author { border-left-color: var(--warn); }
.count.delegated { border-left-color: var(--ink-faint); }
.count.done { border-left-color: var(--good); }
.lane { display: flex; flex-direction: column; gap: 0.75rem; }
.lane h2 {
	margin: 0;
	display: flex; align-items: center; gap: 0.5rem;
	font-family: var(--mono);
	font-size: 0.82rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--ink-soft);
}
.lane-hint { font-family: var(--sans); font-size: 0.75rem; text-transform: none; letter-spacing: 0; color: var(--ink-faint); font-weight: 400; }
.dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--ink-faint); flex: none; }
.dot.needs-you { background: var(--accent); }
.dot.waiting-author { background: var(--warn); }
.dot.done { background: var(--good); }
.card {
	background: var(--surface);
	border: 1px solid var(--rule);
	border-left: 3px solid var(--ink-faint);
	border-radius: var(--radius);
	padding: 1rem 1.1rem;
	display: flex; flex-direction: column; gap: 0.75rem;
}
.card.needs-you { border-left-color: var(--accent); }
.card.waiting-author { border-left-color: var(--warn); }
.card.done { border-left-color: var(--good); }
.card header { display: flex; flex-direction: column; gap: 0.35rem; }
.ident { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.6rem; }
.key { font-family: var(--mono); font-size: 0.85rem; font-weight: 600; color: var(--accent); text-decoration: none; }
.key:hover { text-decoration: underline; }
.meta { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
.card h3 { margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.35; text-wrap: balance; }
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.chip {
	font-family: var(--mono);
	font-size: 0.68rem;
	padding: 0.15rem 0.45rem;
	border-radius: 999px;
	border: 1px solid currentColor;
	color: var(--ink-soft);
}
.chip.yours { color: var(--ink-faint); }
.chip.accent { color: var(--accent); background: var(--accent-soft); }
.chip.good { color: var(--good); }
.chip.crit { color: var(--crit); }
.next { background: var(--inset); border-radius: 8px; padding: 0.7rem 0.85rem; }
.next-label {
	display: block;
	font-family: var(--mono);
	font-size: 0.66rem;
	text-transform: uppercase;
	letter-spacing: 0.09em;
	color: var(--ink-faint);
	margin-bottom: 0.25rem;
}
.next p { margin: 0; font-size: 0.95rem; }
.next.empty p { color: var(--ink-faint); font-style: italic; }
.notes { margin: 0; padding-left: 1.1rem; font-size: 0.85rem; color: var(--ink-soft); }
.findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.findings li { display: flex; gap: 0.55rem; align-items: baseline; font-size: 0.85rem; }
.findings li.dropped { opacity: 0.55; text-decoration: line-through; }
.weight {
	flex: none;
	min-width: 5.5rem;
	font-family: var(--mono);
	font-size: 0.68rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--ink-faint);
}
.weight.crit { color: var(--crit); }
.weight.warn { color: var(--warn); }
.weight.info { color: var(--info); }
.finding { color: var(--ink-soft); }
footer { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-faint); border-top: 1px solid var(--rule); padding-top: 0.9rem; }
.cta {
	align-self: flex-start;
	margin-top: 0.6rem;
	font-family: var(--mono);
	font-size: 0.78rem;
	font-weight: 600;
	padding: 0.4rem 0.8rem;
	border-radius: 7px;
	border: 1px solid var(--accent);
	background: var(--accent);
	color: var(--surface);
	cursor: pointer;
}
.cta:hover { filter: brightness(1.08); }
.cta:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.cta.sent { background: transparent; color: var(--good); border-color: var(--good); }
.resolve-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-top: 0.6rem; }
.resolve-label {
	font-family: var(--mono);
	font-size: 0.66rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--ink-faint);
	margin-right: 0.15rem;
}
.cta.resolve { margin-top: 0; background: transparent; color: var(--accent); }
.cta.resolve:hover { background: var(--accent-soft); }
.cta.resolve.sent { background: var(--good); border-color: var(--good); color: var(--surface); }
.selpill, .annopop { position: absolute; z-index: 20; }
/* A class that sets display beats the UA's [hidden] rule, so the attribute stops
   hiding anything. Restate it for the elements this page toggles. */
.selpill[hidden], .annopop[hidden], #payload[hidden], .lane[hidden], .card[hidden] { display: none; }
.selpill {
	font-family: var(--mono);
	font-size: 0.72rem;
	padding: 0.3rem 0.6rem;
	border-radius: 999px;
	border: 1px solid var(--rule);
	background: var(--surface);
	color: var(--accent);
	box-shadow: 0 2px 10px rgba(0,0,0,0.18);
	cursor: pointer;
}
.annopop {
	width: min(21rem, calc(100vw - 2rem));
	background: var(--surface);
	border: 1px solid var(--rule);
	border-radius: var(--radius);
	box-shadow: 0 8px 28px rgba(0,0,0,0.22);
	padding: 0.75rem;
	display: flex; flex-direction: column; gap: 0.5rem;
}
.annopop-quote {
	font-size: 0.75rem;
	color: var(--ink-faint);
	border-left: 2px solid var(--accent);
	padding-left: 0.5rem;
	max-height: 4.5rem;
	overflow: auto;
}
.annopop textarea {
	width: 100%;
	box-sizing: border-box;
	min-height: 4.5rem;
	resize: vertical;
	font: inherit;
	font-size: 0.85rem;
	color: var(--ink);
	background: var(--ground);
	border: 1px solid var(--rule);
	border-radius: 6px;
	padding: 0.45rem 0.55rem;
}
.annopop-row { display: flex; gap: 0.4rem; justify-content: flex-end; align-items: center; }
.annopop-hint { margin-right: auto; font-family: var(--mono); font-size: 0.66rem; color: var(--ink-faint); }
.btn {
	font-family: var(--mono);
	font-size: 0.75rem;
	padding: 0.35rem 0.7rem;
	border-radius: 6px;
	border: 1px solid var(--rule);
	background: var(--surface);
	color: var(--ink);
	cursor: pointer;
}
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--surface); font-weight: 600; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
mark.anno { background: var(--accent-soft); color: inherit; border-bottom: 2px solid var(--accent); border-radius: 2px; }
.annos { list-style: none; margin: 0; padding: 0.65rem 0 0; border-top: 1px dashed var(--rule); display: flex; flex-direction: column; gap: 0.5rem; }
.annos li { display: grid; grid-template-columns: 1fr auto; gap: 0.15rem 0.5rem; font-size: 0.82rem; }
.anno-quote { grid-column: 1; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-faint); }
.anno-text { grid-column: 1; color: var(--ink); }
.anno-drop { grid-row: 1 / span 2; grid-column: 2; align-self: start; background: none; border: 0; color: var(--ink-faint); font-size: 1rem; line-height: 1; cursor: pointer; padding: 0 0.2rem; }
.anno-drop:hover { color: var(--crit); }
.handoffbox { margin-top: 0.2rem; }
/* Deliberately NOT .cta: every .cta in a card is wired to record a submit decision, so a
   button that only reveals text would store an empty one and repaint itself as a tick. */
.handoff-toggle {
	align-self: flex-start;
	font-family: var(--mono);
	font-size: 0.78rem;
	font-weight: 600;
	padding: 0.4rem 0.8rem;
	border-radius: 7px;
	border: 1px solid var(--accent);
	background: transparent;
	color: var(--accent);
	cursor: pointer;
}
.handoff-toggle:hover { background: var(--accent-soft); }
.handoff-toggle:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.handoff-body { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; }
.handoff-body[hidden] { display: none; }
.handoff-row { display: flex; align-items: center; gap: 0.5rem; }
.handoff-hint { font-family: var(--mono); font-size: 0.7rem; color: var(--ink-faint); margin-right: auto; }
.handoff-text {
	width: 100%;
	box-sizing: border-box;
	font-family: var(--mono);
	font-size: 0.72rem;
	line-height: 1.5;
	color: var(--ink);
	background: var(--ground);
	border: 1px solid var(--rule);
	border-radius: 6px;
	padding: 0.55rem;
	resize: vertical;
}
.handoff {
	position: sticky;
	bottom: 0;
	margin-top: 0.5rem;
	background: var(--surface);
	border: 1px solid var(--rule);
	border-radius: var(--radius);
	padding: 0.7rem 0.85rem;
	display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
	box-shadow: 0 -2px 14px rgba(0,0,0,0.10);
}
.handoff.ready { border-color: var(--accent); }
.handoff-count { font-family: var(--mono); font-size: 0.78rem; color: var(--ink-soft); margin-right: auto; font-variant-numeric: tabular-nums; }
.handoff-note { font-family: var(--mono); font-size: 0.7rem; color: var(--good); flex-basis: 100%; }
#payload {
	flex-basis: 100%;
	box-sizing: border-box;
	min-height: 8rem;
	font-family: var(--mono);
	font-size: 0.72rem;
	color: var(--ink);
	background: var(--ground);
	border: 1px solid var(--rule);
	border-radius: 6px;
	padding: 0.5rem;
	resize: vertical;
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (max-width: 34rem) {
	.findings li { flex-direction: column; gap: 0.1rem; }
	.weight { min-width: 0; }
}
</style>
<div class="wrap">
	<div class="masthead">
		<h1>${esc(title)}</h1>
		<span class="stamp">${esc(model.generatedAt)}${reviewer}</span>
	</div>
	<nav class="owners" role="group" aria-label="Filter by who owns the PR">${ownerBar}</nav>
	<nav class="counts">${countBar}</nav>
	${laneSections}
	${nothing}
	<div class="handoff" id="handoff">
		<span class="handoff-count" id="handoff-count">Nothing selected yet</span>
		<button class="btn primary" type="button" id="handoff-copy">Copy comments</button>
		<button class="btn" type="button" id="handoff-clear">Clear</button>
		<span class="handoff-note" id="handoff-note"></span>
		<textarea id="payload" hidden readonly aria-label="Feedback to paste into the run"></textarea>
	</div>
	<footer>Select any text in a card to comment on it. Buttons here record instructions for the agent &#8212; nothing reaches GitHub until the agent acts. Regenerated by dw-review-prs; this page updates in place.</footer>
</div>
<button class="selpill" id="selpill" type="button" hidden>Comment</button>
<div class="annopop" id="annopop" role="dialog" aria-label="Comment for the agent" hidden>
	<div class="annopop-quote" id="annopop-quote"></div>
	<textarea id="annopop-input" placeholder="What should the agent do with this?"></textarea>
	<div class="annopop-row">
		<span class="annopop-hint">&#8984;&#8629; to save</span>
		<button class="btn" type="button" id="annopop-cancel">Cancel</button>
		<button class="btn primary" type="button" id="annopop-save">Comment</button>
	</div>
</div>
<script>(${dashboardClient.toString()})();</script>`;
}

module.exports = {renderDashboard, esc, LANE_META, ARTIFACT};
