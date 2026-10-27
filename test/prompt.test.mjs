// test/prompt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { NoValidAnswer } from "@sondalab/ui-kit/term.js";
import { chooseMany, confirm, parseChoices } from "../lib/prompt.mjs";

/** An input stream with `text` written ahead and ended, plus a captured output. */
function io(text) {
  const input = new PassThrough();
  input.end(text);
  let written = "";
  const output = { write: (chunk) => { written += chunk; return true; } };
  return { input, output, written: () => written };
}

const OPTIONS = [["alpha", "first"], ["beta", "second"], ["gamma", ""]];

test("parseChoices reads numbers, commas and all; rejects empty and out of range", () => {
  assert.deepEqual(parseChoices("1 3", 3), [0, 2]);
  assert.deepEqual(parseChoices(" 3,1 ,1 ", 3), [0, 2]);
  assert.deepEqual(parseChoices("ALL", 3), [0, 1, 2]);
  assert.equal(parseChoices("", 3), null);
  assert.equal(parseChoices("4", 3), null);
  assert.equal(parseChoices("0", 3), null);
  assert.equal(parseChoices("1 x", 3), null);
});

test("chooseMany then confirm share one reader: lines piped ahead are answered in turn", async () => {
  const s = io("1 3\ny\n\n");
  assert.deepEqual(await chooseMany("Pick?", OPTIONS, s), [0, 2]);
  assert.equal(await confirm("Go?", s), true);
  assert.equal(await confirm("Again?", s), false);
  assert.match(s.written(), /^\? Pick\? Type numbers or all, then Enter\n  1  alpha  first\n  2  beta   second\n  3  gamma\n> /);
  assert.match(s.written(), /\? Go\? \[y\/N\] \? Again\? \[y\/N\] $/);
});

test("confirm asks again on unrecognised input, then fails after 3 tries", async () => {
  const s = io("maybe\nperhaps\nnope\ny\n");
  await assert.rejects(confirm("Go?", s), (err) => err instanceof NoValidAnswer && /3 tries/.test(err.why));
  assert.equal(s.written().match(/\[y\/N\]/g).length, 3);
});

test("end of input fails at once and never takes the default", async () => {
  await assert.rejects(confirm("Go?", { ...io(""), default: true }), (err) => err instanceof NoValidAnswer && /input ended/.test(err.why));
  await assert.rejects(chooseMany("Pick?", OPTIONS, io("")), NoValidAnswer);
});

test("chooseMany cuts a long hint with an ellipsis, ASCII in ASCII mode", async () => {
  const long = [["x", "word ".repeat(40)]];
  const uni = io("1\n");
  await chooseMany("Pick?", long, uni);
  assert.match(uni.written(), /[a-z]…\n/);
  const asc = io("1\n");
  await chooseMany("Pick?", long, { ...asc, ascii: true });
  assert.match(asc.written(), /[a-z]\.\.\.\n/);
  assert.doesNotMatch(asc.written(), /…/);
  for (const line of asc.written().split("\n")) assert.ok(line.length <= 100, line);
});
