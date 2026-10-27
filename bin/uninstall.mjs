#!/usr/bin/env node
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { GLYPHS, TermError, needsPrompt, paint } from "@sondalab/ui-kit/term.js";
import { SKILLS_DIR, discoverSkills, removeSkill } from "../lib/skills.mjs";
import { loadTeardown } from "../lib/setup.mjs";
import { runCli, pickSkills, shellLine, tildify } from "../lib/cli.mjs";
import { chooseMany, confirm } from "../lib/prompt.mjs";

const COMMAND = "skillkit-uninstall";
const DESCRIPTION = "Remove installed skills and the commands and hooks they added.";
const CLAUDE_DIR = join(homedir(), ".claude");
const TARGET_DIR = join(CLAUDE_DIR, "skills");

/** An installed skill's identity: its folder name, never its frontmatter name. */
const idOf = (skill) => basename(skill.dir);

/**
 * Throw when another installed folder claims a picked skill's name in its
 * frontmatter, listing every claimant, so a fork is never taken for the original.
 */
function refuseAmbiguous(picked, installed) {
  for (const skill of picked) {
    const id = idOf(skill);
    const claimants = installed.filter((s) => idOf(s) === id || s.declaredName === id);
    if (claimants.length > 1) {
      throw new TermError(
        `Could not pick ${id}`,
        `more than one folder claims the name ${id}: ${claimants.map((s) => tildify(s.dir)).join(", ")}`,
        `grep -H '^name:' ${tildify(TARGET_DIR)}/*/SKILL.md`,
      );
    }
  }
}

/**
 * Remove the picked skills after one [y/N], or --yes off a TTY. A skill is
 * from the catalog when its folder name is a catalog name: only those get
 * their teardown (loaded from the catalog copy) and only those are in --all
 * or `all`. Other folders are removed as plain folders, only when picked by
 * name or number. A skill whose teardown fails is kept, so a rerun can retry.
 */
async function uninstall(flags, ui, argv) {
  if (flags.version) return ui.lockup();
  if (flags.help) return ui.help(`${COMMAND} [skill...] [flags]`, DESCRIPTION);

  const interactive = !flags.all && !flags.names.length;
  ui.header(DESCRIPTION, { compact: !interactive });

  const installed = discoverSkills(TARGET_DIR, { warn: ui.warn });
  if (!installed.length) {
    const sep = paint(ui.ascii ? GLYPHS.separator.ascii : GLYPHS.separator.unicode, GLYPHS.separator.role, ui.mode);
    process.stdout.write(`No skills in ${tildify(TARGET_DIR)} ${sep} install one with skillkit\n`);
    return 0;
  }

  const catalog = new Map(discoverSkills(SKILLS_DIR, { warn: () => {} }).map((s) => [s.name, s]));
  const fromCatalog = (s) => catalog.has(idOf(s));
  if (flags.all && !installed.some(fromCatalog)) {
    ui.step("skipped", "Removed nothing", `no skillkit skills in ${tildify(TARGET_DIR)}`);
    return 0;
  }
  const picked = await pickSkills(installed, flags, {
    command: COMMAND, question: "Uninstall which skills? (all: skillkit's only)", argv, ui, choose: chooseMany,
    keyOf: idOf,
    allOf: (list) => list.filter(fromCatalog),
    labelOf: (s) => [idOf(s), fromCatalog(s) ? s.description : `(not from skillkit) ${s.description}`],
  });
  refuseAmbiguous(picked, installed);

  const names = picked.map(idOf).join(", ");
  const ask = needsPrompt("--yes", {
    given: flags.yes, what: `Could not confirm removing ${names}`, command: shellLine([COMMAND, ...argv]),
  });
  if (ask && !(await confirm(`Remove ${names} and the commands and hooks they added?`, { mode: ui.errMode }))) {
    ui.step("skipped", "Removed nothing", "declined");
    return 0;
  }

  const counts = { ok: 0, fixed: 0, warn: 0, failed: 0 };
  try {
    for (const skill of picked) {
      const id = idOf(skill);
      const teardown = fromCatalog(skill) ? await loadTeardown(catalog.get(id).dir) : null;
      if (teardown) {
        const before = ui.warnings();
        try {
          await teardown({ skillDir: skill.dir, claudeDir: CLAUDE_DIR, log: ui.log });
          const warned = ui.warnings() - before;
          counts.warn += warned;
          ui.step(warned ? "warn" : "done", `Unwired ${id}`, warned ? `${warned} warning${warned > 1 ? "s" : ""}` : "teardown ran");
        } catch (err) {
          ui.report(err, { what: `Could not unwire ${id}`, rerun: [id, "--yes"] });
          counts.failed++;
          continue;
        }
      }
      removeSkill(skill.dir, TARGET_DIR);
      ui.step("done", `Removed ${id}`, tildify(skill.dir));
      counts.ok++;
    }
  } catch (err) {
    ui.summary(counts);
    throw err;
  }

  ui.summary(counts);
  return counts.failed ? 1 : 0;
}

runCli(process.argv.slice(2), { command: COMMAND, what: "Could not uninstall skills" }, uninstall).then((code) => {
  process.exitCode = code;
});
