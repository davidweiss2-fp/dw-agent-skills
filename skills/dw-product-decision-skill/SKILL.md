---
name: dw-product-decision-skill
description: >-
  Turn a dev/engineering question that surfaced mid-work into a crisp,
  product-level decision question for a non-technical product owner, rendered as
  copy-ready DRAFTS for a Slack DM and/or a JIRA ticket comment. Use when the
  user has hit a product judgment call (which behavior is correct? hide this or
  not? which option ships?) and wants to ask the PM/product owner — e.g. "ask
  product about this", "turn this into a product question", "draft a decision
  question for the PM", or invokes /dw-product-decision [slack|jira|both]
  [topic]. Drafts only — never auto-posts.
---

# Product Decision Question

Your job: take a technical/engineering question that came up during work and reframe it as a
**clear product decision question for a non-technical product audience**, then render **copy-ready
DRAFTS** for a Slack DM and/or a JIRA ticket comment. You draft and surface click-to-open links —
**the human posts.** This skill is prompt-driven: you do the reasoning, mining, screenshots (via
MCP), and lookups yourself. No scripts to run.

## Invocation

`/dw-product-decision [slack|jira|both] [optional topic or question]`

| Token | Meaning |
|---|---|
| `slack` | Slack DM draft only |
| `jira` | JIRA comment draft only |
| `both` / nothing | Default — both drafts |
| `--staging` / `--local` | Force screenshot source |
| `--no-image` | Skip screenshots |
| everything else | The topic/question text |

No mode keyword ⇒ mode = both.

## Flow

1. Parse args: mode (default both) + `--staging`/`--local`/`--no-image`; rest = topic.
2. Get the question: if usable session context exists (this conversation, recent `git diff`,
   branch), auto-mine to draft; else ask the user in one line.
3. Derive the issue key: `git rev-parse --abbrev-ref HEAD | grep -oE '[A-Z]+-[0-9]+'`. Link =
   `https://{jira_host}/browse/<KEY>` (set `{jira_host}` to your Jira host). Ask only if none.
4. Resolve the product owner (fallback chain below); if unresolved, frame without a name.
5. Decide screenshots: UI/UX if topic mentions a screen/page/view/button/layout/visibility OR diff
   touches `*.component.html|ts|scss`. If UI/UX and not `--no-image`, offer + ask which view(s).
6. Reframe to product altitude (strip all internal identifiers — see Hard rules) and write the
   message following "What makes a good product question" below — natural prose, no labels.
7. Render per mode (Slack and/or JIRA).
8. Output both drafts in chat, copy-ready, each fenced, with click-to-open link(s) + inline images
   and their file paths. Stop — do not post.

## What makes a good product question

A good question gets a fast, confident answer. The marks of one:

- **Lead with the ask.** Open with the decision you need, then the context — busy PMs answer fastest
  when the request comes first, not buried after preamble.
- **One decision, clearly answerable.** Ask one thing, and make it easy to answer — usually a
  concrete either/or so they can just pick. Closed when you need a decision; open only when you
  genuinely need exploration.
- **Just enough context.** What it's about, who's affected, what happens today, and why it's coming
  up now — enough to remove ambiguity, nothing that makes them work to understand it.
- **Make the stakes clear.** Why it matters / what's at stake / any urgency, so they can prioritize.
  Omit if there's none.
- **Recommend, don't just ask.** State your lean and the trade-off so they can confirm instead of
  starting from scratch. Optionally a default — what you'll do if you don't hear back.
- **Let them see it.** For UI questions, link the preview/staging view.
- **Their language.** Product/user terms only — no implementation detail (see Hard rules).

## How to write it

Write it the way you'd type it yourself: **simple, terse English, like a normal day-to-day
message.** No section labels or headers — never "Context:", "Scenario:", `h3.`, etc. No corporate
fluff. Short — a sentence or two up to a short paragraph. Choose whatever natural shape fits the
question and the channel. Always land **one clear question** and make your recommendation obvious so
they can reply yes/no. Cover only what's relevant; skip points that don't apply. Match the asker's
own voice.

## Per-mode rendering

Same message, two renders — both terse, natural, **no labels/headers**:
- **Slack DM** — conversational, like a real ping. Light mrkdwn only if it helps (`*bold*` the
  question or a key word). First-name greeting if the owner resolved, else neutral. JIRA/staging
  links as bare URLs. End with a low-friction nudge ("wdyt?", "lmk").
- **JIRA comment** — a touch more composed but still terse plain prose. **No `h3.` headers, no
  labels.** You may `*bold*` the question. Include the staging link; don't restate the ticket key.

## Owner resolution (stop at first hit; else no name)

MCP tool names are `mcp__<server>__<tool>` and the `<server>` segment is environment-specific —
match each tool below by its role and `<tool>` suffix in your available tools, and skip a source
whose server isn't connected.

1. **Issue tracker (e.g. Jira)** — `getJiraIssue` (`cloudId` = your Jira host,
   `issueIdOrKey` = the key, `fields:["reporter","assignee","summary"]`). For a query use
   `searchJiraIssuesUsingJql` (`cloudId` + `jql`). Take the display name / email. (If the host
   cloudId fails, resolve it via `getAccessibleAtlassianResources`.)
2. **Chat (e.g. Slack)** — `slack_search_users` (`query` = name/email); confirm via
   `slack_read_user_profile` (`user_id`). DM open link:
   `https://slack.com/app_redirect?channel=<USER_ID>`.
3. **HR directory (e.g. HiBob)** — `hibob_get_employee_fields` (discover field paths) then
   `hibob_people_search` (filter by email, or empty filters + match the name yourself). Then
   re-run the chat search with the confirmed email.
4. **Unresolved** — do not invent a person. Frame the question with no name and tell the user:
   "Couldn't auto-resolve the product owner — pick the recipient when you paste."

## Image flow (UI/UX only, after offering)

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
`/tmp/dw-product-decision/<key or "adhoc">/<route-slug>.png`. Show each image inline to the user
and **list the file paths in the output.** Images can't be embedded into pasted text — the user
attaches them when pasting.

## Worked example

Question that came up: should the Offers pages be hidden from users without the Offers permission?
Owner resolved to the CDP PM. Slack DM draft:

> Hi Dana — need a product call on the new Offers Management section (under Activation): keep it
> hidden for accounts without the Offers permission, or show it to everyone (blocked on open)?
> Right now it shows for everyone, but those accounts can't actually use it — and before this it
> was only visible to permitted users. I'd keep it hidden — cleaner, and avoids a dead menu item.
> On staging: https://staging.example.com  wdyt?

Leads with the ask, then just enough context, a clear recommendation, and a preview link — terse,
no labels, no PR numbers, no branch or code names.

## Hard rules

- **Never auto-post** — drafts + click-to-open links only. The human sends.
- **Never invent a person** — if owner resolution fails, frame with no name and say so.
- **Strip all internal identifiers** from the product text: no PR numbers, no branch names, no
  file/class/component/method names, no code, no flag/config keys, no internal acronyms a PM
  wouldn't know.
- **Write a good question in natural prose — never labeled sections/headers.** Lead with the ask,
  keep it terse and simple in the asker's own voice, give just enough context, and make the
  recommendation obvious. Cover only what's relevant; omit empty points.
- **Default mode is `both`** when no mode keyword is given.
- **Derive the issue key from the branch**; only ask the user if the branch has none.
- **Screenshots only for UI/UX questions**, after offering; staging beats local; skip on `--no-image`.
- **Images are attached by the user**, not embedded — always list the file paths.
- **No hardcoded environment** — set `{jira_host}`/`{staging_host}` from context, and resolve each
  MCP tool from your available tools by its role + `<tool>` suffix; server prefixes vary per setup.
