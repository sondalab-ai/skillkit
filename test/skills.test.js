import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync, readlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { discoverSkills, copySkill, removeSkill, SKILLS_DIR } from "../lib/skills.mjs";
import { renderTable, injectTable } from "../scripts/gen-readme.mjs";

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "skillkit-test-"));
}

function writeSkill(root, name, frontmatter, body = "body") {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `${frontmatter}\n\n${body}`);
  return dir;
}

test("discoverSkills returns metadata for valid skills, sorted by name", () => {
  const root = tmpRoot();
  writeSkill(root, "beta", "---\nname: beta\ndescription: B desc\n---");
  writeSkill(root, "alpha", "---\nname: alpha\ndescription: A desc\n---");

  const skills = discoverSkills(root);
  assert.equal(skills.length, 2);
  assert.deepEqual(skills.map((s) => s.name), ["alpha", "beta"]);
  assert.equal(skills[0].description, "A desc");
  rmSync(root, { recursive: true, force: true });
});

test("discoverSkills falls back to dir name when frontmatter name is missing", () => {
  const root = tmpRoot();
  writeSkill(root, "no-name", "---\ndescription: only desc\n---");
  const skills = discoverSkills(root);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "no-name");
  assert.equal(skills[0].description, "only desc");
  rmSync(root, { recursive: true, force: true });
});

test("discoverSkills skips malformed frontmatter without throwing", () => {
  const root = tmpRoot();
  writeSkill(root, "good", "---\nname: good\ndescription: ok\n---");
  writeSkill(root, "bad", "---\nname: [unterminated\n---");
  const warned = [];
  const skills = discoverSkills(root, { warn: (label, detail) => warned.push([label, detail]) });
  assert.deepEqual(skills.map((s) => s.name), ["good"]);
  assert.equal(warned.length, 1);
  assert.equal(warned[0][0], "Skipped bad");
  assert.match(warned[0][1], /^invalid SKILL\.md: /);
  assert.doesNotMatch(warned[0][1], /\n/);
  rmSync(root, { recursive: true, force: true });
});

test("discoverSkills returns [] for missing or empty dir", () => {
  assert.deepEqual(discoverSkills(join(tmpdir(), "does-not-exist-xyz")), []);
  const empty = tmpRoot();
  assert.deepEqual(discoverSkills(empty), []);
  rmSync(empty, { recursive: true, force: true });
});

test("copySkill copies nested files recursively and overwrites", () => {
  const root = tmpRoot();
  const src = join(root, "src");
  mkdirSync(join(src, "references"), { recursive: true });
  writeFileSync(join(src, "SKILL.md"), "main");
  writeFileSync(join(src, "references", "extra.md"), "extra");

  const dest = join(root, "dest", "my-skill");
  copySkill(src, dest, join(root, "dest"));
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "main");
  assert.equal(readFileSync(join(dest, "references", "extra.md"), "utf8"), "extra");

  writeFileSync(join(src, "SKILL.md"), "updated");
  copySkill(src, dest, join(root, "dest"));
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "updated");
  assert.ok(existsSync(join(dest, "references", "extra.md")));
  rmSync(root, { recursive: true, force: true });
});

test("renderTable renders rows and escapes pipes", () => {
  const table = renderTable([{ name: "x", description: "a | b" }]);
  assert.match(table, /\| `x` \| a \\\| b \|/);
});

test("renderTable shows placeholder for empty catalog", () => {
  assert.match(renderTable([]), /No skills yet/);
});

test("injectTable replaces only between markers, keeping surrounding text", () => {
  const readme = "Top\n<!-- SKILLS:START -->\nOLD\n<!-- SKILLS:END -->\nBottom";
  const out = injectTable(readme, "NEW");
  assert.match(out, /^Top/);
  assert.match(out, /Bottom$/);
  assert.match(out, /NEW/);
  assert.doesNotMatch(out, /OLD/);
});

test("injectTable throws when markers are missing", () => {
  assert.throws(() => injectTable("no markers here", "X"), /markers/);
});

test("discoverSkills skips a dangling symlink with a warning", () => {
  const root = tmpRoot();
  writeSkill(root, "good", "---\nname: good\ndescription: ok\n---");
  symlinkSync(join(root, "nowhere"), join(root, "dangling"));
  const warned = [];
  const skills = discoverSkills(root, { warn: (label, detail) => warned.push([label, detail]) });
  assert.deepEqual(skills.map((s) => s.name), ["good"]);
  assert.deepEqual(warned, [["Skipped dangling", "broken symbolic link"]]);
  rmSync(root, { recursive: true, force: true });
});

test("copySkill removes files the source no longer has", () => {
  const root = tmpRoot();
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "SKILL.md"), "main");
  const dest = join(root, "dest");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "stale.mjs"), "old");
  copySkill(src, dest, root);
  assert.ok(!existsSync(join(dest, "stale.mjs")));
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "main");
  rmSync(root, { recursive: true, force: true });
});

test("every catalog skill's frontmatter name equals its folder name", () => {
  for (const skill of discoverSkills(SKILLS_DIR)) assert.equal(skill.declaredName, basename(skill.dir), skill.dir);
});

test("discoverSkills names a skill by its folder, whatever the frontmatter says", () => {
  const root = tmpRoot();
  writeSkill(root, "folder-a", "---\nname: ..\ndescription: d\n---");
  writeSkill(root, "folder-b", "---\nname: 42\ndescription: d\n---");
  writeSkill(root, "folder-c", "---\nname: a/b\ndescription: d\n---");
  const skills = discoverSkills(root);
  assert.deepEqual(skills.map((s) => s.name), ["folder-a", "folder-b", "folder-c"]);
  assert.deepEqual(skills.map((s) => s.declaredName), ["..", "42", "a/b"]);
  rmSync(root, { recursive: true, force: true });
});

test("copySkill and removeSkill refuse any path that is not a direct, named child of root", () => {
  const root = tmpRoot();
  const target = join(root, "skills");
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "SKILL.md"), "x");
  writeFileSync(join(root, "precious"), "keep");
  for (const bad of [".", "..", "", "a/b", "../skills2"]) {
    assert.throws(() => copySkill(src, join(target, bad), target), /refusing skill path/, bad);
    assert.throws(() => removeSkill(join(target, bad), target), /refusing skill path/, bad);
  }
  assert.equal(readFileSync(join(root, "precious"), "utf8"), "keep");
  rmSync(root, { recursive: true, force: true });
});

test("copySkill refuses a symlinked destination and copies a symlinked source's content", () => {
  const root = tmpRoot();
  const target = join(root, "skills");
  const real = join(root, "real");
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, "SKILL.md"), "real");
  symlinkSync("SKILL.md", join(real, "alias.md"));
  const linkedSrc = join(root, "linked");
  symlinkSync(real, linkedSrc);
  copySkill(linkedSrc, join(target, "a"), target);
  assert.equal(readFileSync(join(target, "a", "SKILL.md"), "utf8"), "real");
  assert.equal(readlinkSync(join(target, "a", "alias.md")), "SKILL.md");
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(target, "b"));
  assert.throws(() => copySkill(real, join(target, "b"), target), /symbolic link/);
  assert.deepEqual(readdirSync(elsewhere), []);
  rmSync(root, { recursive: true, force: true });
});
