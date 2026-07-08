# Changelog

All notable changes to dw-agent-skills. This project follows semantic versioning.

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
