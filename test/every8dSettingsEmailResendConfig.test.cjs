const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseEvery8dSettingsEmailResendApiKey: parse } = require("../dist/config/every8dSettingsEmailResend");

test("only undefined is absent", () => {
  assert.equal(parse(undefined), undefined);
});

test("preserves visible ASCII exactly at both byte boundaries without a prefix", () => {
  const allVisible = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).join("");
  for (const value of ["~", allVisible, allVisible.repeat(3).slice(0, 256)]) {
    assert.ok(parse(value) === value, "credential changed during parsing");
  }
});

function errorFrom(value) {
  try { parse(value); } catch (error) { return error; }
}

const malformed = [
  ["empty", ""], ["space", "a b"], ["leading space", " a"], ["trailing space", "a "],
  ["tab", "a\tb"], ["newline", "a\n"], ["CRLF", "a\r\n"], ["control", "a\x00"],
  ["DEL", "\x7f"], ["non-ASCII", "é"], ["unpaired surrogate", "\ud800"], ["257 bytes", "a".repeat(257)],
  ["null", null], ["number", 42], ["boolean", false], ["object", {}], ["array", []],
  ["boxed string", new String("a")], ["symbol", Symbol("a")],
];

for (const [label, value] of malformed) {
  test("rejects " + label + " with a fixed configuration error", () => {
    const error = errorFrom(value);
    assert.ok(error instanceof Error && error.message === "Invalid Resend email configuration." &&
      !Object.hasOwn(error, "cause"), "expected only a fixed configuration error");
  });
}

test("configuration error representation omits supplied values", () => {
  const canary = "secret-config-canary";
  for (const value of [canary + "\n", { toString: () => { throw Error(canary); } }]) {
    const error = errorFrom(value);
    assert.ok(error instanceof Error && !require("node:util").inspect(error).includes(canary),
      "configuration error exposed input");
  }
});
