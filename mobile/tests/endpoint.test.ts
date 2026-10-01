import { test } from "node:test";
import assert from "node:assert/strict";
import { serverEndpoint } from "../src/endpoint.ts";

test("LAN address defaults to port 8000", () => {
  assert.deepEqual(serverEndpoint(" 192.168.1.12 "), {
    http: "http://192.168.1.12:8000",
    ws: "ws://192.168.1.12:8000/ws",
  });
});
test("preserves explicit port", () => {
  assert.equal(serverEndpoint("localhost:9000").ws, "ws://localhost:9000/ws");
});
test("HTTPS uses secure WebSocket without adding a port", () => {
  assert.deepEqual(serverEndpoint("https://example.com/"), {
    http: "https://example.com",
    ws: "wss://example.com/ws",
  });
});
test("explicit HTTP uses its standard port", () => {
  assert.equal(serverEndpoint("http://localhost").http, "http://localhost");
});
test("rejects schemes, credentials, paths and URL query secrets", () => {
  for (const value of [
    "",
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
    "https://example.com#fragment",
  ]) {
    assert.throws(() => serverEndpoint(value));
  }
});
