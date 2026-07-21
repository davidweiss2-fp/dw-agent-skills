# Code slop — full catalog

Each pattern: how to spot it (**cue**), what to do (**fix**), when it is a false
positive (**keep**), and a tiny **before → after**. The governing question for
every entry: *does this earn its keep?* Count the implementations behind an
interface, the call sites behind a generic, the information lost if a comment is
deleted, the real boundary a guard protects.

Many of these are machine-catchable before a human ever sees them — run the repo's
linter / IDE structural analysis first (unused vars, dead code, `no-console`,
`no-debugger`, `no-useless-catch`, `no-explicit-any`) so the deslop pass spends
attention on what tooling can't catch.

## Comments that restate the code
- **Cue:** line comments narrating syntax or obvious operations — `// increment counter by one` over `i++`, `// loop through users`, `// return the result`. Deleting the comment loses zero information. AI tends to comment nearly every line.
- **Fix:** delete the narration. If a comment seems needed to explain *what* the code does, prefer making the code clearer (better name, extracted function) over keeping the comment.
- **Keep:** comments that document a non-obvious *what/how* — a tricky algorithm, a real behavioral contract, units, a vendor quirk's actual behavior. (House rule: what/how, never why — see SKILL.md.)
- `// set loading to true` + `this.loading = true` → `this.loading = true`.

## Restating types / obvious things in docstrings
- **Cue:** JSDoc/docstring that mechanically re-types the signature with no added meaning — `@param userId The user id`, `@returns the result`, `/** Constructor */` over a constructor. A lossless echo of the declaration.
- **Fix:** delete it, or replace with real semantics the type can't say — units, ranges, nullability contract, side effects, ownership, error conditions.
- **Keep:** docs that add genuine contract beyond the type.
- `/** @param {number} count The count */` → delete, or `/** count — must be >= 1; 0 throws RangeError */`.

## Defensive try/catch in trusted paths
- **Cue:** every function wrapped in try/catch that just logs-and-rethrows or swallows; catch blocks that only `console.error(e)` then return null; try/catch around code that cannot throw. ESLint `no-useless-catch` flags rethrow-only catches.
- **Fix:** validate and handle errors at **system boundaries** only (request handlers, I/O edges, third-party calls). Let exceptions propagate through the trusted interior to a single handler. Surface every error - a catch that hides an error turns a loud failure into silent corruption.
- **Keep:** try/catch around `JSON.parse(untrustedInput)`, network/fs calls, and other genuinely fallible I/O.
- `try { return user.name } catch(e){ console.error(e); return null }` → `return user.name`.

## Redundant null / guard checks on validated inputs
- **Cue:** `if (!x) return` / `if (x == null) throw` on a value the type system already guarantees non-null, or that a caller one line up just created; length/type checks on inputs already validated at the boundary; guards for impossible states (`if (typeof fn === 'function')` on a required typed callback).
- **Fix:** trust your types and invariants inside the trust boundary. Remove guards for states that can't occur.
- **Keep:** guards exactly where untyped/untrusted data enters — parsed JSON, query params, env vars, FFI, `any`-typed third-party returns.
- On `function f(u: User)`, drop `if (!u) return;`. Keep `if (!req.body?.email) return 400` at the HTTP edge.

## Casts to any / type escapes
- **Cue:** `as any`, `: any`, unjustified `@ts-ignore` / `@ts-expect-error`, `as unknown as Foo` double-casts, Python `# type: ignore`, Go `interface{}` where a concrete type fits. Usually dropped in to silence a compiler error rather than fix the mismatch. typescript-eslint `no-explicit-any`, `no-unsafe-*`.
- **Fix:** replace with the real type, a discriminated union, a generic, or `unknown` + a type guard (which forces validation before use). If a cast is genuinely unavoidable, narrow it to one expression and state in a comment what makes it safe.
- **Keep:** a scoped, commented cast at a real typed/untyped FFI boundary.
- `const data = resp as any` → define `interface Resp {…}`, or `const data = resp as unknown; if (isResp(data)) …`.

## Needless abstraction / wrapper layers
- **Cue:** single-implementation interface; a Factory/Provider/Manager producing exactly one concrete thing; a generic `<T>` called at one site with one type; a thin pass-through wrapper that forwards args; premature DI for a one-app-lifetime singleton. AI reproduces enterprise patterns regardless of scale.
- **Fix:** inline it. Collapse a one-impl interface into its class; flatten a one-product factory; specialize a one-call-site generic. Count implementations behind each interface and call sites behind each generic — if 1, delete the layer.
- **Keep:** abstraction with two or more real implementations/call sites, or a documented seam for a planned second one.
- `interface IUserService { get(id): User }` with one `UserService` → use the class directly.

## Reimplementing an existing utility
- **Cue:** a hand-rolled `deepClone`, `groupBy`, `formatDate`, `debounce`, retry loop, or slugifier when the repo (or a dep already in the manifest) provides it; a new helper duplicating one three files over; near-duplicate helpers with synonymous names (`formatCurrency` / `formatMoney` / `toCurrencyString`).
- **Fix:** search the codebase and existing deps first; route callers through the one canonical implementation and delete the duplicate. Prefer existing deps over new ones, existing utils over new ones.
- **Keep:** a genuinely new utility with no equivalent in the repo or its deps.
- New `function uniq(a){return [...new Set(a)]}` when `lodash.uniq` is already used → reuse it.

## Dead code / unused vars / unused imports
- **Cue:** declared-but-unused variables and parameters, imported-but-unused modules, unreachable branches, functions defined and never called, commented-out "just in case" blocks. ESLint `no-unused-vars`, `no-unreachable`.
- **Fix:** delete it. Version control is the "just in case". Run the linter before raising the PR so it's caught before a human sees it.
- **Keep:** intentionally-unused params required by an interface signature (prefix `_` per the repo's convention).
- `import { useMemo } from 'react'` never used → remove.

## Leftover console.log / print / debug statements
- **Cue:** `console.log`, `print()`, `fmt.Println`, `dbg!`, `debugger;`, ad-hoc `print("here")` left after the model debugged its own code; `print` where the project has a logger. ESLint `no-console`, `no-debugger`.
- **Fix:** remove debug output. Where logging is genuinely wanted, route through the project logger at the right level, keeping secrets and PII out of the logs.
- **Keep:** intentional logging that uses the project's logger and level.
- `console.log('payload', payload)` → delete, or `logger.debug({ payload })` if intentional.

## Verbose ceremony / over-engineering
- **Cue:** 200 lines where 50 do the job — config objects for a single constant, options bags no caller varies, builder chains for a 2-field struct, getters/setters around plain data, multi-layer indirection for a straight-line operation.
- **Fix:** cut to the shortest correct form that fits the codebase's idioms. Remove parameters/options nothing uses (YAGNI). Prefer direct code over configurable machinery until a second real caller exists.
- **Keep:** ceremony the framework or the codebase's established pattern actually requires.
- `new RequestBuilder().setUrl(u).setMethod('GET').build()` for one fixed GET → `fetch(u)`.

## Tests that mirror the implementation
- **Cue:** tests that assert the code does what the code does — mock the function then assert the mock was called; no meaningful assertion (`expect(result).toBeDefined()`); multiple tests on the identical path; snapshots of trivial output. They pass by construction.
- **Fix:** keep behavior/contract tests — given input, assert observable output and edge cases (empty, single element, boundary, error path). Delete tests that would still pass if the logic were wrong.
- **Keep:** real behavior tests, including the meaningful happy path.
- `mockAdd.mockReturnValue(3); expect(add(1,2)).toBe(3)` → call the real `add`, assert `3`, add a 0/negative/overflow case.

## Copy-paste proliferation (near-identical blocks)
- **Cue:** several blocks 90% identical with one or two swapped literals — five API handlers differing only by endpoint string, switch cases varying by a single constant. The variation is data, not logic.
- **Fix:** extract the shared structure into one parameterized function, a lookup table, or config.
- **Keep:** blocks that look similar but differ in logic - keep them separate rather than forcing a needless abstraction.
- 5 handlers identical except the URL → one handler taking the URL, or a route table.

## Inconsistent style vs. the surrounding file
- **Cue:** new code diverging from local convention — quote style, naming (`camelCase` in a `snake_case` file), import ordering, error-handling idiom, framework patterns (raw fetch where the repo uses a typed client; class component in a hooks codebase), a different test framework.
- **Fix:** match the file/module you're editing; run the repo's formatter/linter. When in doubt, copy the nearest existing example in the same package.
- **Keep:** a deliberate, justified deviation the surrounding code already sanctions.
- Adding `axios` in a repo standardized on a generated API client → use the client.

## Emoji and decorative unicode
- **Cue:** emoji in commit messages, section-divider comments with glyphs, emoji in log/UI strings not asked for, checkmark/cross unicode in code, emoji headers in generated docs.
- **Fix:** strip emoji and decorative unicode unless the project explicitly uses them. Follow the repo's commit convention.
- **Keep:** emoji where the house style genuinely uses them (some READMEs/changelogs).
- A commit led by a party emoji + "Add login" → `feat(auth): add login`.

## Hallucinated APIs / phantom dependencies
- **Cue:** imports of packages not in the manifest, calls to methods/options the library doesn't have, plausible-but-fake config keys. Roughly 1 in 5 AI-suggested packages can be non-existent ("slopsquatting").
- **Fix:** treat every unfamiliar import/method as guilty until verified against the installed manifest and the actual installed version — not just that it's plausible. Confirm the symbol exists before trusting it.
- **Keep:** verified real APIs.
- `import { autoRetry } from 'axios'` (no such export) → verify the real API or use the project's retry util.
