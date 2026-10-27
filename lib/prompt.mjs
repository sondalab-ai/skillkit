import { createInterface } from "node:readline";
import {
  GLYPHS,
  LAYOUT,
  ROBUSTNESS,
  NoValidAnswer,
  paint,
  parseYesNo,
  width,
} from "@sondalab/ui-kit/term.js";

// One line reader per input stream, shared by every prompt. term.js keeps its
// own private reader, so mixing its confirm() with a second reader here would
// split piped-ahead lines between the two; every prompt goes through this one.
const readers = new WeakMap();

/** The shared reader for `input`: queued lines, end state and a waiter. */
function readerFor(input) {
  let r = readers.get(input);
  if (r) return r;
  r = { rl: null, lines: [], ended: input.readableEnded === true, wake: null };
  if (!r.ended) {
    r.rl = createInterface({ input, terminal: false });
    r.rl.on("line", (l) => { r.lines.push(l); r.wake?.(); });
    r.rl.on("close", () => { r.ended = true; r.wake?.(); });
  }
  readers.set(input, r);
  return r;
}

/** The next line of `input`, or null at end of input; the stream is paused between prompts. */
async function readLine(input) {
  const r = readerFor(input);
  if (!r.lines.length && !r.ended) {
    r.rl.resume();
    while (!r.lines.length && !r.ended) await new Promise((res) => { r.wake = res; });
    r.wake = null;
    if (!r.ended) r.rl.pause();
  }
  return r.lines.length ? r.lines.shift() : null;
}

/**
 * Write `prompt`, read a line, and resolve to the first non-null `parse` result.
 * Up to ROBUSTNESS.promptRetries tries; end of input rejects at once and never
 * takes a default. Mirrors term.js's private ask().
 */
async function ask(question, prompt, parse, input, output) {
  const tries = ROBUSTNESS.promptRetries;
  for (let i = 0; i < tries; i++) {
    output.write(prompt);
    const line = await readLine(input);
    if (line === null) {
      output.write("\n");
      throw new NoValidAnswer(question, "input ended before an answer");
    }
    const got = parse(line);
    if (got !== null) return got;
  }
  throw new NoValidAnswer(question, `no recognised answer in ${tries} tries`);
}

const questionGlyph = (mode) => paint(GLYPHS.question.unicode, GLYPHS.question.role, mode);

/**
 * `? <question> [y/N] `, the same bytes as term.js confirm(), on the shared reader.
 * Resolves true or false; rejects with NoValidAnswer after the retry cap or at end of input.
 */
export function confirm(question, { default: dflt = false, input = process.stdin, output = process.stderr, mode = "none" } = {}) {
  const prompt = `${questionGlyph(mode)} ${question} ${dflt ? "[Y/n]" : "[y/N]"} `;
  return ask(question, prompt, (a) => parseYesNo(a, dflt), input, output);
}

/**
 * A multi-pick answer: 0-based indexes in list order, or null when not recognised.
 * Accepts `all`, or 1-based numbers separated by spaces or commas; an empty
 * answer, a number out of range or any other word is not recognised.
 */
export function parseChoices(answer, count) {
  const text = answer.trim().toLowerCase();
  if (text === "all") return [...Array(count).keys()];
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^[0-9]+$/.test(p))) return null;
  const picked = new Set(parts.map(Number));
  if ([...picked].some((n) => n < 1 || n > count)) return null;
  return [...picked].sort((a, b) => a - b).map((n) => n - 1);
}

/**
 * The numbered list of the spec's accessible mode, answered with several numbers.
 * `options` are [label, hint] pairs; the hint is dim and cut at width() (terminal width, capped at 100).
 * Resolves to the picked 0-based indexes; no default, retry cap as confirm().
 */
export function chooseMany(question, options, { input = process.stdin, output = process.stderr, mode = "none", ascii = false } = {}) {
  if (!options.length) throw new RangeError("chooseMany() needs at least one option");
  const w = String(options.length).length;
  const labelW = Math.max(...options.map(([label]) => label.length));
  const rows = options.map(([label, hint], i) => {
    const head = `${" ".repeat(LAYOUT.indent)}${String(i + 1).padStart(w)}  ${label.padEnd(labelW)}`;
    const room = width() - head.length - 2;
    const ell = ascii ? "..." : "…";
    const cut = hint && room > ell.length ? (hint.length > room ? hint.slice(0, room - ell.length).trimEnd() + ell : hint) : "";
    return (cut ? `${head}  ${paint(cut, "dim", mode)}` : head).trimEnd() + "\n";
  }).join("");
  output.write(`${questionGlyph(mode)} ${question} Type numbers or all, then Enter\n${rows}`);
  return ask(question, "> ", (a) => parseChoices(a, options.length), input, output);
}
