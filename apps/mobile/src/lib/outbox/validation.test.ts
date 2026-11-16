/// <reference types="node" />
// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyError, isStorageDuplicate, PermanentSyncError } from "./errors.ts";
import {
  evidenceStoragePath,
  longSideResize,
  normalizeLocation,
  normalizeReportedWeight,
} from "./validation.ts";

describe("normalizeReportedWeight", () => {
  it("returns two-decimal strings", () => {
    assert.equal(normalizeReportedWeight("12"), "12.00");
    assert.equal(normalizeReportedWeight("12.5"), "12.50");
    assert.equal(normalizeReportedWeight(" 0.25 "), "0.25");
    assert.equal(normalizeReportedWeight("3,75"), "3.75");
    assert.equal(normalizeReportedWeight("007.10"), "7.10");
    assert.equal(normalizeReportedWeight("99999999.99"), "99999999.99");
  });

  it("refuses zero, negatives, too many decimals and junk", () => {
    for (const bad of ["", "0", "0.00", "-1", "1.234", "abc", "1e3", "123456789", ".5", "5."]) {
      assert.equal(normalizeReportedWeight(bad), null, bad);
    }
  });
});

describe("normalizeLocation", () => {
  it("keeps a valid pair and accuracy", () => {
    assert.deepEqual(normalizeLocation({ latitude: -1.28, longitude: 36.82, accuracy: 8 }), {
      deviceLatitude: -1.28,
      deviceLongitude: 36.82,
      deviceAccuracyM: 8,
    });
  });

  it("drops invalid coordinates and accuracy", () => {
    const none = { deviceLatitude: null, deviceLongitude: null, deviceAccuracyM: null };
    assert.deepEqual(normalizeLocation(null), none);
    assert.deepEqual(normalizeLocation({ latitude: 91, longitude: 0, accuracy: 1 }), none);
    assert.deepEqual(normalizeLocation({ latitude: 0, longitude: Number.NaN, accuracy: 1 }), none);
    assert.equal(normalizeLocation({ latitude: 0, longitude: 0, accuracy: -1 }).deviceAccuracyM, null);
    assert.equal(normalizeLocation({ latitude: 0, longitude: 0, accuracy: Infinity }).deviceAccuracyM, null);
  });
});

describe("longSideResize", () => {
  it("resizes only the long side, only when needed", () => {
    assert.deepEqual(longSideResize(4000, 3000, 1280), { width: 1280 });
    assert.deepEqual(longSideResize(3000, 4000, 1280), { height: 1280 });
    assert.equal(longSideResize(1280, 960, 1280), null);
  });
});

describe("evidenceStoragePath", () => {
  it("builds the lowercase {uid}/{client_record_id}/{photo_uuid}.jpg path", () => {
    assert.equal(
      evidenceStoragePath("AAAAAAAA-0000-4000-8000-000000000001", "b-1", "C-2"),
      "aaaaaaaa-0000-4000-8000-000000000001/b-1/c-2.jpg",
    );
  });
});

describe("classifyError", () => {
  it("retryable: network, timeout, 5xx, 429, expired session", () => {
    for (const error of [
      { message: "TypeError: Network request failed", status: 0, code: "" },
      new TypeError("Network request failed"),
      { name: "AbortError", message: "Aborted" },
      { name: "StorageUnknownError", message: "Network request failed" },
      { message: "Bad Gateway", status: 502 },
      { message: "Too Many Requests", status: 429 },
      { message: "JWT expired", status: 401, code: "PGRST303" },
    ]) {
      assert.equal(classifyError(error).kind, "retryable", JSON.stringify(error));
    }
  });

  it("permanent: permission, validation, trigger exceptions, other 4xx", () => {
    for (const error of [
      { message: "new row violates row-level security policy", status: 403, code: "42501" },
      { message: "invalid input syntax for type uuid", status: 400, code: "22P02" },
      { message: "violates foreign key constraint", status: 409, code: "23503" },
      { message: "Material is not reportable", status: 400, code: "P0001" },
      { message: "new row violates row-level security policy", status: 400, statusCode: "403" },
      new PermanentSyncError("The photo is no longer on this device."),
    ]) {
      assert.equal(classifyError(error).kind, "permanent", JSON.stringify(error));
    }
  });

  it("includes the server message in permanent reasons", () => {
    assert.equal(
      classifyError({ message: "Material is not reportable", status: 400, code: "P0001" }).reason,
      "Rejected by the server: Material is not reportable",
    );
  });

  it("recognises storage duplicates in both API shapes", () => {
    assert.ok(isStorageDuplicate({ message: "The resource already exists", status: 409, statusCode: "409" }));
    assert.ok(isStorageDuplicate({ message: "The resource already exists", status: 400, statusCode: "409" }));
    assert.ok(!isStorageDuplicate({ message: "Payload too large", status: 413, statusCode: "413" }));
  });
});
