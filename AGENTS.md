# AGENTS.md

## Codebase map — graphify

This project has a knowledge graph at `graphify-out/` (5.4k nodes, 14k edges,
271 communities) built locally from the AST, no API cost.

- Read `graphify-out/GRAPH_REPORT.md` before reading source files or running
  grep/find. Its "Community Hubs" list is the real entry-point map of the app
  (`registerFoundationIpc.ts`, `localDatabase.ts`, `AssetsPage.tsx`, …).
- For cross-module questions prefer `graphify query "<question>"`,
  `graphify path "<A>" "<B>"` or `graphify explain "<concept>"` over grep.
- The graph refreshes automatically at the end of each Claude Code turn. After
  changes from any other tool, run `graphify update . --code-only`.
- `graphify-out/` is gitignored: it rebuilds from scratch in ~16s with
  `graphify . --code-only`.

## Design pass — impeccable

The impeccable design detector runs as a hook after every edit to a UI file
(`.tsx`, `.css`, …) and reports findings into the session. Fix what it finds;
suppress a rule only through `hook-admin.mjs` with a named reason, never by
hand-editing `.impeccable/config.json`.

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
