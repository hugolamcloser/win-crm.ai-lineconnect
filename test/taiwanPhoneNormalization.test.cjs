const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeTaiwanMobile,
} = require("../dist/utils/taiwanPhone");

test("Taiwan mobile normalizer accepts approved national and E.164 forms", () => {
  const national = normalizeTaiwanMobile("0912345678");
  const e164 = normalizeTaiwanMobile("+886912345678");

  assert.deepEqual(national, {
    canonicalE164: "+886912345678",
    every8dNational: "0912345678",
  });
  assert.deepEqual(e164, national);
});

test("Taiwan mobile normalizer rejects ambiguous, formatted, and invalid forms", () => {
  for (const value of [
    "886912345678",
    "+886-912-345-678",
    "0912 345 678",
    "+12025550123",
    "0812345678",
    "+886812345678",
    "091234567",
    "09123456789",
    "+88691234567",
    "+8869123456789",
    "09abcdefgh",
    "",
  ]) {
    assert.equal(normalizeTaiwanMobile(value), null, value);
  }
});
