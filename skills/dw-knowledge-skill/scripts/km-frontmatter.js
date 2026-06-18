'use strict';

// Tiny YAML-subset parser/serializer for the knowledge-memory frontmatter schema.
// Dependency-free; node: builtins only. This is NOT a general YAML engine: it only
// needs to correctly round-trip the files THIS skill generates, namely:
//   - scalar:            key: value
//   - one-level object:  metadata:\n  key: value
//   - block lists:       key:\n  - item            (at top level or one level deep)
//   - lists of objects:  key:\n  - name: x\n    example: y   (inline-map list items)
// Anything outside that subset is preserved as best-effort scalar text.

const FENCE = '---';

// --- value (de)serialization ---------------------------------------------

// Parse a scalar token into a JS value. Strips matching quotes; coerces
// booleans, null, and plain integers. Everything else stays a string.
function parseScalar(raw) {
	const t = raw.trim();
	if (t === '') return '';
	if (t === 'null' || t === '~') return null;
	if (t === 'true') return true;
	if (t === 'false') return false;
	if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
		(t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
		return t.slice(1, -1);
	}
	if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
	return t;
}

// Serialize a JS scalar into a YAML token. Quotes strings only when needed
// to keep the value unambiguous on re-parse.
function serializeScalar(value) {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return String(value);
	const s = String(value);
	if (s === '') return '';
	const needsQuote =
		s !== s.trim() ||
		/^[-?&*!|>%@`"'#]/.test(s) ||
		/:\s/.test(s) ||
		/\s#/.test(s) ||
		/[:#]$/.test(s) ||
		s.includes('\n') ||
		['null', '~', 'true', 'false'].includes(s) ||
		/^-?\d+$/.test(s);
	if (!needsQuote) return s;
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Split a "key: value" line at the first top-level colon-space (or trailing colon).
// Returns {key, rest} where rest is '' when the value is empty/absent.
function splitKeyValue(line) {
	const m = line.match(/^([^:]+):(?:\s+(.*))?$/);
	if (!m) return null;
	return {key: m[1].trim(), rest: m[2] === undefined ? '' : m[2]};
}

// Indentation width (spaces) of a line.
function indentOf(line) {
	const m = line.match(/^( *)/);
	return m ? m[1].length : 0;
}

// Parse an inline flow map item like "name: x, example: y" (used for list-of-objects
// items written as "- name: x"). Falls back to a scalar if it isn't a map.
function parseListItem(raw) {
	const t = raw.trim();
	const kv = splitKeyValue(t);
	// Treat as object only when it looks like "k: v" AND there's a following ", k2: v2"
	// OR it's a lone "k: v" pair. We keep this conservative: a single key:value pair.
	if (kv && /^[a-zA-Z0-9_-]+$/.test(kv.key)) {
		const obj = {};
		// support comma-separated inline pairs: name: x, example: y
		const parts = splitTopLevelCommas(t);
		let allPairs = true;
		for (const part of parts) {
			const pkv = splitKeyValue(part.trim());
			if (pkv && /^[a-zA-Z0-9_-]+$/.test(pkv.key)) {
				obj[pkv.key] = parseScalar(pkv.rest);
			} else {
				allPairs = false;
				break;
			}
		}
		if (allPairs) return obj;
	}
	return parseScalar(t);
}

// Parse a list item that may span multiple lines as a map, e.g.
//   - name: install_cmd
//     example: npm ci
// `firstContent` is the text after "- "; `contLines` are the trimmed,
// deeper-indented continuation lines. With no continuation lines it defers to
// parseListItem (inline-flow / scalar form), which keeps round-tripping intact.
function parseListItemFull(firstContent, contLines) {
	if (!contLines || contLines.length === 0) return parseListItem(firstContent);
	const first = splitKeyValue(firstContent.trim());
	if (!(first && /^[a-zA-Z0-9_-]+$/.test(first.key))) {
		// First line isn't "key: value" — treat the whole item as inline/scalar.
		return parseListItem(firstContent);
	}
	const obj = {};
	obj[first.key] = parseScalar(first.rest);
	for (const cl of contLines) {
		const kv = splitKeyValue(cl.trim());
		if (kv && /^[a-zA-Z0-9_-]+$/.test(kv.key)) {
			obj[kv.key] = parseScalar(kv.rest);
		}
	}
	return obj;
}

// Split on commas that are not inside quotes. Used for inline flow-map list items.
function splitTopLevelCommas(s) {
	const out = [];
	let cur = '';
	let quote = '';
	for (const ch of s) {
		if (quote) {
			cur += ch;
			if (ch === quote) quote = '';
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			cur += ch;
			continue;
		}
		if (ch === ',') {
			out.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	if (cur.trim() !== '' || out.length > 0) out.push(cur);
	return out;
}

// --- parse ----------------------------------------------------------------

// parse(text) -> { data, body }
// Tolerates files with no frontmatter: returns { data: {}, body: text }.
function parse(text) {
	const src = String(text).replace(/\r\n/g, '\n');
	if (!src.startsWith(FENCE)) {
		return {data: {}, body: src};
	}
	const lines = src.split('\n');
	// First line is the opening fence. Find the closing fence.
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === FENCE) {
			end = i;
			break;
		}
	}
	if (end === -1) {
		// No closing fence: treat whole thing as body.
		return {data: {}, body: src};
	}
	const fmLines = lines.slice(1, end);
	const data = parseBlock(fmLines, 0).value;
	// Body is everything after the closing fence. Drop a single leading blank line
	// (stringify writes exactly one), preserve the rest verbatim.
	let bodyLines = lines.slice(end + 1);
	if (bodyLines.length && bodyLines[0] === '') bodyLines = bodyLines.slice(1);
	const body = bodyLines.join('\n');
	return {data, body};
}

// Parse a contiguous block of frontmatter lines at a given base indent into an object.
// Returns {value, next} (next unused at top level). Recurses one level for nested maps.
function parseBlock(lines, baseIndent) {
	const obj = {};
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '' || /^\s*#/.test(line)) {
			i++;
			continue;
		}
		const ind = indentOf(line);
		if (ind < baseIndent) break;
		if (ind > baseIndent) {
			// Shouldn't happen at this level; skip defensively.
			i++;
			continue;
		}
		const content = line.slice(baseIndent);
		const kv = splitKeyValue(content);
		if (!kv) {
			i++;
			continue;
		}
		const {key, rest} = kv;
		if (rest !== '') {
			obj[key] = parseScalar(rest);
			i++;
			continue;
		}
		// Empty value: could be a nested map, a block list, or a genuinely empty scalar.
		// Look ahead at the next non-blank line's indent and shape.
		let j = i + 1;
		while (j < lines.length && (lines[j].trim() === '' || /^\s*#/.test(lines[j]))) j++;
		if (j >= lines.length) {
			obj[key] = '';
			i = j;
			continue;
		}
		const childInd = indentOf(lines[j]);
		if (childInd <= baseIndent) {
			// Nothing nested under it.
			obj[key] = '';
			i = i + 1;
			continue;
		}
		const childContent = lines[j].slice(childInd);
		if (childContent.startsWith('- ') || childContent === '-') {
			// Block list. Collect items at exactly childInd starting with '-',
			// folding any deeper-indented continuation lines into multi-line map
			// items (e.g. "- name: x" then an indented "example: y").
			const items = [];
			let k = i + 1;
			while (k < lines.length) {
				if (lines[k].trim() === '' || /^\s*#/.test(lines[k])) {
					k++;
					continue;
				}
				const lind = indentOf(lines[k]);
				if (lind < childInd) break;
				if (lind > childInd) {
					// Stray continuation with no owning '-' item — skip defensively.
					k++;
					continue;
				}
				const lc = lines[k].slice(childInd);
				if (!lc.startsWith('-')) break;
				const itemRaw = lc.replace(/^-\s?/, '');
				// Gather continuation lines indented deeper than childInd.
				const contLines = [];
				let n = k + 1;
				while (n < lines.length) {
					if (lines[n].trim() === '' || /^\s*#/.test(lines[n])) break;
					if (indentOf(lines[n]) <= childInd) break;
					contLines.push(lines[n]);
					n++;
				}
				items.push(parseListItemFull(itemRaw, contLines));
				k = n;
			}
			obj[key] = items;
			i = k;
			continue;
		}
		// Nested one-level map. Collect lines indented deeper than baseIndent.
		const sub = [];
		let k = i + 1;
		while (k < lines.length) {
			if (lines[k].trim() === '') {
				sub.push(lines[k]);
				k++;
				continue;
			}
			if (indentOf(lines[k]) <= baseIndent) break;
			sub.push(lines[k]);
			k++;
		}
		obj[key] = parseBlock(sub, childInd).value;
		i = k;
	}
	return {value: obj, next: i};
}

// --- stringify ------------------------------------------------------------

// stringify(data, body) -> '---\n<frontmatter>\n---\n\n<body>'
// Deterministic emission following insertion order of keys.
function stringify(data, body) {
	const fm = emitObject(data || {}, 0);
	const bodyText = body === undefined || body === null ? '' : String(body);
	return `${FENCE}\n${fm}${FENCE}\n\n${bodyText}`;
}

function emitObject(obj, indent) {
	const pad = ' '.repeat(indent);
	let out = '';
	for (const key of Object.keys(obj)) {
		const value = obj[key];
		if (Array.isArray(value)) {
			out += `${pad}${key}:\n`;
			out += emitList(value, indent + 2);
		} else if (value && typeof value === 'object') {
			out += `${pad}${key}:\n`;
			out += emitObject(value, indent + 2);
		} else {
			out += `${pad}${key}: ${serializeScalar(value)}\n`;
		}
	}
	return out;
}

function emitList(arr, indent) {
	const pad = ' '.repeat(indent);
	let out = '';
	for (const item of arr) {
		if (item && typeof item === 'object' && !Array.isArray(item)) {
			// Inline flow-map list item: "- name: x, example: y"
			const pairs = Object.keys(item)
				.map((k) => `${k}: ${serializeScalar(item[k])}`)
				.join(', ');
			out += `${pad}- ${pairs}\n`;
		} else {
			out += `${pad}- ${serializeScalar(item)}\n`;
		}
	}
	return out;
}

// --- convenience ----------------------------------------------------------

// getMeta(data, key, default) -> data.metadata[key] ?? default
function getMeta(data, key, defaultValue) {
	if (!data || !data.metadata || typeof data.metadata !== 'object') return defaultValue;
	const v = data.metadata[key];
	return v === undefined ? defaultValue : v;
}

module.exports = {
	parse,
	stringify,
	getMeta,
};
