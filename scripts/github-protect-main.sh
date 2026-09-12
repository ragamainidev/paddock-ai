#!/usr/bin/env bash
# Apply the main-branch ruleset described in docs/git-workflow.md §5:
# every change reaches main through a pull request (squash or rebase, so
# history stays linear), CI job `checks` must pass, no force-push/delete.
# Needs `gh` authenticated as an account with admin on the repo
# (`gh auth login`, then `gh auth status`). Idempotent: updates the ruleset
# named "main" if it exists.
set -euo pipefail

REPO="${1:-ragamainidev/paddock}"

body=$(cat <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "checks" } ]
      }
    }
  ]
}
JSON
)

existing=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="main") | .id' 2>/dev/null || true)
if [ -n "$existing" ]; then
  echo "$body" | gh api -X PUT "repos/$REPO/rulesets/$existing" --input - >/dev/null
  echo "updated ruleset main ($existing) on $REPO"
else
  echo "$body" | gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null
  echo "created ruleset main on $REPO"
fi
