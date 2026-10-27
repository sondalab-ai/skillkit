// test/cli.test.mjs
// Runs the real binaries with stdin piped (never a TTY) and HOME in a temp dir,
// so nothing touches the real ~/.claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createUi, headerEnv, parseCli, UsageError } from "../lib/cli.mjs";
import { header } from "@sondalab/ui-kit/term.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = join(ROOT, "bin", "install.mjs");
const UNINSTALL = join(ROOT, "bin", "uninstall.mjs");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const ESC = /\x1b\[/;

/** Run `bin` with a clean env: UTF-8 locale, a temp HOME, no colour or ASCII switches. */
function run(bin, args, { env = {}, home = mkdtempSync(join(tmpdir(), "skillkit-home-")) } = {}) {
  const base = { PATH: process.env.PATH, HOME: home, LANG: "en_US.UTF-8", COLUMNS: "100" };
  const res = spawnSync(process.execPath, [bin, ...args], { env: { ...base, ...env }, input: "", encoding: "utf8" });
  return { ...res, home };
}

test("non-TTY without a selection stops with MissingFlag naming --all", () => {
  const r = run(INSTALL, []);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^  ✗ Could not choose skills\n    stdin is not a terminal, so nothing can be asked, and --all was not passed\n    Try: skillkit --all\n$/);
});

test("non-TTY --all without a setup flag names --setup and --no-setup and writes nothing", () => {
  const r = run(INSTALL, ["--all", "--yes"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^  ✗ Could not confirm setup for debug-decisions, memory-org, spec-versioning, sync-skills\n/);
  assert.match(r.stderr, /pass --no-setup to skip it, or --setup to add\s+what it adds\n    Try: skillkit --all --yes --no-setup\n$/);
  assert.ok(!existsSync(join(r.home, ".claude", "skills")));
});

test("non-TTY install over an existing skill without --yes writes nothing; --yes replaces it", () => {
  const home = run(INSTALL, ["mind-gym"]).home;
  const dest = join(home, ".claude", "skills", "mind-gym");
  writeFileSync(join(dest, "leftover.txt"), "old");
  const refused = run(INSTALL, ["mind-gym"], { home });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Could not confirm overwriting mind-gym\n[\s\S]*Try: skillkit mind-gym --yes\n$/);
  assert.equal(readFileSync(join(dest, "leftover.txt"), "utf8"), "old");
  const replaced = run(INSTALL, ["mind-gym", "--yes"], { home });
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.ok(!existsSync(join(dest, "leftover.txt")));
  assert.ok(existsSync(join(dest, "SKILL.md")));
});

test("install refuses a symlinked skill folder and leaves the link target untouched", () => {
  const home = mkdtempSync(join(tmpdir(), "skillkit-home-"));
  const target = mkdtempSync(join(tmpdir(), "skillkit-target-"));
  writeFileSync(join(target, "mine.txt"), "keep");
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  symlinkSync(target, join(home, ".claude", "skills", "mind-gym"));
  const r = run(INSTALL, ["mind-gym", "--yes"], { home });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^  ✗ Could not install mind-gym\n    ~\/\.claude\/skills\/mind-gym is a symbolic link to/);
  assert.match(r.stderr, /Try: rm [^\n]*\.claude\/skills\/mind-gym\n$/);
  assert.deepEqual(readdirSync(target), ["mine.txt"]);
  assert.equal(readFileSync(join(target, "mine.txt"), "utf8"), "keep");
});

test("a leftover setup.mjs the catalog never shipped does not run, and is removed", () => {
  const home = run(INSTALL, ["mind-gym"]).home;
  const dest = join(home, ".claude", "skills", "mind-gym");
  const marker = join(home, "ran");
  writeFileSync(join(dest, "setup.mjs"), `import { writeFileSync } from "node:fs"; export default async () => writeFileSync(${JSON.stringify(marker)}, "x");\n`);
  const r = run(INSTALL, ["mind-gym", "--yes", "--setup"], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(marker));
  assert.ok(!existsSync(join(dest, "setup.mjs")));
});

test("--no-setup counts the skipped setup as warn and leaves settings.json and commands alone", () => {
  const home = mkdtempSync(join(tmpdir(), "skillkit-home-"));
  mkdirSync(join(home, ".claude", "commands"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{\"model\":\"x\"}\n");
  writeFileSync(join(home, ".claude", "commands", "memory-setup.md"), "mine");
  const r = run(INSTALL, ["memory-org", "debug-decisions", "--no-setup"], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /↷ Not wired debug-decisions\s+skipped \(--no-setup\)\n/);
  assert.match(r.stdout, /Summary  2 ok · 0 fixed · 2 warn · 0 failed\n/);
  assert.equal(readFileSync(join(home, ".claude", "settings.json"), "utf8"), "{\"model\":\"x\"}\n");
  assert.equal(readFileSync(join(home, ".claude", "commands", "memory-setup.md"), "utf8"), "mine");
});

test("--setup runs setup with no prompt", () => {
  const r = run(INSTALL, ["spec-versioning", "--setup"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ Wired spec-versioning/);
  assert.ok(existsSync(join(r.home, ".claude", "commands", "spec-new.md")));
});

test("skill names together with --all exit 2, for install and uninstall", () => {
  for (const bin of [INSTALL, UNINSTALL]) {
    const r = run(bin, ["mind-gym", "--all"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Could not combine skill names with --all/);
  }
});

test("--setup with --no-setup is a usage error", () => {
  assert.equal(run(INSTALL, ["mind-gym", "--setup", "--no-setup"]).status, 2);
});

test("non-TTY uninstall without --yes names --yes and removes nothing", () => {
  const home = run(INSTALL, ["mind-gym", "--yes"]).home;
  const r = run(UNINSTALL, ["mind-gym"], { home });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Try: skillkit-uninstall mind-gym --yes\n$/);
  assert.ok(existsSync(join(home, ".claude", "skills", "mind-gym", "SKILL.md")));
});

test("--yes installs with step lines, Summary and Next", () => {
  const r = run(INSTALL, ["mind-gym", "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "  ✓ Installed mind-gym          ~/.claude/skills/mind-gym\n\nSummary  1 ok · 0 fixed · 0 warn · 0 failed\n    Next: claude\n");
});

test("an unexpected failure is the three-line block with --debug in the fix, and no stack", () => {
  const home = join(mkdtempSync(join(tmpdir(), "skillkit-")), "file");
  writeFileSync(home, "");
  const r = run(INSTALL, ["mind-gym", "--yes"], { home });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^  ✗ Could not install skills\n    ENOTDIR/);
  assert.match(r.stderr, /\n    Try: skillkit mind-gym --yes --debug\n$/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test("--debug adds the stack after the block", () => {
  const home = join(mkdtempSync(join(tmpdir(), "skillkit-")), "file");
  writeFileSync(home, "");
  const r = run(INSTALL, ["mind-gym", "--yes", "--debug"], { home });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Try: skillkit mind-gym --yes --debug\n\nError: ENOTDIR[^\n]*\n\s+at /);
});

test("ASCII mode: --ascii, SONDALAB_ASCII=1 and a non-UTF-8 locale use ASCII glyphs", () => {
  const expected = "  + Installed mind-gym          ~/.claude/skills/mind-gym\n\nSummary  1 ok | 0 fixed | 0 warn | 0 failed\n    Next: claude\n";
  assert.equal(run(INSTALL, ["mind-gym", "--yes", "--ascii"]).stdout, expected);
  assert.equal(run(INSTALL, ["mind-gym", "--yes"], { env: { SONDALAB_ASCII: "1" } }).stdout, expected);
  assert.equal(run(INSTALL, ["mind-gym", "--yes"], { env: { LANG: "C" } }).stdout, expected);
  assert.match(run(INSTALL, ["--ascii"]).stderr, /^  x Could not choose skills\n/);
});

test("colour: none off a TTY, FORCE_COLOR turns it on, --no-color wins over FORCE_COLOR, --color over NO_COLOR", () => {
  assert.doesNotMatch(run(INSTALL, ["mind-gym", "--yes"]).stdout, ESC);
  assert.match(run(INSTALL, ["mind-gym", "--yes"], { env: { FORCE_COLOR: "1" } }).stdout, ESC);
  assert.doesNotMatch(run(INSTALL, ["mind-gym", "--yes", "--no-color"], { env: { FORCE_COLOR: "1" } }).stdout, ESC);
  assert.match(run(INSTALL, ["mind-gym", "--yes", "--color"], { env: { NO_COLOR: "1" } }).stdout, ESC);
});

test("--version prints the one-line lockup and no header off a TTY", () => {
  const r = run(INSTALL, ["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `sonda/lab skillkit ${VERSION}\n`);
  assert.equal(run(UNINSTALL, ["-v"]).stdout, `sonda/lab skillkit-uninstall ${VERSION}\n`);
});

test("an unknown flag or skill exits 2 with Did you mean", () => {
  const flag = run(INSTALL, ["--versoin"]);
  assert.equal(flag.status, 2);
  assert.equal(flag.stderr, "  ✗ Unknown flag --versoin\n    Did you mean --version?\n");
  const skill = run(INSTALL, ["mind-gm"]);
  assert.equal(skill.status, 2);
  assert.equal(skill.stderr, "  ✗ Unknown skill mind-gm\n    Did you mean mind-gym?\n");
  assert.match(run(INSTALL, ["zzzzzz"]).stderr, /Try: skillkit --help\n$/);
});

test("uninstall with an empty target prints the empty state", () => {
  const r = run(UNINSTALL, []);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "No skills in ~/.claude/skills · install one with skillkit\n");
});

test("parseCli leaves ascii and color undefined unless a flag is given", () => {
  const f = parseCli([], "skillkit");
  assert.equal(f.ascii, undefined);
  assert.equal(f.color, undefined);
  assert.equal(parseCli(["--no-color"], "skillkit").color, false);
  assert.throws(() => parseCli(["--nope"], "skillkit"), UsageError);
});

test("the header honours --ascii and --no-color through headerEnv on a TTY", () => {
  const env = { LANG: "en_US.UTF-8", COLUMNS: "100" };
  const full = header("skillkit", "1.0.0", "Desc.", { env, isTTY: true });
  assert.match(full, /▄█▄/);
  assert.match(full, ESC);
  assert.equal(header("skillkit", "1.0.0", "Desc.", { env: headerEnv({ ascii: true }, env), isTTY: true }), "sonda\x1b[93m/\x1b[0mlab skillkit 1.0.0\n");
  assert.doesNotMatch(header("skillkit", "1.0.0", "Desc.", { env: headerEnv({ color: false }, env), isTTY: true }), ESC);
});

test("the setup log keeps clack's method names and prints continuation lines", () => {
  let out = "";
  const stdout = { isTTY: false, write: (c) => { out += c; return true; } };
  const ui = createUi({ ascii: true }, { command: "skillkit", stdout, stderr: stdout, env: { LANG: "en_US.UTF-8" } });
  for (const m of ["info", "success", "step", "message", "warn", "warning", "error"]) ui.log[m](`${m} text`);
  assert.equal(out, [
    "    info text", "    success text", "    step text", "    message text",
    "    ! warn text", "    ! warning text", "    x error text", "",
  ].join("\n"));
});

test("uninstall --all removes only skills this catalog ships", () => {
  const home = run(INSTALL, ["mind-gym", "--yes"]).home;
  const foreign = join(home, ".claude", "skills", "my-own");
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "SKILL.md"), "---\nname: my-own\ndescription: x\n---\n");
  const r = run(UNINSTALL, ["--all", "--yes"], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(home, ".claude", "skills", "mind-gym")));
  assert.ok(existsSync(join(foreign, "SKILL.md")));
  assert.match(r.stdout, /Removed mind-gym/);
  assert.doesNotMatch(r.stdout, /my-own/);
});

/** A temp HOME with `folder` installed as a copy of catalog mind-gym, frontmatter name `name`. */
function forkHome(folders) {
  const home = mkdtempSync(join(tmpdir(), "skillkit-home-"));
  for (const [folder, name] of folders) {
    const dir = join(home, ".claude", "skills", folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: fork\n---\n`);
  }
  return home;
}

test("uninstall --all goes by folder name: a fork named mind-gym in its frontmatter is kept", () => {
  const home = forkHome([["my-fork", "mind-gym"]]);
  const r = run(UNINSTALL, ["--all", "--yes"], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Removed nothing/);
  assert.ok(existsSync(join(home, ".claude", "skills", "my-fork", "SKILL.md")));
  assert.equal(run(UNINSTALL, ["mind-gym", "--yes"], { home }).status, 2);
});

test("uninstall refuses when two folders claim one name, listing both paths", () => {
  const home = forkHome([["my-fork", "mind-gym"], ["mind-gym", "mind-gym"]]);
  for (const args of [["mind-gym", "--yes"], ["--all", "--yes"]]) {
    const r = run(UNINSTALL, args, { home });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Could not pick mind-gym\n    more than one folder claims the name mind-gym: ~\/\.claude\/skills\/mind-gym,\s+~\/\.claude\/skills\/my-fork/);
  }
  assert.ok(existsSync(join(home, ".claude", "skills", "mind-gym")));
  assert.ok(existsSync(join(home, ".claude", "skills", "my-fork")));
});

test("a foreign folder named explicitly is removed without a teardown", () => {
  const home = forkHome([["my-own", "my-own"]]);
  const r = run(UNINSTALL, ["my-own", "--yes"], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Unwired/);
  assert.ok(!existsSync(join(home, ".claude", "skills", "my-own")));
});

test("a failing teardown keeps the skill folder and exits 1", () => {
  const home = run(INSTALL, ["debug-decisions", "--no-setup"]).home;
  writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
  const r = run(UNINSTALL, ["debug-decisions", "--yes"], { home });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ Could not unwire debug-decisions\n/);
  assert.match(r.stdout, /Summary  0 ok · 0 fixed · 0 warn · 1 failed\n/);
  assert.ok(existsSync(join(home, ".claude", "skills", "debug-decisions", "SKILL.md")));
});

/** A throwaway copy of the package whose catalog is `skills`: [folder, SKILL.md frontmatter name]. */
function fakeRepo(skills) {
  const repo = mkdtempSync(join(tmpdir(), "skillkit-repo-"));
  for (const part of ["bin", "lib"]) cpSync(join(ROOT, part), join(repo, part), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(repo, "package.json"));
  symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"));
  for (const [folder, name] of skills) {
    mkdirSync(join(repo, "skills", folder), { recursive: true });
    writeFileSync(join(repo, "skills", folder, "SKILL.md"), `---\nname: ${JSON.stringify(name)}\ndescription: test\n---\n`);
  }
  return repo;
}

test("a hostile or mismatched frontmatter name installs into the folder name and nowhere else", () => {
  const repo = fakeRepo([["dotdot", ".."], ["dot", "."], ["slash", "a/b"], ["folder-x", "other-name"]]);
  const home = mkdtempSync(join(tmpdir(), "skillkit-home-"));
  mkdirSync(join(home, ".claude", "skills", "keep-me"), { recursive: true });
  writeFileSync(join(home, ".claude", "precious.json"), "{}");
  writeFileSync(join(home, ".claude", "skills", "keep-me", "SKILL.md"), "---\nname: keep-me\n---\n");
  const r = run(join(repo, "bin", "install.mjs"), ["--all", "--yes"], { home });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(join(home, ".claude", "skills")).sort(), ["dot", "dotdot", "folder-x", "keep-me", "slash"]);
  assert.ok(existsSync(join(home, ".claude", "precious.json")));
  assert.match(r.stdout, /Installed folder-x\s+~\/\.claude\/skills\/folder-x\n/);

  const u = run(join(repo, "bin", "uninstall.mjs"), ["--all", "--yes"], { home });
  assert.equal(u.status, 0, u.stderr);
  assert.deepEqual(readdirSync(join(home, ".claude", "skills")), ["keep-me"]);
  assert.ok(existsSync(join(home, ".claude", "precious.json")));
});

test("--setup off a TTY keeps a differing command file with a warn; --yes replaces it after a backup", () => {
  const home = mkdtempSync(join(tmpdir(), "skillkit-home-"));
  const cmd = join(home, ".claude", "commands", "spec-new.md");
  mkdirSync(dirname(cmd), { recursive: true });
  writeFileSync(cmd, "mine");
  const kept = run(INSTALL, ["spec-versioning", "--setup"], { home });
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(readFileSync(cmd, "utf8"), "mine");
  assert.match(kept.stdout, /! kept ~\/\.claude\/commands\/spec-new\.md: differs; pass --yes to replace\n  ! Wired spec-versioning\s+1 warning\n/);
  assert.match(kept.stdout, /Summary  1 ok · 0 fixed · 1 warn · 0 failed\n/);

  const replaced = run(INSTALL, ["spec-versioning", "--setup", "--yes"], { home });
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.notEqual(readFileSync(cmd, "utf8"), "mine");
  const backups = readdirSync(dirname(cmd)).filter((f) => f.startsWith("spec-new.md.bak."));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dirname(cmd), backups[0]), "utf8"), "mine");
});
