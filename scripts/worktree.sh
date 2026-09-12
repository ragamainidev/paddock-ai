#!/usr/bin/env bash
# Worktree helper for concurrent agents (docs/multi-agent.md).
#
#   pnpm wt new <name> [base]   create .worktrees/<name> on branch <name> from <base> (default: main)
#   pnpm wt rm <name> [--force] remove the worktree; delete the branch if it is merged
#   pnpm wt ls                  list worktrees
#
# A new worktree gets: node_modules (pnpm, from the shared store), a copy of
# .env.local, data/eval.db (built from the committed subset), a symlink to
# data/ymm.db when the primary checkout has one, and a stable dev port
# derived from the name so several `pnpm dev`s never collide.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WT_DIR="$ROOT/.worktrees"

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

port_for() {
  # 3100–3999, stable per name.
  local sum
  sum=$(printf '%s' "$1" | cksum | cut -d' ' -f1)
  echo $((3100 + sum % 900))
}

cmd="${1:-}"; shift || true
case "$cmd" in
  new)
    name="${1:-}"; base="${2:-main}"
    [ -n "$name" ] || usage
    path="$WT_DIR/$name"
    mkdir -p "$WT_DIR"
    if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$name"; then
      git -C "$ROOT" worktree add "$path" "$name"
    else
      git -C "$ROOT" worktree add -b "$name" "$path" "$base"
    fi
    (
      cd "$path"
      pnpm install --frozen-lockfile --prefer-offline >/dev/null
      [ -f "$ROOT/.env.local" ] && cp "$ROOT/.env.local" .env.local
      mkdir -p data
      [ -f "$ROOT/data/ymm.db" ] && [ ! -e data/ymm.db ] && ln -s "$ROOT/data/ymm.db" data/ymm.db
      pnpm catalog:sample >/dev/null
    )
    port=$(port_for "$name")
    echo "$port" > "$WT_DIR/$name.port"
    cat <<EOF
worktree ready: $path  (branch $name from $base)
  cd $path
  PORT=$port DATABASE_URL=file:data/eval.db pnpm dev
integrate when done: docs/workflows/integrate-and-deploy.md
EOF
    ;;
  rm)
    name="${1:-}"; force="${2:-}"
    [ -n "$name" ] || usage
    path="$WT_DIR/$name"
    # Ignored files (node_modules, .env.local, eval.db) always exist, so git's
    # own cleanliness check would always refuse; check tracked changes and
    # untracked-but-not-ignored files ourselves, then remove with --force.
    if [ "$force" != "--force" ] && [ -n "$(git -C "$path" status --porcelain)" ]; then
      echo "worktree $name has uncommitted changes:" >&2
      git -C "$path" status --short >&2
      echo "commit them, or: pnpm wt rm $name --force" >&2
      exit 1
    fi
    git -C "$ROOT" worktree remove --force "$path"
    rm -f "$WT_DIR/$name.port"
    if git -C "$ROOT" branch -d "$name" 2>/dev/null; then
      echo "removed worktree and merged branch $name"
    else
      echo "removed worktree; branch $name kept (not merged into the current branch)"
    fi
    ;;
  ls)
    git -C "$ROOT" worktree list
    ;;
  *) usage ;;
esac
