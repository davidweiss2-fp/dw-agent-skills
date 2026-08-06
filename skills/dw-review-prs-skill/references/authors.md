# Per-author review instructions

`authors.json`, beside `state.md` in the store, holds the reviewer's standing decisions about how
to review particular people. It exists because those decisions are **data, not skill**: they change
per reviewer and per team, they change often, and a prompt edit is the wrong place to keep them.

```json
{
  "some-login": {
    "who": "one line — who they are and why this entry exists",
    "knowledge": ["memory-name-to-recall-through-dw-knowledge"],
    "steps": ["an extra step this author's PRs need, at the point it names"],
    "instructions": ["how the comments themselves must be written"]
  },
  "another-login": "a bare string is shorthand for instructions"
}
```

## The contract

| Field | Read as |
|---|---|
| `who` | Context for the reviewer. Never quoted on a PR. |
| `knowledge` | Names to recall through `dw-knowledge` before drafting. |
| `steps` | Actions to carry out, each naming its own point in the run (before drafting, at close-out). |
| `instructions` | Constraints on the comment text itself. |

Every field is optional. Matching is **case-insensitive**, because GitHub logins are and an entry
typed with the wrong case would otherwise fail silently — the worst outcome for a config whose whole
job is to not be forgotten.

## What notes do not do

They **never change classification**. An author who needs a different register is still ordinary
review work, and the queue treats their PR exactly as it would anyone's. Notes change how the review
is written and delivered, nothing else. Keeping that line sharp is what stops the file from becoming
a second, invisible routing table.

## Where they surface

`surfaces <pr>` returns the matching entry under `authorNotes`, and `queue` tags the row
`[author notes]`. They ride on `surfaces` on purpose: Step 2 already makes it mandatory before
drafting, so there is no separate command to forget. A note that only appears when someone
remembers to ask for it is a note that will be missed on the run that mattered.

## Worked example — an author you manage

The case this was built for: a first-role engineer whose reviews carry a teaching job, whose PRs are
also read by the senior owners of the code, and who has a second store of history that must be read
before drafting so a settled finding is never re-delivered.

```json
{
  "junior-dev": {
    "who": "First role out of school; learning the culture and the stack at once. Review feedback is a main learning channel.",
    "knowledge": ["mentoring-tone-for-this-author"],
    "steps": [
      "Before drafting, read <other-store>/posted-comments.md and the standing notes in its state.md — they record findings already delivered and findings the reviewer DECLINED to post.",
      "At close-out, update <other-store>/coaching.md with the day's evidence."
    ],
    "instructions": [
      "Never keep score. State the general rule plainly as if for the first time; the rule is the teaching, its history is not.",
      "Split the register from the finding: the PR gets the finding, short and evidence-first; the teaching goes to them directly.",
      "A finding already declined stays off the PR even when new evidence turns up — route the evidence to the reviewer instead."
    ]
  }
}
```
