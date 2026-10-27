import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  GLYPHS,
  LAYOUT,
  TermError,
  asciiMode,
  colorMode,
  errorBlock,
  header,
  heading,
  kvLine,
  lockup,
  needsPrompt,
  nextLine,
  paint,
  stepLine,
  summary,
  wrap,
} from "@sondalab/ui-kit/term.js";

/** The package version, shown by the header and --version. */
export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** Shared flags of both binaries: [name, parseArgs config, help text]. */
const FLAGS = [
  ["all", { type: "boolean" }, "Every catalog skill, no selection prompt"],
  ["yes", { type: "boolean", short: "y" }, "Confirm overwriting or removing skill folders"],
  ["ascii", { type: "boolean" }, "ASCII glyphs only"],
  ["color", { type: "boolean" }, "Colour even when not a terminal"],
  ["no-color", { type: "boolean" }, "No colour"],
  ["debug", { type: "boolean" }, "Show the stack trace of an error"],
  ["version", { type: "boolean", short: "v" }, "Print the version"],
  ["help", { type: "boolean", short: "h" }, "Print this help"],
];

/** The installer's extra flags: whether to run setup (hooks, commands, Bash permissions). */
export const SETUP_FLAGS = [
  ["setup", { type: "boolean" }, "Run setup: hooks, commands, Bash permissions"],
  ["no-setup", { type: "boolean" }, "Install files only, run no setup"],
];

/** A command-line mistake: the fix is the --help line, never --debug. */
export class UsageError extends TermError {
  /** `suggestion` set renders the two-line "Did you mean" shape instead of the block. */
  constructor(what, why, fix, suggestion = "") {
    super(what, why, fix);
    this.name = "UsageError";
    this.suggestion = suggestion;
  }
}

/** Levenshtein distance, for the "Did you mean" suggestion. */
function distance(a, b) {
  const row = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The nearest of `candidates` to `input` within 2 edits, or "". */
export function nearest(input, candidates) {
  let best = "";
  let bestD = 3;
  for (const c of candidates) {
    const d = distance(input, c);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/**
 * Parse argv into { names, all, yes, setup, ascii, color, debug, version, help }.
 * `setup`, `ascii` and `color` stay undefined when no flag was given, so the
 * prompt or the environment decides. `extra` adds flags (SETUP_FLAGS).
 * An unknown flag, a flag with its negation, or names with --all throw UsageError.
 */
export function parseCli(argv, command, extra = []) {
  const flags = [...FLAGS, ...extra];
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: Object.fromEntries(flags.map(([name, cfg]) => [name, cfg])),
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    const flag = /'([^']+)'/.exec(err.message)?.[1] ?? argv.find((a) => a.startsWith("-")) ?? "";
    const guess = nearest(flag, flags.map(([name]) => `--${name}`));
    if (guess) throw new UsageError(`Unknown flag ${flag}`, "", "", guess);
    throw new UsageError(`Unknown flag ${flag}`, `${command} has no ${flag} flag`, `${command} --help`);
  }
  const v = parsed.values;
  for (const name of ["color", "setup"]) {
    if (v[name] && v[`no-${name}`]) {
      throw new UsageError(`Conflicting flags --${name} and --no-${name}`, "pass one of them", `${command} --help`);
    }
  }
  if (v.all && parsed.positionals.length) {
    throw new UsageError("Could not combine skill names with --all", "--all already picks every catalog skill", `${command} --all`);
  }
  return {
    names: parsed.positionals,
    all: v.all === true,
    yes: v.yes === true,
    setup: v.setup ? true : v["no-setup"] ? false : undefined,
    ascii: v.ascii ? true : undefined,
    color: v.color ? true : v["no-color"] ? false : undefined,
    debug: v.debug === true,
    version: v.version === true,
    help: v.help === true,
  };
}

/** Flags read without parseArgs, for reporting an argv that failed to parse. */
export function looseFlags(argv) {
  return {
    debug: argv.includes("--debug"),
    ascii: argv.includes("--ascii") || undefined,
    color: argv.includes("--no-color") ? false : argv.includes("--color") ? true : undefined,
  };
}

/** `args` as a shell line: words with shell metacharacters are single-quoted. */
export function shellLine(args) {
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`)).join(" ");
}

/** `path` with the home directory written as `~`. */
export function tildify(path) {
  const home = homedir();
  return path === home || path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

/** `text` with every home-directory path in it written from `~`, for why lines. */
export function tildifyText(text) {
  const home = homedir();
  return home.length > 1 ? text.replace(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=/|\\b|$)", "g"), "~") : text;
}

/**
 * The environment header() should read. term.js's header() takes no colour or
 * ASCII option, so --no-color, --color and --ascii are passed through the env.
 */
export function headerEnv(flags, env = process.env) {
  const out = { ...env };
  if (flags.ascii) out.SONDALAB_ASCII = "1";
  if (flags.color === false) out.NO_COLOR = "1";
  if (flags.color === true) {
    out.NO_COLOR = "";
    out.FORCE_COLOR = "1";
  }
  return out;
}

/**
 * The terminal UI of one run: colour and ASCII decided once from the flags and
 * the env, results on stdout, warnings, prompts and errors on stderr. `io`
 * replaces the streams and env in tests.
 */
export function createUi(flags, { command, extra = [], stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const ascii = asciiMode({ override: flags.ascii, env });
  const mode = colorMode({ flag: flags.color, env, isTTY: stdout.isTTY === true });
  const errMode = colorMode({ flag: flags.color, env, isTTY: stderr.isTTY === true });
  const out = (text) => stdout.write(text + "\n");
  const cont = (text) => " ".repeat(LAYOUT.indent + 2) + text;
  const glyphed = (name) => (msg) =>
    out(cont(`${paint(ascii ? GLYPHS[name].ascii : GLYPHS[name].unicode, GLYPHS[name].role, mode)} ${msg}`));
  const plain = (msg) => out(wrap(String(msg), { env, indent: LAYOUT.indent + 2 }));

  return {
    ascii,
    mode,
    errMode,
    env,
    /** One step line on stdout. */
    step: (glyph, label, detail = "") => out(stepLine(glyph, label, detail, { ascii, mode })),
    /** A warn step line on stderr. */
    warn: (label, detail = "") => stderr.write(stepLine("warn", label, detail, { ascii, mode: errMode }) + "\n"),
    /** The full header, or the compact one for a one-shot run; nothing off a TTY. */
    header: (description, { compact = false } = {}) =>
      stdout.write(header(command, VERSION, description, { compact, env: headerEnv(flags, env), isTTY: stdout.isTTY === true })),
    lockup: () => out(lockup(command, VERSION, mode)),
    /** `Summary  …` after one blank line, then `Next:` when given. */
    summary: (counts, next = "") => {
      out("\n".repeat(LAYOUT.blankBeforeSummary) + summary(counts.ok, counts.fixed, counts.warn, counts.failed, { mode, ascii }));
      if (next) out(nextLine(next, { mode }));
    },
    help: (usage, description) => {
      stdout.write(header(command, VERSION, description, { env: headerEnv(flags, env), isTTY: stdout.isTTY === true }));
      out(heading("Usage", { mode }));
      out(cont(usage));
      out("");
      out(heading("Flags", { mode }));
      for (const [name, cfg, text] of [...FLAGS, ...extra]) out(kvLine(cfg.short ? `-${cfg.short}, --${name}` : `--${name}`, text));
    },
    /**
     * The clack-shaped `log` handed to a skill's setup()/teardown(): every
     * method a skill may call prints a continuation line under the step.
     */
    log: { info: plain, success: plain, step: plain, message: plain, warn: glyphed("warn"), warning: glyphed("warn"), error: glyphed("failed") },
    /**
     * Print `err` on stderr: a UsageError or TermError as its own block, any
     * other error as `what` with `Try: <rerun> --debug`. The stack only with --debug.
     */
    report: (err, { what, rerun }) => {
      const opts = { ascii, mode: errMode, env };
      let text;
      if (err instanceof UsageError && err.suggestion) {
        const ask = `${paint("Did you mean", "prompt", errMode)} ${err.suggestion}${paint("?", "prompt", errMode)}`;
        text = errorBlock(err.what, "", "", opts) + "\n" + cont(ask);
      } else if (err instanceof TermError) {
        text = err.block(opts);
      } else {
        const why = tildifyText(err instanceof Error ? err.message : String(err));
        text = errorBlock(what, why, `${shellLine([command, ...rerun.filter((a) => a !== "--debug")])} --debug`, opts);
      }
      stderr.write(text + "\n");
      if (flags.debug && err instanceof Error && err.stack) stderr.write("\n" + err.stack + "\n");
    },
  };
}

/**
 * Run one binary: parse `argv`, build the UI, await `main(flags, ui, argv)` and
 * resolve to the exit code. A usage mistake exits 2, any other failure 1,
 * each reported as an error block; `what` names an unexpected failure.
 */
export async function runCli(argv, { command, what, extra = [] }, main) {
  let flags;
  try {
    flags = parseCli(argv, command, extra);
  } catch (err) {
    createUi(looseFlags(argv), { command }).report(err, { what, rerun: argv });
    return 2;
  }
  const ui = createUi(flags, { command, extra });
  try {
    const code = await main(flags, ui, argv);
    return typeof code === "number" ? code : 0;
  } catch (err) {
    ui.report(err, { what, rerun: argv });
    return err instanceof UsageError ? 2 : 1;
  }
}

/**
 * The skills to act on: the named ones, the `allOf` subset with --all, else
 * the numbered prompt, where `all` also means that subset. Names match
 * `keyOf(skill)`; `labelOf` gives each prompt row. An unknown name throws
 * UsageError; off a TTY with neither, MissingFlag.
 */
export async function pickSkills(skills, flags, {
  command, question, argv, ui, choose,
  keyOf = (s) => s.name, allOf = (list) => list, labelOf = (s) => [keyOf(s), s.description],
}) {
  if (flags.all) return allOf(skills);
  if (flags.names.length) {
    const byKey = new Map(skills.map((s) => [keyOf(s), s]));
    return [...new Set(flags.names)].map((name) => {
      const skill = byKey.get(name);
      if (skill) return skill;
      const guess = nearest(name, byKey.keys());
      if (guess) throw new UsageError(`Unknown skill ${name}`, "", "", guess);
      throw new UsageError(`Unknown skill ${name}`, `known skills: ${[...byKey.keys()].join(", ")}`, `${command} --help`);
    });
  }
  needsPrompt("--all", { given: false, what: "Could not choose skills", command: shellLine([command, ...argv]) });
  const all = new Set(allOf(skills));
  const picked = await choose(question, skills.map(labelOf), {
    mode: ui.errMode, ascii: ui.ascii, env: ui.env, allIndexes: skills.flatMap((s, i) => (all.has(s) ? [i] : [])),
  });
  return picked.map((i) => skills[i]);
}
