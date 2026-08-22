import { Pressable, Text, View } from "react-native";

import {
  GenealogyGraph,
  NamedRelation,
  relationsOf,
} from "@/lib/genealogyLayout";
import { colors, createThemedStyles } from "@/lib/theme";

type Props = {
  graph: GenealogyGraph;
  nodeId: string;
  compact?: boolean;
  onPressPerson?: (nodeId: string) => void;
};

function RelationGroup({
  heading,
  items,
  empty,
  onPressPerson,
}: {
  heading: string;
  items: NamedRelation[];
  empty: string;
  onPressPerson?: (nodeId: string) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{heading}</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        items.map((item) => {
          const line = `${item.name} · ${item.role}`;
          if (!onPressPerson) {
            return (
              <Text key={item.id} style={styles.item}>
                {line}
              </Text>
            );
          }
          return (
            <Pressable
              key={item.id}
              onPress={() => onPressPerson(item.id)}
              hitSlop={4}
            >
              <Text style={styles.itemLink}>{line}</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

export function PersonRelationsBlock({
  graph,
  nodeId,
  compact,
  onPressPerson,
}: Props) {
  const rel = relationsOf(graph, nodeId);
  return (
    <View style={[styles.root, compact && styles.rootCompact]}>
      <RelationGroup
        heading="Cha/mẹ"
        items={rel.parents}
        empty="Chưa ghi"
        onPressPerson={onPressPerson}
      />
      <RelationGroup
        heading="Vợ/chồng"
        items={rel.spouses}
        empty="Chưa ghi"
        onPressPerson={onPressPerson}
      />
      <RelationGroup
        heading="Con"
        items={rel.children}
        empty="Chưa ghi"
        onPressPerson={onPressPerson}
      />
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { gap: 8 },
  rootCompact: { gap: 6 },
  group: { gap: 2 },
  heading: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
  },
  item: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  itemLink: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.brandSoft,
    fontWeight: "600",
  },
}));
