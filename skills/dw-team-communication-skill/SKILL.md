---
name: dw-team-communication-skill
description: >-
  Turn an engineering change, decision, or status into the right message for the right
  audience — to get approval, announce, inform, or loop people in — in a tone matched to
  who's reading. Use when the dev wants to communicate something to teammates/PM/stakeholders:
  "ask product about this", "draft a slack to the team", "announce this change", "tell the
  PM", "status update for X", "get sign-off on", "loop in the eng channel", or invokes
  /dw-team-communication [audience] [intent] [topic]. Same engine every time — context, intent,
  CTA, audience-matched tone — outputs copy-ready Slack-DM / JIRA-comment / channel-post drafts.
  Drafts only, never posts.
---

# Team Communication

Your job: take something that came up during work — a decision, a change, a status, a question —
and turn it into **the right message for the right audience**, then render **copy-ready DRAFTS**
for a Slack DM, a JIRA ticket comment, and/or a team channel post. You draft and surface
click-to-open links — **the human posts.** This skill is prompt-driven: you do the reasoning,
mining, screenshots (via MCP), and lookups yourself. No scripts to run — but every draft goes
through the **required review pass** (deslop, then review subagents) before you show it.

## Invocation

`/dw-team-communication [audience/channel] [free-text intent] [optional topic]`

| Token | Meaning |
|---|---|
| `slack` / `jira` / `both` / a channel name | Where to render. Default (nothing given) → `both` (Slack DM + JIRA comment) |
| free text, e.g. "ask PM to approve", "announce to #eng", "status update for the team", "get sign-off on this" | The **intent** — what the message needs to accomplish. Required in spirit; if missing, infer from context and confirm in one line |
| `--staging` / `--local` | Force screenshot source |
| `--no-image` | Skip screenshots |
| everything else | The topic the message is about |

No mode keyword ⇒ render both. No intent given ⇒ infer it from context (e.g. "this needs a yes/no
from product" → approval-ask) and state the inferred intent before drafting.

## Flow

1. Parse args: audience/channel (default both), free-text intent, `--staging`/`--local`/
   `--no-image`; rest = topic.
2. Get the substance: if usable session context exists (this conversation, recent `git diff`,
   branch), auto-mine it; else ask the user in one line what the message is about.
3. Derive the issue key: `git rev-parse --abbrev-ref HEAD | grep -oE '[A-Z]+-[0-9]+'`. Link =
   `https://{jira_host}/browse/<KEY>` (set `{jira_host}` to your Jira host). Ask only if none.
4. Resolve the audience/recipient (fallback chain below); if unresolved, frame without a name.
5. Decide screenshots: relevant if the topic mentions a screen/page/view/button/layout/visibility
   OR the diff touches `*.component.html|ts|scss`. If relevant and not `--no-image`, offer + ask
   which view(s).
6. Write the message following "What makes a good message" below — natural prose, no labels,
   tone matched to the audience (see Tone by audience).
7. Render per channel (Slack DM / JIRA comment / team channel post).
8. **Required review pass** — run the pass below on the rendered drafts and fold in every finding
   before anything reaches the user. See "Required review pass".
9. Output drafts in chat, copy-ready, each fenced, with click-to-open link(s) + inline images and
   their file paths — plus the ask-answerer's note when one ran. Stop — do not post.

## What makes a good message

A good message gets read, understood, and acted on fast. The marks of one:

- **Lead with the point.** Open with the ask, the news, or the status — busy people read fastest
  when the point comes first, not buried after preamble.
- **One clear CTA.** Every message lands one thing the reader should do with it: decide, ack, no
  action needed, reply by a date. Make it explicit, even when the CTA is "just FYI."
- **Just enough context.** What it's about, who's affected, what's changing or happened, and why
  it's coming up now — enough to remove ambiguity, nothing that makes them work to understand it.
- **Make the stakes clear.** Why it matters / what's at stake / any urgency or deadline, so they
  can prioritize. Omit if there's none.
- **Recommend, don't just report.** When a decision is needed, state your lean and the trade-off
  so they can confirm instead of starting from scratch. Optionally a default — what happens if you
  don't hear back. When it's a status or announcement, state impact, not just activity.
- **Let them see it.** For UI topics, link the preview/staging view.
- **Their language, their altitude.** Match vocabulary and detail to the audience (see below) — no
  internal identifiers a non-engineer wouldn't know unless the audience is engineering.

## Tone by audience

The intent decides the CTA; the audience decides the voice and altitude. Resolve who's reading
before drafting:

- **Product / non-technical owner** — product-level language only, no implementation detail (see
  Hard rules). Used for decisions, approvals, sign-off asks.
- **Engineering peers / eng channel** — technical detail is welcome and often expected: file/
  component names, PR links, root cause. Used for announcements, status updates, loop-ins.
- **Mixed / leadership** — lead with business impact, keep technical detail to one line of "how,"
  skip implementation minutiae.

When in doubt, ask one line rather than guess the altitude wrong — a product question pitched at
engineers (or vice versa) is the most common failure mode.

## How to write it

Write it the way you'd type it yourself: **simple, terse English, like a normal day-to-day
message.** No section labels or headers — never "Context:", "Scenario:", `h3.`, etc. No corporate
fluff. Short — a sentence or two up to a short paragraph. Choose whatever natural shape fits the
message and the channel. Always land **one clear CTA** — a decision, an ack, or "no action
needed" — stated plainly. Cover only what's relevant; skip points that don't apply. Match the
asker's own voice.

## Required review pass

A draft is going in front of a teammate, a PM, or a channel — so it gets checked before you show
it, every time. Runs on the rendered drafts, in this order; a draft doesn't reach the user until
it has been through deslop and both mandatory reviews.

1. **Deslop — inline, in the main agent.** Invoke `dw-deslop` on the draft prose and lean fully
   into it until it's done: strip the AI writing tells (filler openers, puffery, bold-everything,
   emoji bullets, em-dash→hyphen, hedging). These are professional prose, not code, so it's a
   prose-deslop pass. Apply every edit before moving on.

2. **Two mandatory review subagents — spawn both in parallel:**
   - **Cold-reader.** Give it only the rendered draft plus the audience and intent — no drafting
     context, so it reacts the way the real recipient will. It answers: is the point in the first
     line, is there exactly one clear CTA, does the altitude match the audience, is anything
     confusing or missing? It returns concrete fixes, not a score.
   - **Correctness.** Give it repo access and have it check every factual and technical claim in
     the draft against ground truth — the diff, the code, the ticket. File and behavior claims,
     "before it was X", numbers, names, links. It returns each claim as confirmed / wrong (with the
     real fact) / unverifiable.

   Fold both into the drafts: fix anything correctness flagged wrong; soften or drop the
   unverifiable; apply the cold-reader's clarity fixes.

3. **Ask-answerer — a third subagent, only when the draft poses a question the reader must answer.**
   When the message asks the recipient something that could be answered from the code or facts,
   hand the **correctness subagent's output** to this subagent and have it try to answer that
   question from the same ground truth. Surface its answer to the dev next to the drafts — e.g.
   "you're asking {question}; from the code the answer looks like {answer} — you may not need to
   ask, or you can fold it in as context." Never rewrite the ask on your own and never post; the
   dev decides whether the question still needs sending.

**Done when:** deslop is applied, both mandatory subagents have returned and their findings are
folded in, and — if the draft contained an ask — the ask-answerer has run and its note is attached.
Only then output.

## Per-channel rendering

Same message, rendered per channel — all terse, natural, **no labels/headers**:
- **Slack DM** — conversational, like a real ping. Light mrkdwn only if it helps (`*bold*` the
  ask or a key word). First-name greeting if the recipient resolved, else neutral. JIRA/staging
  links as bare URLs. End with a low-friction nudge matched to the CTA ("wdyt?", "lmk", "ack when
  seen", no nudge needed for pure FYI).
- **JIRA comment** — a touch more composed but still terse plain prose. **No `h3.` headers, no
  labels.** You may `*bold*` the key point. Include the staging link; don't restate the ticket key.
- **Team channel post** — written for a wider audience reading once, possibly out of thread.
  Slightly more self-contained than a DM (no assumed shared context), still terse. Lead with the
  one-line takeaway; mrkdwn for emphasis is fine.

## Recipient / audience resolution (stop at first hit; else no name)

MCP tool names are `mcp__<server>__<tool>` and the `<server>` segment is environment-specific —
match each tool below by its role and `<tool>` suffix in your available tools, and skip a source
whose server isn't connected.

1. **Issue tracker (e.g. Jira)** — `getJiraIssue` (`cloudId` = your Jira host,
   `issueIdOrKey` = the key, `fields:["reporter","assignee","summary"]`). For a query use
   `searchJiraIssuesUsingJql` (`cloudId` + `jql`). Take the display name / email. (If the host
   cloudId fails, resolve it via `getAccessibleAtlassianResources`.)
2. **Chat (e.g. Slack)** — `slack_search_users` (`query` = name/email) for a DM, or
   `slack_search_channels` for a named channel; confirm a user via `slack_read_user_profile`
   (`user_id`). DM open link: `https://slack.com/app_redirect?channel=<USER_ID>`.
3. **HR directory (e.g. HiBob)** — `hibob_get_employee_fields` (discover field paths) then
   `hibob_people_search` (filter by email, or empty filters + match the name yourself). Then
   re-run the chat search with the confirmed email.
4. **Unresolved** — do not invent a person or channel. Frame the message with no name and tell
   the user: "Couldn't auto-resolve the recipient — pick it when you paste."

## Image flow (UI/UX topics only, after offering)

Offer first, then ask which view(s)/route(s). Pick a source:

- **Staging preferred** — if a staging env exists for this branch, view it at
  `https://{staging_host}/<route>`.
- **Else local** — start the app's dev server (e.g. `npm start`), view at
  `http://localhost:<port>/<route>`. `--local` forces this; `--staging` forces staging.

Capture — match each tool by role + `<tool>` suffix in your available tools:

- **Local launched server → a preview tool** (preferred for local): `preview_start`
  (returns a `serverId`) → `preview_screenshot` (`serverId`).
- **Remote staging URL → a browser tool**: `navigate` (`url`) → its screenshot action (e.g.
  `computer` with `action:"screenshot"`, `save_to_disk:true`), which returns the saved path.

Save / reference PNGs under the OS temp dir, e.g.
`/tmp/dw-team-communication/<key or "adhoc">/<route-slug>.png`. Show each image inline to the user
and **list the file paths in the output.** Images can't be embedded into pasted text — the user
attaches them when pasting.

## Worked examples

**Approval ask** (product-decision mode). Question that came up: should the Offers pages be
hidden from users without the Offers permission? Owner resolved to the CDP PM. Slack DM draft:

> Hi Dana — need a product call on the new Offers Management section (under Activation): keep it
> hidden for accounts without the Offers permission, or show it to everyone (blocked on open)?
> Right now it shows for everyone, but those accounts can't actually use it — and before this it
> was only visible to permitted users. I'd keep it hidden — cleaner, and avoids a dead menu item.
> On staging: https://staging.example.com  wdyt?

**Status / announce.** Intent: "announce to #eng" that a flaky test suite is fixed. Channel post:

> Fixed the flaky integration suite that's been blocking merges on `main` all week — root cause
> was a shared test DB race, now isolated per run. Should be green going forward; ping me if you
> still see red after pulling latest.

Both lead with the point, give just enough context, and land a clear CTA (a decision in the
first, "no action needed beyond FYI" in the second) — terse, no labels, no internal identifiers
that don't belong in front of that audience.

## Hard rules

- **Never auto-post** — drafts + click-to-open links only. The human sends.
- **Never output an unreviewed draft** — every draft goes through the required review pass (deslop
  → cold-reader + correctness subagents → conditional ask-answerer) first.
- **Never invent a person or channel** — if resolution fails, frame with no name and say so.
- **Match altitude to the audience** — strip internal identifiers (PR numbers, branch names,
  file/class/component/method names, code, flag/config keys, internal acronyms) for non-technical
  audiences; technical detail is fine and often expected for engineering peers.
- **Write in natural prose — never labeled sections/headers.** Lead with the point, keep it terse
  and simple in the asker's own voice, give just enough context, and land one explicit CTA. Cover
  only what's relevant; omit empty points.
- **Default channel is `both`** (Slack DM + JIRA comment) when no channel is given.
- **Intent is free text** — infer it from context if not given, and state the inferred intent
  before drafting so the user can correct it.
- **Derive the issue key from the branch**; only ask the user if the branch has none.
- **Screenshots only for UI/UX topics**, after offering; staging beats local; skip on `--no-image`.
- **Images are attached by the user**, not embedded — always list the file paths.
- **No hardcoded environment** — set `{jira_host}`/`{staging_host}` from context, and resolve each
  MCP tool from your available tools by its role + `<tool>` suffix; server prefixes vary per setup.
