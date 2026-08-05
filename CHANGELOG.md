# Changelog

All notable changes to dw-agent-skills. This project follows semantic versioning.

## 0.4.5

### Fixed

- **dw-review-prs: the queue lost every PR the moment its review was submitted.** `queue` searched
  `review-requested:@me` only, and GitHub clears that request as soon as a review lands - so a PR
  disappeared from the list at precisely the point the reviewer was waiting on the author's answer,
  and the run had to be told about it by hand. It now unions `review-requested:@me` with
  `reviewed-by:@me`, deduplicated by PR, and each hit carries why it is listed. On the author's own
  queue this surfaced ten already-reviewed PRs and two that had been pushed to since their review,
  none of which the old search returned. `--participation` widens it further to `commenter:@me`;
  those arrive as a new non-actionable `watching` status, because taking part in someone's thread is
  not a request to write a review.
- **A head the store already recorded no longer reads as unreviewed.** `classifyPr` checked older
  submitted SHAs before the store, so a run that reviewed a delta and correctly found nothing - which
  records the head without publishing a review - came back as "pushed to since your last submitted
  review" on every later run. The store's record of the current head is now consulted first.
## 0.4.4

### Fixed

- **dw-review-prs: a card with drafts waiting now asks for a resolution instead of handing back an
  instruction.** Its button carried the agent-authored `cta`, and on a PR with unsubmitted drafts that
  text is addressed to the reviewer - "Read the 2 drafts, then submit". Clicking it sent that sentence
  back verbatim, so the run received an instruction to *itself* and still had no idea which review
  event the reviewer wanted. Those cards now render **Comment / Approve / Request changes**, one
  decision per card, and the payload reads `I read the drafts - submit them as APPROVE`, which names
  the event and authorizes exactly `submit --event APPROVE`. Cards with nothing drafted keep their
  free-text `cta`, and the build no longer asks for a `cta` on a card that gets the resolution row.

## 0.4.3

### Added

- **dw-review-prs: a published status page, and a way to talk back to the run.** The queue reported
  its state into a chat message that scrolled away, and there was no route from "I disagree with this
  draft" to the run except retyping it. `dashboard` now builds one self-contained page - every PR the
  store records, grouped into waiting-on-you / waiting-on-the-author / delegated / closed-out, each
  card carrying its `/files` link, live state chips, the drafted findings from the ledger, and one
  free-text next step with a single labelled button inside it ("Approve the PR", "Submit the draft").
  Selecting text on a card opens a comment popup the way a document editor does; **Copy comments**
  hands every comment and button click back as one pasteable block, which re-enters the skill at
  Step 2. The page's markup, both colour themes and all of its behaviour live in
  `scripts/review-prs-dashboard.js`, so the interface is identical for every reviewer on this skill
  and only the data varies - `--actions` carries the per-PR text, and the build reports any card left
  without a next step or a button. `dashboard-url` persists the artifact URL in the store, so every
  later run and the scheduled task publish over the same link instead of minting one the reviewer has
  to re-find. Rules and field reference: `references/dashboard.md`.

  Three things the page needed to actually be usable, each found by driving it rather than reading it:
  the comment popup set `display: flex`, which outranks the browser's `[hidden]` rule and left Cancel
  with nothing to do; the copy button treated a denied async-clipboard permission as terminal instead
  of falling back to `execCommand`, which is the path that works in a sandboxed frame; and a selection
  crossing two elements carried a newline into the payload and broke its one-entry-per-line shape.
  Output is also pure ASCII now - the page is published into a document shell this repo does not
  control, and an em dash in a PR title should not depend on it.

## 0.4.2

### Added

- **dw-review-prs: `watch` — the replies to reviews you already left.** A drafted review is half a
  conversation, and the other half arrived on a PR the queue had already stopped listing: `queue`
  only reports PRs where review is *requested*, so once a review is submitted the answer to it was
  invisible. `watch` polls every PR `state.md` has ever recorded — across repos, including merged and
  closed ones, since a thread outlives its merge — and reports what landed since the last pass. Own
  comments and bots stay out of the report (`--include-bots` opts them in), so what surfaces is a
  person waiting on a reply. A high-water mark per PR per surface lives in `watch-state.json`, and
  the first pass on a PR seeds those marks rather than replaying its history. Failure is per PR, not
  per pass: `watchPass()` turns a throwing PR into a result carrying the error, so a deleted PR or a
  revoked token on one repo leaves the other PRs reporting — with tests for both that and a
  reporting failure. `--once` for a scheduled run, `--poll-ms` to keep listening.

### Changed

- **dw-review-prs: every drafted comment now leads with its ask.** Step 4 said "finding and ask in
  the first two lines", which permits an ask anywhere in the opening and does not require one at
  all — so a comment could state a finding and leave the author to infer what closes the thread,
  which is the failure a nit invites most ("worth restoring the clause" instead of "restore the
  clause"). The step now fixes the body shape: `[dev-ai]`, then `Ask:` on the next line, then the
  weight label on the line stating the finding, then evidence. `review-prs-lib.js` gained
  `hasAskLine()` and `bodyFile()` rejects a body that opens any other way, so the rule is enforced
  where the `[dev-ai]` tag already was rather than left to prose. A `Rationalizations` row carries
  the excuse it has to survive ("it's a nit, the ask is obvious from the label"). Also new: a
  one-line code change ships as a ` ```suggestion ` block in the evidence slot, matching the
  anchored line verbatim, so the author closes it in one click — `draft` anchors a single line, so
  anything longer stays prose.

## 0.4.1

### Fixed

- **dw-knowledge: memories written with a native type were indexed but never recallable.**
  `km-recall.js` filtered candidates to `VALID_TYPES = ['how-to', 'domain', 'task', 'gotcha']`,
  dropping the four native-memory types before scoring. `references/schema.md` promises the native
  types (`user`, `feedback`, `project`, `reference`) are "read and indexed as-is", and
  `km-index.js` honours that — so such a memory appeared in `INDEX.md` with its description and
  facets intact while every query silently excluded it, including a query for its own name. The
  failure is invisible from the index side, which is the only side a human looks at. 33 memories
  typed `feedback` and 6 typed `reference` in the author's own store were unreadable this way.
  `VALID_TYPES` now carries the native types alongside the dw four; the capture guidance is
  unchanged, since preferring the dw values is still right for the distinction they carry.

## 0.4.0

### Added

- **`dw-review-prs-skill` — the reviews waiting on you, drafted but never sent.** Works the queue of
  PRs where review is requested of the user and leaves each finding as an **unsubmitted (pending)**
  `[dev-ai]` review, so the user reads the drafts in the GitHub UI and submits them. Every run starts
  by reading what it already drafted, what the user already published, and what every other reviewer
  and bot said, so a finding is never delivered twice; `state.md` keyed on head SHA keeps an unchanged
  PR out of scope, and `comments.md` is the ledger of everything ever drafted. `scripts/review-prs.js`
  owns the mechanics that are easy to get wrong by hand: one pending review per user per PR (an open
  one makes REST comment posting fail 422, so drafts go through GraphQL `addPullRequestReviewThread`),
  draft comment bodies that REST cannot edit (404, so edits use `updatePullRequestReviewComment`),
  replies that must carry both the review and thread ids, and a search index that lags live PR state
  (every hit is re-resolved through the PR endpoint). The script refuses a comment body without the
  `[dev-ai]` tag and refuses to submit without an explicit `--event`, so the only irreversible step
  stays a deliberate one. Slash command: `/dw-review-prs`.

## 0.3.6

### Changed

- **dw-flow: the review-fix loop has a ceiling.** The Review step said to iterate "until a fresh
  pass is clean", with rounds 1-3 named as a deepening ladder and rounds 4+ unbounded - so a loop
  where each fix provoked the next finding had no exit except the dev noticing. Five rounds is now
  the ceiling: still blocking on round five escalates to the dev with a brief (recurring findings,
  fixes tried, the call needed) instead of opening round six. Two earlier escalation signals are
  named - a fix that creates the next finding (the existing symptom-guard smell; reopen the
  placement contract) and the same finding surviving two fixes. Adapted from obra/superpowers
  (PR #1998, 2026-07-19, shipped v6.2.0); its fix-scoped re-review is deliberately not adopted,
  since the deepening ladder is what surfaces findings a fix-scoped pass would never reach.
- **dw-flow: the review method now judges tests by falsifiability.** The deepening ladder named
  round 3 "tests" without saying what to look for, so a test that cannot fail passed that round.
  Each new or changed test now needs the production change that would fail it named, its
  expectation derived from the requirement rather than read off the implementation, and a closing
  mutation check against the most plausible bug. Names the two traps that look like coverage: the
  **string-presence trap** (asserting text appears in a script, prompt, config, or markdown - the
  observable is behaviour, never text) and the **change-detector trap** (pinning a constant fails
  on every edit and protects nothing). Adapted from obra/superpowers `writing-good-tests.md`
  (PR #1935, 2026-07-13, shipped v6.2.0).

### Housekeeping

- `THIRD_PARTY_NOTICES.md` attributes obra/superpowers for `dw-flow-skill`.

## 0.3.5

### Changed

- **dw-grilling: facts are the agent's to look up, decisions stay the user's.** Step 3 used to
  say to resolve a question from "an established pattern, a config value, a prior decision, an
  existing type", which read as licence to settle a *decision* from the codebase. Facts are now
  looked up and reported; a decision stays the user's even when the environment points at an
  answer, with the existing pattern demoted to evidence for the recommended default. Applied to
  step 3, the hard rule, the stop condition, and the `asking-well` anti-patterns - which gained
  the counterpart, *Deciding from a pattern the user never picked*. Follows upstream
  (mattpocock/skills PR #461, 2026-07-06; carried further in PR #586, 2026-07-16).
- **dw-skill-authoring: the rationalization-table form for load-bearing guards.** The
  positive-phrasing sweep (0.3.1-0.3.2) and the Pruning passes both push toward deleting
  "never do X" guards, while the **negation** failure mode said to keep a prohibition where the
  target can't be phrased positively - without saying what shape the survivor takes. It is now
  an *Excuse / Reality* table placed where the agent would argue past the rule, plus two failure
  modes (**rationalized guard**, **over-pruned guard**) and a pruning caveat that an argument
  behind a rule reads as padding and often isn't. Adapted from obra/superpowers (PR #1934,
  2026-07-14, shipped v6.2.0), whose evals measured the failure this guards against: deleting a
  guard's rebuttal prose degraded behaviour 8/10 -> 5/10 under pressure, while the same
  arguments kept as table rows held.

### Housekeeping

- `THIRD_PARTY_NOTICES.md` now attributes obra/superpowers (MIT).
- Backfilled the missing 0.3.3 and 0.3.4 entries below - both shipped as version bumps without
  a changelog record.

## 0.3.4

### Fixed

- **dw-git-ops: the co-author trailer no longer pins a model version.** `ops.sh` hardcoded
  `Co-Authored-By: Claude Opus 4.8` into every commit it created; the name went stale as soon as
  a newer model was in use, and recording the right one meant suppressing the trailer with
  `OPS_NO_COAUTHOR=1` and hand-writing it. The identity is now overridable via `OPS_COAUTHOR`
  and the default drops the model version entirely, so an unset override cannot record a wrong
  model. `OPS_NO_COAUTHOR` still suppresses the trailer outright.

## 0.3.3

### Changed

- **dw-knowledge: the knowledge store converges on Claude native memory.** `km-index` owned only
  a fenced block inside `MEMORY.md`, so native writes and km writes accumulated side by side -
  one project index had three competing lists, four links pointing at files in the global store,
  and two duplicate lines. `km-index` now regenerates the whole project `MEMORY.md` from the
  files on disk, so the index is derived and cannot drift, duplicate an entry, or point at a
  missing file; a hand-added line is re-derived rather than duplicated.
- **A global tier over native memory, which has none.** `dw-migrate` points every project memory
  dir at the global store (`memory/global` -> `knowledge/`), and `km-index` appends a pointer
  line to `global/INDEX.md` when that link resolves - so a cross-repo memory is readable as
  `global/<name>.md` without being copied into each project.
- Index lines drop the `conf:? verified:?` placeholders when the frontmatter carries neither,
  leaving the native `- [name](file.md) - description` prefix intact.

### Fixed

- `km-index` and `km-review` each skipped only their own scope's index filename, so a `MEMORY.md`
  sitting in the global store was indexed and reviewed as if it were a memory (producing a bogus
  `[MEMORY](MEMORY.md) type:unknown` entry). Both now exclude both index filenames,
  case-insensitively, matching `km-recall`.

## 0.3.2

### Changed

- **Positive-phrasing sweep across the remaining dw-* skills.** Following the 0.3.1 sweep of
  dw-flow, every other skill (dw-knowledge, dw-runbook, dw-deslop, dw-handoff, dw-env,
  dw-grilling, dw-team-communication, dw-post-merge-verification, dw-git-ops, dw-pr-ready,
  dw-skill-authoring) now states its rules as the target behaviour rather than as "do-not"
  prohibitions, per the rule-authoring standard. Behaviour-preserving, docs-only; definitional
  contrasts, quoted examples, descriptive tool behaviour, and the negation-failure-mode teaching
  in dw-skill-authoring were kept intact.

## 0.3.1

### Changed

- **dw-flow: the Plan gate now settles design on paper before code.** A plan is approvable only
  once it carries a **traced, reproduced root cause** (bug tasks) - traced past the error to the
  code that actually governs the behaviour - a **placement contract** (which unit owns the state,
  who writes it, who reads it, its lifecycle; architecture decided at the gate, the specialist
  advising the mechanism), and a clean **design-review** pass over the sketch.
- **dw-flow: added a review method** (`references/review.md`) applied to both the design sketch
  and the diff - design-first, single-responsibility, visibility-serves-design, injection
  discipline, delete-the-speculative, iterate-until-clean - run **blind to what was approved** so
  the reviewer judges correctness fresh rather than deferring to the sign-off.
- **dw-flow: operating principles** - iterate cheap (one deploy after design sign-off), a
  symptom-guard is a design smell, and label a review idea as a suggestion or a constraint.
- **dw-flow: rules restated as positive target behaviour** throughout the skill and its
  references, dropping "do-not" phrasing per the rule-authoring standard.

## 0.3.0

### Changed

- **Durable stores moved to the dw-agent store** - knowledge, runbooks, deslop rules, run
  notes, and handoffs now live under `DW_STORE_ROOT` or `~/Documents/dw-agent-store/`
  (`knowledge/`, `projects/<slug>/{memory,runbooks}/`, `run-notes/`, `handoffs/`) so they
  survive a machine or Claude Code reinstall. Path resolvers fall back per-dir to the legacy
  `~/.claude` layout until `dw migrate` runs; handoffs moved out of the OS temp dir; the
  flow's per-ticket run notes moved out of `{repo}/.claude/worktrees/`.

### Added

- **`bin/dw.js`** - one command surface over the skill scripts: `dw recall`, `dw runbook`,
  `dw handoff`, `dw hook`, `dw migrate`, `dw paths`.
- **`bin/dw-migrate.js`** - one-time legacy-to-store move that leaves symlinks at the old
  `~/.claude` locations; idempotent, `--dry-run`, never touches non-dw data under
  `~/.claude/projects/<slug>/`.
- **`bin/dw-hook.js`** - a single dispatcher now wired to fourteen hook events. Injecting
  events (SessionStart, UserPromptSubmit, PreToolUse(Bash), PostToolUseFailure, PreCompact)
  recall saved knowledge or build the runbook hint / handoff nudge in-process, deduped per
  session via a run-notes cache; the rest (SessionEnd, PostToolUse, PostToolBatch, Stop,
  StopFailure, SubagentStop, PostCompact, PermissionDenied, CwdChanged) append one JSONL line
  to `<store>/run-notes/<slug>/session-log.jsonl`.

## 0.2.3

### Changed

- **dw-team-communication-skill** - added a required review pass that runs on every draft before
  it is shown: `dw-deslop` inline first, then two mandatory review subagents in parallel
  (cold-reader for clarity/CTA/altitude, correctness for claim-vs-code/ticket verification), plus
  a conditional third ask-answerer subagent that, when the draft poses a question, tries to answer
  it from the correctness subagent's ground truth and surfaces the answer to the dev. Drafts-only
  and never-post behavior is unchanged.

## 0.2.2

### Changed

- **dw-grilling** - the interview is now stateful and preference-seeded. It recalls the user's
  `dw-knowledge` preferences (`david-working-rules`, `david-prefers-*` / `prefer-*`) to seed the
  recommended default on every question, persists the decision trail to a session state file so a
  grill survives a pause or context compaction and resumes at the open question, and offers to
  capture the decision record and any newly-revealed preference back to `dw-knowledge` on the way
  out. The abstraction-shape default is now recalled from `david-working-rules` rather than
  hard-coded in the skill.

## 0.2.0

An insights-driven overhaul: two new skills, plugin-shipped hooks, a deslop rules engine, and
flow-spine hardening - all aimed at the recurring friction the usage report surfaced (wrong
clone layout, mid-run env blockers, fixes that merge green with no prod effect, scope overreach,
and mid-task context loss).

### Added

- **dw-env-skill** - owns the canonical flat `{workspace}/{repo}` layout (never a namespace
  subdir) with a deterministic preflight (Docker daemon, AWS credentials shape, layout) that
  fails fast with remediation, plus a bootstrap flow for new machines and repos.
- **dw-post-merge-verification-skill** - proves a merged PR changed production behavior instead
  of trusting green CI: verifies locally, queries the plan-time success metric through read-only
  APM/analytics tools, hands the dev a checklist for the rest, and rules confirmed / no-effect /
  inconclusive. Never touches prod beyond read-only queries.
- **Plugin-shipped hooks** (`hooks/hooks.json`) - knowledge auto-recall (`UserPromptSubmit`),
  runbook hint (`PreToolUse`), and a handoff nudge (`PreCompact`); wired automatically when the
  plugin is enabled, and merged into `settings.json` for non-plugin installs.
- **dw-deslop rules engine** - user-extensible deterministic find/replace rules scoped to
  introduced lines; ships an `em-dash-to-hyphen` default and promotes to a runbook on recurrence.

### Changed

- **dw-flow spine** - three `/simplify` stops (plan, pre-deslop, pre-ship), a plan-time success
  metric locked at the Plan gate, an offered post-merge-verify step, a per-phase skill survey,
  and Capture promoted from offered to mandatory.
- **dw-git-ops** - `ops.sh` prints repo/branch/worktree context before every mutation and
  supports `--expect-branch` / `OPS_EXPECT_BRANCH` to fail on a context mismatch.
- **dw-deslop / dw-grilling** - scope-discipline and completion-with-artifact-proof rules; the
  abstraction-shape decision (new function over flag-growth on a shared helper) is now explicit.
- **Installer** - wires the plugin's hooks for non-plugin installs (additive `settings.json`
  merge, dedupe by command, `--hooks` / `--no-hooks`, exact-match uninstall removal).

### Fixed

- **Dangling canon** - `dw-flow` referenced a `david-working-rules` knowledge entry that did not
  exist; the entry now exists and carries the operating rules.
