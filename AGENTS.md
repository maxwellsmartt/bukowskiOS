# AGENTS.md

## Delegation

- Prioritize stability, consistency and isolated write scopes over raw parallelism.
- Use `explorer` agents for read-only audits, contracts, query reviews and UI inspection.
- Use `worker` agents only when the task can be split into non-overlapping write sets.
- Do not split work across agents if two slices touch the same files or the same state model.
- Validate each slice before starting the next one:
  - contracts/query layer
  - UI integration
  - copy/polish
  - tests/verify
- For UX batches, prefer this split:
  - `explorer`: audit current implementation and edge cases
  - `worker`: frontend component + styles
  - `worker`: tests or supporting docs
- If a slice changes both query behavior and UI behavior, land the query layer first and verify it before moving to the visual slice.
