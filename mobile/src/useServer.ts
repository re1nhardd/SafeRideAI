import { useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import { serverEndpoint } from "./endpoint";

export interface Status {
  attention: number;
  alert: string;
  yawning: boolean;
  speech_text: string;
  offensive_detected: boolean;
  help_detected: boolean;
  camera_ready: boolean;
  detector_ready: boolean;
  calibrated: boolean;
  face_detected: boolean;
  phone_detected: boolean;
  looking_away: boolean;
  error: string;
}
export interface AlertMsg {
  alert: string;
  message: string;
  severity: string;
  time: number;
}
export const EMPTY: Status = {
  attention: 0,
  alert: "NONE",
  yawning: false,
  speech_text: "",
  offensive_detected: false,
  help_detected: false,
  camera_ready: false,
  detector_ready: false,
  calibrated: false,
  face_detected: false,
  phone_detected: false,
  looking_away: false,
  error: "",
};

export async function enableNotifications() {
  if (Platform.OS === "web") return;
  try {
    const N = await import("expo-notifications");
    if (Platform.OS === "android")
      await N.setNotificationChannelAsync("alerts", {
        name: "Driver alerts",
        importance: N.AndroidImportance.HIGH,
      });
    await N.requestPermissionsAsync();
  } catch {
    /* In-app alerts remain available. */
  }
}

export async function notify(alert: AlertMsg) {
  if (Platform.OS === "web") return;
  try {
    const H = await import("expo-haptics");
    await H.notificationAsync(
      alert.severity === "critical"
        ? H.NotificationFeedbackType.Error
        : H.NotificationFeedbackType.Warning,
    );
    const N = await import("expo-notifications");
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if ((await N.getPermissionsAsync()).granted)
      await N.scheduleNotificationAsync({
        content: { title: "SafeRide AI", body: alert.message, sound: true },
        trigger: null,
      });
  } catch {
    /* Haptics/notifications may be unavailable on a particular device. */
  }
}

export function useServer(address: string, demo = false) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<Status>(EMPTY);
  const [lastAlert, setLastAlert] = useState<AlertMsg | null>(null);
  const [connError, setConnError] = useState("");
  const [generation, setGeneration] = useState(0);
  const reconnect = useCallback(() => setGeneration((n) => n + 1), []);

  useEffect(() => {
    setConnected(false);
    setStatus(EMPTY);
    setLastAlert(null);
    setConnError("");
    if (!address || demo) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let endpoint: ReturnType<typeof serverEndpoint>;
    try {
      endpoint = serverEndpoint(address);
      if (
        Platform.OS === "web" &&
        globalThis.location?.protocol === "https:" &&
        endpoint.http.startsWith("http:")
      ) {
        throw new Error(
          "This HTTPS app needs an HTTPS server. For a LAN server, use Expo Go or run the web app locally.",
        );
      }
    } catch (e) {
      setConnError((e as Error).message);
      return;
    }
    function connect() {
      if (disposed) return;
      setConnError("Connecting to your server…");
      const ws = new WebSocket(endpoint.ws);
      socket = ws;
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (!disposed) {
            setConnError("Server stopped responding. Reconnecting…");
            ws.close();
          }
        }, 10000);
      };
      armWatchdog();
      ws.onopen = () => {
        if (!disposed) {
          attempt = 0;
          setConnected(true);
          setConnError("");
          armWatchdog();
        }
      };
      ws.onmessage = (e) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(e.data);
          if (
            msg.type === "status" &&
            msg.data &&
            Number.isFinite(msg.data.attention)
          ) {
            armWatchdog();
            setStatus({
              ...EMPTY,
              ...msg.data,
              attention: Math.max(0, Math.min(100, msg.data.attention)),
            });
          } else if (
            msg.type === "alert" &&
            typeof msg.message === "string" &&
            Number.isFinite(msg.time)
          ) {
            setLastAlert(msg);
            void notify(msg);
          }
        } catch {
          /* Keep the last valid sample; the watchdog handles stale peers. */
        }
      };
      ws.onerror = () => {
        if (!disposed) {
          setConnError("Cannot reach the server. Check the address and Wi-Fi.");
          ws.close();
        }
      };
      ws.onclose = () => {
        clearTimeout(watchdog);
        if (disposed) return;
        setConnected(false);
        setStatus(EMPTY);
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      if (socket) {
        socket.onclose = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [address, demo, generation]);
  return { connected, status, lastAlert, connError, reconnect };
}
