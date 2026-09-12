#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand). Exit 0 = skip the
# build, exit 1 = build. docs/deployment.md §5.
#
#   production (main):        build unless the commit touched only docs
#   preview (other branches): build only branches named preview/*
#
# Vercel provides VERCEL_ENV and VERCEL_GIT_COMMIT_REF; the checkout is
# shallow but includes HEAD^ for the diff.
set -u

ref="${VERCEL_GIT_COMMIT_REF:-}"
env="${VERCEL_ENV:-}"

if [ "$env" != "production" ] && [[ "$ref" != preview/* ]]; then
  echo "skip: preview builds only for preview/* branches (ref=$ref)"
  exit 0
fi

if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  if git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)*.md' ':(exclude)**/*.md' ':(exclude).github'; then
    echo "skip: docs-only change"
    exit 0
  fi
fi

echo "build: $env $ref"
exit 1
