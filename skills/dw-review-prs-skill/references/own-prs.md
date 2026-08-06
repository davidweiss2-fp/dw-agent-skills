# Your own PRs

The queue hands them over as ordinary work — same statuses, same lifecycle, same review. Two things
differ: where the review's context may come from, and who does the work afterwards.

## Context: only what a stranger could reach

The diff and surrounding code at the PR's ref, what is committed in the local repo, the PR
description, the ticket and its ACs, the comment surfaces. **Nothing from the session that wrote the
code**, the plan behind it, or your memory of why a line is the way it is.

That rule is the whole point rather than a formality. Knowing the intent is what lets a reviewer
talk themselves out of a real defect: the code matches what you meant, so the gap between what you
meant and what you wrote goes invisible — and that gap is exactly what review is for. Judge the diff
on its merits, the way the strict reviewer in the repo's own conventions would, and let a finding
stand even when you remember deciding it was fine.

Two consequences:

- If justifying a finding needs a fact that is not in the diff, the repo, or the ticket, that fact
  is written down nowhere a reviewer could find it — and *that* is the finding. Say it belongs in
  the PR body or the ticket.
- Drafts on your own PR submit as `COMMENT`. GitHub refuses `APPROVE` and `REQUEST_CHANGES` there,
  and `submit` says so rather than failing three calls deep.

| Excuse | Reality |
|---|---|
| "I wrote this, so I already know it is right" | You know the intent, which is the one thing a reviewer is not supposed to have. Every defect you have ever shipped was written by someone who believed the same thing at the same moment. |
| "This needs context the PR does not carry, but I can supply it" | Then the PR does not carry it, and the next reader will not have you. Write the finding against the PR body or the ticket. |

## Handing it to the agent that will fix it

Once your review is submitted, the next move belongs to whoever does the work. The PR's card on the
status page carries **Prompt for the coding agent**: a copy-ready markdown brief, revealed inline
with its own Copy button, generated from the card rather than written per run.

Its whole content is *where the comments are and how to answer them*. It deliberately says nothing
about the change itself — the comments are the brief, and a second copy would drift from them.

The brief establishes three voices in one thread:

| Tag | Who |
|---|---|
| `[dev-ai]` | the reviewing agent — this skill |
| `[author-ai]` | the agent doing the work, replying and pushing back |
| *(none)* | you, and an untagged comment is the deciding voice |

`author` and `reviewer` are the vocabulary GitHub already puts on a PR, so a reader of the thread
knows which side a comment came from without a glossary.

The whole exchange then happens on the PR: the working agent answers in-thread, refutes what it can
refute with evidence, fixes what it cannot, leaves threads unresolved, ignores bots, and you weigh in
as yourself without a tag. Nothing has to come back through this skill for the two agents to argue.

The button only appears on a PR the store records, which is the right gate — the brief claims
comments are waiting, and that is only true once they are.
