#!/usr/bin/env bash
# Self-test for ops.sh: builds a throwaway repo + bare remote + a `gh` stub, exercises the
# command surface, asserts outcomes, and leaves nothing behind. Run: bash ops-self-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OPS="$HERE/ops.sh"
fails=0
ok(){ if [ "$1" = "0" ]; then printf 'ok   %s\n' "$2"; else printf 'FAIL %s\n' "$2"; fails=$((fails+1)); fi; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- gh stub: pr view reports MERGED only for branches listed in $OPS_TEST_MERGED ---
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then
  br="${3:-}"; for m in ${OPS_TEST_MERGED:-}; do [ "$m" = "$br" ] && { echo MERGED; exit 0; }; done; exit 1
fi
exit 0   # pr create / pr ready: succeed quietly
STUB
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"; export OPS_TEST_MERGED=""

# --- throwaway remote + main checkout ---
git init -q --bare "$TMP/remote.git"
git clone -q "$TMP/remote.git" "$TMP/repo"
cd "$TMP/repo"
git config user.email t@e.com; git config user.name T; git config commit.gpgsign false
echo hi > README.md; git add -A; git commit -qm init; git branch -M main; git push -q -u origin main

# 1. branch --unplanned --scope demo  (bare scope name)
wt="$(bash "$OPS" branch --unplanned --scope demo 2>/dev/null | tail -1)"
[ -d "$wt" ]; ok $? "branch --unplanned creates a worktree"
git show-ref -q --verify refs/heads/demo; ok $? "unplanned branch name = bare {scope} (demo)"

# 2. branch --ticket RD-1 --scope cars -> {ticket}-{scope}, under .claude/worktrees
wt2="$(bash "$OPS" branch --ticket RD-1 --scope cars 2>/dev/null | tail -1)"
git show-ref -q --verify refs/heads/RD-1-cars; ok $? "planned branch name = {ticket}-{scope} (RD-1-cars)"
case "$wt2" in *"/.claude/worktrees/RD-1-cars") ok 0 "worktree lives under .claude/worktrees/";; *) ok 1 "worktree path (got $wt2)";; esac

# 3/4. required-arg guards
bash "$OPS" branch --unplanned >/dev/null 2>&1; ok "$([ $? -ne 0 ] && echo 0 || echo 1)" "branch without --scope fails"
bash "$OPS" branch --scope x >/dev/null 2>&1;   ok "$([ $? -ne 0 ] && echo 0 || echo 1)" "branch without --ticket/--unplanned fails"

# 5. add+commit in the worktree carries the co-author trailer
( cd "$wt"; echo a > a.txt; bash "$OPS" add a.txt >/dev/null 2>&1; bash "$OPS" commit "add a" >/dev/null 2>&1 )
( cd "$wt"; git log -1 --pretty=%B | grep -q "Co-Authored-By: Claude" ); ok $? "commit carries co-author trailer"

# 6. commit on protected main is refused
( cd "$TMP/repo"; bash "$OPS" commit "x" >/dev/null 2>&1 ); ok "$([ $? -ne 0 ] && echo 0 || echo 1)" "commit on protected main refused"

# 7. on a ROOT (non-worktree) feature branch: warn but proceed.
# (Capture to a var, then grep — piping ops output straight into `grep -q` would SIGPIPE the
#  still-writing ops process and, under `set -o pipefail`, falsely fail the pipeline.)
out7="$( cd "$TMP/repo"; git checkout -q -b rootfeat; echo r > r.txt; bash "$OPS" add r.txt >/dev/null 2>&1; bash "$OPS" commit "root commit" 2>&1 )"
printf '%s' "$out7" | grep -q "ROOT checkout"; ok $? "root feature branch warns about ROOT checkout"
( cd "$TMP/repo"; git log -1 --pretty=%s | grep -q "root commit" ); ok $? "...but the commit still proceeds"

# 8. cap = add+commit+push to the remote
( cd "$wt"; echo b > b.txt; bash "$OPS" cap "cap b" b.txt >/dev/null 2>&1 )
git ls-remote --heads "$TMP/remote.git" demo | grep -q demo; ok $? "cap pushed branch to the remote"

# 9. pr requires both --title and --body
( cd "$wt"; bash "$OPS" pr --title T >/dev/null 2>&1 ); ok "$([ $? -ne 0 ] && echo 0 || echo 1)" "pr without --body fails"
( cd "$wt"; bash "$OPS" pr --title T --body B >/dev/null 2>&1 ); ok $? "pr --title --body succeeds"

# 10. worktree-rm: refuse dirty, remove clean
( cd "$wt"; echo junk > junk.txt )
bash "$OPS" worktree-rm "$wt" >/dev/null 2>&1; ok "$([ $? -ne 0 ] && echo 0 || echo 1)" "worktree-rm refuses a dirty worktree"
( cd "$wt"; rm -f junk.txt )
bash "$OPS" worktree-rm RD-1-cars >/dev/null 2>&1; ok "$([ ! -d "$wt2" ] && echo 0 || echo 1)" "worktree-rm removes a clean worktree (by branch name)"

# 11. reap: merged -> removed + branch deleted; unmerged -> untouched
wt3="$(bash "$OPS" branch --unplanned --scope shipme 2>/dev/null | tail -1)"
export OPS_TEST_MERGED="shipme"
bash "$OPS" reap >/dev/null 2>&1
ok "$([ ! -d "$wt3" ] && echo 0 || echo 1)" "reap removed the MERGED worktree"
git show-ref -q --verify refs/heads/shipme; ok "$([ $? -ne 0 ] && echo 0 || echo 1)" "reap deleted the merged local branch"
ok "$([ -d "$wt" ] && echo 0 || echo 1)" "reap left the unmerged worktree (demo) intact"

# 12. status shows location + managed worktrees (capture to a var; see the note on test 7)
out12="$( cd "$wt"; bash "$OPS" status 2>/dev/null )"; printf '%s' "$out12" | grep -q "\[worktree\]"; ok $? "status reports [worktree] in a worktree"

printf '\n%s — ops self-test (%s failure(s))\n' "$([ "$fails" = 0 ] && echo PASS || echo FAIL)" "$fails"
[ "$fails" = 0 ]
