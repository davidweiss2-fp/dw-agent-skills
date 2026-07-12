# Skill-authoring glossary

The vocabulary the SKILL.md uses. Each term is the shortest handle for a recurring idea in skill
design; keeping the words consistent is itself a predictability move.

## Core ideas

- **Predictability** — how reliably a skill makes the agent follow the *same path* each run. The
  point is a repeatable process, not byte-identical output. This is the property every other lever
  exists to raise.
- **Leading word** — a compact concept the model already holds from pretraining (e.g. *checklist*,
  *guardrail*, *tracer bullet*) that the agent reasons with while running the skill. Used in the
  name and body it anchors *behavior*; used in the description and shared with your prompts/docs/code
  it anchors *invocation*. One strong word can retire a sentence of explanation.
- **Step** — an ordered action in the SKILL.md body. The primary content tier: what the agent does,
  in sequence.
- **Reference** — a definition, rule, or fact the agent consults on demand rather than executes in
  order. May sit in the body or be disclosed to a `references/` file.
- **Completion criterion** — the condition that marks a step done. Should be *checkable* (the agent
  can tell done from not-done) and, where it matters, *exhaustive* (covers every item, not "some").
- **Branch** — a distinct path through the skill. Different runs take different branches; inline
  what every branch needs, disclose what only some reach.
- **Progressive disclosure** — moving material out of the SKILL.md body into a linked file so the
  top stays legible, loaded only when its pointer fires.
- **Pointer** — the wording in the body that sends the agent to disclosed material (e.g. "Full
  procedure: `references/x.md`"). The *phrasing*, not the target, decides how reliably it is reached.
- **Single source of truth** — each meaning lives in exactly one authoritative place, so changing a
  behavior is a one-spot edit.

## Invocation

- **Trigger** — a phrasing or situation named in the `description` that should make the model fire
  the skill. Concrete and quoted from real usage, not an abstract category; one trigger per distinct
  path.
- **Model-invoked** — the skill keeps a `description`, so the agent can fire it on its own and other
  skills can reach it. Costs context every turn the description is loaded.
- **User-invoked** — `disable-model-invocation: true`; only a human typing the name can run it. Zero
  context cost, but you must remember it exists.

## Scripts vs. prose

- **Script** — deterministic, repeatable mechanics pulled out of the body and into code: same steps,
  same order, identical run to run. Use it where a wrong step is costly.
- **Prose** — the body text that carries judgment work — triage, drafting, deciding which path
  applies. Spends words on *how to think*, not *what to type*.

## Failure modes

- **Premature completion** — ending a step before the work is genuinely done, because *being done*
  is more attractive than the legwork. Fix the completion criterion first; split the sequence only
  if it stays fuzzy and you still see the rush.
- **Duplication** — the same meaning in more than one place. Costs maintenance and tokens and
  inflates how important that meaning looks.
- **Sediment** — stale layers that build up because adding feels safe and removing feels risky. The
  default fate of any skill without a pruning habit.
- **Sprawl** — a skill that is simply too long, even when every line is live. Cured by the
  disclosure ladder and by splitting along branches or sequence.
- **No-op** — a line the model already obeys by default, so you pay context to say nothing. Test
  each sentence: does it change behavior versus the default? If not, delete it (or upgrade a weak
  phrase to a stronger leading word).
- **Negation** - steering by prohibition: naming the behavior you want *stopped* pulls it into
  context and makes it more available, not less ("don't think of an elephant" leaves only the
  elephant). Fix by stating the target behavior instead, so the banned one is never named; keep a
  bare prohibition only where the target can't be phrased positively, and pair it with the
  positive even then.
