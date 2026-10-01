// src/Ring.tsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";

interface Props {
  value: number;
  size?: number;
  isDark?: boolean;
}

export function Ring({ value, size = 200, isDark = true }: Props) {
  const SW = size < 150 ? 12 : 16;
  const R = (size - SW) / 2;
  const CIRC = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, value));
  const dash = CIRC - (pct / 100) * CIRC;

  const ok = isDark ? "#00C98C" : "#0A8A5E";
  const warn = isDark ? "#FFB547" : "#B07000";
  const danger = isDark ? "#FF5A5F" : "#D93040";
  const track = isDark ? "#1A2540" : "#C8D4E8";
  const txt = isDark ? "#FFFFFF" : "#0A0E1A";
  const dim = isDark ? "#8A9BBE" : "#6B7A99";

  const color = pct >= 70 ? ok : pct >= 40 ? warn : danger;
  const fs = size < 150 ? 30 : 48;

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          stroke={track}
          strokeWidth={SW}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          stroke={color}
          strokeWidth={SW}
          fill="none"
          strokeDasharray={CIRC}
          strokeDashoffset={dash}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View
        style={[
          StyleSheet.absoluteFill,
          { alignItems: "center", justifyContent: "center" },
        ]}
        pointerEvents="none"
      >
        <Text style={{ fontSize: fs, fontWeight: "500", color }}>
          {Math.round(pct)}
        </Text>
        <Text style={{ fontSize: 11, color: dim, marginTop: -4 }}>%</Text>
        {size >= 150 && (
          <Text
            style={{
              fontSize: 10,
              color: dim,
              letterSpacing: 1.5,
              marginTop: 2,
            }}
          >
            ATTENTION
          </Text>
        )}
      </View>
    </View>
  );
}
