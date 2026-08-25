---
id: 2026-08-25-2320-duplicate-installer-into-skillkit-instead
date: 2026-08-25T23:20+02:00
project: -Users-marcello.barile-src-mine-ai-tools-skillkit
status: active
git_sha: f64c9ef
tags: [installer, split]
---

# Duplicate the installer into skillkit instead of sharing it with claude-skills

## Context
`claude-skills` was split: five agent-tooling skills moved here, four personal ones stayed
behind. The repo is not a folder of Markdown, it is a package with an interactive installer
(`bin/`, `lib/`, `scripts/gen-readme.mjs`, `test/`). Four of the five moving skills
(`debug-decisions`, `memory-org`, `spec-versioning`, `sync-skills`) ship `setup.mjs`,
`teardown.mjs` and `commands/`, and `debug-decisions` also ships `hooks/`, so they are
useless without that wiring. Both repos need the same installer at the same time.

## Decision
Copy `bin/`, `lib/`, `scripts/` and `test/` into `skillkit` as an independent second copy,
and rename the binaries to `skillkit` / `skillkit-install` / `skillkit-uninstall`.

## Alternatives considered
- **Share `lib/` via a git or npm dependency** — dropped: couples a `sondalab-ai` repo to a
  personal repo that is itself about to be relocated out of `~/src/mine/ai-tools/`.
- **Ship only the index generator, install the skills by hand** — dropped: four of the five
  skills would lose their slash commands and hooks, a regression against what users have today.
- **Keep the `claude-skills*` bin aliases** — dropped: the two catalogs would fight over the
  same global binary names on any machine that has both installed.

## Rationale
- The duplication is bounded and static: the installer has not changed shape since it was
  written, and neither catalog is expected to evolve it independently.
- Standalone beats DRY here because the two repos have different owners and different
  lifetimes; a shared dependency would make the personal repo a permanent upstream.
- The coupling to the old name was only textual, three lines, so the rename was cheap.

## Scope / Impact
- Files: `bin/install.mjs`, `bin/uninstall.mjs`, `lib/*.mjs`, `scripts/gen-readme.mjs`,
  `test/*`, `package.json`
- Areas: install/uninstall wiring, catalog generation, `npx github:` entry point
- Downstream dependencies: a fix to installer behaviour must now be applied twice, once here
  and once in `marcellobarile/claude-skills`, until that repo drops its installer.

## Revert plan
1. Delete `bin/`, `lib/`, `scripts/`, `test/` from this repo and add `claude-skills` as a
   dependency, re-exporting its `lib/` entry points.
2. Restore the `claude-skills*` bin names in `package.json`, accepting the collision.
3. Risks: `npx github:sondalab-ai/skillkit` stops being self-contained, and this repo starts
   breaking whenever the personal repo moves or is renamed.

## Follow-ups
- [ ] If the installer ever needs a real change, decide then whether to extract it into a
      third package rather than patching both copies.
