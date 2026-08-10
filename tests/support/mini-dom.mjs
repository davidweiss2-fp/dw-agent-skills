// A DOM small enough to run the status page's client function against, and no smaller.
//
// The page's behaviour is a serialized function that closes over nothing, so the only thing
// standing between it and a unit test is a document. The repo takes no dependencies, so this
// implements exactly the surface `dashboardClient` touches - the selector shapes it queries, the
// element properties it sets, click dispatch, and localStorage - and nothing else. Anything the
// client does not use is deliberately absent, so an addition that needs more fails loudly here
// rather than passing against a stub that quietly returns undefined.
//
// The structure below mirrors the rendered markup by hand rather than parsing it. That split is
// deliberate: the markup-to-selector contract is asserted separately against the real HTML, and
// this file is where the filter's *logic* is exercised.

function parseSelector(selector) {
	const parts = {tag: '', classes: [], attrs: [], notHidden: false};
	let rest = selector.trim();
	if (rest.endsWith(':not([hidden])')) {
		parts.notHidden = true;
		rest = rest.slice(0, -':not([hidden])'.length);
	}
	const tag = /^[a-zA-Z][\w-]*/.exec(rest);
	if (tag) {
		parts.tag = tag[0].toLowerCase();
		rest = rest.slice(tag[0].length);
	}
	for (const m of rest.matchAll(/\.([\w-]+)/g)) parts.classes.push(m[1]);
	for (const m of rest.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) parts.attrs.push({name: m[1], value: m[2]});
	return parts;
}

function toKebab(key) {
	return key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

class ClassList {
	constructor(el) {
		this.el = el;
	}
	get set() {
		return new Set(String(this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
	}
	write(set) {
		this.el.setAttribute('class', [...set].join(' '));
	}
	contains(name) {
		return this.set.has(name);
	}
	add(name) {
		const s = this.set;
		s.add(name);
		this.write(s);
	}
	remove(name) {
		const s = this.set;
		s.delete(name);
		this.write(s);
	}
	toggle(name, force) {
		const on = force === undefined ? !this.contains(name) : Boolean(force);
		if (on) this.add(name);
		else this.remove(name);
		return on;
	}
}

export class El {
	constructor(tagName, attrs = {}, text = '') {
		this.tagName = String(tagName).toLowerCase();
		this.nodeType = 1;
		this.attrs = new Map();
		this.childNodes = [];
		this.parentNode = null;
		this.listeners = new Map();
		this.style = {};
		this.classList = new ClassList(this);
		this._text = text;
		this.value = '';
		for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
		const self = this;
		this.dataset = new Proxy(
			{},
			{
				get(_t, key) {
					const v = self.getAttribute('data-' + toKebab(String(key)));
					return v === null ? undefined : v;
				},
				set(_t, key, value) {
					self.setAttribute('data-' + toKebab(String(key)), value);
					return true;
				},
				has(_t, key) {
					return self.attrs.has('data-' + toKebab(String(key)));
				},
			},
		);
	}

	// `hidden` is the attribute the filter toggles, so the property and the attribute are one
	// thing here exactly as they are in a browser.
	get hidden() {
		return this.attrs.has('hidden');
	}
	set hidden(on) {
		if (on) this.setAttribute('hidden', '');
		else this.attrs.delete('hidden');
	}

	get className() {
		return String(this.getAttribute('class') || '');
	}
	set className(v) {
		this.setAttribute('class', v);
	}

	get id() {
		return String(this.getAttribute('id') || '');
	}

	getAttribute(name) {
		return this.attrs.has(name) ? this.attrs.get(name) : null;
	}
	setAttribute(name, value) {
		this.attrs.set(name, String(value));
	}

	get children() {
		return this.childNodes.filter((n) => n.nodeType === 1);
	}
	get firstChild() {
		return this.childNodes[0] || null;
	}
	get parentElement() {
		return this.parentNode;
	}

	appendChild(child) {
		child.parentNode = this;
		this.childNodes.push(child);
		return child;
	}
	insertBefore(child, before) {
		const i = this.childNodes.indexOf(before);
		child.parentNode = this;
		this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, child);
		return child;
	}
	remove() {
		if (!this.parentNode) return;
		const i = this.parentNode.childNodes.indexOf(this);
		if (i >= 0) this.parentNode.childNodes.splice(i, 1);
		this.parentNode = null;
	}

	get textContent() {
		if (this.childNodes.length) return this.childNodes.map((n) => n.textContent).join('');
		return this._text;
	}
	set textContent(v) {
		this.childNodes = [];
		this._text = String(v);
	}

	descendants() {
		const out = [];
		for (const child of this.children) {
			out.push(child, ...child.descendants());
		}
		return out;
	}

	matches(selector) {
		const p = parseSelector(selector);
		if (p.tag && p.tag !== this.tagName) return false;
		for (const c of p.classes) if (!this.classList.contains(c)) return false;
		for (const a of p.attrs) {
			if (a.value === undefined) {
				if (!this.attrs.has(a.name)) return false;
			} else if (this.getAttribute(a.name) !== a.value) return false;
		}
		if (p.notHidden && this.hidden) return false;
		return true;
	}

	querySelectorAll(selector) {
		return this.descendants().filter((el) => el.matches(selector));
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}
	closest(selector) {
		let el = this;
		while (el) {
			if (el.matches && el.matches(selector)) return el;
			el = el.parentNode;
		}
		return null;
	}

	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}
	dispatch(type, event = {}) {
		for (const fn of this.listeners.get(type) || []) fn({target: this, ...event});
	}
	click() {
		this.dispatch('click');
	}
	focus() {}
	select() {}
}

export function makeLocalStorage(seed = {}) {
	const map = new Map(Object.entries(seed));
	return {
		map,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
	};
}

// The globals `dashboardClient` reads. `getSelection` returns a collapsed selection, so the
// select-to-comment flow stays inert and the filter is what the test drives.
export function makeEnv(root, storage) {
	const document = new El('body');
	document.appendChild(root);
	document.getElementById = (id) => document.querySelector(`[id="${id}"]`);
	document.createElement = (tag) => new El(tag);
	document.execCommand = () => true;
	return {
		document,
		localStorage: storage,
		window: {
			getSelection: () => ({isCollapsed: true, rangeCount: 0, removeAllRanges() {}}),
			scrollX: 0,
			scrollY: 0,
			innerWidth: 1200,
		},
		navigator: {},
	};
}

// Runs the client against a fake document. `dashboardClient` takes no arguments and reads free
// globals, so it is re-bound here with `new Function` over the same source the page serializes -
// the same text, so a change to the client is a change to what this exercises.
export function runClient(clientFn, env) {
	const body = `return (${clientFn.toString()})();`;
	const invoke = new Function('document', 'localStorage', 'window', 'navigator', body);
	invoke(env.document, env.localStorage, env.window, env.navigator);
}
