# Prose & doc slop — full catalog

For READMEs, docs, comments, commit/PR bodies, and any committed prose. Each entry:
**cue**, **fix**, **keep** (the false positive), and a **before → after**.

Two rules govern the whole list:

- **Judge by clusters, not single words.** Any one tell is a false positive; what
  convicts is density and co-occurrence — Title-Case headings + bold-everything +
  inline-header lists + rule-of-three in the same passage. Set a mental threshold
  ("more than ~3 hedges in one sentence", "a cluster of puffery in one paragraph"),
  don't ban words outright.
- **The deepest fixes add substance, not just swaps.** The "opinion vacuum" and
  uniform rhythm are tells word-substitution can't fix — add specifics (named
  sources, real numbers, dates), take positions, vary sentence length.

## Filler / didactic openers
- **Cue:** a meta-throat-clear that adds nothing — "It's worth noting that…", "It's important to note/remember that…", "In today's fast-paced / rapidly evolving world…". A tell especially when it leads a paragraph.
- **Fix:** delete the opener, state the fact. "It's important to note that the API rate-limits at 100 req/s" → "The API rate-limits at 100 req/s."
- **Keep:** a bare "Note:" flagging a genuine non-obvious exception ("Note: this silently truncates inputs over 8k tokens").

## Chat pleasantries / prompt-acknowledgement
- **Cue:** "Certainly!", "Great question!", "Sure, I'd be happy to help.", "I hope this helps!" — the chat interface leaking into standalone prose.
- **Fix:** strip entirely; docs have no interlocutor to thank.
- **Keep:** a brief acknowledgement only in genuine live conversation — never in committed docs, READMEs, or commit messages.

## Restating the prompt / self-referential framing
- **Cue:** "In this article, we will explore…", "This guide aims to…", "This section will discuss…", "As requested, here is…".
- **Fix:** cut the framing, deliver the content; the heading already announces the topic.
- **Keep:** a one-line scope statement only when scope is genuinely ambiguous and bounding it saves the reader time.

## Empty restating conclusions / section summaries
- **Cue:** "In conclusion…", "In summary…", "Overall, X is a complex and multifaceted subject", a section ending "This section discussed…".
- **Fix:** delete pure restatement. A conclusion earns its place only if it adds a decision, recommendation, or next step.
- **Keep:** a real TL;DR at the top, an abstract, or release notes where the reader needs the gist without the body.

## Puffery verbs
- **Cue:** inflated Latinate verbs at higher density than a human reaches for — delve, leverage, harness, foster, underscore, facilitate, streamline, bolster, empower, unlock, elevate, revolutionize. One is coincidence; a cluster is the tell.
- **Fix:** swap for the plain verb — leverage → use, facilitate → help, streamline → simplify, bolster → strengthen, foster → build.
- **Keep:** where the word is the precise technical term (financial "leverage", a test "harness").
- "Leverage caching to facilitate faster loads." → "Use caching to load faster."

## Hollow marketing adjectives
- **Cue:** quality asserted without evidence — seamless, robust, comprehensive, cutting-edge, innovative, game-changing, dynamic, multifaceted, powerful, state-of-the-art. Strongest when the adjective replaces a concrete spec.
- **Fix:** replace with the fact it gestures at — "robust" → "99.9% uptime, retries on 5xx"; "comprehensive" → say what's covered. If no fact backs it, cut it.
- **Keep:** when the claim is specific and substantiated nearby.
- "A robust, comprehensive, seamless solution." → "Handles 10k req/s, covers REST and gRPC, zero config to start."

## Grandiose metaphors
- **Cue:** vague figurative nouns — landscape, realm, tapestry, ecosystem, beacon, "in the heart of", "embark on a journey", "navigate the landscape of"; "boasts", travel-brochure tone in technical text.
- **Fix:** name the literal thing — "the SEO landscape" → "SEO"; "a rich tapestry of features" → list them.
- **Keep:** a fresh, apt metaphor doing real work in genuinely creative copy — the tell is the tired, generic one.

## Hedging / weasel words / opinion vacuum
- **Cue:** reflexive qualifiers dodging commitment — "generally speaking", "tends to", "arguably", "to some extent", "both approaches have their merits", "it depends on your use case". Flag at density (>~3 per sentence) or false balance on a question with a defensible answer.
- **Fix:** take a position and justify it — "Both have merits" → "Use Postgres here because you need transactions; the doc-store only wins if your schema is truly unbounded."
- **Keep:** genuine, calibrated uncertainty — hedge honestly when evidence is mixed, but name the condition that decides it.

## Vague authority attributions
- **Cue:** "experts argue", "studies show", "it is widely regarded", "observers note" — a generic claim dressed as sourced.
- **Fix:** name the source and link it, or drop the claim. "Studies show X" → "A 2024 Stanford study (link) found X."
- **Keep:** attributions pointing to a real, citable, named source.

## Rule of three / parallel-triple overuse
- **Cue:** reflexive triples manufacturing completeness — "fast, reliable, and scalable", "creativity, innovation, and impact" — appearing as the default rhythm across sentences.
- **Fix:** keep one item if one is true, two if two are; don't pad to three. Cut adjectives that don't each carry distinct weight.
- **Keep:** one intentional, earned triple for emphasis at a real high point.
- "A fast, flexible, and powerful framework." → "A framework that renders in <16ms."

## Negative parallelism ("not just X, it's Y")
- **Cue:** "not only X but also Y", "it's not X, it's Y", "this isn't a tool, it's a platform", "no fluff, no filler, just results" — recurring section after section.
- **Fix:** use at most once, intentionally, as a genuine pivot; otherwise rewrite as a plain declarative.
- **Keep:** a single deliberate instance where the contrast is the actual point.
- "It's not a checklist — it's a philosophy." → "It's a checklist you re-run every release."

## Em-dash overuse
- **Cue:** multiple em-dashes in one paragraph splicing clauses where a comma, period, or parenthesis would do; co-occurs with the triple and the negative-parallelism tics.
- **Fix:** keep at most one per paragraph; convert the rest, and recast some as separate sentences.
- **Keep:** an em-dash marking a genuine sharp aside — varied punctuation reads more human, so don't purge them all.
- "Caching helps — a lot — and it's easy — just add a header." → "Caching helps a lot, and it's easy: just add a header."

## Redundant transition stacking
- **Cue:** heavy formal connectors clustering at sentence starts — "Furthermore," "Moreover," "Additionally," "That being said," several in a row; content-free bridges like "At its core," "To put it simply."
- **Fix:** cut most; let ideas abut, or use light connectors ("Also," "But," "So"). Often the transition deletes with no loss.
- **Keep:** a transition signalling a real logical turn (genuine contrast, cause, sequence).

## Over-explaining the obvious
- **Cue:** spelling out what the reader or the heading already shows — defining common terms inline, "as we can see", "simply put", glossing every noun. Padded, low-density paragraphs.
- **Fix:** cut to the new information; trust the reader's baseline. Match depth to the stated audience.
- **Keep:** genuine explanation of the actually-hard part, and in explicitly beginner-targeted docs.
- "A database, which is a system that stores data, stores your data." → "Stored in Postgres."

## Formatting tells (Markdown / wikitext)
- **Cue:** **bold-everything** (a bolded term in every bullet, most of a paragraph bold); **emoji bullets** ("🚀 Fast / ✨ Easy / 🔒 Secure"); **Title Case headings** where the house style is sentence case; **curly quotes / smart punctuation** in code or Markdown source; **inline-header lists** ("**Term**: …") repeated mechanically, sometimes with pasted • / – glyphs instead of real list syntax.
- **Fix:** bold a few truly load-bearing terms per page; plain bullets; sentence-case headings to match the repo; straight ASCII quotes in code/Markdown; vary list form, use prose where items aren't parallel.
- **Keep:** bold for definienda on first use and real warnings; one status glyph (✓/✗) in a comparison table; the bold-term-colon shape for a genuine glossary; title case where the style guide mandates it; curly quotes in rendered/typeset output.

## Uniform rhythm / no contractions / elegant variation
- **Cue:** three or four consecutive sentences of near-identical length and Subject-Verb-Object structure, zero contractions ("it is" / "do not" throughout); and synonym-cycling one referent ("the function" → "the method" → "this routine") which causes referential confusion in technical writing.
- **Fix:** vary sentence length — follow a long sentence with a short one; use contractions; an occasional fragment. Repeat the **exact** term for the same thing; consistency beats variety in docs.
- **Keep:** measured uniformity in reference material (API parameter docs, legal text) where precision outranks rhythm.

## Leaked scaffolding markup
- **Cue:** residual LLM-internal tokens or fake artifacts — `oaicite`, `contentReference`, `turn0search0`, `oai_citation`, "[search: …]" links pointing at searches, hallucinated/404 URLs, fake DOIs, `utm_source=chatgpt` tracking params.
- **Fix:** strip all of it; verify every link, DOI, and citation resolves to the claimed target before publishing. No legitimate use exists.
- "See the docs [oaicite:0] (example.com?utm_source=chatgpt)" → "See the docs: https://example.com/docs".
