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
`~/.claude/skills/<name>/`. If a skill is already installed, it asks before replacing it
(`[y/N]`); the old folder is removed first, so no stale file survives. A skill folder that is a
symbolic link is refused, never written through.

Some skills ship extra wiring via a `setup.mjs`: slash commands in `~/.claude/commands/`, hooks
and Bash permissions in `~/.claude/settings.json` (backed up first, idempotently). After copying
such a skill, the installer asks whether to run its setup (`[y/N]`), and asks again before
replacing a command file of yours that differs from the skill's. Setup always runs from the
catalog's copy, never from what was already in `~/.claude/skills/`.

Name the skills, or pass `--all`, to skip the list. Without a terminal on stdin (CI, a pipe)
nothing is ever asked: the installer stops before writing anything and names the missing flag.
`--yes` confirms replacing installed skills; `--setup` or `--no-setup` decides the wiring
(`--setup` also replaces differing command files).

```bash
npx github:sondalab-ai/skillkit debug-decisions mind-gym --setup
npx github:sondalab-ai/skillkit --all --yes --no-setup
```

## Uninstall

Run the uninstaller wizard:

```bash
npm run uninstall
```

It lists the skills currently installed in `~/.claude/skills/`, lets you pick by number, asks
once to confirm (`[y/N]`), then runs each skill's `teardown.mjs` and deletes the skill directory. A teardown removes
only what its setup wrote: a command file only while it is byte-identical to the skill's copy,
and in `~/.claude/settings.json` (backed up first) only the exact hook and permission entries
setup added. A changed or foreign file or entry is kept and reported. A skill whose teardown fails is kept, so you can retry it. Recorded user
data — e.g. `debug-decisions` decision records under `~/.claude/debug-decisions/` — is **never**
deleted; remove it by hand if you want it gone.

It takes the same arguments: `npm run uninstall -- mind-gym --yes`, or `--all --yes`. A skill
counts as this catalog's when its folder name is a catalog name, whatever its `SKILL.md` says.
`--all` (and `all` in the list) takes only those; other folders are marked in the list, are
removed only when picked by name or number, and get no teardown. If two folders claim one name,
the uninstaller refuses and lists both.

## Flags

Both commands accept, except where noted:

| Flag | Effect |
| --- | --- |
| `--all` | Every catalog skill, no selection list; not with skill names |
| `-y`, `--yes` | Confirm replacing (install) or removing (uninstall) skill folders |
| `--setup`, `--no-setup` | Install only: run or skip setup (hooks, commands, Bash permissions) without asking |
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
