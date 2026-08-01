import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View, type ViewStyle } from "react-native";

const BAR_COUNT = 20;

function normalizeMetering(metering?: number): number {
  if (metering == null || Number.isNaN(metering)) return 0;
  if (metering > 0 && metering <= 1) return metering;
  const clamped = Math.max(-60, Math.min(0, metering));
  return (clamped + 60) / 60;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Props = {
  active: boolean;
  metering?: number;
  durationMillis?: number;
  barColor?: string;
  dotColor?: string;
  variant?: "compact" | "large";
  style?: ViewStyle;
};

export function RecordingLevelMeter({
  active,
  metering,
  durationMillis = 0,
  barColor = "#c45c4a",
  dotColor = "#e04535",
  variant = "compact",
  style,
}: Props) {
  const bars = useMemo(() => Array.from({ length: BAR_COUNT }, (_, i) => i), []);
  const pulse = useRef(new Animated.Value(1)).current;
  const [tick, setTick] = useState(0);
  const large = variant === "large";
  const minH = large ? 6 : 4;
  const maxH = large ? 44 : 24;
  const barW = large ? 4 : 3;
  const level = normalizeMetering(metering);

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.45,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [active, pulse]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 70);
    return () => clearInterval(id);
  }, [active]);

  const loudness = active ? Math.max(0.22, level) : 0.15;
  const waveT = tick * 0.22;

  return (
    <View style={[styles.wrap, large && styles.wrapLarge, style]}>
      <Animated.View
        style={[
          styles.dot,
          large && styles.dotLarge,
          { backgroundColor: dotColor },
          {
            transform: [{ scale: pulse }],
            opacity: pulse.interpolate({
              inputRange: [1, 1.45],
              outputRange: [0.8, 1],
            }),
          },
        ]}
      />
      <View style={[styles.bars, large && styles.barsLarge]}>
        {bars.map((i) => {
          const center = (BAR_COUNT - 1) / 2;
          const dist = Math.abs(i - center) / center;
          const shape = 0.45 + (1 - dist) * 0.55;
          const wave =
            0.38 +
            0.62 *
              Math.abs(
                Math.sin(waveT + i * 0.62) * Math.cos(waveT * 0.45 + i * 0.28),
              );
          const height = minH + wave * shape * loudness * (maxH - minH);
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  width: barW,
                  backgroundColor: barColor,
                  height,
                },
              ]}
            />
          );
        })}
      </View>
      <Text style={[styles.time, large && styles.timeLarge]}>
        {formatDuration(durationMillis)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
  },
  wrapLarge: {
    minHeight: 56,
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  bars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    height: 28,
  },
  barsLarge: {
    height: 48,
    gap: 4,
  },
  bar: {
    borderRadius: 3,
    minHeight: 4,
  },
  time: {
    fontVariant: ["tabular-nums"],
    fontSize: 14,
    fontWeight: "600",
    color: "#a04535",
    minWidth: 38,
    textAlign: "right",
  },
  timeLarge: {
    fontSize: 16,
    minWidth: 44,
  },
});
