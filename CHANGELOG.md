# Changelog

All notable changes to dw-agent-skills. This project follows semantic versioning.

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
