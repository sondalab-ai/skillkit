import { readdirSync, statSync, readFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { asciiMode, colorMode, stepLine } from "@sondalab/ui-kit/term.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo's skills/ directory. */
export const SKILLS_DIR = join(__dirname, "..", "skills");

/**
 * Scan a skills directory and return metadata for each valid skill.
 * A valid skill is a subdirectory containing a SKILL.md with parseable
 * frontmatter. Malformed skills are skipped with a warning, never thrown.
 * `warn(label, detail)` reports a skip; the default prints a warn step line on stderr.
 * @returns {{name: string, description: string, dir: string}[]}
 */
export function discoverSkills(skillsDir = SKILLS_DIR, { warn = warnStep } = {}) {
  if (!existsSync(skillsDir)) return [];

  const entries = readdirSync(skillsDir).filter((entry) => {
    const dir = join(skillsDir, entry);
    return statSync(dir).isDirectory() && existsSync(join(dir, "SKILL.md"));
  });

  const skills = [];
  for (const entry of entries) {
    const dir = join(skillsDir, entry);
    try {
      const { data } = matter(readFileSync(join(dir, "SKILL.md"), "utf8"));
      skills.push({
        name: data.name || entry,
        description: (data.description || "").trim(),
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

/**
 * Recursively copy a skill directory to a destination, replacing any existing
 * contents. Creates parent directories as needed.
 */
export function copySkill(srcDir, destDir) {
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
}
