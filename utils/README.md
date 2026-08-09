# utils — shared source, vendored into each skill

Code here is the **single source of truth** for logic more than one skill needs. It is not required
across skill directories at runtime; it is copied into each consuming skill by
`node utils/sync-utils.js`, and CI fails if a copy has drifted.

## Why vendored rather than required

Skills ship as **independent directories**. `npx skills add <repo> --all` installs each
`skills/<name>/` on its own, so a skill that does `require('../../other-skill/scripts/x.js')` loads
fine from the Claude plugin cache — where the whole repo is present — and throws for every other
agent, where its sibling was never copied. The failure appears only in the channel you are least
likely to be testing.

That constraint is why five skills each carried their own `storeRoot`, with a test asserting the
copies stayed byte-identical. The duplication was deliberate; what was missing was a source of
truth to generate it from.

## Using it

1. Put the shared function in `utils/<name>.js`. Plain CommonJS, `node:` builtins only.
2. List its consumers in `SHARED` in `utils/sync-utils.js`.
3. Run `node utils/sync-utils.js`. Each consumer gets `scripts/_shared-<name>.js`, carrying a
   generated-file header, and requires that local copy.
4. `node utils/sync-utils.js --check` verifies every copy matches. CI runs it, so a hand-edited
   copy fails the build instead of drifting quietly.

## What belongs here

Logic two or more skills genuinely share, where one definition is the point — a store path they must
agree on, a comment signature they must read the same way. A helper that only *looks* alike in two
skills does not: vendoring it fixes the shape of the duplication while inventing a coupling neither
skill wanted.
