import React, { useEffect, useRef, useState } from "react";
import { EMPTY, type Status } from "./useServer";
import { newSignalState, updateSignals, type Point } from "./browserSignals";

/** Owns the webcam, worker and frame loop. No frames leave this browser. */
export function useBrowserCamera(enabled: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>(EMPTY);
  const [phase, setPhase] = useState("");
  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [aspect, setAspect] = useState(4 / 3);
  const [calibrationProgress, setCalibrationProgress] = useState(0);

  useEffect(() => {
    setStatus(EMPTY);
    setRunning(false);
    setCalibrationProgress(0);
    if (!enabled) {
      setPhase("");
      return;
    }
    let disposed = false;
    let stream: MediaStream | undefined;
    let worker: Worker | undefined;
    let next: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastResult = performance.now();
    let lastVideoTime = -1;
    const signals = newSignalState();
    const stop = () => {
      disposed = true;
      clearTimeout(next);
      clearTimeout(timeout);
      clearInterval(watchdog);
      worker?.terminate();
      stream?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
      const c = canvas.current;
      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    };
    const fail = (message: string) => {
      if (disposed) return;
      stop();
      setRunning(false);
      setStatus({ ...EMPTY, error: message });
      setPhase(message);
    };
    const hidden = () => {
      if (document.hidden)
        fail(
          "Camera paused while this tab is hidden. Choose Retry camera to resume.",
        );
    };
    const pagehide = () => stop();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pagehide);

    async function frame() {
      if (disposed) return;
      const v = video.current;
      if (!v || v.readyState < 2 || v.currentTime === lastVideoTime) {
        next = setTimeout(frame, 200);
        return;
      }
      lastVideoTime = v.currentTime;
      try {
        const width = Math.min(640, v.videoWidth);
        const height = Math.round((width * v.videoHeight) / v.videoWidth);
        const bitmap = await createImageBitmap(v, {
          resizeWidth: width,
          resizeHeight: height,
        });
        if (disposed) {
          bitmap.close();
          return;
        }
        worker!.postMessage(
          { type: "frame", bitmap, timestamp: performance.now() },
          [bitmap],
        );
      } catch {
        fail(
          "Could not read camera frames. Close other camera apps and retry.",
        );
      }
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        fail(
          "Camera access requires HTTPS or localhost and a supported browser.",
        );
        return;
      }
      if (
        typeof Worker === "undefined" ||
        typeof createImageBitmap === "undefined" ||
        typeof OffscreenCanvas === "undefined"
      ) {
        fail(
          "This browser does not support local vision. Try a current Chrome or Edge, or use Expo Go.",
        );
        return;
      }
      setPhase("Waiting for camera permission…");
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 30 },
          },
          audio: false,
        });
        if (disposed) {
          acquired.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = acquired;
        stream
          .getVideoTracks()
          .forEach((t) =>
            t.addEventListener("ended", () =>
              fail("Camera disconnected. Reconnect it and retry."),
            ),
          );
        const v = video.current;
        if (!v) throw new Error("Video view is unavailable");
        v.srcObject = stream;
        await v.play();
        if (disposed) return;
        setAspect(v.videoWidth / v.videoHeight || 4 / 3);
        setRunning(true);
        setStatus({ ...EMPTY, camera_ready: true });
        setPhase("Loading local vision models…");
        worker = new Worker("/vision-worker.js");
        timeout = setTimeout(
          () =>
            fail(
              "Vision models took too long to load. Check your connection and retry.",
            ),
          90000,
        );
        worker.onerror = (event) => {
          console.error("Browser worker:", event.message);
          fail(
            "The browser vision engine could not start. Reload the page and retry.",
          );
        };
        worker.onmessage = ({ data }) => {
          if (disposed) return;
          if (data.type === "progress") {
            setPhase(data.message);
            return;
          }
          if (data.type === "error") {
            console.error("Browser vision:", data.message);
            fail(
              "Vision processing failed. Check your connection and retry camera.",
            );
            return;
          }
          if (data.type === "ready") {
            clearTimeout(timeout);
            lastResult = performance.now();
            setPhase("Look at the camera with eyes open for five seconds.");
            watchdog = setInterval(() => {
              if (performance.now() - lastResult > 12000)
                fail("Camera processing stopped responding. Retry camera.");
            }, 1000);
            void frame();
            return;
          }
          if (data.type !== "result") return;
          lastResult = performance.now();
          const { landmarks, boxes, width, height, timestamp } = data as {
            landmarks: Point[];
            boxes: {
              originX: number;
              originY: number;
              width: number;
              height: number;
            }[];
            width: number;
            height: number;
            timestamp: number;
          };
          const result = updateSignals(
            signals,
            landmarks,
            boxes.length > 0,
            timestamp,
            width,
            height,
          );
          const { calibrationProgress: progress, ...observations } = result;
          setCalibrationProgress(progress);
          setStatus({
            ...EMPTY,
            ...observations,
            camera_ready: true,
            detector_ready: true,
          });
          setPhase(
            !result.face_detected
              ? "No face detected. Face the camera in good light."
              : !result.calibrated
                ? `Calibrating ${Math.round(progress * 100)}% · keep your eyes open and face the camera.`
                : "Live analysis · frames stay on this device.",
          );
          const c = canvas.current;
          if (c) {
            c.width = width;
            c.height = height;
            const ctx = c.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, width, height);
              ctx.fillStyle = result.alert === "NONE" ? "#77E5C1" : "#FFBA76";
              for (const i of [
                1, 4, 13, 14, 33, 133, 160, 158, 153, 144, 263, 362, 385, 387,
                373, 380, 78, 308,
              ]) {
                const p = landmarks[i];
                if (!p) continue;
                ctx.beginPath();
                ctx.arc(p.x * width, p.y * height, 2, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.strokeStyle = "#FFBA76";
              ctx.lineWidth = 3;
              for (const b of boxes)
                ctx.strokeRect(b.originX, b.originY, b.width, b.height);
            }
          }
          next = setTimeout(frame, 150);
        };
        worker.postMessage({ type: "init" });
      } catch (error) {
        const name = (error as DOMException).name;
        fail(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow this site to use your camera, then retry."
            : name === "NotFoundError"
              ? "No camera found. Connect a webcam and retry."
              : name === "NotReadableError"
                ? "Camera is busy. Close other camera apps and retry."
                : "Could not start the camera. Check browser permissions and retry.",
        );
      }
    }
    void start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [enabled, generation]);

  const preview = (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: aspect,
        borderRadius: 12,
        overflow: "hidden",
        background: "#081321",
      }}
    >
      <video
        ref={video}
        muted
        autoPlay
        playsInline
        aria-label="Live webcam preview"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: "scaleX(-1)",
        }}
      />
      <canvas
        ref={canvas}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          transform: "scaleX(-1)",
        }}
      />
    </div>
  );
  return {
    status,
    phase,
    running,
    preview,
    restart: () => setGeneration((n) => n + 1),
    calibrationProgress,
  };
}
