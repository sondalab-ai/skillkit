#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { GLYPHS, needsPrompt, paint } from "@sondalab/ui-kit/term.js";
import { discoverSkills } from "../lib/skills.mjs";
import { loadTeardown } from "../lib/setup.mjs";
import { runCli, pickSkills, shellLine, tildify } from "../lib/cli.mjs";
import { chooseMany, confirm } from "../lib/prompt.mjs";

const COMMAND = "skillkit-uninstall";
const DESCRIPTION = "Remove installed skills and the commands and hooks they added.";
const CLAUDE_DIR = join(homedir(), ".claude");
const TARGET_DIR = join(CLAUDE_DIR, "skills");

/**
 * Tear down and delete the picked skills after one [y/N], or --yes off a TTY.
 * A skill whose teardown fails is kept, so the printed rerun can retry it.
 */
async function uninstall(flags, ui, argv) {
  if (flags.version) return ui.lockup();
  if (flags.help) return ui.help(`${COMMAND} [skill...] [flags]`, DESCRIPTION);

  const interactive = !flags.all && !flags.names.length;
  ui.header(DESCRIPTION, { compact: !interactive });

  const skills = discoverSkills(TARGET_DIR, { warn: ui.warn });
  if (!skills.length) {
    const sep = paint(ui.ascii ? GLYPHS.separator.ascii : GLYPHS.separator.unicode, GLYPHS.separator.role, ui.mode);
    process.stdout.write(`No skills in ${tildify(TARGET_DIR)} ${sep} install one with skillkit\n`);
    return 0;
  }

  const picked = await pickSkills(skills, flags, {
    command: COMMAND, question: "Uninstall which skills?", argv, ui, choose: chooseMany,
  });
  const names = picked.map((s) => s.name).join(", ");
  const ask = needsPrompt("--yes", {
    given: flags.yes, what: `Could not confirm removing ${names}`, command: shellLine([COMMAND, ...argv]),
  });
  if (ask && !(await confirm(`Remove ${names} and the commands and hooks they added?`, { mode: ui.errMode }))) {
    ui.step("skipped", "Removed nothing", "declined");
    return 0;
  }

  const counts = { ok: 0, fixed: 0, warn: 0, failed: 0 };
  for (const skill of picked) {
    const teardown = await loadTeardown(skill.dir);
    if (teardown) {
      try {
        await teardown({ skillDir: skill.dir, claudeDir: CLAUDE_DIR, log: ui.log });
        ui.step("done", `Unwired ${skill.name}`, "commands and hooks");
      } catch (err) {
        ui.report(err, { what: `Could not unwire ${skill.name}`, rerun: [skill.name, "--yes"] });
        counts.failed++;
        continue;
      }
    }
    rmSync(skill.dir, { recursive: true, force: true });
    ui.step("done", `Removed ${skill.name}`, tildify(skill.dir));
    counts.ok++;
  }

  ui.summary(counts);
  return counts.failed ? 1 : 0;
}

runCli(process.argv.slice(2), { command: COMMAND, what: "Could not uninstall skills" }, uninstall).then((code) => {
  process.exitCode = code;
});
