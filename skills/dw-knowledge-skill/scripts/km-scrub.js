'use strict';

// Deterministic SECRET SCRUBBER for knowledge-memory candidates.
// Dependency-free; node: builtins only. No network, no clock, no randomness.
//
// PURPOSE: store the METHOD, never the data. This is the hard gate of the write
// workflow. Reads a candidate memory from stdin (or --file <path>), detects
// secrets / org-identifiers, and either auto-slots them with named {placeholders}
// or REFUSES when a match cannot be safely genericized.
//
// CLI:
//   node km-scrub.js < candidate.md
//   node km-scrub.js --file candidate.md
//   node km-scrub.js --json   (emit the full JSON report to stdout instead of text)
//
// OUTPUT:
//   default: scrubbed text -> stdout ; JSON report -> stderr
//   --json:  {scrubbed, redactions:[{kind,replacement}], refused:[{kind}]} -> stdout
//
// EXIT CODES:
//   0 = clean OR all matches auto-slotted (caller MAY write the scrubbed text)
//   2 = refused: at least one secret could not be safely genericized
//       (caller MUST NOT write)

const {readFileSync} = require('node:fs');

// --- arg parsing (house style, parameterless catch where err unused) ------

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) {
			if (!args._) args._ = [];
			args._.push(token);
			continue;
		}
		const [key, ...rest] = token.slice(2).split('=');
		if (rest.length > 0) {
			args[key] = rest.join('=');
		} else {
			const next = argv[i + 1];
			if (next && !next.startsWith('--')) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

function readInput(args) {
	if (typeof args.file === 'string' && args.file.length > 0) {
		return readFileSync(args.file, 'utf8');
	}
	try {
		return readFileSync(0, 'utf8');
	} catch {
		return '';
	}
}

// --- entropy --------------------------------------------------------------

// Shannon entropy in bits per character. Used to distinguish a high-entropy
// secret blob (random key material) from ordinary prose/identifiers.
function shannonEntropy(s) {
	if (!s) return 0;
	const counts = Object.create(null);
	for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
	const len = s.length;
	let bits = 0;
	for (const ch in counts) {
		const p = counts[ch] / len;
		bits -= p * Math.log2(p);
	}
	return bits;
}

// --- redaction bookkeeping ------------------------------------------------

// A single ordered list of detectors. Each detector either:
//   - replaces matches with a {slot}  (action: 'slot'), or
//   - refuses the whole candidate     (action: 'refuse').
// `test(m, text)` lets a detector reject a candidate match (e.g. entropy gate
// or placeholder allow-list) by returning false.
//
// Order matters: the most specific / most dangerous patterns run first so that
// e.g. a private-key body is refused before a generic high-entropy blob slots it.

const PRIVATE_KEY_RE = /-----BEGIN (?:[A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]*)PRIVATE KEY-----/g;
// Also catch a bare BEGIN header with no matching END (truncated paste).
const PRIVATE_KEY_HEADER_RE = /-----BEGIN (?:[A-Z0-9 ]*)PRIVATE KEY-----/g;

// Placeholder hosts/emails that are explicitly allowed to pass through verbatim.
const PLACEHOLDER_HOST_RE = /(^|\.)(example\.(com|org|net)|localhost)$/i;

function isPlaceholderEmail(email) {
	const at = email.lastIndexOf('@');
	if (at < 0) return false;
	const domain = email.slice(at + 1);
	return PLACEHOLDER_HOST_RE.test(domain);
}

function isPlaceholderHost(host) {
	return PLACEHOLDER_HOST_RE.test(host);
}

// RFC1918 / loopback / link-local check for an IPv4 literal.
function isPrivateIp(ip) {
	const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
		return false;
	}
	const [a, b] = parts;
	if (a === 10) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 127) return true;
	if (a === 169 && b === 254) return true;
	return false;
}

// Generic, non-public host suffixes always treated as internal. The shipped
// skill embeds NO company-specific domain — additional org domains are OPT-IN at
// runtime via the KM_ORG_DOMAINS env var (comma-separated), e.g.
//   KM_ORG_DOMAINS="acme.com,acme.internal"
const BUILTIN_INTERNAL_SUFFIXES = ['internal', 'corp', 'intranet', 'local', 'lan'];

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build the internal-host detector regex from the builtin suffixes plus any
// opt-in org domains. Read once at module load.
function internalHostRegex() {
	const extra = String(process.env.KM_ORG_DOMAINS || '')
		.split(',')
		.map((d) => d.trim().replace(/^\.+|\.+$/g, ''))
		.filter(Boolean);
	const suffixes = [...BUILTIN_INTERNAL_SUFFIXES, ...extra].map(escapeRe);
	return new RegExp(
		`\\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9-]+)*\\.(?:${suffixes.join('|')})\\b`,
		'g',
	);
}

const INTERNAL_HOST_RE = internalHostRegex();

// Detectors run in order. `refuse: true` => action refuse (exit 2).
const DETECTORS = [
	// --- private keys: cannot be genericized; REFUSE ----------------------
	{
		kind: 'private_key',
		refuse: true,
		re: PRIVATE_KEY_RE,
	},
	{
		kind: 'private_key',
		refuse: true,
		re: PRIVATE_KEY_HEADER_RE,
	},

	// --- connection strings with inline credentials -----------------------
	// scheme://user:pass@host  -> keep scheme + slot creds + slot host
	{
		kind: 'connection_string',
		slot: '{connection_string}',
		re: /\b([a-zA-Z][a-zA-Z0-9+.-]*):\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+/g,
	},
	// jdbc:driver://host... (creds often in query/properties)
	{
		kind: 'connection_string',
		slot: '{connection_string}',
		re: /\bjdbc:[a-zA-Z0-9]+:\/\/[^\s]+/g,
	},

	// --- provider API tokens / keys ---------------------------------------
	{
		kind: 'github_token',
		slot: '{api_key}',
		re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
	},
	{
		kind: 'openai_key',
		slot: '{api_key}',
		re: /\bsk-[A-Za-z0-9]{20,}\b/g,
	},
	{
		kind: 'aws_access_key_id',
		slot: '{api_key}',
		re: /\bAKIA[0-9A-Z]{16}\b/g,
	},
	{
		kind: 'slack_token',
		slot: '{api_key}',
		re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
	},
	{
		kind: 'bearer_token',
		slot: 'Bearer {api_key}',
		re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
	},

	// --- org identifiers ---------------------------------------------------
	{
		kind: 'uuid',
		slot: '{uuid}',
		re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
	},
	// long numeric id adjacent to tenant/account/org/customer/project keyword.
	// Captures and re-emits the keyword + separator, slots the number.
	{
		kind: 'org_id',
		re: /\b(account|acct|tenant|org|organization|customer|project)([\s_-]*(?:id|number|no)?[\s:=]+)(\d{6,})\b/gi,
		replace: (m, kw, sep) => `${kw}${sep}{account_id}`,
	},
	// internal / corp / opt-in org hostnames (builtin suffixes + KM_ORG_DOMAINS).
	{
		kind: 'internal_host',
		slot: '{host}',
		re: INTERNAL_HOST_RE,
		test: (m) => !isPlaceholderHost(m),
	},
	// emails (keep example.com/example.org placeholders verbatim).
	{
		kind: 'email',
		slot: '{email}',
		re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
		test: (m) => !isPlaceholderEmail(m),
	},
	// RFC1918 / loopback / link-local IPv4 literals.
	{
		kind: 'private_ip',
		slot: '{host}',
		re: /\b(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})\b/g,
		test: (m) => isPrivateIp(m),
	},

	// --- generic high-entropy blobs (run LAST: catch-all for raw secrets) --
	// base64/hex-ish token, length >= 32, Shannon entropy > 4.0 bits/char.
	{
		kind: 'high_entropy_blob',
		slot: '{secret}',
		re: /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g,
		test: (m) => shannonEntropy(m) > 4.0,
	},
];

// --- core scrub -----------------------------------------------------------

// scrub(text) -> { scrubbed, redactions, refused }
// Applies each detector in order over the current working text. Refusal
// detectors short-circuit nothing (we collect ALL refusals) but mark the result
// so the caller exits 2. Slot detectors mutate the working text left-to-right.
function scrub(text) {
	let working = String(text);
	const redactions = [];
	const refused = [];

	for (const det of DETECTORS) {
		// Fresh regex state each detector (all are /g; reset lastIndex).
		const re = det.re;
		re.lastIndex = 0;

		if (det.refuse) {
			// Refusal detector: if any (real) match exists, record and strip the
			// match so a later generic detector can't "slot" the same bytes and
			// mask the refusal. We replace with a marker that is itself safe.
			let found = false;
			working = working.replace(re, (...mArgs) => {
				const m = mArgs[0];
				if (det.test && !det.test(m, working)) return m;
				found = true;
				return '{REDACTED_PRIVATE_KEY}';
			});
			if (found) refused.push({kind: det.kind});
			continue;
		}

		working = working.replace(re, (...mArgs) => {
			const m = mArgs[0];
			if (det.test && !det.test(m, working)) return m;
			let replacement;
			if (typeof det.replace === 'function') {
				replacement = det.replace(...mArgs);
			} else {
				replacement = det.slot;
			}
			redactions.push({kind: det.kind, replacement});
			return replacement;
		});
	}

	return {scrubbed: working, redactions, refused};
}

// --- main -----------------------------------------------------------------

function main() {
	const args = parseArgs(process.argv);
	const input = readInput(args);
	const result = scrub(input);
	const isRefused = result.refused.length > 0;

	if (args.json) {
		process.stdout.write(JSON.stringify({
			scrubbed: result.scrubbed,
			redactions: result.redactions,
			refused: result.refused,
		}));
		process.stdout.write('\n');
	} else {
		// Scrubbed text to stdout; machine-readable report to stderr.
		process.stdout.write(result.scrubbed);
		if (!result.scrubbed.endsWith('\n')) process.stdout.write('\n');
		process.stderr.write(JSON.stringify({
			redactions: result.redactions,
			refused: result.refused,
		}));
		process.stderr.write('\n');
	}

	process.exit(isRefused ? 2 : 0);
}

if (require.main === module) {
	main();
}

module.exports = {scrub, shannonEntropy, isPrivateIp, isPlaceholderEmail, isPlaceholderHost};
