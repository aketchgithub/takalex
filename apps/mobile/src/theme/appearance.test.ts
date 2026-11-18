// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPEARANCES, isAppearance, resolveScheme } from "./appearance.ts";
import { darkColors, lightColors, paletteFor } from "./tokens.ts";

describe("resolveScheme", () => {
  it("follows the phone for System, light when the phone says nothing", () => {
    assert.equal(resolveScheme("system", "dark"), "dark");
    assert.equal(resolveScheme("system", "light"), "light");
    assert.equal(resolveScheme("system", null), "light");
    assert.equal(resolveScheme("system", undefined), "light");
  });
  it("uses Light or Dark whatever the phone says", () => {
    assert.equal(resolveScheme("light", "dark"), "light");
    assert.equal(resolveScheme("dark", "light"), "dark");
  });
});

describe("isAppearance", () => {
  it("accepts the three choices only", () => {
    for (const option of APPEARANCES) assert.equal(isAppearance(option.value), true);
    assert.equal(isAppearance("auto"), false);
    assert.equal(isAppearance(undefined), false);
  });
});

describe("palettes", () => {
  it("have the same colour names", () => {
    assert.deepEqual(Object.keys(darkColors).sort(), Object.keys(lightColors).sort());
    assert.equal(paletteFor("dark"), darkColors);
    assert.equal(paletteFor("light"), lightColors);
  });
});
