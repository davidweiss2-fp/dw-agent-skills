# Changelog

All notable changes to dw-agent-skills. This project follows semantic versioning.

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
