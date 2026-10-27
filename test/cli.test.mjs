// test/cli.test.mjs
// Runs the real binaries with stdin piped (never a TTY) and HOME in a temp dir,
// so nothing touches the real ~/.claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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

test("non-TTY --all without --yes names --yes and writes nothing", () => {
  const r = run(INSTALL, ["--all"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--yes was not passed\n    Try: skillkit --all --yes\n$/);
  assert.ok(!existsSync(join(r.home, ".claude", "skills")));
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
