import { join } from "node:path";
import { homedir } from "node:os";
import {
  rmSync, existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync,
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

/** `value` as JSON with object keys sorted, so equal entries compare equal in any key order. */
const canon = (value) => JSON.stringify(value, (_, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v);

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

/**
 * Drop from `settings` only the exact hook entry and permission strings that
 * setup added. A Stop group is dropped only when it held nothing but our hook;
 * a hook on our command with other fields is kept and reported. Returns what changed.
 */
function pruneSettings(settings, skillDir, log) {
  const hook = canon(ownHook(skillDir));
  const command = ownHook(skillDir).command;
  const changed = [];
  const groups = settings.hooks?.Stop;
  if (Array.isArray(groups)) {
    const kept = [];
    for (const g of groups) {
      const hooks = Array.isArray(g?.hooks) ? g.hooks : null;
      const rest = hooks ? hooks.filter((h) => canon(h) !== hook) : null;
      if (!hooks || rest.length === hooks.length) {
        kept.push(g);
      } else {
        changed.push("Stop hook");
        const onlyHooks = Object.keys(g).every((k) => k === "hooks");
        if (rest.length || !onlyHooks) kept.push({ ...g, hooks: rest });
      }
      for (const h of rest ?? []) {
        if (h?.command === command) log.warn("debug-decisions: kept a Stop hook on its script: changed since install");
      }
    }
    if (kept.length !== groups.length || changed.length) {
      if (kept.length) settings.hooks.Stop = kept;
      else delete settings.hooks.Stop;
    }
  }
  const allow = settings.permissions?.allow;
  if (Array.isArray(allow)) {
    const own = new Set(ownPermissions(skillDir));
    const rest = allow.filter((p) => !own.has(p));
    if (rest.length !== allow.length) {
      settings.permissions.allow = rest;
      changed.push("permissions");
    }
  }
  return [...new Set(changed)];
}

export default async function teardown({ skillDir, claudeDir, log }) {
  // 1. Commands: only byte-identical copies of the ones this skill ships.
  const removed = removeOwnedCommands({ skillDir, claudeDir, log }, "debug-decisions");
  if (removed.length) log.info(`debug-decisions: removed ${removed.join(", ")}`);

  // 2. settings.json: only the exact entries setup added, backed up before writing.
  const settingsPath = join(claudeDir, "settings.json");
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const changed = pruneSettings(settings, skillDir, log);
    if (changed.length) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      copyFileSync(settingsPath, `${settingsPath}.bak.${ts}`);
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      log.info(`debug-decisions: removed ${changed.join(" and ")} from settings.json`);
    }
  }

  // 3. Recorded decision data is preserved on purpose — never deleted here.
  log.info(
    "debug-decisions: decision data left intact at ~/.claude/debug-decisions/ (remove manually if you want it gone)",
  );
}
