// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOCATION_MESSAGES,
  formatCoordinates,
  hasLocation,
  locationWriteErrorMessage,
  mapsUrl,
  parseCoordinates,
  sameCoordinates,
} from "./siteLocation.ts";

describe("parseCoordinates", () => {
  it("reads latitude and longitude however they are separated", () => {
    for (const input of ["-1.2667, 36.8833", "-1.2667,36.8833", " -1.2667  36.8833 ", "-1.2667; 36.8833", "-1.2667 , 36.8833"]) {
      assert.deepEqual(parseCoordinates(input), { latitude: -1.2667, longitude: 36.8833 }, input);
    }
    assert.deepEqual(parseCoordinates("+1.5, .25"), { latitude: 1.5, longitude: 0.25 });
  });
  it("rounds to 6 decimals like the database", () => {
    assert.deepEqual(parseCoordinates("-1.26669912345, 36.8833301"), { latitude: -1.266699, longitude: 36.88333 });
  });
  it("refuses anything else with a plain message", () => {
    assert.deepEqual(parseCoordinates("  "), { error: "Enter the latitude and longitude." });
    for (const input of ["-1.2667", "-1.2667, 36.88, 5", "1°16'S, 36°53'E", "abc, def", "-1.2.3, 36"]) {
      assert.ok("error" in parseCoordinates(input), input);
    }
    assert.deepEqual(parseCoordinates("91, 36"), { error: "The latitude must be between -90 and 90." });
    assert.deepEqual(parseCoordinates("-1, 181"), { error: "The longitude must be between -180 and 180." });
    assert.deepEqual(parseCoordinates("0, 0.0000001"), { error: "0, 0 is not a real site. Check the numbers." });
  });
});

describe("showing a location", () => {
  it("knows whether a site has one", () => {
    assert.equal(hasLocation({ latitude: -1.2, longitude: 36.8 }), true);
    assert.equal(hasLocation({ latitude: null, longitude: null }), false);
    assert.equal(hasLocation({}), false);
  });
  it("formats, compares and links", () => {
    assert.equal(formatCoordinates({ latitude: -1.266699, longitude: 36.88333 }), "-1.26670, 36.88333");
    assert.equal(sameCoordinates({ latitude: -1.2000001, longitude: 36.8 }, { latitude: -1.2, longitude: 36.8000004 }), true);
    assert.equal(sameCoordinates({ latitude: -1.2, longitude: 36.8 }, { latitude: -1.21, longitude: 36.8 }), false);
    assert.equal(
      mapsUrl({ latitude: -1.2667, longitude: 36.8833 }),
      "https://www.google.com/maps/search/?api=1&query=-1.2667,36.8833",
    );
  });
});

describe("locationWriteErrorMessage", () => {
  it("maps the database's refusals to plain messages", () => {
    assert.equal(locationWriteErrorMessage({ code: "42501", message: "x", status: 403 }), LOCATION_MESSAGES.notAdmin);
    assert.equal(locationWriteErrorMessage({ code: "P0002", message: "x", status: 404 }), LOCATION_MESSAGES.notFound);
    assert.equal(locationWriteErrorMessage({ code: "22023", message: "x", status: 400 }), LOCATION_MESSAGES.invalid);
    assert.equal(locationWriteErrorMessage({ code: "XX000", message: "secret", status: 500 }), LOCATION_MESSAGES.other);
  });
});
