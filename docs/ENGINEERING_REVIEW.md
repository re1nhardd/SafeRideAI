# Engineering review

Review date: 2 October 2026. The original desktop folders were retained. This repository is the consolidated, cleaned application.

## Corrected behavior

| Area | Original issue | Result |
|---|---|---|
| Expo dependencies | SDK 54 mixed with SDK 56 packages and incompatible native versions | SDK 57 with aligned native dependencies and a committed npm lockfile |
| Mobile layout | Fixed 390px web frame and desktop/mobile layout constraints | Responsive dashboard, safe-area handling, dark/light themes |
| Web deployment | Required a private laptop IP and insecure WebSockets | Standalone labeled demo, or explicit HTTP(S)/WS(S) backend connection |
| WebSocket lifecycle | Closed effects could schedule new reconnects and retain old addresses | Effect-scoped socket ownership, disposed guards, cleared timers and bounded retry backoff |
| Connection health | No stale-status watchdog | Ten-second message timeout; five-second stale camera checks |
| Backend concurrency | Worker threads wrote WebSockets from separate asyncio loops | One async broadcaster owns all outgoing WebSocket messages |
| Video pipeline | Captured, compressed, decoded, resized and mirrored frames again | One inference/capture worker; encode once after detection |
| Camera readiness | Default 100% attention and placeholder JPEG could imply valid monitoring | Explicit readiness flags and HTTP 503 for missing/stale frames |
| Face loss | Yawn and head-pose state could survive after the face disappeared | Reset those states; client suppresses readings until face/calibration are ready |
| Mouth geometry | Incorrect mouth landmark pairs | Inner-lip height divided by mouth width; calibrated threshold has a floor |
| Head pose | Euler angles assigned to the wrong named axes | OpenCV rotation decomposition with pitch/yaw/roll mapped explicitly |
| Phone status | Phone inferred from a single priority alert label | Independent phone flag survives simultaneous higher-priority alerts |
| Model paths | Depended on process working directory | Assets resolved under `backend/models/`; configurable custom YOLO path |
| Google speech | Background listener not stopped; configured language ignored | Listener stopped on shutdown; configured locale passed to recognizer |
| Whisper buffering | Continuous speech could evade utterance length limit | Flush long utterances while speech continues |
| Speech alerts | Old keyword flags could repeat indefinitely | Ten-second freshness window in the server |
| Transcript privacy | File logging enabled automatically | Opt-in logging; no transcript files committed |
| Browser origins | Unrestricted CORS | Explicit configured origins and same-origin local dashboard WebSockets |
| Dependencies | Audit findings in transitive build tools | Compatible patch updates; scoped `xcode` → `uuid` override with ID-generation regression test |
| Training utility | Rewrote legacy source to change weights and contained outdated dataset assumptions | Explicit dataset YAML and optional `SAFERIDE_YOLO_MODEL` configuration |

## Removed from the published tree

- Python virtual environments, `node_modules`, caches and model binaries.
- Recorded speech logs, training runs and placeholder dataset images.
- Superseded desktop GUI/entry points and v1 detector/audio implementations.
- Unused AV/WebView dependencies, sound generator and old theme module.
- Duplicate embedded dashboard markup; the local dashboard is one HTML file.

These source-folder originals were not deleted. The published app has one supported mobile/web client and one supported inference-server entry point.

## Validation

- TypeScript check, web production export, and Android/iOS Hermes bundle export.
- Expo Doctor: 21/21 checks passed.
- npm audit: zero reported vulnerabilities after compatible fixes.
- Node regression tests: LAN/default-port/HTTPS normalization, invalid input and patched Xcode ID generation.
- Python tests: health/readiness, missing/fresh/stale snapshots, WebSocket status and alert delivery, disconnect cleanup, origin rejection, cooldowns, speech matching/logging/shutdown and stale voice-alert expiry.
- Opt-in model tests load the actual MediaPipe and YOLOv8n weights, process a blank synthetic frame, and test mouth geometry/PERCLOS expiry.
- Browser checks cover desktop and 320px/mobile layouts, five demo scenarios, theme switching, invalid addresses, manual alerts, real connection to the hardware-disabled FastAPI server, reconnect, and cleanup when returning to demo.
- README screenshots are captured from the web build. The mobile image is a responsive-browser screenshot, not a physical-device capture.

## Limits of this review

No physical Android/iPhone run, live driver session, microphone recording, quantitative detection benchmark, or custom-model training was performed. Native device behavior and real-world signal thresholds still need controlled validation. Automated model smoke tests verify loadability and selected logic, not detection accuracy.

The inference backend is intended for a trusted local network. The public Vercel deployment hosts the client and browser model assets; standalone webcam inference runs on the visitor's device. The original remote Python inference option requires a separately managed HTTPS service with access control. No remote push infrastructure, emergency-service integration, phone-camera upload, or guaranteed background monitoring is implemented.

The SDK 57 Expo Go installation route depends on platform availability. Follow the linked official instructions in the README rather than using an arbitrary store version.

Third-party dependency audits are point-in-time checks; maintain the lockfile and rerun the checks when upgrading.


## Browser webcam addition

- Added opt-in local webcam inference using pinned MediaPipe Tasks Vision 0.10.32, FaceLandmarker and EfficientDet-Lite0 in a classic Web Worker. Camera frames remain on-device; browser mode requests no audio.
- Added five-second calibration, persistent eye-closure/yawning/looking-away signals, phone presence smoothing and explicit no-face/model-error/permission states. Browser head orientation uses a simpler landmark offset than the Python pose estimator; outputs are not interchangeable benchmarks.
- Camera tracks, worker and timers are released on stop, mode changes, hidden tabs and failures, including permission grants arriving after cancellation.
- Kept the Python backend and Expo Go guide unchanged. Native builds resolve a separate fallback module, without browser APIs.
- Validation: 11 client regression tests, TypeScript, web/Android/iOS exports; real browser models with synthetic webcam input, same-origin GET-only requests, no audio request, recalibration cleanup, demo recovery, permission denial and late-grant cancellation.
- No physical webcam accuracy test or physical Expo Go device run was performed.
