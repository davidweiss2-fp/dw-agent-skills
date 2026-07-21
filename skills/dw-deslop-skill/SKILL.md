---
name: dw-deslop-skill
description: >-
  Strip AI slop from the code and prose just written — the over-commenting,
  defensive boilerplate, `any`-casts, dead code, needless abstraction, copy-paste,
  and the writing tells (filler openers, puffery, bold-everything, emoji bullets)
  a careful human reviewer would remove. Use before committing or opening a PR to
  clean a branch — "deslop this", "remove the AI slop", "clean up this branch",
  "is this slop", or invokes /dw-deslop [path|--staged]. Edits only the diff
  against the base branch, behavior-preserving, and keeps legitimate defensive
  code and comments at trust boundaries.
---

# Deslop: strip AI slop from a diff

AI slop is code or prose that runs and reads fine in isolation but is padded,
generic, and indifferent to the system it landed in: comments narrating obvious
syntax, try/catch on code that can't throw, `as any` to silence a type error, a
one-implementation interface, a re-rolled util the repo already has, dead
scaffolding — and in prose, filler openers, puffery, reflexive triples, and
emoji-bulleted everything.

The cardinal rule: **deslop is behavior-preserving and scoped to the diff.** You
remove slop the branch introduced; you keep what the code does unchanged, leave
the actual feature or fix alone, and reformat only the lines the diff added.
The bar is the surrounding human code, not a generic ideal.

## Invocation

`/dw-deslop [optional path · or --staged]`

- **No arg** — the current branch's changes vs the base branch (the default
  branch, usually `main`; fall back to `master` / `origin/HEAD`).
- **A path** — only the slop in those files.
- **`--staged`** — only staged changes.

If nothing concrete is in scope, ask in one line what to deslop.

## The loop

1. **Scope the diff.** Find the base branch, then look only at lines this branch
   introduced — including uncommitted work, so it catches slop before the commit:
   `git diff --merge-base <base>` (committed + working tree), `git diff --staged`
   for `--staged`, or the named paths. Touch only code inside that set.
2. **Run the deterministic rules pass first.** Before any judgment, run
   `node scripts/deslop-rules.js` on the same scope — it applies the house's
   find/replace rules (e.g. em/en-dash → hyphen) only to introduced lines. Completion
   criterion: its envelope is posted. Details + custom rules: `references/rules.md`.
3. **Classify before deleting.** For each changed hunk, ask the one question
   that separates slop from substance: *does this earn its keep?* Run it against
   the taxonomy — compact below, full catalog in `references/code-slop.md` and
   `references/prose-slop.md`. Code slop and prose/doc slop both count.
4. **Strip surgically.** Remove or rewrite the slop and nothing else. Match the
   file's existing conventions. If a change could alter runtime behavior, it is
   not deslop — leave it.
5. **Hold the false-positive line.** The same constructs are correct at trust
   boundaries (see KEEP discipline). Strip only in the trusted interior; when a
   call is genuinely ambiguous, leave it and flag it instead of guessing.
6. **Verify.** Re-read the resulting diff; if the repo has a formatter/linter
   wired up and it's cheap, run it. Confirm you changed only slop, behavior intact.
7. **Summarize tersely** — what you stripped, grouped by kind, plus anything you
   deliberately left for a human. 1-5 sentences, no preamble. (The summary itself
   must be slop-free.)

## Code slop (compact — full catalog in `references/code-slop.md`)

- **Comments that narrate the code** — `// increment counter` over `i++`. Delete.
- **Docstrings that re-type the signature** — `@param userId The user id`. Delete
  or replace with real semantics (units, nullability, errors).
- **Defensive try/catch in trusted paths** — catch that only logs-and-rethrows or
  swallows; try around code that can't throw. Strip in the interior.
- **Redundant guards on validated inputs** — `if (!u) return` where the type
  already guarantees `u`. Trust your types inside the boundary.
- **`as any` / `@ts-ignore` / type escapes** — replace with the real type, a
  union, a generic, or `unknown` + a guard.
- **Needless abstraction** — one-impl interface, one-product factory, one-call-site
  generic, pass-through wrapper. Count implementations/call sites; if 1, inline it.
- **Reimplementing an existing util** — search the repo and its deps first; route
  through the one canonical implementation.
- **Dead code / unused vars / unused imports / commented-out blocks** — delete;
  version control is the "just in case".
- **Leftover `console.log` / `print` / `debugger`** — remove, or route through the
  project logger if logging is genuinely wanted.
- **Verbose ceremony / over-engineering** — builders and options bags no caller
  varies; cut to the shortest correct form (YAGNI).
- **Tests that mirror the implementation** — mock-then-assert-the-mock, no-op
  assertions. Keep behavior/edge tests; delete tests that pass by construction.
- **Style inconsistent with the file** — quotes, naming, import order, idioms.
  Match the nearest existing example in the package.
- **Emoji / decorative unicode** in code, comments, and commit messages — strip
  unless the project explicitly uses them.

## Prose & doc slop (compact — full catalog in `references/prose-slop.md`)

Judge by **clusters, not single words** — one tell is a false positive; density
convicts.

- **Filler / didactic openers** — "It's worth noting that", "In today's
  fast-paced…". Cut; state the fact.
- **Chat pleasantries** — "Certainly!", "Great question!", "I hope this helps!".
  No interlocutor in committed prose; strip.
- **Restating the prompt / empty conclusions** — "In this article we will
  explore…", "In conclusion…". Cut unless it adds a decision or next step.
- **Puffery verbs & marketing adjectives** — delve, leverage, foster, seamless,
  robust, comprehensive. Swap for the plain word, or replace with the concrete
  fact ("robust" → "99.9% uptime, retries on 5xx").
- **Hedging / opinion vacuum** — "both approaches have their merits". Take a
  position and name the condition that decides it.
- **Reflexive triples & "not just X, it's Y"** - keep one if one is true; add
  more only as each earns it, and flip for emphasis only on a real contrast.
- **Em-dash overuse, bold-everything, emoji bullets, Title Case headings, curly
  quotes** in plain-text/Markdown — normalize to the house style.

## KEEP discipline (false positives - keep)

The whole skill is separating **boundary code (keep)** from **trusted interior
(strip)**. Keep, every time:

- Try/catch, guards, validation, and casts at genuine **trust boundaries** —
  request handlers, parsed/untrusted input, env vars, fallible I/O, public APIs,
  FFI / untyped third-party returns.
- Comments that state a **non-obvious what/how** — a tricky algorithm, a real
  behavioral contract, units, a vendor quirk's actual behavior.
- **Calibrated uncertainty** where the evidence really is mixed — hedge honestly,
  but name what would decide it.
- A **single intentional** triple or bold term. Varied phrasing reads more human,
  not less. (Punctuation the rules engine normalizes - e.g. em/en-dash - is
  normalized regardless; a house rule always wins over generic keep-guidance.)
- **`TODO(ticket)` / `FIXME` markers** - actionable work items, not why-slop;
  dropping one silently loses the planned follow-up.
- **Ported author-context / config-rationale comments** when code is moved or
  ported - a faithful port carries the original author's comments across.

## Comments: what/how, never why (house rule)

This repo's comment rule overrides the generic "keep the why-comments" advice.
Strip **both** (a) narration of obvious syntax **and** (b) comments whose only job
is to justify or give history — "replaces the old X", "safe because…", ticket
refs like `See JIRA …`. The strip rule targets newly-authored narration and
justification, not `TODO`/`FIXME` markers or context comments carried across in a
move or port (see KEEP discipline). Keep comments that document a non-obvious **what/how** —
phrased as what the code does, not why it exists. Rationale belongs in the
PR/commit, not the source.

## Custom rules

Deterministic style fixes are data, not prose. Shipped defaults live in
`references/rules.default.json` (ships `em-dash-to-hyphen`); your own rules live in
`~/Documents/dw-agent-store/knowledge/deslop-rules/*.json` and override a default of the same name. Schema and
workflow: `references/rules.md`. When the dev states a deterministic preference in a session
("never X, always Y"), **offer to persist it as a rule** instead of hand-applying it every
run. Once the rules pass recurs across repos, promote it to a `deslop-rules` runbook per the
`dw-runbook` lifecycle so parallel agents share its lock, cache, and result envelope.

## Hard rules

- **Behavior-preserving above all** — if a change could alter runtime behavior, it
  isn't deslop; leave it.
- **Rules pass before judgment** — run `deslop-rules.js` first; it is scoped to introduced
  lines and a house rule wins over generic keep-guidance.
- **Scope is the diff** - only lines this branch introduced; reformat or
  "improve" only those, leaving untouched code as-is.
- **Codebase-first** — the bar is the surrounding file's conventions.
- **Keep at the boundary** — strip defensive code only in the trusted interior.
- **Prose by clusters** — act on density, not a single flagged word.
- **Comments: what/how, never why.**
- **Flag when unsure** - leave genuinely ambiguous calls and name them in the summary.
- **Terse output** - no filler; the skill's own output stays slop-free.
- **Re-check after** — deslop edits the diff, so run `fmt` + the repo's `preflight` runbook
  (`dw-runbook`) before shipping; a stray edit shouldn't reach the PR unchecked.

---

Adapted from getsentry's `deslop` skill (MIT, mirrored in
davila7/claude-code-templates) — extended from code-only to code + prose, with
explicit KEEP / trust-boundary discipline, cluster-based prose judgment, and this
repo's comment rule (what/how, never why). Prose taxonomy draws on Wikipedia's
"Signs of AI writing".
