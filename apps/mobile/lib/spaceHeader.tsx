import { useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useLayoutEffect } from "react";
import { Pressable, Text } from "react-native";

import { colors } from "@/lib/theme";

export function useSpaceScreenOptions(opts: {
  spaceId?: string;
  title?: string;
  showSettings?: boolean;
  backTitle?: string;
}) {
  const navigation = useNavigation();
  const router = useRouter();
  const {
    spaceId,
    title,
    showSettings = true,
    backTitle = "Nhà",
  } = opts;

  useLayoutEffect(() => {
    navigation.setOptions({
      ...(title != null ? { title } : {}),
      headerBackTitle: backTitle,
      headerRight: showSettings
        ? () => (
            <Pressable
              onPress={() => spaceId && router.push(`/settings/${spaceId}`)}
              hitSlop={8}
              style={{ marginRight: 4, paddingVertical: 4, paddingHorizontal: 2 }}
            >
              <Text style={{ color: colors.brand, fontWeight: "600", fontSize: 16 }}>
                Cài đặt
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, router, spaceId, title, showSettings, backTitle]);
}
