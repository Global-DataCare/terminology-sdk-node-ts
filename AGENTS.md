# terminology-sdk-node-ts

- Use red-green-refactor TDD and sequential tests.
- Consume exact released terminology data/core packages; never commit local dependencies.
- Verify size and SHA-256 before atomic activation.
- Never forward credentials to a download URL on another origin.
- Cache directories are explicit; never derive a destructive target from HOME or a broad workspace path.
- Keep product policy and licensed terminology data outside this package.
- Preserve downloaded grouped entries and their plain `code -> value` maps;
  select them by flat claim and language rather than creating per-code wire resources.
