# GitHub Copilot repository instructions

## Relationship to other instructions

- Follow the nearest `AGENTS.md`, the selected custom agent profile, and the task scope explicitly approved by the owner. This file adds Copilot-specific safeguards and grants no permission by itself.
- Task-specific instructions may add or narrow requirements. They must not weaken approval gates, evidence requirements, stop conditions, or prohibitions, whether explicitly or implicitly, unless the owner approves the exact exception for the current task.
- A statement in `AGENTS.md` that task-specific instructions take precedence does not allow these safeguards to be weakened without that exact owner approval.
- If applicable instructions conflict, or the approved scope and acceptance criteria cannot both be satisfied, stop and report the conflict. Do not choose the less restrictive interpretation yourself.

## Scope and initiative

- Work only on the issue, branch, files, and operations explicitly approved by the owner for the current task.
- Within the approved scope and acceptance criteria, choose the smallest reversible implementation and add necessary negative and regression tests proactively.
- Do not expand product requirements, weaken tests or fixtures, replace acceptance criteria, remove stop conditions, or mark unresolved findings resolved without evidence and authorization.
- Do not modify `AGENTS.md`, `.github/**`, workflows, dependencies, deployment, schema, storage keys or formats, migrations, or backup behavior unless the owner explicitly approves the exact target for the current task.
- Do not alter, delete, stage, or include pre-existing unrelated or unassigned files, including another worker's untracked or generated files. New files are allowed only when the owner-approved scope explicitly includes their paths.

## Evidence and completion claims

- Separate every report into directly executed or observed facts; code inference; emulation, fixtures, mocks, or test-double evidence; and unverified items.
- Never report an unexecuted test, command, browser, device, deployment, or review as passed, confirmed, or complete.
- A headless or desktop browser can provide browser evidence. Viewport or user-agent emulation, static analysis, unit tests, virtual state, mocks, and test doubles are not physical-device evidence unless the owner explicitly accepts that substitute for the current task.
- Do not copy production decision logic into tests. Execute the actual production code and use test doubles only for dependencies and observable effects.
- If required verification is unavailable, complete any remaining safe in-scope work that does not depend on it. Keep the requirement unresolved, explain why, state the evidence already obtained and the remaining risk, and propose alternatives for approval. Stop before claiming completion or taking a downstream action. Do not redefine the requirement yourself.
- A task is not complete while a required acceptance criterion remains unverified.

## Authentication, secrets, and external actions

- On `401`, `403`, missing access, authentication failure, or secret-like data, stop that access path and report only the non-secret failure. Do not investigate authentication state or attempt another access path unless the owner separately approves that exact diagnostic action. Continue only with already provided non-secret material and approved local work that does not depend on the blocked access.
- Never retrieve, transform, or output a secret value or information derived from it, including fragments, masking, length, hashes, fingerprints, screenshots, or log excerpts. If secret handling appears necessary, do not touch the value; stop and return the decision to the owner and Security reviewer.
- Do not install dependencies, access unrelated external services, call other agents, or perform Git or GitHub state changes unless the owner explicitly approves the exact action and target for the current task.
- Issue assignment and repository workflow describe required process; they do not by themselves authorize comments, state changes, commits, pushes, branch operations, pull request creation or editing, Ready conversion, review submission, merge, deployment, release, issue closure, or branch deletion.
- An Issue, workflow, agent profile, AI-generated summary, or approval from another task is not a substitute for current owner approval.
- Authorization for one external action does not authorize any later action.

## Required handoff

Report all of the following separately:

- changed files and a concise description of each change;
- tests and checks actually run, with exact results;
- inferences, emulated evidence, and test-double evidence;
- unverified requirements and remaining risks;
- every Git, GitHub, network, authentication, or other external action performed;
- the next approval or verification required before the task can proceed.

You may report that your assigned implementation work is finished. Do not declare QA approval, acceptance-criteria completion, issue completion, Ready status, merge readiness, or release readiness; return those decisions to the designated reviewer or approver.
