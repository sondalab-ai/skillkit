// test/teardown.integration.test.mjs
// Runs the real teardown.mjs of every skill that has one against throwaway
// dirs: each removes only what its setup wrote, byte for byte or entry for entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const WITH_TEARDOWN = readdirSync(SKILLS).filter((s) => existsSync(join(SKILLS, s, "teardown.mjs")));

/** A log that records warn lines. */
function recorder() {
  const warns = [];
  return { warns, log: { info() {}, success() {}, step() {}, message() {}, warn: (m) => warns.push(m), warning: (m) => warns.push(m), error() {} } };
}

/** A temp skillDir (copy of the catalog skill) and claudeDir with the skill's commands installed. */
function installed(skill) {
  const root = mkdtempSync(join(tmpdir(), "teardown-"));
  const skillDir = join(root, "skills", skill);
  const claudeDir = join(root, "claude");
  cpSync(join(SKILLS, skill), skillDir, { recursive: true });
  mkdirSync(join(claudeDir, "commands"), { recursive: true });
  const shipped = readdirSync(join(skillDir, "commands")).filter((f) => f.endsWith(".md"));
  for (const f of shipped) cpSync(join(skillDir, "commands", f), join(claudeDir, "commands", f));
  return { skillDir, claudeDir, shipped };
}

for (const skill of WITH_TEARDOWN) {
  test(`${skill} teardown removes unmodified commands, keeps changed and foreign ones with a warn`, async () => {
    const { default: teardown } = await import(join(SKILLS, skill, "teardown.mjs"));
    const { skillDir, claudeDir, shipped } = installed(skill);
    const [changed, ...same] = shipped;
    writeFileSync(join(claudeDir, "commands", changed), "edited by the user");
    writeFileSync(join(claudeDir, "commands", "other.md"), "keep");
    const { warns, log } = recorder();
    await teardown({ skillDir, claudeDir, log });
    for (const f of same) assert.ok(!existsSync(join(claudeDir, "commands", f)), f);
    assert.equal(readFileSync(join(claudeDir, "commands", changed), "utf8"), "edited by the user");
    assert.equal(readFileSync(join(claudeDir, "commands", "other.md"), "utf8"), "keep");
    assert.equal(warns.length, 1);
    assert.match(warns[0], new RegExp(`^kept .*commands/${changed}: changed since install, or not installed by ${skill}$`));
  });
}

test("debug-decisions teardown removes only its exact hook and permissions", async () => {
  const { default: teardown } = await import(join(SKILLS, "debug-decisions", "teardown.mjs"));
  const { default: setup } = await import(join(SKILLS, "debug-decisions", "setup.mjs"));
  const { skillDir, claudeDir } = installed("debug-decisions");
  const settingsPath = join(claudeDir, "settings.json");
  const foreignHook = { type: "command", command: "node /other/hook.js" };
  writeFileSync(settingsPath, JSON.stringify({
    model: "opus",
    hooks: { Stop: [{ hooks: [foreignHook] }, { matcher: "x", hooks: [] }], PreToolUse: [{ hooks: [] }] },
    permissions: { allow: ["Bash(git status)", "Bash(~/.claude/skills/debug-decisions/.bin/slug.sh:*)"], deny: ["Read(.env)"] },
  }));
  const quiet = recorder().log;
  await setup({ skillDir, claudeDir, log: quiet });
  // A group the user put our hook into alongside their own keeps their hook.
  const s = JSON.parse(readFileSync(settingsPath, "utf8"));
  const ours = s.hooks.Stop.at(-1).hooks[0];
  s.hooks.Stop.push({ hooks: [{ ...ours }, { type: "command", command: "node /mine.js" }] });
  writeFileSync(settingsPath, JSON.stringify(s));

  await teardown({ skillDir, claudeDir, log: quiet });

  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(after.model, "opus");
  assert.deepEqual(after.hooks.Stop, [
    { hooks: [foreignHook] },
    { matcher: "x", hooks: [] },
    { hooks: [{ type: "command", command: "node /mine.js" }] },
  ]);
  assert.deepEqual(after.hooks.PreToolUse, [{ hooks: [] }]);
  assert.deepEqual(after.permissions, {
    allow: ["Bash(git status)", "Bash(~/.claude/skills/debug-decisions/.bin/slug.sh:*)"],
    deny: ["Read(.env)"],
  });
  assert.ok(readdirSync(claudeDir).some((f) => f.startsWith("settings.json.bak.")));
});

test("debug-decisions teardown removes its hook even when the user changed it, warning what changed", async () => {
  const { default: teardown } = await import(join(SKILLS, "debug-decisions", "teardown.mjs"));
  const { default: setup } = await import(join(SKILLS, "debug-decisions", "setup.mjs"));
  const { skillDir, claudeDir } = installed("debug-decisions");
  await setup({ skillDir, claudeDir, log: recorder().log });
  const settingsPath = join(claudeDir, "settings.json");
  const s = JSON.parse(readFileSync(settingsPath, "utf8"));
  s.hooks.Stop[0].hooks[0].timeout = 30;
  writeFileSync(settingsPath, JSON.stringify(s));
  const { warns, log } = recorder();
  await teardown({ skillDir, claudeDir, log });
  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(after.hooks.Stop, undefined);
  assert.deepEqual(after.permissions.allow, []);
  assert.deepEqual(warns, ["debug-decisions: removed its Stop hook though timeout changed since install"]);
});

test("debug-decisions teardown fails on an unreadable settings.json before deleting anything", async () => {
  const { default: teardown } = await import(join(SKILLS, "debug-decisions", "teardown.mjs"));
  const { skillDir, claudeDir, shipped } = installed("debug-decisions");
  writeFileSync(join(claudeDir, "settings.json"), "{ not json");
  await assert.rejects(teardown({ skillDir, claudeDir, log: recorder().log }), /settings\.json is not valid JSON .*nothing was removed/);
  for (const f of shipped) assert.ok(existsSync(join(claudeDir, "commands", f)), f);
});

test("backups never overwrite: a second backup in the same instant gets a counter", async () => {
  const { backupFile } = await import(join(ROOT, "lib", "setup.mjs"));
  const dir = mkdtempSync(join(tmpdir(), "backup-"));
  const file = join(dir, "settings.json");
  writeFileSync(file, "one");
  const a = backupFile(file);
  writeFileSync(file, "two");
  writeFileSync(a + ".1", "taken");
  const b = backupFile(file);
  assert.notEqual(a, b);
  assert.equal(readFileSync(a, "utf8"), "one");
  assert.equal(readFileSync(b, "utf8"), "two");
});

test("the inlined removeOwnedCommands is byte-identical in every teardown", () => {
  const extract = (skill) => {
    const src = readFileSync(join(SKILLS, skill, "teardown.mjs"), "utf8");
    const start = src.lastIndexOf("/**", src.indexOf("function removeOwnedCommands"));
    return src.slice(start, src.indexOf("\n}\n", start) + 3);
  };
  const copies = WITH_TEARDOWN.map(extract);
  assert.ok(copies[0].includes("function removeOwnedCommands"));
  for (const [i, copy] of copies.entries()) assert.equal(copy, copies[0], WITH_TEARDOWN[i]);
});

/** Run a binary with a temp HOME and a clean env. */
function run(bin, args, home) {
  const env = { PATH: process.env.PATH, HOME: home, LANG: "en_US.UTF-8", COLUMNS: "100" };
  return spawnSync(process.execPath, [join(ROOT, "bin", bin), ...args], { env, input: "", encoding: "utf8" });
}

test("end to end: uninstall keeps a user-owned command and foreign settings entries", () => {
  const home = mkdtempSync(join(tmpdir(), "skillkit-home-"));
  const claude = join(home, ".claude");
  mkdirSync(join(claude, "commands"), { recursive: true });
  writeFileSync(join(claude, "commands", "spec-new.md"), "mine");
  const foreign = { hooks: { Stop: [{ hooks: [{ type: "command", command: "node /other.js" }] }] }, permissions: { allow: ["Bash(ls)"] } };
  writeFileSync(join(claude, "settings.json"), JSON.stringify(foreign));
  assert.equal(run("install.mjs", ["spec-versioning", "--no-setup"], home).status, 0);
  assert.equal(run("install.mjs", ["debug-decisions", "--setup"], home).status, 0);

  const r = run("uninstall.mjs", ["--all", "--yes"], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /! kept ~\/\.claude\/commands\/spec-new\.md: changed since install, or not installed by spec-versioning\n/);
  assert.equal(readFileSync(join(claude, "commands", "spec-new.md"), "utf8"), "mine");
  assert.deepEqual(readdirSync(join(claude, "commands")), ["spec-new.md"]);
  assert.deepEqual(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")), { ...foreign, permissions: { allow: ["Bash(ls)"] } });
});
