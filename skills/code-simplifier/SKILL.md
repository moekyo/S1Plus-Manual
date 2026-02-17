---
name: code-simplifier
description: Simplify existing code with behavior-preserving refactors focused on readability, maintainability, and consistency. Use when asked to simplify, clean up, reduce complexity, remove duplication, or make code easier to understand without changing outputs, interfaces, side effects, or data contracts.
---

# Code Simplifier

Simplify code while preserving behavior.

## Workflow

1. Define scope.
   - Use user-provided file paths first.
   - If scope is not specified, start from recently changed files:
     - `git diff --name-only HEAD`
     - `git diff --name-only --cached`
2. Load project constraints before editing.
   - Read repository instructions (`AGENTS.md`, language/style guides, lint/type settings).
   - Preserve existing conventions unless the user asks for a broader restyle.
3. Plan simplifications.
   - Prioritize high-complexity and repeated logic.
   - Prefer small, reviewable edits over broad rewrites.
4. Apply safe simplifications.
   - Reduce nesting with guard clauses and early returns.
   - Remove dead code and redundant temporary variables.
   - Replace repeated logic with shared helpers only when behavior is identical.
   - Improve naming when intent is unclear.
   - Keep comments only for non-obvious rationale.
5. Enforce safety boundaries.
   - Do not change public APIs, return shapes, error semantics, side effects, I/O ordering, persistence behavior, authorization checks, or concurrency behavior unless requested.
   - Do not introduce large architectural changes unless requested.
6. Validate changes.
   - Run the narrowest relevant checks first (targeted tests/lint/typecheck for touched files).
   - If validation cannot run, report exactly what was not verified.
7. Report results.
   - List changed files and the simplification rationale.
   - Include commands run for validation and outcomes.
   - Call out assumptions and residual risk.

## Simplification Heuristics

- Prefer explicit, readable code over clever compact forms.
- Prefer clear control flow over dense nested conditionals.
- Prefer named constants over repeated magic literals.
- Prefer cohesive functions with single responsibilities.
- Prefer consistency with the local codebase over personal style.
