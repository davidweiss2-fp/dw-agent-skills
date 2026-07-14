# Background mode - prompt template and boundaries

Detail for `SKILL.md`'s Background mode section: what the background agent's seed prompt must
contain, and how to tell the user it was spawned. Reached only when that mode fires (explicit
trigger) - the default flow never needs this file.

## Prompt template

The scrubbed handoff document (produced by the normal flow, unchanged) is the seed; wrap it with
the framing a fresh agent needs, since it starts with none of this conversation's context:

```
You are picking up work in <repo path / worktree path>, handed off from a prior session.
Focus for this session: <focus arg, or "continue the work below" if none was given>.

<the scrubbed handoff document - Objective / Current state / Next steps / Key decisions &
constraints / Gotchas / Pointers / Suggested next skills, verbatim>

Do NOT, without asking the user first:
- merge, force-push, or delete a branch; flip a PR from draft to ready
- change access controls or sharing permissions on any resource
- post/send anything on the user's behalf (Slack, email, PR comments)
- spend money, or take any other irreversible action

If you hit one of the above, stop and report back instead of proceeding.
```

Keep the boundary list short and concrete - it mirrors this environment's own prohibited /
explicit-permission-required action categories, restated so a fresh agent that has never seen this
conversation still respects them. Don't expand it into a full policy restatement; the point is a
fast, checkable list, not a duplicate of the environment's rules.

## Spawning it

In this environment, that means one call to the `Agent` tool with `run_in_background: true` and the
prompt above, plus a short `description`/title (a few words, e.g. "Fix login bug", "Wire up retry
path") so the user can tell it apart from any other background work. That maps onto upstream's
`claude --bg --name "<title>" "<summary>"` - same idea, this environment's actual mechanism.

## Telling the user

State it plainly and stop there - don't narrate the tool call, don't invent a tracking mechanism:

> Spawned a background agent ("<title>") seeded with the handoff above, working in <repo path>.
> You'll be notified when it finishes, or you can check on it the normal way in this environment.

If the environment surfaces background tasks differently than "you'll be notified," describe that
real mechanism instead - never fabricate a dashboard, status file, or tracking ID this repo doesn't
actually provide.
