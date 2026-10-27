#!/usr/bin/env node
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { MissingFlag, TermError, needsPrompt } from "@sondalab/ui-kit/term.js";
import { SKILLS_DIR, discoverSkills, copySkill } from "../lib/skills.mjs";
import { loadSetup } from "../lib/setup.mjs";
import { SETUP_FLAGS, runCli, pickSkills, shellLine, tildify } from "../lib/cli.mjs";
import { chooseMany, confirm } from "../lib/prompt.mjs";

const COMMAND = "skillkit";
const DESCRIPTION = "Install agent skills into ~/.claude/skills.";
const CLAUDE_DIR = join(homedir(), ".claude");
const TARGET_DIR = join(CLAUDE_DIR, "skills");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");

/** Whether `path` is a symbolic link, without following it. */
function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The command files a skill's setup would overwrite with different content. */
function clashingCommands(skillDir) {
  const src = join(skillDir, "commands");
  if (!existsSync(src)) return [];
  return readdirSync(src).filter((f) => {
    if (!f.endsWith(".md")) return false;
    const dest = join(COMMANDS_DIR, f);
    return existsSync(dest) && !readFileSync(dest).equals(readFileSync(join(src, f)));
  });
}

/**
 * Whether to run `skill`'s setup: --setup or --no-setup decide; otherwise ask,
 * and ask again before replacing command files that differ from the catalog's.
 */
async function wantSetup(skill, flags, ask) {
  if (flags.setup !== undefined) return flags.setup;
  if (!(await ask(`Run setup for ${skill.name}? It adds hooks, commands and Bash permissions to ${tildify(CLAUDE_DIR)}`))) return false;
  const clashes = clashingCommands(skill.dir);
  if (!clashes.length) return true;
  return ask(`Replace ${clashes.join(", ")} in ${tildify(COMMANDS_DIR)}? They differ from ${skill.name}'s`);
}

/**
 * Install the picked skills. --yes confirms overwriting a skill folder;
 * --setup / --no-setup decide setup (hooks, commands, Bash permissions).
 * Off a TTY a missing answer stops the run before anything is written.
 */
async function install(flags, ui, argv) {
  if (flags.version) return ui.lockup();
  if (flags.help) return ui.help(`${COMMAND} [skill...] [flags]`, DESCRIPTION);

  const interactive = !flags.all && !flags.names.length;
  ui.header(DESCRIPTION, { compact: !interactive });

  const skills = discoverSkills(SKILLS_DIR, { warn: ui.warn });
  if (!skills.length) {
    ui.step("skipped", "No skills in the catalog");
    return 0;
  }

  const picked = await pickSkills(skills, flags, {
    command: COMMAND, question: "Install which skills?", argv, ui, choose: chooseMany,
  });

  const destOf = (skill) => join(TARGET_DIR, basename(skill.name));
  for (const skill of picked) {
    const dest = destOf(skill);
    if (isLink(dest)) {
      throw new TermError(
        `Could not install ${skill.name}`,
        `${tildify(dest)} is a symbolic link to ${tildify(readlinkSync(dest))}; skillkit never writes through a link`,
        `rm ${shellLine([dest])}`,
      );
    }
  }
  const rerun = shellLine([COMMAND, ...argv]);
  const conflicts = picked.filter((s) => existsSync(destOf(s))).map((s) => s.name);
  const askOverwrite = conflicts.length > 0 && needsPrompt("--yes", {
    given: flags.yes, what: `Could not confirm overwriting ${conflicts.join(", ")}`, command: rerun,
  });
  const wired = picked.filter((s) => existsSync(join(s.dir, "setup.mjs"))).map((s) => s.name);
  if (wired.length && flags.setup === undefined && !process.stdin.isTTY) {
    const err = new MissingFlag("--setup", `Could not confirm setup for ${wired.join(", ")}`, rerun);
    err.why = "stdin is not a terminal, so nothing can be asked; pass --setup to add hooks, commands and Bash permissions, or --no-setup to skip them";
    throw err;
  }
  const ask = (question) => confirm(question, { mode: ui.errMode });

  mkdirSync(TARGET_DIR, { recursive: true });
  const counts = { ok: 0, fixed: 0, warn: 0, failed: 0 };
  try {
    for (const skill of picked) {
      const dest = destOf(skill);
      if (existsSync(dest) && askOverwrite && !(await ask(`Overwrite ${skill.name} in ${tildify(TARGET_DIR)}?`))) {
        ui.step("skipped", `Skipped ${skill.name}`, "already installed");
        counts.warn++;
        continue;
      }
      copySkill(skill.dir, dest);
      ui.step("done", `Installed ${skill.name}`, tildify(dest));
      counts.ok++;

      const setup = await loadSetup(skill.dir);
      if (!setup) continue;
      if (!(await wantSetup(skill, flags, ask))) {
        ui.step("skipped", `Not wired ${skill.name}`, "setup declined");
        counts.warn++;
        continue;
      }
      try {
        await setup({ skillDir: dest, claudeDir: CLAUDE_DIR, log: ui.log });
        ui.step("done", `Wired ${skill.name}`, "hooks, commands, permissions");
      } catch (err) {
        ui.report(err, { what: `Could not wire ${skill.name}`, rerun: [skill.name] });
        counts.failed++;
      }
    }
  } catch (err) {
    ui.summary(counts);
    throw err;
  }

  ui.summary(counts, counts.ok ? "claude" : "");
  return counts.failed ? 1 : 0;
}

runCli(process.argv.slice(2), { command: COMMAND, what: "Could not install skills", extra: SETUP_FLAGS }, install).then((code) => {
  process.exitCode = code;
});
