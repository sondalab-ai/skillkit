import { join } from "node:path";
import { homedir } from "node:os";
import { rmSync, existsSync, readdirSync, readFileSync } from "node:fs";

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

export default async function teardown(ctx) {
  const removed = removeOwnedCommands(ctx, "sync-skills");
  if (removed.length) ctx.log.info(`sync-skills: removed ${removed.join(", ")}`);
}
