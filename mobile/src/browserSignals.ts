/** Pure time-based signal logic shared by browser inference and regression tests. */
export interface Point {
  x: number;
  y: number;
  z?: number;
}
export interface SignalState {
  last: number;
  calibrationMs: number;
  ears: number[];
  mouths: number[];
  earThreshold: number;
  mouthThreshold: number;
  calibrated: boolean;
  closedSince: number | null;
  yawnSince: number | null;
  awaySince: number | null;
  phoneUntil: number;
  score: number;
  eyeWindow: { time: number; closed: boolean }[];
}
export function newSignalState(): SignalState {
  return {
    last: 0,
    calibrationMs: 0,
    ears: [],
    mouths: [],
    earThreshold: 0.21,
    mouthThreshold: 0.35,
    calibrated: false,
    closedSince: null,
    yawnSince: null,
    awaySince: null,
    phoneUntil: 0,
    score: 100,
    eyeWindow: [],
  };
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function updateSignals(
  s: SignalState,
  points: Point[],
  phone: boolean,
  now: number,
  width: number,
  height: number,
) {
  const dt = s.last ? Math.min(now - s.last, 500) : 0;
  const gap = s.last > 0 && now - s.last > 1500;
  s.last = now;
  if (phone) s.phoneUntil = now + 1000;
  const phoneDetected = now < s.phoneUntil;
  const empty = {
    attention: 0,
    alert: "NONE",
    yawning: false,
    face_detected: false,
    phone_detected: phoneDetected,
    looking_away: false,
    calibrated: s.calibrated,
    calibrationProgress: Math.min(1, s.calibrationMs / 5000),
  };
  if (points.length < 468) {
    s.closedSince = s.yawnSince = s.awaySince = null;
    s.eyeWindow = [];
    if (!s.calibrated) {
      s.calibrationMs = 0;
      s.ears = [];
      s.mouths = [];
    }
    return { ...empty, calibrationProgress: s.calibrated ? 1 : 0 };
  }
  if (gap) {
    s.closedSince = s.yawnSince = s.awaySince = null;
    s.eyeWindow = [];
  }
  const distance = (a: number, b: number) =>
    Math.hypot(
      (points[a].x - points[b].x) * width,
      (points[a].y - points[b].y) * height,
    );
  const eye = (i: number[]) =>
    (distance(i[1], i[5]) + distance(i[2], i[4])) /
    (2 * Math.max(0.001, distance(i[0], i[3])));
  const ear =
    (eye([33, 160, 158, 133, 153, 144]) + eye([362, 385, 387, 263, 373, 380])) /
    2;
  const mouth = distance(13, 14) / Math.max(0.001, distance(78, 308));
  if (!s.calibrated) {
    s.calibrationMs += dt;
    s.ears.push(ear);
    s.mouths.push(mouth);
    if (s.calibrationMs >= 5000 && s.ears.length >= 10) {
      s.earThreshold = Math.max(0.12, Math.min(0.3, median(s.ears) * 0.75));
      s.mouthThreshold = Math.max(0.35, median(s.mouths) * 1.8);
      s.calibrated = true;
      s.ears = [];
      s.mouths = [];
    }
    return {
      ...empty,
      face_detected: true,
      attention: s.calibrated ? s.score : 0,
      calibrated: s.calibrated,
      calibrationProgress: Math.min(1, s.calibrationMs / 5000),
    };
  }
  const closed = ear < s.earThreshold;
  s.closedSince = closed ? (s.closedSince ?? now) : null;
  s.yawnSince = mouth > s.mouthThreshold ? (s.yawnSince ?? now) : null;
  const eyeCenter = (points[33].x + points[263].x) / 2;
  const noseOffset =
    Math.abs(points[1].x - eyeCenter) /
    Math.max(0.01, Math.abs(points[263].x - points[33].x));
  s.awaySince = noseOffset > 0.32 ? (s.awaySince ?? now) : null;
  s.eyeWindow.push({ time: now, closed });
  s.eyeWindow = s.eyeWindow.filter((v) => now - v.time <= 30000);
  const coverage = now - s.eyeWindow[0].time;
  const perclos =
    s.eyeWindow.filter((v) => v.closed).length / s.eyeWindow.length;
  const drowsy =
    (s.closedSince !== null && now - s.closedSince >= 2000) ||
    (coverage >= 5000 && perclos >= 0.3);
  const warning =
    !drowsy &&
    ((s.closedSince !== null && now - s.closedSince >= 700) ||
      (coverage >= 5000 && perclos >= 0.15));
  const yawning = s.yawnSince !== null && now - s.yawnSince >= 1200;
  const lookingAway = s.awaySince !== null && now - s.awaySince >= 1500;
  const target = Math.max(
    0,
    100 -
      (drowsy ? 50 : warning ? 25 : 0) -
      (yawning ? 20 : 0) -
      (phoneDetected ? 25 : 0) -
      (lookingAway ? 25 : 0),
  );
  s.score = 0.3 * target + 0.7 * s.score;
  return {
    attention: Math.round(s.score),
    alert: drowsy
      ? "DROWSY"
      : warning
        ? "WARNING"
        : yawning
          ? "SLEEPY"
          : phoneDetected
            ? "LOW_ATTENTION"
            : "NONE",
    yawning,
    face_detected: true,
    phone_detected: phoneDetected,
    looking_away: lookingAway,
    calibrated: true,
    calibrationProgress: 1,
  };
}
