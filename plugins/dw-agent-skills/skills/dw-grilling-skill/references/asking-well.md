# Asking well: question shape and recommended defaults

The interview only saves the user time if each question is fast to answer. This is the
shape that works.

## The anatomy of one good question

1. **Name the decision** in one line — what has to be decided and why it's open now.
2. **Give the real options** — usually two or three concrete choices, not an open void.
   Drop options that the codebase or earlier answers already rule out.
3. **Lead with your recommendation** — the option you'd pick and the one-line trade-off
   that justifies it. This is the part that turns a "let me think" into a "yep."
4. **Make it answerable in a word** — "Go with A?", "yes/no", "A or B?". The user should
   be able to confirm or redirect without writing a paragraph.

Example shape:

> For the cache, I'd use an in-memory LRU with a 5-minute TTL — it's the simplest thing
> that handles the read pattern here, and we can swap in a shared store later if traffic
> grows. The alternative is a shared cache now, which adds an external dependency we
> don't need yet. Go with the in-memory LRU?

One decision, real options, a clear lean, a one-word answer.

## What a good recommended default looks like

- **It's a real choice, not a hedge.** "Either could work" is not a recommendation. Pick
  one and own the reasoning.
- **The trade-off is one line.** Why this over the alternative — cost, simplicity,
  reversibility, consistency with existing code. Long justifications mean the question is
  really several questions; split it.
- **It favors the reversible, lower-cost path** when the stakes are genuinely even. Easy
  to undo beats theoretically optimal.
- **It's consistent with what already exists** in the codebase unless there's a reason to
  diverge — and if there is, say what the reason is.

## When you genuinely have no lean

Rare, but real. Then:

- Say so plainly: "I don't have a strong lean here."
- Give the **smallest** set of genuinely-distinct options, each with its trade-off.
- Ask which one fits the user's priorities — not "what do you want," but "are we
  optimizing for X or Y here?" so even the open question has structure.

## Anti-patterns

- **Stacking questions.** Two "?" in one turn is two turns. Split them.
- **Bare open questions.** "How should we handle errors?" with no options and no lean
  pushes the work back onto the user. Bring options and a recommendation.
- **Asking what the codebase already answers.** If there's an established pattern, a
  config value, or a prior decision, resolve it and report — don't ask.
- **Questions out of dependency order.** Don't ask about the response format before
  you've settled whether there's a response at all. Re-prune after each answer.
- **Fake binaries.** Don't force an A/B when the honest answer space is three options or
  a number. Match the options to the real decision.

## Closing summary

When the tree is resolved, write the **resolved-design summary**: a flat list of every
decision and its outcome, plus anything deliberately deferred. This is what the user (or
the next agent) builds from, so it must stand alone without re-reading the interview.
