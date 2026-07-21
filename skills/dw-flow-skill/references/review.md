# Review method (design and code)

Applied at two points in the flow, same method both times, run as a strict senior reviewer would:

- **Design review** at the Plan gate - over the design *sketch* (the units, their signatures, the
  data flow), before any code. The cheap findings live here: an SRP break, a missing test seam, or
  a coverage gap costs a paragraph to fix now and a rewrite to fix later.
- **Code review** at the Review step - over the diff, via `/code-review` (or `fp-cdp-review` in
  that scope).

## The method

- **Design-first, unit by unit.** Read each unit as a design artifact: does it hold one precise
  concept, named for its exact role, in the right place? Rename anything generic ("Manager",
  "Helper", "Discovery", "handle", "skip") to what it actually does.
- **Single responsibility.** One unit owns one concern. A routing unit may surface a route's
  permission; it may not own a presentation decision. Flag any unit that has grown a second job.
- **Visibility is for design, never for tests.** Ask "why is this public?" of every new public
  member; if the answer is "so a test can reach it", that is a finding - test through the public
  entry point, or extract the logic to its own unit with its own tests.
- **Injection discipline** (idiomatic to the stack - constructor DI in Laravel/Angular, `handle()`
  injection for commands, `Depends` in FastAPI): a collaborator built inline (`new`/`resolve`)
  instead of injected is a finding.
- **DRY.** A repeated call shape gets extracted to one named helper.
- **Delete the speculative.** Guards, knobs, extra state, and defensive code with no concrete
  trigger come out. "This seems extra" is a finding.
- **Directive findings.** Each finding is one concrete instruction with the target named
  ("rename X → Y", "inject Z", "make W private and test through V").

## Iterate until a fresh pass finds nothing

Re-run the method after every fix and after every push, a level deeper each round (round 1: naming
and structure; round 2: injection and visibility; round 3: tests and naming again). One pass is not
done - a real reviewer re-reviews every push, so close that loop before they do.

## Run it blind to what was approved

Give the reviewer the artifact and this method only. Do **not** feed it the approved plan, the
prior rationale, or any "this was signed off / treat X as acceptable" framing. Approval context
makes a reviewer rationalise a real defect into a non-finding - and hearing that defect is the
whole point of the pass. A wrong thing is wrong regardless of what was approved. Recall
`dw-knowledge` for the repo's specific reviewer patterns and hand those in too - but as things to
check, never as things already blessed.
