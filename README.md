# skillkit

A catalog of skills for your coding agent, with an interactive installer that lets you pick
**only the skills you want** and copies them into your personal skills directory
(`~/.claude/skills/`).

## Install

Run the wizard with `npx` (no clone needed):

```bash
npx github:sondalab-ai/skillkit
```

Or clone and run it locally:

```bash
git clone https://github.com/sondalab-ai/skillkit
cd skillkit
npm install
npm start
```

The wizard prints a numbered list of the available skills; type the numbers you want
(`1 3`, `1,3`) or `all`, then Enter. Each chosen skill is copied into
`~/.claude/skills/<name>/`. If a skill is already installed, it asks before overwriting
(`[y/N]`).

Some skills ship extra wiring (slash commands, hooks) via a `setup.mjs`. After copying such a
skill, the installer asks whether to run its setup (`[y/N]`), which copies commands into
`~/.claude/commands/` and registers any hooks in `~/.claude/settings.json` (backed up first,
idempotently).

Name the skills, or pass `--all`, to skip the list. Without a terminal on stdin (CI, a pipe)
nothing is ever asked: the installer stops and names the missing flag unless you pass
`--yes`, which answers yes to every overwrite and setup question.

```bash
npx github:sondalab-ai/skillkit debug-decisions mind-gym
npx github:sondalab-ai/skillkit --all --yes
```

## Uninstall

Run the uninstaller wizard:

```bash
npm run uninstall
```

It lists the skills currently installed in `~/.claude/skills/`, lets you pick by number, asks
once to confirm (`[y/N]`), then runs each skill's `teardown.mjs` (removing the slash commands it
installed and de-registering its hooks from `~/.claude/settings.json`, with a backup) and deletes
the skill directory. A skill whose teardown fails is kept, so you can retry it. Recorded user
data — e.g. `debug-decisions` decision records under `~/.claude/debug-decisions/` — is **never**
deleted; remove it by hand if you want it gone.

It takes the same arguments: `npm run uninstall -- mind-gym --yes`, or `--all --yes`. For the
uninstaller, `--all` means every installed skill that this catalog ships; other directories in
`~/.claude/skills/` are only removed when named.

## Flags

Both commands accept:

| Flag | Effect |
| --- | --- |
| `--all` | Every catalog skill, no selection list |
| `-y`, `--yes` | Answer yes to every confirmation; required without a terminal |
| `--ascii` | ASCII glyphs only (also `SONDALAB_ASCII=1`, `TERM=dumb` or a non-UTF-8 locale) |
| `--color`, `--no-color` | Force colour on or off; otherwise `NO_COLOR`, then `FORCE_COLOR`, then terminal detection |
| `--debug` | Print the stack trace after an error |
| `-v`, `--version` | Print the version |
| `-h`, `--help` | Print the help |

Output follows the Sondalab terminal spec through
[`@sondalab/ui-kit/term.js`](https://www.npmjs.com/package/@sondalab/ui-kit). Requires Node 18.3
or later.

## Available skills

<!-- SKILLS:START -->

| Skill | Description |
| --- | --- |
| `debug-decisions` | Per-project tracking of architectural decisions made during Claude sessions. Registers decisions as versioned Markdown with revert plans, an INDEX, and an optional session-end reminder hook. Use when making or reviewing an architectural/approach decision, or when asked to record/list/revert a decision. |
| `memory-org` | Convention for where Claude memories live — repo-scoped project memories in docs/memory (git-tracked, symlinked into ~/.claude) vs generic memories in ~/.claude/CLAUDE.md. Use when saving a memory, organizing project memory, or setting up per-project memory. |
| `mind-gym` | Cognitive training against brain atrophy. Proposes a puzzle calibrated to the user's profile, guides the resolution empathetically with Socratic hints (never spoiling the answer), offers a transferable growth insight, and routes technical puzzles to the right tool (Python for math, REPL/editor + tests for programming) while keeping logic and humanistic puzzles in the terminal. USE when the user asks to train/exercise their brain or mind, wants a puzzle, riddle, brain teaser, kata, or cognitive workout, says they feel mentally rusty, or asks to "keep me sharp" / "give me a challenge" / "propose a problem to solve". Maintains a persistent profile and history under ~/.claude/mind-gym/ to adapt difficulty and rotate domains across sessions. |
| `spec-versioning` | Convention for where design specs and implementation plans live in a repo (docs/specs and docs/plans), with /spec-new and /plan-new scaffolding commands. Use when creating a spec or plan, or organizing project design docs. |
| `sync-skills` | Sync Claude Code skills from GitHub repos. Use when user invokes /sync-skills, /sync-skills add, /sync-skills remove, /sync-skills scan, or asks to manage or set up skill syncing. |

<!-- SKILLS:END -->

## Manual install

Each skill lives in `skills/<name>/`. To install one by hand, copy its directory into
`~/.claude/skills/`:

```bash
cp -R skills/<name> ~/.claude/skills/
```

## Contributing a skill

Add a directory under `skills/` containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: One-line summary shown in the catalog and the installer.
---

# My Skill

...skill body...
```

Extra files (references, scripts, assets) can live alongside `SKILL.md`; the installer copies
the whole directory. After adding or editing a skill, regenerate the catalog table:

```bash
npm run docs
```

## License

MIT
