// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMEOUT_MESSAGE } from "../fetchWithTimeout.ts";
import {
  MATERIAL_MESSAGES,
  MATERIAL_NAME_MAX,
  deactivateMaterialConfirmation,
  isMaterialEdited,
  materialNameError,
  materialRolesError,
  materialWriteErrorMessage,
  normaliseMaterialName,
  rolesSummary,
  sortMaterials,
  withRole,
  type AdminMaterial,
} from "./materialModel.ts";

const mat = (code: string, displayName: string, extra: Partial<AdminMaterial> = {}): AdminMaterial => ({
  code,
  displayName,
  isReportable: true,
  isVerifiable: true,
  isRecyclerVisible: true,
  isActive: true,
  sortOrder: 10,
  ...extra,
});

const list = [mat("PET", "PET"), mat("PLASTIC_BAGS", "Plastic bags"), mat("OLD", "Old film", { isActive: false })];
const all = { isReportable: true, isVerifiable: true, isRecyclerVisible: true };

describe("material names", () => {
  it("normalises like the database", () => {
    assert.equal(normaliseMaterialName("  Polystyrene \t (PS) "), "Polystyrene (PS)");
  });

  it("accepts a new, valid name", () => {
    assert.equal(materialNameError("PVC", list), null);
    assert.equal(materialNameError("x".repeat(MATERIAL_NAME_MAX), list), null);
  });

  it("refuses empty, too long and control characters", () => {
    assert.equal(materialNameError("  ", list), "Enter a material name.");
    assert.match(materialNameError("x".repeat(MATERIAL_NAME_MAX + 1), list) ?? "", /at most 60/);
    assert.match(materialNameError("Bad\u0007", list) ?? "", /special characters/);
  });

  it("refuses another material's name ignoring case and spaces, pointing to reactivation when it is inactive", () => {
    assert.match(materialNameError(" plastic   BAGS ", list) ?? "", /"Plastic bags" already exists/);
    assert.match(materialNameError("old film", list) ?? "", /inactive material .* Reactivate it instead/);
    assert.equal(materialNameError("pet", list, "PET"), null);
  });
});

describe("material roles", () => {
  it("accepts sensible combinations", () => {
    assert.equal(materialRolesError(all), null);
    assert.equal(materialRolesError({ isReportable: true, isVerifiable: false, isRecyclerVisible: false }), null);
    assert.equal(materialRolesError({ isReportable: false, isVerifiable: true, isRecyclerVisible: false }), null);
  });

  it("refuses recycler-only, no role, and a verifiable Mixed", () => {
    assert.match(materialRolesError({ isReportable: true, isVerifiable: false, isRecyclerVisible: true }) ?? "", /Recyclers only see sorted/);
    assert.match(materialRolesError({ isReportable: false, isVerifiable: false, isRecyclerVisible: false }) ?? "", /at least/);
    assert.match(materialRolesError({ isReportable: true, isVerifiable: true, isRecyclerVisible: false }, "MIXED") ?? "", /Mixed/);
    assert.equal(materialRolesError({ isReportable: true, isVerifiable: false, isRecyclerVisible: false }, "MIXED"), null);
  });

  it("keeps recyclers tied to managers when toggling", () => {
    assert.deepEqual(withRole(all, "isVerifiable", false), { isReportable: true, isVerifiable: false, isRecyclerVisible: false });
    assert.deepEqual(withRole({ isReportable: true, isVerifiable: false, isRecyclerVisible: false }, "isRecyclerVisible", true), all);
    assert.deepEqual(withRole(all, "isReportable", false), { isReportable: false, isVerifiable: true, isRecyclerVisible: true });
  });

  it("summarises who can use it", () => {
    assert.equal(rolesSummary(all), "Collectors · Managers · Recyclers");
    assert.equal(rolesSummary({ isReportable: true, isVerifiable: false, isRecyclerVisible: false }), "Collectors");
  });
});

describe("isMaterialEdited", () => {
  it("is false when nothing changes after normalising", () => {
    assert.equal(isMaterialEdited(list[1], " Plastic  bags ", all), false);
    assert.equal(isMaterialEdited(list[1], "Plastic bags", { ...all, isRecyclerVisible: false }), true);
    assert.equal(isMaterialEdited(list[1], "Bags", all), true);
  });
});

describe("sortMaterials", () => {
  it("orders by sort order, then code, without changing the input", () => {
    const input = [mat("B", "b", { sortOrder: 20 }), mat("C", "c", { sortOrder: 10 }), mat("A", "a", { sortOrder: 20 })];
    assert.deepEqual(sortMaterials(input).map((m) => m.code), ["C", "A", "B"]);
    assert.deepEqual(input.map((m) => m.code), ["B", "C", "A"]);
  });
});

describe("materialWriteErrorMessage", () => {
  it("maps SQLSTATEs and migration 010's fixed messages", () => {
    assert.equal(materialWriteErrorMessage({ message: "x", code: "42501" }), MATERIAL_MESSAGES.notAdmin);
    assert.equal(materialWriteErrorMessage({ message: "x", code: "23505" }), MATERIAL_MESSAGES.duplicate);
    assert.equal(materialWriteErrorMessage({ message: "used", code: "23503" }), MATERIAL_MESSAGES.used);
    assert.equal(materialWriteErrorMessage({ message: "x", code: "P0002" }), MATERIAL_MESSAGES.notFound);
    assert.equal(materialWriteErrorMessage({ message: "At least one active material must stay reportable by collectors", code: "22023" }), MATERIAL_MESSAGES.lastReportable);
    assert.equal(materialWriteErrorMessage({ message: "At least one active material must stay verifiable by managers", code: "22023" }), MATERIAL_MESSAGES.lastVerifiable);
    assert.equal(materialWriteErrorMessage({ message: "Mixed cannot be deleted", code: "22023" }), MATERIAL_MESSAGES.mixed);
    assert.equal(materialWriteErrorMessage({ message: "This material is already first", code: "22023" }), MATERIAL_MESSAGES.edge);
    assert.equal(materialWriteErrorMessage({ message: "Nothing to change", code: "22023" }), MATERIAL_MESSAGES.invalid);
    assert.equal(materialWriteErrorMessage({ message: "boom", code: "XX000", status: 500 }), MATERIAL_MESSAGES.other);
  });

  it("reports no connection and timeouts", () => {
    assert.equal(materialWriteErrorMessage({ message: "Network request failed", status: 0 }), MATERIAL_MESSAGES.network);
    assert.equal(materialWriteErrorMessage({ message: TIMEOUT_MESSAGE, name: "AbortError" }), MATERIAL_MESSAGES.network);
  });
});

describe("deactivateMaterialConfirmation", () => {
  it("names every effect, including deliveries waiting on phones", () => {
    const text = deactivateMaterialConfirmation("PP");
    assert.match(text, /no longer be able to report PP/);
    assert.match(text, /recyclers' totals/);
    assert.match(text, /waiting to upload/);
    assert.match(text, /reactivate it later/);
  });
});
