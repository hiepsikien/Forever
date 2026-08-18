import { Image, ImageStyle, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { fonts, useTheme } from "@/lib/theme";

type Variant = "onDark" | "onLight";

type Props = {
  /** Mark stroke: cream on dark surfaces, brand color on light. */
  variant?: Variant;
  /** Show the Forever wordmark beside/below the mark. */
  showWordmark?: boolean;
  /** horizontal = mark + wordmark; stacked = mark above wordmark */
  layout?: "horizontal" | "stacked";
  /** Mark diameter in dp */
  markSize?: number;
  wordmarkSize?: number;
  style?: StyleProp<ViewStyle>;
  markStyle?: StyleProp<ImageStyle>;
};

const MARK_ON_DARK = require("../assets/logo-mark.png");
const MARK_ON_LIGHT = require("../assets/logo-mark-brand.png");

export function BrandLogo({
  variant = "onLight",
  showWordmark = true,
  layout = "horizontal",
  markSize = 36,
  wordmarkSize = 22,
  style,
  markStyle,
}: Props) {
  const { colors } = useTheme();
  const onDark = variant === "onDark" || colors.isDark;
  const stacked = layout === "stacked";

  return (
    <View
      style={[
        stacked ? styles.stacked : styles.row,
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel="Forever"
    >
      <Image
        source={onDark ? MARK_ON_DARK : MARK_ON_LIGHT}
        style={[{ width: markSize, height: markSize }, markStyle]}
        resizeMode="contain"
      />
      {showWordmark ? (
        <Text
          style={[
            styles.wordmark,
            {
              fontSize: wordmarkSize,
              color: onDark ? colors.bg : colors.brand,
              marginTop: stacked ? 8 : 0,
              marginLeft: stacked ? 0 : 10,
            },
          ]}
        >
          Forever
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  stacked: {
    alignItems: "center",
  },
  wordmark: {
    fontFamily: fonts.display,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
});
