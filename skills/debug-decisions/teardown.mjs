import { join } from "node:path";
import { homedir } from "node:os";
import {
  rmSync, existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync, constants,
} from "node:fs";

/**
 * Remove each command file this skill ships only while ~/.claude still holds
 * its byte-identical copy; a differing file is kept and reported. Inlined in
 * every teardown, which stays self-contained (no repo lib/ import).
 */
function removeOwnedCommands({ skillDir, claudeDir, log }, skill) {
  const src = join(skillDir, "commands");
  const removed = [];
  if (!existsSync(src)) return removed;
  for (const f of readdirSync(src).filter((n) => n.endsWith(".md"))) {
    const target = join(claudeDir, "commands", f);
    if (!existsSync(target)) continue;
    if (readFileSync(target).equals(readFileSync(join(src, f)))) {
      rmSync(target);
      removed.push(f);
    } else {
      log.warn(`kept ${target.replace(homedir(), "~")}: changed since install, or not installed by ${skill}`);
    }
  }
  return removed;
}

/** Back up `path` to `<path>.bak.<ts>`, never overwriting: a counter is appended on a clash. */
function backup(path) {
  const base = `${path}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  for (let i = 0; ; i++) {
    try {
      return copyFileSync(path, i ? `${base}.${i}` : base, constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}

/** The Stop hook entry setup.mjs adds, exactly. Keep in sync with setup.mjs. */
const ownHook = (skillDir) => ({
  type: "command",
  command: `node "${join(skillDir, "hooks", "decisions-stop-prompt.js")}"`,
  timeout: 10,
  statusMessage: "Checking for unregistered architectural decisions...",
});

/** The Bash permissions setup.mjs adds, exactly. Keep in sync with setup.mjs. */
const ownPermissions = (skillDir) => {
  const binBase = skillDir.replace(homedir(), "~") + "/.bin";
  return [
    `Bash(${binBase}/slug.sh)`,
    `Bash(${binBase}/git-sha.sh)`,
    `Bash(${binBase}/ensure-project-dir.sh:*)`,
    `Bash(${binBase}/decision-id.sh:*)`,
    `Bash(${binBase}/index-append.sh:*)`,
    `Bash(${binBase}/index-update-status.sh:*)`,
    `Bash(${binBase}/setup-project-decisions.sh:*)`,
  ];
};

/** The fields of `hook` that differ from `own`, by name. */
const changedFields = (hook, own) =>
  [...new Set([...Object.keys(own), ...Object.keys(hook)])]
    .filter((k) => JSON.stringify(hook[k]) !== JSON.stringify(own[k]));

/**
 * Drop from `settings` only what setup added: every Stop hook whose command is
 * exactly our script (a hook with other fields edited is removed too, with a
 * warn naming them, so no hook points at a deleted script) and the exact
 * permission strings. A Stop group is dropped only when it held nothing but
 * our hook. Other entries are never touched. Returns what changed.
 */
function pruneSettings(settings, skillDir, log) {
  const own = ownHook(skillDir);
  const changed = new Set();
  const groups = settings.hooks?.Stop;
  if (Array.isArray(groups)) {
    const kept = [];
    for (const g of groups) {
      const hooks = Array.isArray(g?.hooks) ? g.hooks : null;
      const rest = hooks ? hooks.filter((h) => h?.command !== own.command) : null;
      if (!hooks || rest.length === hooks.length) {
        kept.push(g);
        continue;
      }
      changed.add("Stop hook");
      for (const h of hooks.filter((x) => x?.command === own.command)) {
        const diff = changedFields(h, own);
        if (diff.length) log.warn(`debug-decisions: removed its Stop hook though ${diff.join(", ")} changed since install`);
      }
      if (rest.length || Object.keys(g).some((k) => k !== "hooks")) kept.push({ ...g, hooks: rest });
    }
    if (changed.size) {
      if (kept.length) settings.hooks.Stop = kept;
      else delete settings.hooks.Stop;
    }
  }
  const allow = settings.permissions?.allow;
  if (Array.isArray(allow)) {
    const perms = new Set(ownPermissions(skillDir));
    const rest = allow.filter((p) => !perms.has(p));
    if (rest.length !== allow.length) {
      settings.permissions.allow = rest;
      changed.add("permissions");
    }
  }
  return [...changed];
}

export default async function teardown({ skillDir, claudeDir, log }) {
  // 1. Read settings.json first: if it cannot be parsed, fail before deleting anything.
  const settingsPath = join(claudeDir, "settings.json");
  let settings = null;
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (err) {
      throw new Error(`${settingsPath.replace(homedir(), "~")} is not valid JSON (${err.message}); nothing was removed`);
    }
  }

  // 2. Commands: only byte-identical copies of the ones this skill ships.
  const removed = removeOwnedCommands({ skillDir, claudeDir, log }, "debug-decisions");
  if (removed.length) log.info(`debug-decisions: removed ${removed.join(", ")}`);

  // 3. settings.json: only the entries setup added, backed up before writing.
  if (settings) {
    const changed = pruneSettings(settings, skillDir, log);
    if (changed.length) {
      backup(settingsPath);
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      log.info(`debug-decisions: removed ${changed.join(" and ")} from settings.json`);
    }
  }

  // 4. Recorded decision data is preserved on purpose — never deleted here.
  log.info(
    "debug-decisions: decision data left intact at ~/.claude/debug-decisions/ (remove manually if you want it gone)",
  );
}
