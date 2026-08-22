import { FamilyTreeNode } from "@forever/api-client";
import { Pressable, Text, View } from "react-native";

import {
  buildGenealogyGraph,
  nodeYearLine,
  siblingHint,
  spouseLabelForPair,
} from "@/lib/genealogyLayout";
import { colors, createThemedStyles } from "@/lib/theme";

type Props = {
  node: FamilyTreeNode;
  graph: ReturnType<typeof buildGenealogyGraph>;
  clusterMateId?: string;
  onPress?: () => void;
  selected?: boolean;
};

export function PersonNodeCard({
  node,
  graph,
  clusterMateId,
  onPress,
  selected,
}: Props) {
  const years = nodeYearLine(node);
  const sibling = siblingHint(node);
  const spouseLabel =
    clusterMateId != null
      ? spouseLabelForPair(graph, clusterMateId, node.id) ??
        spouseLabelForPair(graph, node.id, clusterMateId)
      : undefined;
  const linked = Boolean(node.identity_profile_id);

  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
    >
      <Text style={styles.name} numberOfLines={2}>
        {node.display_name}
      </Text>
      {years ? (
        <Text style={styles.meta} numberOfLines={1}>
          {years}
        </Text>
      ) : null}
      {sibling ? (
        <Text style={styles.meta} numberOfLines={1}>
          {sibling}
        </Text>
      ) : null}
      {spouseLabel ? (
        <Text style={styles.spouseBadge} numberOfLines={1}>
          {spouseLabel}
        </Text>
      ) : null}
      {linked ? (
        <Text style={styles.linkBadge} numberOfLines={1}>
          Có hồ sơ
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = createThemedStyles((colors) => ({
  card: {
    minWidth: 112,
    maxWidth: 160,
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  cardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.bgDeep,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: colors.ink,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
  },
  spouseBadge: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: colors.brandSoft,
  },
  linkBadge: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.brand,
    fontWeight: "600",
  },
}));
