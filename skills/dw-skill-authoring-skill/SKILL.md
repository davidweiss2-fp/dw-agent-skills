---
name: dw-skill-authoring-skill
description: >-
  Principles, a checklist, and a failure-mode table for authoring reliable
  Agent Skills — naming, description, progressive disclosure, scripts vs.
  prose. Invoked by name.
disable-model-invocation: true
---

# Authoring Agent Skills

A skill's job is to pull **predictability** out of a model that is otherwise free to improvise:
the agent should take the *same path* on every run, not necessarily produce identical output.
Every rule below serves that one goal. Use this skill when writing a new SKILL.md, reviewing an
existing one, or debugging why a skill mis-fires.

Vocabulary in **bold** is defined in `references/glossary.md` — reach for it when a term is unclear.

## The shape of a skill

A skill is a directory with a `SKILL.md` (YAML frontmatter + Markdown body) and, optionally,
`references/`, `scripts/`, and `commands/`. The body is built from two kinds of content that mix
freely:

- **Steps** — ordered actions the agent performs, each ending on a checkable done-condition.
- **Reference** — definitions, rules, and facts the agent consults on demand.

A skill can be all steps, all reference, or both. This skill, for instance, is mostly reference.

## Naming

The `name` is lowercase-hyphen and carries the skill's **leading word** — the one compact concept
the agent (and you) think with when reaching for it. Pick a name whose key word also shows up in the
prompts, tickets, and code where the skill should fire; shared language is what makes invocation
reliable. In this repo, prefix every skill `dw-` and suffix `-skill` to match the set.

## Writing the description

The `description` does the invocation work, so it earns the hardest pruning of anything you write —
it sits in the context window every turn it is reachable. Two jobs: say what the skill is, and list
the situations that should **trigger** it.

- **Third person, broad, and a little pushy.** Describe the skill from the outside ("Turn a
  question into…", "Keep a PR ready…"), and lean toward firing rather than staying silent.
- **Concrete trigger phrasings.** Quote the words a user would actually type — "review this skill",
  "why won't my skill trigger" — not abstract categories. The model matches on surface language.
- **One trigger per distinct path.** Synonyms that rename the same path are **duplication**;
  collapse them and keep only genuinely different reasons to fire.
- **Front-load the leading word**, and don't restate identity already obvious from the body.

If a skill should only ever be run by hand, set `disable-model-invocation: true`; the description
then becomes a human-facing one-liner and stops costing context every turn.

## Progressive disclosure

Rank everything by how immediately the agent needs it, and put it at the matching tier:

1. **In the SKILL.md body** — the steps and the reference the agent needs on most runs.
2. **In `references/*.md`** — detail reached through a **pointer** ("Full procedure:
   `references/x.md`"), loaded only when that pointer fires.
3. **Outside the skill** — material any skill can point at.

Push too little down and the body bloats (**sprawl**); push too much down and you hide what the
agent actually needs. The cleanest test is **branching**: inline what *every* run needs, and move
behind a pointer what only *some* runs reach. Keep a SKILL.md body under ~200 lines; when it grows
past that, disclose, don't cram. Keep a concept's definition, rules, and caveats together under one
heading so reading one part pulls in its neighbors.

## Steps and completion criteria

Write steps in order, and end each on a **completion criterion** — the condition that tells the
agent the step is done. Make it *checkable* (can the agent tell done from not-done?) and, where it
matters, *exhaustive* ("every changed file accounted for", not "list some changes"). A fuzzy
criterion invites **premature completion** — the agent declaring victory early because finishing
looks more attractive than the work. If the steps still ahead keep tempting the agent to rush the
one in front, that is the signal to split the sequence so later steps stay out of view.

## Scripts vs. prose

Put deterministic, repeatable mechanics in a **script**; keep judgment in **prose**.

- **Script it** when the work is the same every time and a wrong step is costly — parsing,
  indexing, fetching state, enforcing a guardrail. A script makes that part identical run to run.
- **Keep it prose** when the work needs the model's judgment — triage, drafting, deciding which
  path applies. Prose is where you spend words on *how to think*, not *what to type*.

House rules for any script you ship: Node, CommonJS, `'use strict'`, **only `node:` builtins** (no
npm deps), and it must pass `node --check`. Never build a shell command out of untrusted input —
prefer pure parsing over shelling out. Match the style of
`skills/dw-pr-ready-skill/scripts/utils.js`.

## Pruning

A long skill is not a thorough skill. Three passes:

1. **Single source of truth** — each fact lives in exactly one place, so a behavior change is a
   one-spot edit. Repetition is **duplication**: it costs tokens and inflates a fact's apparent
   importance.
2. **Relevance** — delete any line that no longer bears on what the skill does. Skills accumulate
   **sediment** because adding feels safe and removing feels risky; prune anyway.
3. **No-ops** — test each *sentence* in isolation: does it change behavior versus what the model
   would do by default? "Be thorough" is a **no-op** when the agent is already thorough-ish. Delete
   the whole sentence rather than trim it, or replace a weak instruction with a stronger leading
   word ("relentless", not "be careful").

## Authoring checklist

Run this before calling a skill done — for a new skill or a review:

- [ ] `name` is `dw-…-skill`, lowercase-hyphen, carrying a clear leading word.
- [ ] `description` is third-person, broad/pushy, with concrete trigger phrasings; one per path.
- [ ] Body is concise (< ~200 lines); long detail is disclosed to `references/` behind pointers.
- [ ] Steps end on checkable, exhaustive-where-it-matters completion criteria.
- [ ] Mechanics that should be identical every run are scripts; judgment stays prose.
- [ ] Scripts: Node + CommonJS + `'use strict'`, `node:` builtins only, pass `node --check`, no
      shell-from-untrusted-input.
- [ ] Slash commands live in `commands/` under the `/dw-…` convention.
- [ ] No duplication, no stale lines, no no-op sentences.
- [ ] Zero secrets / company-specific data — examples use placeholders only.
- [ ] A committed byte-identical mirror exists if the repo keeps one.

## Failure modes (diagnosis)

When a skill misbehaves, name the failure before fixing it:

| Symptom | Failure mode | Fix |
|---|---|---|
| Agent stops a step early | **premature completion** | Sharpen the completion criterion first; only split the sequence if it stays fuzzy and you still see the rush. |
| Same meaning in two places | **duplication** | Collapse to one source of truth. |
| Skill keeps growing, nothing removed | **sediment** | Prune on a schedule; deletion is the default move. |
| Skill is just too long | **sprawl** | Disclose reference behind pointers; split by branch or sequence. |
| A line the model already obeys | **no-op** | Delete it, or swap a weak phrase for a strong leading word. |
| Skill doesn't fire when it should | weak description | Add the concrete trigger phrasing the user actually types; front-load the leading word. |
| A "never do X" rule reads back as an instruction to do X | **negation** | Rephrase as the positive target behavior; keep the prohibition only where you can't phrase the target positively, and even then pair it with what to do instead. |

## Hard rules

- **Predictability is the goal** — every edit should make the agent's *path* more repeatable.
- **The description is load-bearing and always-on** — prune it hardest; concrete triggers, no
  duplication.
- **Length is a cost, not a virtue** — disclose and prune; never pad.
- **Zero secrets / company data** — placeholders only in every example.

---

Adapted from mattpocock/skills (skills/productivity/writing-great-skills), MIT License. Re-expressed
for this repo's conventions; vocabulary and failure-mode taxonomy credit the original. The
**negation** failure mode follows upstream's addition of the same concept (mattpocock/skills
PR #463, 2026-07-06).
