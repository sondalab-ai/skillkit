#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { MissingFlag, needsPrompt } from "@sondalab/ui-kit/term.js";
import { SKILLS_DIR, assertSkillDir, copySkill, discoverSkills, refuseLink } from "../lib/skills.mjs";
import { backupFile, describeSetup, loadSetup } from "../lib/setup.mjs";
import { SETUP_FLAGS, runCli, pickSkills, shellLine, tildify } from "../lib/cli.mjs";
import { chooseMany, confirm } from "../lib/prompt.mjs";

const COMMAND = "skillkit";
const DESCRIPTION = "Install agent skills into ~/.claude/skills.";
const CLAUDE_DIR = join(homedir(), ".claude");
const TARGET_DIR = join(CLAUDE_DIR, "skills");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");

/** The ~/.claude/commands files a skill's setup would overwrite with different content. */
function clashingCommands(skillDir) {
  const src = join(skillDir, "commands");
  if (!existsSync(src)) return [];
  return readdirSync(src)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [join(COMMANDS_DIR, f), join(src, f)])
    .filter(([dest, from]) => existsSync(dest) && !readFileSync(dest).equals(readFileSync(from)))
    .map(([dest]) => dest);
}

/** The prompt's account of what a setup adds, from describeSetup(). */
function setupSummary({ commands, settings }) {
  const parts = [];
  if (commands.length) parts.push(`${commands.join(", ")} to ${tildify(COMMANDS_DIR)}`);
  if (settings.length) parts.push(`${settings.join(" and ")} to ${tildify(join(CLAUDE_DIR, "settings.json"))}`);
  return parts.length ? `It adds ${parts.join("; ")}` : "It changes nothing outside the skill folder";
}

/**
 * Run `skill`'s setup from the catalog copy. A ~/.claude/commands file that
 * differs from the skill's is replaced only with --yes or a yes on a TTY (after
 * a backup); otherwise it is restored after setup and reported. Warn lines from
 * setup or from a kept file make the step a warn and count in the Summary.
 */
async function wire(skill, dest, { flags, ui, ask, tty, counts }) {
  const clashes = clashingCommands(skill.dir);
  const replace = clashes.length > 0
    && (flags.yes || (tty && (await ask(`Replace ${clashes.map(tildify).join(", ")}? They differ from ${skill.name}'s`))));
  const kept = new Map();
  for (const path of clashes) {
    if (replace) backupFile(path);
    else kept.set(path, readFileSync(path));
  }
  const before = ui.warnings();
  try {
    const setup = await loadSetup(skill.dir);
    await setup({ skillDir: dest, claudeDir: CLAUDE_DIR, log: ui.log });
  } catch (err) {
    ui.report(err, { what: `Could not wire ${skill.name}`, rerun: [skill.name] });
    counts.failed++;
    return;
  } finally {
    for (const [path, content] of kept) writeFileSync(path, content);
  }
  for (const path of kept.keys()) ui.log.warn(`kept ${tildify(path)}: differs; pass --yes to replace`);
  const warned = ui.warnings() - before;
  counts.warn += warned;
  ui.step(warned ? "warn" : "done", `Wired ${skill.name}`, warned ? `${warned} warning${warned > 1 ? "s" : ""}` : "setup ran");
}

/**
 * Install the picked skills. --yes confirms replacing a skill folder and a
 * differing command file; --setup / --no-setup decide the setup. Off a TTY a
 * missing answer stops the run before anything is written.
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

  const destOf = (skill) => join(TARGET_DIR, skill.name);
  for (const skill of picked) {
    assertSkillDir(destOf(skill), TARGET_DIR);
    refuseLink(destOf(skill));
  }
  const rerun = shellLine([COMMAND, ...argv]);
  const tty = process.stdin.isTTY === true;
  const conflicts = picked.filter((s) => existsSync(destOf(s))).map((s) => s.name);
  const askOverwrite = conflicts.length > 0 && needsPrompt("--yes", {
    given: flags.yes, what: `Could not confirm overwriting ${conflicts.join(", ")}`, command: rerun,
  });
  const wired = picked.filter((s) => existsSync(join(s.dir, "setup.mjs"))).map((s) => s.name);
  if (wired.length && flags.setup === undefined && !tty) {
    const err = new MissingFlag("--no-setup", `Could not confirm setup for ${wired.join(", ")}`, rerun);
    err.why = "stdin is not a terminal, so nothing can be asked; pass --no-setup to skip it, or --setup to add what it adds";
    throw err;
  }
  const ask = (question) => confirm(question, { mode: ui.errMode });

  const counts = { ok: 0, fixed: 0, warn: 0, failed: 0 };
  try {
    for (const skill of picked) {
      const dest = destOf(skill);
      if (existsSync(dest) && askOverwrite && !(await ask(`Overwrite ${skill.name} in ${tildify(TARGET_DIR)}?`))) {
        ui.step("skipped", `Skipped ${skill.name}`, "already installed");
        counts.warn++;
        continue;
      }
      copySkill(skill.dir, dest, TARGET_DIR);
      ui.step("done", `Installed ${skill.name}`, tildify(dest));
      counts.ok++;

      if (!existsSync(join(skill.dir, "setup.mjs"))) continue;
      const run = flags.setup ?? (await ask(`Run setup for ${skill.name}? ${setupSummary(await describeSetup(skill.dir))}`));
      if (!run) {
        ui.step("skipped", `Not wired ${skill.name}`, flags.setup === false ? "skipped (--no-setup)" : "setup declined");
        counts.warn++;
        continue;
      }
      await wire(skill, dest, { flags, ui, ask, tty, counts });
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
