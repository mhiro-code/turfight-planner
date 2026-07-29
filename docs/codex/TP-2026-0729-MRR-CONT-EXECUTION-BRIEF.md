# TP-2026-0729-MRR-CONT Execution Brief

## Approval and outcome

- Owner approval: 2026-07-29, explicit `承認する`
- Approved outcome: implement Issue D in the approved `A -> D -> B -> C -> E` order so saving one recruitment round or plan cannot erase another.
- Gate status:
  - Gate 0 and Gate 1: approved
  - Gate 2: stop only if the implementation would depart from the approved architecture or require a new owner decision
  - Gate 3 through Gate 5: not approved

## Baseline and workspace protection

- Repository: `projects/turfight-planner`
- Feature worktree: `projects/turfight-planner-issue-d`
- Branch: `feature/issue-d-nondestructive-save`
- Baseline: `origin/main` at `2624e668b6c9c70c1d9be402a480a90cd06236c1`
- Formal GitHub context checked on 2026-07-29:
  - Issue #73 contains the approved multiple-recruitment-round architecture.
  - Issue #75 implemented Issue A.
  - No separate formal Issue D was found; this work therefore follows the owner-approved Issue D scope without creating or posting an external issue.
- Protected existing checkout:
  - branch `issue-87-run-all-tests`
  - untracked `docs/codex/TESTING.md`
  - untracked `tests/run-all.js`
  - do not edit, move, overwrite, stage, or delete these files.

## Scope

- Complete the non-destructive save foundation for the current recruitment round and current plan only.
- Split recruitment-round settings capture/apply from plan-state capture/apply.
- Change only the minimum necessary `index.html`, tests, and local design/verification records.
- Preserve:
  - inactive recruitment rounds;
  - inactive plans;
  - unknown fields;
  - saved values not represented in the current DOM.
- Keep recruitment-round settings only in the recruitment round and `viewFilter` / horse selections only in the plan.

## Non-targets

- Do not redesign the schema-v4 hierarchy.
- Do not implement Issues B, C, or E.
- Do not change unrelated UI or Asset Vision.
- Do not edit `main` directly.
- Do not commit, push, open or update a PR, merge, publish Pages, release, close an issue, or delete remote branches.

## Ownership and sequence

1. Commander / architect check: read-only comparison against the approved architecture.
2. Implementer: sole editor of `index.html` and Issue D test files.
3. Independent QA: read-only positive, negative, boundary, regression, and PC/iPad-equivalent verification.
4. Commander: integrate evidence and report the verdict.

Only one implementer may edit this repository at a time. `index.html` has exactly one editor.

## Verification plan

- Positive: current recruitment round settings and current plan state are updated.
- Negative: inactive recruitment rounds and plans are unchanged.
- Boundary: unknown fields and saved values absent from the DOM survive a save.
- Failure: invalid capture or invalid root does not overwrite stored data.
- Separation: recruitment-round settings never enter plan state; filter and horse selections never enter recruitment-round settings.
- Regression: all schema-v4 and existing local tests pass.
- Browser: PC and iPad-equivalent viewport checks show no relevant console error or layout/interaction regression.

## Stop conditions

Stop before editing or further integration if:

- the required design departs from the approved architecture;
- upstream changes after baseline selection overlap the owned files;
- a data-loss or rollback risk is found;
- file ownership overlaps;
- verification fails materially;
- any action would cross Gate 3 or later.

## Current status

- Execution brief: complete
- Architecture check: complete within the approved Issue D design; no Gate 2 departure found
- Implementation: complete in the isolated worktree
- Local verification:
  - Issue D tests: 5/5 passed
  - schema-v4 non-visual regression tests: 28/28 passed
  - `git diff --check`: passed
  - PC 1440x1000 and iPad 1024x768: saved plan values survived reload, no console errors or horizontal overflow
- Independent QA: `PASS`
- Upstream recheck: GitHub `main` remained at `2624e668b6c9c70c1d9be402a480a90cd06236c1`
- Unconfirmed: the baseline sticky visual test fails and then hangs before this Issue D change; this change contains no UI or CSS delta
- Next decision: Gate 3 approval is required before any commit, push, PR, or external message
