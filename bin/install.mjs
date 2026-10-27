#!/usr/bin/env node
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { needsPrompt } from "@sondalab/ui-kit/term.js";
import { SKILLS_DIR, discoverSkills, copySkill } from "../lib/skills.mjs";
import { loadSetup } from "../lib/setup.mjs";
import { runCli, pickSkills, shellLine, tildify } from "../lib/cli.mjs";
import { chooseMany, confirm } from "../lib/prompt.mjs";

const COMMAND = "skillkit";
const DESCRIPTION = "Install agent skills into ~/.claude/skills.";
const CLAUDE_DIR = join(homedir(), ".claude");
const TARGET_DIR = join(CLAUDE_DIR, "skills");

/** Install the picked skills, asking before an overwrite or a setup unless --yes. */
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
  const conflicts = picked.filter((s) => existsSync(destOf(s))).map((s) => s.name);
  const wired = picked.filter((s) => existsSync(join(s.dir, "setup.mjs"))).map((s) => s.name);
  let ask = false;
  if (conflicts.length || wired.length) {
    const what = conflicts.length
      ? `Could not confirm overwriting ${conflicts.join(", ")}`
      : `Could not confirm setup for ${wired.join(", ")}`;
    ask = needsPrompt("--yes", { given: flags.yes, what, command: shellLine([COMMAND, ...argv]) });
  }
  const yes = async (question) => (ask ? confirm(question, { mode: ui.errMode }) : true);

  mkdirSync(TARGET_DIR, { recursive: true });
  const counts = { ok: 0, fixed: 0, warn: 0, failed: 0 };
  for (const skill of picked) {
    const dest = destOf(skill);
    if (existsSync(dest) && !(await yes(`Overwrite ${skill.name} in ${tildify(TARGET_DIR)}?`))) {
      ui.step("skipped", `Skipped ${skill.name}`, "already installed");
      counts.warn++;
      continue;
    }
    copySkill(skill.dir, dest);
    ui.step("done", `Installed ${skill.name}`, tildify(dest));
    counts.ok++;

    const setup = await loadSetup(dest);
    if (!setup) continue;
    if (!(await yes(`Run setup for ${skill.name}? It adds commands and hooks to ${tildify(CLAUDE_DIR)}`))) {
      ui.step("skipped", `Not wired ${skill.name}`, "setup declined");
      counts.warn++;
      continue;
    }
    try {
      await setup({ skillDir: dest, claudeDir: CLAUDE_DIR, log: ui.log });
      ui.step("done", `Wired ${skill.name}`, "commands and hooks");
    } catch (err) {
      ui.report(err, { what: `Could not wire ${skill.name}`, rerun: [skill.name, "--yes"] });
      counts.failed++;
    }
  }

  ui.summary(counts, counts.ok ? "claude" : "");
  return counts.failed ? 1 : 0;
}

runCli(process.argv.slice(2), { command: COMMAND, what: "Could not install skills" }, install).then((code) => {
  process.exitCode = code;
});
