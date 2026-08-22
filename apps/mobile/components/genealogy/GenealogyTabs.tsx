import { router, usePathname } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { colors, createThemedStyles } from "@/lib/theme";

type TabId = "calendar" | "genealogy";

const TABS: { id: TabId; label: string; path: (spaceId: string) => string }[] = [
  {
    id: "calendar",
    label: "Lịch",
    path: (spaceId) => `/library/${spaceId}/calendar`,
  },
  {
    id: "genealogy",
    label: "Gia phả",
    path: (spaceId) => `/library/${spaceId}/genealogy`,
  },
];

export function GenealogyTabs({ spaceId }: { spaceId: string }) {
  const pathname = usePathname();
  const active: TabId = pathname.endsWith("/genealogy") ? "genealogy" : "calendar";

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              style={[styles.chip, selected && styles.chipOn]}
              onPress={() => {
                if (selected) return;
                router.replace(tab.path(spaceId));
              }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  wrap: {
    height: 44,
    marginBottom: 8,
  },
  row: {
    paddingHorizontal: 16,
    alignItems: "center",
    flexDirection: "row",
    columnGap: 8,
  },
  chip: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brandSoft,
  },
  chipTextOn: { color: "#f4efe6" },
}));
