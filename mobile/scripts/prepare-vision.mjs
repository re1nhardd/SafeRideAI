// Serve the pinned browser runtime and models from our own deployment.
import { mkdir, copyFile, access, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "public/vision");
await mkdir(path.join(out, "wasm"), { recursive: true });
const source = path.join(root, "node_modules/@mediapipe/tasks-vision");
await copyFile(
  path.join(source, "vision_bundle.cjs"),
  path.join(out, "vision_bundle.js"),
);
for (const name of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  await copyFile(path.join(source, "wasm", name), path.join(out, "wasm", name));
}
const models = {
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "efficientdet_lite0.tflite":
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite",
};
for (const [name, url] of Object.entries(models)) {
  const target = path.join(out, name);
  try {
    await access(target);
    continue;
  } catch {
    /* First build. */
  }
  console.log(`Downloading browser model: ${name}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status} ${url}`);
  await writeFile(
    target + ".download",
    Buffer.from(await response.arrayBuffer()),
  );
  await rename(target + ".download", target);
}
console.log("Browser vision assets ready.");
