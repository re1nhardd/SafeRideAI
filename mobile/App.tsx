import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  Image,
  useWindowDimensions,
  Linking,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Circle, Rect, Line, Ellipse } from "react-native-svg";
import { Ring } from "./src/Ring";
import {
  useServer,
  EMPTY,
  enableNotifications,
  notify,
  Status,
} from "./src/useServer";
import { serverEndpoint } from "./src/endpoint";
import { useBrowserCamera } from "./src/useBrowserCamera";

const dark = {
  bg: "#090E19",
  panel: "#101A2A",
  border: "#24334A",
  text: "#EDF3FC",
  muted: "#9AAAC1",
  accent: "#77E5C1",
  blue: "#76ACFF",
  danger: "#FF868C",
};
const light = {
  bg: "#F1F5F9",
  panel: "#FFFFFF",
  border: "#D2DDE9",
  text: "#122033",
  muted: "#52667E",
  accent: "#087A59",
  blue: "#225CC7",
  danger: "#BB263B",
};
const scenarios = [
  {
    id: "NONE",
    label: "Focused",
    value: 96,
    description: "Driver attentive",
    detail: "Eyes open. No distraction detected.",
  },
  {
    id: "DROWSY",
    label: "Drowsiness",
    value: 32,
    description: "Drowsiness detected",
    detail: "Pull over safely and take a break.",
  },
  {
    id: "LOW_ATTENTION",
    label: "Phone",
    value: 61,
    description: "Phone detected",
    detail: "Keep your attention on the road.",
  },
  {
    id: "SLEEPY",
    label: "Yawning",
    value: 72,
    description: "Yawning detected",
    detail: "Consider taking a rest break.",
  },
  {
    id: "HELP",
    label: "Help request",
    value: 92,
    description: "Help phrase detected",
    detail: "Check the situation when it is safe.",
  },
];

function DriverIllustration({ alert }: { alert: string }) {
  const color = alert === "NONE" ? "#77E5C1" : "#FFBA76";
  return (
    <Svg
      width="100%"
      height={226}
      viewBox="0 0 520 280"
      accessibilityLabel="Illustrated driver, simulated data"
    >
      <Rect width={520} height={280} rx={18} fill="#081321" />
      {[70, 140, 210, 280, 350, 420].map((x) => (
        <Line key={x} x1={x} y1={0} x2={x} y2={280} stroke="#14273A" />
      ))}
      {[56, 112, 168, 224].map((y) => (
        <Line key={y} x1={0} y1={y} x2={520} y2={y} stroke="#14273A" />
      ))}
      <Path
        d="M110 275 Q130 176 200 167 L320 167 Q390 176 410 275"
        fill="#20394E"
      />
      <Rect x={237} y={145} width={46} height={43} rx={15} fill="#537487" />
      <Ellipse cx={260} cy={106} rx={54} ry={67} fill="#6B8B9B" />
      <Path
        d="M207 91 Q200 21 261 31 Q322 28 315 92 L298 64 Q246 84 223 62 Z"
        fill="#203647"
      />
      <Path
        d={
          alert === "DROWSY"
            ? "M226 103 Q237 113 247 103 M273 103 Q284 113 295 103"
            : "M226 103 L247 103 M273 103 L295 103"
        }
        stroke="#0A2637"
        strokeWidth={4}
        fill="none"
      />
      <Path
        d="M259 108 L252 126 L264 126"
        stroke="#375567"
        strokeWidth={3}
        fill="none"
      />
      {alert === "SLEEPY" ? (
        <Ellipse cx={260} cy={143} rx={12} ry={16} fill="#263E50" />
      ) : (
        <Path
          d="M244 145 Q260 153 276 145"
          stroke="#375567"
          strokeWidth={3}
          fill="none"
        />
      )}
      <Rect
        x={190}
        y={24}
        width={140}
        height={162}
        rx={18}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="8 6"
        fill="none"
      />
      {[
        [226, 103],
        [247, 103],
        [273, 103],
        [295, 103],
        [260, 126],
        [244, 145],
        [276, 145],
        [260, 170],
      ].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={3} fill={color} />
      ))}
      <Path
        d="M173 280 A88 70 0 0 1 347 280"
        stroke="#416277"
        strokeWidth={15}
        fill="none"
      />
      {alert === "LOW_ATTENTION" && (
        <Rect
          x={340}
          y={131}
          width={47}
          height={78}
          rx={7}
          fill="#163246"
          stroke={color}
          strokeWidth={2}
        />
      )}
      <Line x1={24} y1={22} x2={62} y2={22} stroke={color} strokeWidth={3} />
      <Line x1={24} y1={22} x2={24} y2={50} stroke={color} strokeWidth={3} />
      <Line
        x1={496}
        y1={258}
        x2={458}
        y2={258}
        stroke={color}
        strokeWidth={3}
      />
      <Line
        x1={496}
        y1={258}
        x2={496}
        y2={230}
        stroke={color}
        strokeWidth={3}
      />
    </Svg>
  );
}

function Camera({
  address,
  ready,
  C,
}: {
  address: string;
  ready: boolean;
  C: typeof dark;
}) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setTick(Date.now());
  }, [address, ready]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setTick(Date.now()), failed ? 2000 : 250);
    return () => clearTimeout(timer);
  }, [ready, tick, failed]);
  if (!ready)
    return (
      <View style={s.cameraPlaceholder}>
        <Text style={{ color: C.muted }}>Waiting for a camera frame</Text>
      </View>
    );
  const endpoint = serverEndpoint(address);
  return (
    <View>
      <Image
        accessibilityLabel="Live annotated camera image"
        source={{ uri: `${endpoint.http}/snapshot?t=${tick}` }}
        style={s.cameraImage}
        resizeMode="contain"
        onError={() => setFailed(true)}
        onLoad={() => setFailed(false)}
      />
      {failed && (
        <Text style={{ color: C.danger }}>
          Camera image unavailable. Retrying…
        </Text>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Dashboard />
    </SafeAreaProvider>
  );
}

function Dashboard() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [isDark, setIsDark] = useState(true);
  const C = isDark ? dark : light;
  const [address, setAddress] = useState("");
  const [input, setInput] = useState("");
  const [demo, setDemo] = useState(true);
  const [browserMode, setBrowserMode] = useState(false);
  const browser = useBrowserCamera(browserMode);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [scenario, setScenario] = useState(0);
  const [testAlert, setTestAlert] = useState(false);
  const live = useServer(address, demo || browserMode);
  const connected = browserMode ? browser.running : live.connected;
  const current = scenarios[scenario];
  const simulated: Status = {
    ...EMPTY,
    attention: current.value,
    alert: current.id,
    camera_ready: true,
    detector_ready: true,
    calibrated: true,
    face_detected: true,
    phone_detected: current.id === "LOW_ATTENTION",
    yawning: current.id === "SLEEPY",
    help_detected: current.id === "HELP",
    speech_text:
      current.id === "HELP" ? "Please stop the car. I need help." : "",
  };
  const status = browserMode ? browser.status : demo ? simulated : live.status;
  const ready =
    demo ||
    (connected &&
      status.camera_ready &&
      status.detector_ready &&
      status.face_detected &&
      status.calibrated);
  const title = demo
    ? current.description
    : !connected
      ? browserMode
        ? "Camera not running"
        : "Server disconnected"
      : status.error
        ? "Monitoring unavailable"
        : !status.camera_ready
          ? "Waiting for camera"
          : !status.detector_ready
            ? "Loading detection models"
            : !status.face_detected
              ? "No face detected"
              : !status.calibrated
                ? "Calibrating your baseline"
                : scenarios.find((v) => v.id === status.alert)?.description ||
                  (status.alert === "WARNING"
                    ? "Eyes closing"
                    : "Monitoring active");
  useEffect(() => {
    AsyncStorage.multiGet(["server_address", "theme"])
      .then((values) => {
        const a = values[0][1];
        if (a) {
          setAddress(a);
          setInput(a);
        }
        if (values[1][1] === "light") setIsDark(false);
      })
      .catch(() => {});
  }, []);
  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: primary ? C.accent : C.panel,
          borderColor: primary ? C.accent : C.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary ? (isDark ? "#092119" : "#FFFFFF") : C.text,
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const connect = () => {
    try {
      serverEndpoint(input);
      setError("");
      setAddress(input.trim());
      setBrowserMode(false);
      setDemo(false);
      setSettings(false);
      live.reconnect();
      void AsyncStorage.setItem("server_address", input.trim()).catch(() => {});
      void enableNotifications();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const card = (children: React.ReactNode, extra = {}) => (
    <View
      style={[
        s.card,
        { backgroundColor: C.panel, borderColor: C.border },
        extra,
      ]}
    >
      {children}
    </View>
  );
  const label = (text: string) => (
    <Text style={[s.label, { color: C.muted }]}>{text}</Text>
  );
  const reading = (name: string, active: boolean, supported = true) => (
    <View key={name} style={[s.reading, { borderBottomColor: C.border }]}>
      <Text style={{ color: C.text, fontSize: 13 }}>{name}</Text>
      <Text
        style={{
          color: !supported || !ready ? C.muted : active ? C.danger : C.accent,
          fontSize: 11,
          fontWeight: "700",
        }}
      >
        {!supported
          ? "SERVER ONLY"
          : !ready
            ? "NO DATA"
            : active
              ? "DETECTED"
              : "CLEAR"}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[s.page, { paddingHorizontal: wide ? 40 : 18 }]}>
          <View style={[s.header, { borderBottomColor: C.border }]}>
            <View style={s.brand}>
              <View style={[s.mark, { borderColor: C.accent }]}>
                <Text
                  style={{ color: C.accent, fontSize: 20, fontWeight: "800" }}
                >
                  S
                </Text>
              </View>
              <View>
                <Text
                  style={{
                    color: C.text,
                    fontSize: 20,
                    fontWeight: "700",
                    letterSpacing: -0.6,
                  }}
                >
                  SafeRide<Text style={{ color: C.accent }}> AI</Text>
                </Text>
                <Text
                  style={{
                    color: C.muted,
                    fontSize: 10,
                    letterSpacing: 1.7,
                    marginTop: 3,
                  }}
                >
                  DRIVER INTELLIGENCE
                </Text>
              </View>
            </View>
            <View style={s.actions}>
              {button(isDark ? "Light mode" : "Dark mode", () => {
                setIsDark(!isDark);
                void AsyncStorage.setItem(
                  "theme",
                  isDark ? "light" : "dark",
                ).catch(() => {});
              })}
              {wide &&
                button("GitHub ↗", () => {
                  void Linking.openURL(
                    "https://github.com/re1nhardd/SafeRideAI",
                  );
                })}
            </View>
          </View>
          <View
            style={[
              s.hero,
              {
                flexDirection: wide ? "row" : "column",
                alignItems: wide ? "flex-end" : "flex-start",
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.eyebrow, { color: C.accent }]}>
                A SECOND PAIR OF EYES
              </Text>
              <Text
                style={[s.title, { color: C.text, fontSize: wide ? 44 : 32 }]}
              >
                Every signal matters.
              </Text>
              <Text style={[s.subtitle, { color: C.muted }]}>
                Driver awareness, distractions and voice alerts. One connected
                view.
              </Text>
            </View>
            <View style={[s.actions, { marginTop: 18 }]}>
              {Platform.OS === "web" &&
                !browserMode &&
                button(
                  "Use webcam",
                  () => {
                    setDemo(false);
                    setBrowserMode(true);
                    setSettings(false);
                    setTestAlert(false);
                  },
                  true,
                )}
              {browserMode &&
                button("Stop camera", () => {
                  setBrowserMode(false);
                  setDemo(true);
                })}
              {browserMode &&
                button(
                  browser.running ? "Recalibrate" : "Retry camera",
                  browser.restart,
                )}

              {button(settings ? "Close settings" : "Connect server", () =>
                setSettings(!settings),
              )}
              {!demo &&
                button("Explore demo", () => {
                  setBrowserMode(false);
                  setDemo(true);
                  setSettings(false);
                })}
            </View>
          </View>
          {Platform.OS === "web" && !browserMode && (
            <Text
              style={{
                color: C.muted,
                fontSize: 13,
                lineHeight: 21,
                marginBottom: 18,
              }}
            >
              Use your webcam directly in this browser. No installation or
              server needed. Video stays on your device; allow camera access
              when asked.
            </Text>
          )}
          {settings &&
            card(
              <>
                {label("CONNECT YOUR INFERENCE SERVER")}
                <Text
                  style={{
                    color: C.muted,
                    fontSize: 13,
                    lineHeight: 21,
                    marginVertical: 12,
                  }}
                >
                  Use your computer’s LAN address in Expo Go, or an HTTPS server
                  for this hosted web app. The camera runs on the server
                  computer.
                </Text>
                <View
                  style={{ flexDirection: wide ? "row" : "column", gap: 12 }}
                >
                  <TextInput
                    accessibilityLabel="Server address"
                    value={input}
                    onChangeText={setInput}
                    placeholder="192.168.1.10:8000 or https://your-server.example.com"
                    placeholderTextColor={C.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onSubmitEditing={connect}
                    style={[
                      s.input,
                      {
                        color: C.text,
                        borderColor: C.border,
                        backgroundColor: C.bg,
                      },
                    ]}
                  />
                  {button("Connect", connect, true)}
                </View>
                {!!error && (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: C.danger, marginTop: 10 }}
                  >
                    {error}
                  </Text>
                )}
              </>,
              { marginBottom: 18 },
            )}
          <View
            style={[
              s.mode,
              {
                backgroundColor: isDark ? "#142A2A" : "#DCEFE9",
                borderColor: C.border,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: C.accent,
                  fontSize: 12,
                  fontWeight: "700",
                  letterSpacing: 1,
                }}
              >
                {browserMode
                  ? "BROWSER CAMERA"
                  : demo
                    ? "INTERACTIVE DEMO"
                    : live.connected
                      ? "SERVER CONNECTED"
                      : "SERVER OFFLINE"}
              </Text>
              <Text
                style={{
                  color: C.muted,
                  fontSize: 12,
                  lineHeight: 18,
                  marginTop: 5,
                }}
              >
                {browserMode
                  ? browser.phase
                  : demo
                    ? "Simulated scenarios · illustrated camera view · no camera or microphone access"
                    : live.connected
                      ? "Live data from your inference server"
                      : live.connError || "Waiting for connection…"}
              </Text>
            </View>
            <View
              style={[
                s.dot,
                {
                  backgroundColor: demo || connected ? C.accent : C.danger,
                },
              ]}
            />
          </View>
          {demo && (
            <View style={s.scenarios}>
              {scenarios.map((item, i) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: scenario === i }}
                  key={item.id}
                  onPress={() => {
                    setScenario(i);
                    setTestAlert(false);
                  }}
                  style={[
                    s.chip,
                    {
                      backgroundColor: i === scenario ? C.accent : C.panel,
                      borderColor: i === scenario ? C.accent : C.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        i === scenario
                          ? isDark
                            ? "#092119"
                            : "#FFFFFF"
                          : C.muted,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <View
            style={{
              flexDirection: wide ? "row" : "column",
              gap: 18,
              marginTop: 18,
            }}
          >
            <View style={{ flex: wide ? 1.4 : undefined, gap: 18 }}>
              {card(
                <>
                  <View style={s.cardHead}>
                    {label("01 / DRIVER VIEW")}
                    <Text
                      style={{
                        color: C.accent,
                        fontSize: 10,
                        fontWeight: "700",
                      }}
                    >
                      {demo
                        ? "SIMULATED"
                        : status.camera_ready
                          ? "CAMERA"
                          : "NO SIGNAL"}
                    </Text>
                  </View>
                  {browserMode ? (
                    browser.preview
                  ) : demo ? (
                    <DriverIllustration alert={current.id} />
                  ) : (
                    <Camera
                      address={address}
                      ready={live.connected && status.camera_ready}
                      C={C}
                    />
                  )}
                  <View style={[s.cameraFooter, { borderTopColor: C.border }]}>
                    <Text style={{ color: C.muted, fontSize: 11 }}>
                      {browserMode
                        ? "MediaPipe + EfficientDet · on device"
                        : "MediaPipe landmarks + YOLO objects"}
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 11 }}>
                      {browserMode
                        ? "Your webcam"
                        : demo
                          ? "Illustration"
                          : "Server camera"}
                    </Text>
                  </View>
                </>,
              )}
              {card(
                <>
                  <View style={s.cardHead}>
                    {label("02 / SIGNAL OVERVIEW")}
                    <Text style={{ color: C.muted, fontSize: 10 }}>
                      COMPUTER VISION
                    </Text>
                  </View>
                  <View style={s.metrics}>
                    {[
                      {
                        v: ready ? `${Math.round(status.attention)}%` : "—",
                        l: "ATTENTION",
                      },
                      {
                        v: ready
                          ? status.phone_detected
                            ? "Detected"
                            : "Clear"
                          : "—",
                        l: "PHONE",
                      },
                      {
                        v: ready
                          ? status.yawning
                            ? "Detected"
                            : "Clear"
                          : "—",
                        l: "YAWNING",
                      },
                    ].map((m) => (
                      <View key={m.l} style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: C.text,
                            fontSize: wide ? 27 : 21,
                            fontWeight: "600",
                          }}
                        >
                          {m.v}
                        </Text>
                        <Text
                          style={{
                            color: C.muted,
                            fontSize: 9,
                            letterSpacing: 1,
                            marginTop: 9,
                          }}
                        >
                          {m.l}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>,
              )}
            </View>
            <View style={{ flex: wide ? 1 : undefined, gap: 18 }}>
              {card(
                <>
                  <View style={s.cardHead}>
                    {label("03 / DRIVER STATE")}
                    <Text style={{ color: C.muted, fontSize: 10 }}>
                      {ready ? "ACTIVE" : "WAITING"}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 22,
                      marginBottom: 20,
                    }}
                  >
                    {ready ? (
                      <Ring
                        value={status.attention}
                        size={112}
                        isDark={isDark}
                      />
                    ) : (
                      <View style={s.emptyRing}>
                        <Text style={{ color: C.muted, fontSize: 26 }}>—</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color:
                            ready && status.alert !== "NONE"
                              ? C.danger
                              : C.text,
                          fontSize: 19,
                          fontWeight: "600",
                          lineHeight: 25,
                        }}
                      >
                        {title}
                      </Text>
                      <Text
                        style={{
                          color: C.muted,
                          fontSize: 12,
                          lineHeight: 19,
                          marginTop: 7,
                        }}
                      >
                        {demo
                          ? current.detail
                          : browserMode
                            ? browser.phase
                            : status.error ||
                              (!ready
                                ? "Check the server, camera and calibration."
                                : "Heuristic indicators, updated from your server.")}
                      </Text>
                    </View>
                  </View>
                  {reading(
                    "Drowsiness",
                    status.alert === "DROWSY" || status.alert === "WARNING",
                  )}
                  {reading("Phone distraction", status.phone_detected)}
                  {reading("Looking away", status.looking_away)}
                  {reading("Help request", status.help_detected, !browserMode)}
                </>,
              )}
              {card(
                <>
                  <View style={s.cardHead}>
                    {label("04 / VOICE SIGNAL")}
                    <Text style={{ color: C.muted, fontSize: 10 }}>
                      {browserMode
                        ? "SERVER MODE ONLY"
                        : demo
                          ? "SAMPLE"
                          : "OPTIONAL AUDIO"}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: status.help_detected ? C.danger : C.muted,
                      fontSize: 15,
                      lineHeight: 23,
                    }}
                  >
                    {browserMode
                      ? "Browser mode analyzes video only. Use Expo Go with the Python server for optional speech recognition."
                      : status.speech_text
                        ? `“${status.speech_text}”`
                        : demo
                          ? "No speech event in this scenario."
                          : "No transcript received."}
                  </Text>
                </>,
              )}
            </View>
          </View>
          {(testAlert || (!demo && !browserMode && live.lastAlert)) &&
            card(
              <>
                <Text
                  accessibilityRole="alert"
                  style={{ color: C.danger, fontWeight: "600" }}
                >
                  Notification
                </Text>
                <Text style={{ color: C.text, marginTop: 6 }}>
                  {testAlert
                    ? "Test alert received. This is a manual notification test."
                    : live.lastAlert?.message}
                </Text>
              </>,
              { marginTop: 18 },
            )}
          <View style={[s.actions, { marginTop: 22 }]}>
            {button("Test alert", () => {
              setTestAlert(true);
              void notify({
                alert: "TEST",
                message: "Manual SafeRide AI test alert.",
                severity: "warning",
                time: Date.now() / 1000,
              });
            })}
            {!demo && !browserMode && button("Reconnect", live.reconnect)}
          </View>
          <View style={[s.footer, { borderTopColor: C.border }]}>
            <Text
              style={{ color: C.muted, fontSize: 11, lineHeight: 18, flex: 1 }}
            >
              Research prototype · Attention is a heuristic score, not a
              calibrated probability. Evaluate only while parked; not a
              certified safety system.
            </Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>
              Built by Bekzat Daulen
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: {
    width: "100%",
    maxWidth: 1240,
    alignSelf: "center",
    paddingBottom: 22,
  },
  header: {
    paddingVertical: 24,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  mark: {
    height: 40,
    width: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderRadius: 10,
  },
  hero: { paddingVertical: 34, gap: 10 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12,
  },
  title: { fontWeight: "700", letterSpacing: -1.7, lineHeight: 53 },
  subtitle: { fontSize: 14, lineHeight: 23, marginTop: 8, maxWidth: 490 },
  card: { padding: 21, borderRadius: 18, borderWidth: 1 },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 19,
    alignItems: "center",
  },
  label: { fontSize: 10, fontWeight: "600", letterSpacing: 1.4 },
  mode: {
    padding: 17,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  scenarios: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 19 },
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cameraFooter: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  cameraPlaceholder: {
    height: 226,
    justifyContent: "center",
    alignItems: "center",
  },
  cameraImage: { width: "100%", height: 226, borderRadius: 12 },
  metrics: { flexDirection: "row", gap: 10, paddingBottom: 3 },
  reading: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: 0.5,
  },
  emptyRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 8,
    borderColor: "#24334A",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 13,
  },
  footer: {
    marginTop: 34,
    paddingTop: 20,
    borderTopWidth: 1,
    gap: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
});
