import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorldIdLevel, worldIdErrorMessage } from "../src/lib/worldid-level";

test("World ID level defaults to device so non-Orb users are accepted", () => {
  assert.equal(parseWorldIdLevel(undefined), "device");
  assert.equal(parseWorldIdLevel(""), "device");
  assert.equal(parseWorldIdLevel("bogus"), "device");
  assert.equal(parseWorldIdLevel(" ORB "), "orb");
  assert.equal(parseWorldIdLevel("document"), "document");
});

test("credential errors name the required level", () => {
  assert.match(worldIdErrorMessage("credential_unavailable", "orb"), /Orb-verified/);
  assert.match(worldIdErrorMessage("credential_unavailable", "device"), /any verified World ID/);
  assert.equal(worldIdErrorMessage("weird_code", "device"), "World ID error: weird_code");
});
