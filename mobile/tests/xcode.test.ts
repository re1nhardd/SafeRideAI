import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("patched uuid preserves Xcode project ID generation", () => {
  const project = require("xcode").project("fixture.pbxproj");
  project.hash = { project: { objects: {} } };
  const ids = new Set(
    Array.from({ length: 100 }, () => project.generateUuid()),
  );
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id as string, /^[A-F0-9]{24}$/);
});
