// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PHONE_HINT, formatPhone, normalisePhone, samePhone } from "./phoneNumber.ts";

const e164 = (input: string) => {
  const result = normalisePhone(input);
  return result.ok ? result.e164 : `error: ${result.message}`;
};

describe("normalisePhone", () => {
  it("accepts the ways Kenyan mobile numbers are typed", () => {
    for (const input of ["0712345678", "0712 345 678", "712345678", "254712345678", "+254712345678", "+254 712 345 678", "(0712) 345-678"]) {
      assert.equal(e164(input), "+254712345678", input);
    }
    assert.equal(e164("0112345678"), "+254112345678");
  });

  it("accepts international numbers with +", () => {
    assert.equal(e164("+44 7700 900123"), "+447700900123");
    assert.equal(e164("+256 772 123456"), "+256772123456");
  });

  it("refuses empty input", () => {
    assert.equal(e164("  "), "error: Enter your phone number.");
  });

  it("refuses wrong lengths, letters and Kenyan landline-style numbers", () => {
    for (const input of ["071234567", "07123456789", "0712abc678", "0212345678", "+2540712345678", "+0712345678", "12345", "+1234567", "+1234567890123456"]) {
      assert.equal(e164(input), `error: ${PHONE_HINT}`, input);
    }
  });
});

describe("formatPhone", () => {
  it("shows Kenyan numbers in groups and others with +", () => {
    assert.equal(formatPhone("254712345678"), "+254 712 345 678");
    assert.equal(formatPhone("+254712345678"), "+254 712 345 678");
    assert.equal(formatPhone("447700900123"), "+447700900123");
  });

  it("returns null when there is no number", () => {
    assert.equal(formatPhone(null), null);
    assert.equal(formatPhone(""), null);
    assert.equal(formatPhone(undefined), null);
  });
});

describe("samePhone", () => {
  it("compares numbers whatever their form", () => {
    assert.equal(samePhone("254712345678", "+254712345678"), true);
    assert.equal(samePhone("254712345678", "+254712345679"), false);
    assert.equal(samePhone(null, "+254712345678"), false);
  });
});
