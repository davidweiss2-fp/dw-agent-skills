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
- **Single responsibility.** One unit owns one concern. A routing unit surfaces a route's
  permission; a presentation decision belongs to a presentation unit. Flag any unit that has grown
  a second job.
- **Visibility serves the design.** Ask "why is this public?" of every new public member; if the
  answer is "so a test can reach it", that is a finding - test through the public entry point, or
  extract the logic to its own unit with its own tests.
- **Injection discipline** (idiomatic to the stack - constructor DI in Laravel/Angular, `handle()`
  injection for commands, `Depends` in FastAPI): a collaborator built inline (`new`/`resolve`)
  instead of injected is a finding.
- **DRY.** A repeated call shape gets extracted to one named helper.
- **Delete the speculative.** Guards, knobs, extra state, and defensive code earn their place only
  with a concrete trigger; the rest comes out. "This seems extra" is a finding.
- **Directive findings.** Each finding is one concrete instruction with the target named
  ("rename X → Y", "inject Z", "make W private and test through V").

## Tests: does each one rule anything out?

A test that cannot fail is not coverage. Review every new or changed test for **falsifiability**:

- **Name the production change that would fail it.** If you can't name one, the test asserts
  nothing. Say so as a finding.
- **Derive the expectation from the requirement, not the code.** An expectation read off the
  implementation and restated as an assertion passes by construction and locks in today's bug.
  Work out what the behaviour *should* be from the ticket or the design, then assert that.
- **The string-presence trap.** Asserting that some text appears in a script, prompt, config, or
  markdown file counterfeits falsifiability — the observable is *behaviour*, never text. A test
  that greps for a phrase passes when the phrase is copied into a comment and fails when the same
  behaviour is spelled differently. Assert what the thing does.
- **The change-detector trap.** A test that pins a constant or a serialised blob fails on every
  edit and protects nothing. Ask what defect it would catch; if the answer is "someone changed
  this line", it is a maintenance cost, not a test.
- **Close with a mutation check.** Pick the most plausible bug in the changed code, ask whether at
  least one test would fail on it, and name the test. If nothing catches it, that is the gap.

Trivial code and prose earn no test — a test with nothing to rule out is sediment.

## Iterate until a fresh pass finds nothing — for at most five rounds

Re-run the method after every fix and after every push, a level deeper each round (round 1: naming
and structure; round 2: injection and visibility; round 3: tests — by the falsifiability pass above
— and naming again). A real reviewer
re-reviews every push, so close that loop before they do.

**Five rounds is the ceiling.** A loop still producing blocking findings on round five has stopped
being a review problem, so escalate to the dev instead of opening round six. Hand over a brief:
the findings that keep recurring, the fixes already tried, and the specific call you need. Iterating
past that burns the dev's turnaround on a disagreement only they can settle.

Two signals to escalate **before** the ceiling:

- **A fix creates the next finding.** When round N's findings trace back to round N−1's fixes, the
  design is wrong, not the code — that is the symptom-guard smell in the operating principles.
  Escalate and reopen the placement contract rather than iterating.
- **The same finding survives two fixes.** Either the finding is misstated or the fix cannot land
  where it is being attempted. Say which you think it is and ask.

## Run it blind to what was approved

The reviewer's whole input is the artifact and this method - that is what keeps it judging
correctness fresh. Approval context (the signed-off plan, the prior rationale, any "this was
signed off / treat X as acceptable" framing) makes a reviewer rationalise a real defect into a
non-finding, and hearing that defect is the whole point of the pass. A wrong thing is wrong
regardless of what was approved. Recall `dw-knowledge` for the repo's specific reviewer patterns
and hand those in too, as things to check.

---

The **five-round ceiling with escalation** is adapted from obra/superpowers (MIT), whose
subagent-driven-development loop installs a five-round circuit breaker with controller adjudication
when it trips (PR #1998, 2026-07-19, shipped in v6.2.0). Upstream also scopes its re-review to the
fixes; this method keeps re-reviewing the whole artifact a level deeper each round instead, because
the deepening ladder is what surfaces findings a fix-scoped pass would never reach.

The **falsifiability pass** — name the production change that would fail the test, derive the
expectation independently of the code under test, and close on a mutation check — is adapted from
the same project's `writing-good-tests.md` (PR #1935, 2026-07-13, also v6.2.0), including the
**string-presence** and **change-detector** traps it names.
