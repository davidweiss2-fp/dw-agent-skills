#!/usr/bin/env bash
#
# ops.sh — the dw-git-ops skill's single git entry point.
#
# Worktree-first: routine work happens in a per-scope worktree (one worktree = one
# branch = one scope = one PR, reaped when the PR merges), and touching the ROOT
# checkout is the explicit exception (--root). Everyday git is scripted here so it is
# consistent and reviewable.
#
# DESTRUCTIVE git (reset --hard, force-push, clean -fd, branch -D, checkout/restore .)
# is deliberately NOT scripted here. The skill runs those raw, under judgment, so the
# normal permission prompt stays the human gate. (reap deletes a branch only when its
# PR is confirmed MERGED — i.e. when the work is provably safe in the base.)
#
#   ops.sh branch --scope <s> (--ticket <T> | --unplanned) [--base <ref>]
#                                    new worktree + branch {T}-{s} (or {s}); prints its path
#   ops.sh add <path>...             stage named paths (never `git add -A`)
#   ops.sh commit <message>          commit staged changes (guarded)
#   ops.sh push                      push current branch to origin -u (guarded)
#   ops.sh cap <message> [<path>...] add (if paths) + commit + push
#   ops.sh pr --title <t> --body <b> [--ready]   open a PR (draft unless --ready)
#   ops.sh pr-ready                  mark current branch's PR ready for review
#   ops.sh pr-draft                  convert current branch's PR back to draft
#   ops.sh worktree-rm <path|branch> remove a worktree (refuses if dirty; keeps the branch)
#   ops.sh reap                      remove worktrees whose PR is MERGED + delete their branch
#   ops.sh status                    branch + short status + managed worktrees
#
# Global flag: --root  operate on the main checkout (mutating ops only warn otherwise).
# Env: OPS_DRY=1 echo mutating git/gh instead of running; OPS_NO_COAUTHOR=1 drop the
#      Co-Authored-By trailer; OPS_REMOTE=<name> push remote (default origin).
set -uo pipefail

PROTECTED_RE='^(master|main)$'
REMOTE="${OPS_REMOTE:-origin}"
WT_SUBDIR=".claude/worktrees"
COAUTHOR_TRAILER="Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
ROOT_OK=0

die()  { printf 'ops: %s\n' "$*" >&2; exit 1; }
warn() { printf 'ops: %s\n' "$*" >&2; }
run()  {
  printf '+ %s\n' "$*" >&2
  [ "${OPS_DRY:-0}" = "1" ] && return 0
  "$@"
}

in_repo() { git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git working tree"; }
current_branch() { git symbolic-ref --short -q HEAD || true; }

# Main worktree root, regardless of which worktree we are in: `git worktree list` always
# lists the primary worktree first. Robust across git versions and macOS /private symlinks
# (both this and --show-toplevel come from git, so the paths compare cleanly).
main_root() { git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10); exit}'; }
is_linked_worktree() { [ "$(git rev-parse --show-toplevel 2>/dev/null)" != "$(main_root)" ]; }

guard_branch() {
  local b; b="$(current_branch)"
  [ -n "$b" ] || die "detached HEAD — checkout a branch before committing/pushing"
  if printf '%s' "$b" | grep -Eq "$PROTECTED_RE"; then die "refusing to operate on protected branch '$b' — use a feature branch/worktree"; fi
  printf '%s' "$b"
}

# Mutating ops prefer a worktree; warn (do not block) when on the root checkout without --root.
prefer_worktree() {
  [ "$ROOT_OK" = "1" ] && return 0
  is_linked_worktree && return 0
  warn "operating on the ROOT checkout (not a worktree) — prefer 'ops.sh branch' for isolated, parallel-safe work; pass --root to silence this"
}

cmd_branch() {
  in_repo
  local ticket="" scope="" base="" unplanned=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ticket) ticket="${2:-}"; shift 2 || die "branch: --ticket needs a value";;
      --scope)  scope="${2:-}";  shift 2 || die "branch: --scope needs a value";;
      --base)   base="${2:-}";   shift 2 || die "branch: --base needs a value";;
      --unplanned) unplanned=1; shift;;
      *) die "branch: unknown arg '$1'";;
    esac
  done
  [ -n "$scope" ] || die "branch needs --scope <s>"
  local branch
  if [ "$unplanned" = "1" ]; then branch="$scope"
  else [ -n "$ticket" ] || die "branch needs --ticket <T> (or --unplanned)"; branch="${ticket}-${scope}"; fi

  reap_merged || true   # opportunistic cleanup of already-merged worktrees first

  local root wt base_ref base_sha
  root="$(main_root)"; wt="$root/$WT_SUBDIR/$branch"
  [ -e "$wt" ] && die "worktree path already exists: $wt"
  base_ref="${base:-HEAD}"
  base_sha="$(git rev-parse --short "$base_ref" 2>/dev/null)" || die "base ref not found: $base_ref"
  if [ -z "$base" ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "current tree is dirty; uncommitted changes will NOT follow into the new worktree (it checks out $base_ref)"
  fi
  run git worktree add -b "$branch" "$wt" "$base_ref" || die "git worktree add failed"
  printf 'ops: created worktree\n  branch: %s\n  base:   %s (%s)\n  path:   %s\n' "$branch" "$base_ref" "$base_sha" "$wt" >&2
  printf '%s\n' "$wt"   # stdout last line = the worktree path, for capture
}

cmd_add() {
  in_repo
  [ "$#" -ge 1 ] || die "add needs explicit paths (this tool never runs 'git add -A')"
  run git add -- "$@"
}

cmd_commit() {
  in_repo; prefer_worktree; guard_branch >/dev/null
  [ "$#" -ge 1 ] && [ -n "${1:-}" ] || die "commit needs a message: ops.sh commit \"<message>\""
  local msg="$1"
  if [ "${OPS_NO_COAUTHOR:-0}" != "1" ]; then msg="$msg

$COAUTHOR_TRAILER"; fi
  if [ "${OPS_DRY:-0}" != "1" ]; then git diff --cached --quiet && die "nothing staged to commit (run: ops.sh add <paths>)"; fi
  run git commit -m "$msg"
}

cmd_push() {
  in_repo; prefer_worktree
  local b; b="$(guard_branch)"
  run git push -u "$REMOTE" "$b"
}

cmd_cap() {
  in_repo; guard_branch >/dev/null
  [ "$#" -ge 1 ] && [ -n "${1:-}" ] || die "cap needs a message: ops.sh cap \"<message>\" [<path>...]"
  local msg="$1"; shift
  if [ "$#" -ge 1 ]; then cmd_add "$@" || die "cap: staging failed"; else warn "no paths given to cap — committing what is already staged"; fi
  cmd_commit "$msg" || die "cap: commit failed — not pushing"
  cmd_push || die "cap: push failed"
}

cmd_pr() {
  in_repo
  local title="" body="" ready=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --title) title="${2:-}"; shift 2 || die "pr: --title needs a value";;
      --body)  body="${2:-}";  shift 2 || die "pr: --body needs a value";;
      --ready) ready=1; shift;;
      *) die "pr: unknown arg '$1'";;
    esac
  done
  [ -n "$title" ] || die "pr needs --title <t> (title is required)"
  [ -n "$body" ]  || die "pr needs --body <b> (body is required)"
  command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) not found"
  local b; b="$(guard_branch)"
  if [ "$ready" = "1" ]; then run gh pr create --title "$title" --body "$body" --head "$b"
  else run gh pr create --draft --title "$title" --body "$body" --head "$b"; fi
}

cmd_pr_ready() { in_repo; command -v gh >/dev/null 2>&1 || die "gh not found"; run gh pr ready "$(guard_branch)"; }
cmd_pr_draft() { in_repo; command -v gh >/dev/null 2>&1 || die "gh not found"; run gh pr ready --undo "$(guard_branch)"; }

cmd_worktree_rm() {
  in_repo
  [ "$#" -ge 1 ] || die "worktree-rm needs a <path|branch>"
  local target="$1" root wt
  root="$(main_root)"
  if [ -d "$target" ]; then wt="$target"; else wt="$root/$WT_SUBDIR/$target"; fi
  [ -d "$wt" ] || die "no worktree at $wt"
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    die "worktree has uncommitted changes — commit/stash first, or remove it manually: $wt"
  fi
  run git worktree remove "$wt"
  printf 'ops: removed worktree %s (branch left intact)\n' "$wt" >&2
}

# Reap managed worktrees whose PR is MERGED: remove the worktree + delete the local branch.
reap_one() {
  local path="$1" branch="$2" state
  [ -n "$path" ] && [ -n "$branch" ] || return 0
  case "$path" in *"/$WT_SUBDIR/"*) ;; *) return 0;; esac        # only managed worktrees
  if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then warn "reap: skip dirty worktree $path"; return 0; fi
  state="$(gh pr view "$branch" --json state -q .state 2>/dev/null)" || state=""
  [ "$state" = "MERGED" ] || return 0
  run git worktree remove "$path" || { warn "reap: could not remove $path"; return 0; }
  run git branch -D "$branch" || warn "reap: removed worktree but could not delete branch $branch"
  printf 'ops: reaped %s — PR merged; worktree removed, branch %s deleted\n' "$path" "$branch" >&2
}
reap_merged() {
  command -v gh >/dev/null 2>&1 || return 0    # without gh we cannot confirm MERGED — do nothing
  local root wtdir path branch line
  root="$(main_root)"; wtdir="$root/$WT_SUBDIR"
  [ -d "$wtdir" ] || return 0
  path=""; branch=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) path="${line#worktree }";;
      "branch "*)   branch="${line#branch refs/heads/}";;
      "") reap_one "$path" "$branch"; path=""; branch="";;
    esac
  done < <(git worktree list --porcelain; printf '\n')
}
cmd_reap() { in_repo; reap_merged; printf 'ops: reap complete\n' >&2; }

cmd_status() {
  in_repo
  local loc; if is_linked_worktree; then loc="[worktree]"; else loc="[root]"; fi
  printf 'branch: %s %s\n' "$(current_branch || echo '(detached)')" "$loc"
  git status --short --branch
  local wtdir; wtdir="$(main_root)/$WT_SUBDIR"
  if [ -d "$wtdir" ]; then
    printf '\nmanaged worktrees:\n'
    git worktree list | grep -F "/$WT_SUBDIR/" || printf '  (none)\n'
  fi
}

main() {
  # Pull the global --root flag out of the arg list (bash-3.2-safe for empty arrays).
  local a; local -a rest=()
  for a in "$@"; do
    if [ "$a" = "--root" ]; then ROOT_OK=1; else rest[${#rest[@]}]="$a"; fi
  done
  set -- ${rest[@]+"${rest[@]}"}

  local sub="${1:-}"; [ "$#" -gt 0 ] && shift || true
  case "$sub" in
    branch)      cmd_branch "$@";;
    add)         cmd_add "$@";;
    commit)      cmd_commit "$@";;
    push)        cmd_push "$@";;
    cap)         cmd_cap "$@";;
    pr)          cmd_pr "$@";;
    pr-ready)    cmd_pr_ready "$@";;
    pr-draft)    cmd_pr_draft "$@";;
    worktree-rm) cmd_worktree_rm "$@";;
    reap)        cmd_reap "$@";;
    status)      cmd_status "$@";;
    ""|-h|--help|help) sed -n '3,/^[^#]/p' "$0" | sed '/^[^#]/d; s/^# \{0,1\}//';;
    *) die "unknown subcommand '$sub' (try: branch | add | commit | push | cap | pr | pr-ready | pr-draft | worktree-rm | reap | status)";;
  esac
}

main "$@"
