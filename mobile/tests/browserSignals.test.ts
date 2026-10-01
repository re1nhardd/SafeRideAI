import test from "node:test";
import assert from "node:assert/strict";
import {
  newSignalState,
  updateSignals,
  type Point,
} from "../src/browserSignals.ts";
function face(closed = false, yawn = false, away = false): Point[] {
  const p = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [ids, left] of [
    [[33, 160, 158, 133, 153, 144], 0.3],
    [[362, 385, 387, 263, 373, 380], 0.6],
  ] as [number[], number][]) {
    const h = closed ? 0.003 : 0.025;
    const xy = [
      [left, 0.4],
      [left + 0.025, 0.4 - h],
      [left + 0.075, 0.4 - h],
      [left + 0.1, 0.4],
      [left + 0.075, 0.4 + h],
      [left + 0.025, 0.4 + h],
    ];
    ids.forEach((id, i) => (p[id] = { x: xy[i][0], y: xy[i][1] }));
  }
  p[1] = { x: away ? 0.7 : 0.5, y: 0.55 };
  p[78] = { x: 0.4, y: 0.65 };
  p[308] = { x: 0.6, y: 0.65 };
  p[13] = { x: 0.5, y: 0.65 };
  p[14] = { x: 0.5, y: yawn ? 0.8 : 0.67 };
  return p;
}
function calibrated() {
  const s = newSignalState();
  for (let t = 100; t <= 5100; t += 200)
    updateSignals(s, face(), false, t, 640, 480);
  assert.equal(s.calibrated, true);
  return s;
}
const read = (
  s: ReturnType<typeof newSignalState>,
  p: Point[],
  time: number,
  phone = false,
) => updateSignals(s, p, phone, time, 640, 480);
test("five seconds of visible face calibrates; missing face resets incomplete baseline", () => {
  const s = newSignalState();
  read(s, face(), 100);
  read(s, face(), 500);
  read(s, [], 600);
  assert.equal(s.calibrationMs, 0);
  assert.equal(s.ears.length, 0);
  const ready = calibrated();
  assert.ok(ready.earThreshold >= 0.12 && ready.earThreshold <= 0.3);
  assert.equal(read(ready, face(), 5300).attention, 100);
});
test("brief blink stays clear; sustained eye closure warns then becomes drowsy", () => {
  const s = calibrated();
  assert.equal(read(s, face(true), 5300).alert, "NONE");
  assert.equal(read(s, face(true), 5500).alert, "NONE");
  read(s, face(), 5700);
  read(s, face(true), 5900);
  let r;
  for (let t = 6100; t <= 8100; t += 200) {
    r = read(s, face(true), t);
    if (t === 6700) assert.equal(r.alert, "WARNING");
  }
  assert.equal(r!.alert, "DROWSY");
  assert.ok(r!.attention < 100);
});
test("missing face and long frame gaps cannot continue a stale closure", () => {
  const s = calibrated();
  read(s, face(true), 5300);
  read(s, face(true), 6300);
  assert.equal(read(s, [], 6400).face_detected, false);
  assert.equal(read(s, face(true), 6500).alert, "NONE");
  assert.equal(read(s, face(true), 10000).alert, "NONE");
});
test("yawning and looking away require persistence", () => {
  const s = calibrated();
  assert.equal(read(s, face(false, true, true), 5300).yawning, false);
  let r;
  for (let t = 5500; t <= 6900; t += 200)
    r = read(s, face(false, true, true), t);
  assert.equal(r!.yawning, true);
  assert.equal(r!.looking_away, true);
  assert.equal(r!.alert, "SLEEPY");
});
test("phone presence expires and yields to a more severe drowsiness alert", () => {
  const s = calibrated();
  assert.equal(read(s, face(), 5300, true).alert, "LOW_ATTENTION");
  assert.equal(read(s, face(), 6100).phone_detected, true);
  assert.equal(read(s, face(), 6500).phone_detected, false);
  let r;
  for (let t = 6700; t <= 8900; t += 200) r = read(s, face(true), t, true);
  assert.equal(r!.alert, "DROWSY");
  assert.ok(r!.attention >= 0 && r!.attention <= 100);
});
