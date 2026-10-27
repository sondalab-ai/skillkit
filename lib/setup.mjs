import { existsSync, readdirSync, copyFileSync, constants } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Load a named module from a skill dir, or null if absent. */
async function importSkillModule(skillDir, file) {
  const modPath = join(skillDir, file);
  if (!existsSync(modPath)) return null;
  return import(pathToFileURL(modPath).href);
}

/** Load a named module's default export from a skill dir, or null if absent. */
async function loadSkillModule(skillDir, file) {
  return (await importSkillModule(skillDir, file))?.default ?? null;
}

/**
 * What a skill's setup adds, for the prompt: its command files (from
 * `commands/*.md`) and the setup module's optional `settingsAdds` list.
 */
export async function describeSetup(skillDir) {
  const dir = join(skillDir, "commands");
  const commands = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => "/" + f.slice(0, -3)) : [];
  const mod = await importSkillModule(skillDir, "setup.mjs");
  return { commands, settings: Array.isArray(mod?.settingsAdds) ? mod.settingsAdds.map(String) : [] };
}

/**
 * Copy `path` to `<path>.bak.<timestamp>` without ever overwriting a file:
 * on a name clash a counter is appended. Returns the backup path.
 */
export function backupFile(path) {
  const base = `${path}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  for (let i = 0; ; i++) {
    const target = i ? `${base}.${i}` : base;
    try {
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}

/**
 * Load a skill's setup.mjs default export, or null if the skill has none.
 * The default export is `async ({ skillDir, claudeDir, log }) => void`.
 */
export async function loadSetup(skillDir) {
  return loadSkillModule(skillDir, "setup.mjs");
}

/**
 * Load a skill's teardown.mjs default export, or null if the skill has none.
 * The default export is `async ({ skillDir, claudeDir, log }) => void`.
 */
export async function loadTeardown(skillDir) {
  return loadSkillModule(skillDir, "teardown.mjs");
}
