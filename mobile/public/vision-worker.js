// Model inference runs off the UI thread. Only local ImageBitmaps cross this boundary.
// Classic worker: the MediaPipe WASM loader relies on importScripts.
self.exports = {};
importScripts("/vision/vision_bundle.js");
const { FilesetResolver, FaceLandmarker, ObjectDetector } = self.exports;

let face, objects;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      self.postMessage({
        type: "progress",
        message: "Loading vision runtime…",
      });
      const files = await FilesetResolver.forVisionTasks("/vision/wasm");
      self.postMessage({ type: "progress", message: "Loading face model…" });
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/vision/face_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      self.postMessage({
        type: "progress",
        message: "Loading phone detector…",
      });
      objects = await ObjectDetector.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/vision/efficientdet_lite0.tflite",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        scoreThreshold: 0.35,
        maxResults: 5,
        categoryAllowlist: ["cell phone"],
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      face?.close();
      objects?.close();
      self.postMessage({
        type: "error",
        message: String(error?.message || error),
      });
    }
    return;
  }
  if (data.type !== "frame") return;
  const { bitmap, timestamp } = data;
  try {
    const faces = face.detectForVideo(bitmap, timestamp);
    const detections = objects.detectForVideo(bitmap, timestamp).detections;
    self.postMessage({
      type: "result",
      timestamp,
      width: bitmap.width,
      height: bitmap.height,
      landmarks: faces.faceLandmarks[0] || [],
      boxes: detections.map((d) => d.boundingBox),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || error),
    });
  } finally {
    bitmap.close();
  }
};
