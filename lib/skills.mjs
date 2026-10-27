import { readdirSync, statSync, lstatSync, readFileSync, mkdirSync, cpSync, existsSync, rmSync, realpathSync, readlinkSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { TermError, asciiMode, colorMode, stepLine } from "@sondalab/ui-kit/term.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo's skills/ directory. */
export const SKILLS_DIR = join(__dirname, "..", "skills");

/**
 * Scan a skills directory and return metadata for each valid skill.
 * A valid skill is a subdirectory containing a SKILL.md with parseable
 * frontmatter. Malformed skills are skipped with a warning, never thrown.
 * `warn(label, detail)` reports a skip; the default prints a warn step line on stderr.
 * `name` is always the folder name, the one identity that selects a path;
 * `declaredName` is the frontmatter `name`, kept only to spot conflicting claims.
 * @returns {{name: string, declaredName: string, description: string, dir: string}[]}
 */
export function discoverSkills(skillsDir = SKILLS_DIR, { warn = warnStep } = {}) {
  if (!existsSync(skillsDir)) return [];

  const entries = readdirSync(skillsDir).filter((entry) => {
    const dir = join(skillsDir, entry);
    let stat;
    try {
      stat = statSync(dir);
    } catch (err) {
      warn(`Skipped ${entry}`, err.code === "ENOENT" ? "broken symbolic link" : firstLine(err.message));
      return false;
    }
    return stat.isDirectory() && existsSync(join(dir, "SKILL.md"));
  });

  const skills = [];
  for (const entry of entries) {
    const dir = join(skillsDir, entry);
    try {
      const { data } = matter(readFileSync(join(dir, "SKILL.md"), "utf8"));
      skills.push({
        name: entry,
        declaredName: data.name == null ? entry : String(data.name),
        description: String(data.description ?? "").trim(),
        dir,
      });
    } catch (err) {
      warn(`Skipped ${entry}`, `invalid SKILL.md: ${firstLine(err.message)}`);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** The first line of a parser message; YAML errors carry a multi-line excerpt. */
const firstLine = (text) => text.split("\n")[0].trim().replace(/:$/, "");

/** The default skip report: a warn step line on stderr, colour and ASCII from the env. */
function warnStep(label, detail) {
  const ascii = asciiMode();
  const mode = colorMode({ isTTY: process.stderr.isTTY === true });
  process.stderr.write(stepLine("warn", label, detail, { ascii, mode }) + "\n");
}

/** `path` with the home directory written as `~`. */
const tilde = (path) => (path.startsWith(homedir() + "/") ? "~" + path.slice(homedir().length) : path);

/**
 * Throw unless `dir` is a direct child of `root` with a real name (not empty,
 * `.` or `..`), so no skill name can make a copy or delete reach outside it.
 */
export function assertSkillDir(dir, root) {
  const full = resolve(dir);
  const name = basename(full);
  if (dirname(full) !== resolve(root) || !name || name === "." || name === "..") {
    throw new Error(`refusing skill path ${dir}: not a folder directly inside ${root}`);
  }
}

/** Throw a TermError naming the link when `dir` is a symbolic link; never follow it. */
export function refuseLink(dir) {
  let link = false;
  try {
    link = lstatSync(dir).isSymbolicLink();
  } catch {
    return;
  }
  if (link) {
    throw new TermError(
      `Could not install ${basename(dir)}`,
      `${tilde(dir)} is a symbolic link to ${tilde(readlinkSync(dir))}; skillkit never writes through a link`,
      `rm ${tilde(dir)}`,
    );
  }
}

/**
 * Replace `destDir` (a direct child of `root`, not a link) with a copy of
 * `srcDir`: the old folder is removed first, so files the catalog no longer
 * ships do not survive. A symlinked source is resolved first; links inside it
 * are copied as links, verbatim.
 */
export function copySkill(srcDir, destDir, root) {
  assertSkillDir(destDir, root);
  refuseLink(destDir);
  mkdirSync(root, { recursive: true });
  rmSync(destDir, { recursive: true, force: true });
  cpSync(realpathSync(srcDir), destDir, { recursive: true, verbatimSymlinks: true });
}

/** Delete an installed skill folder (a link is removed, not followed), guarded like copySkill(). */
export function removeSkill(dir, root) {
  assertSkillDir(dir, root);
  rmSync(dir, { recursive: true, force: true });
}
