import { FamilyTreeNode } from "@forever/api-client";
import { Pressable, Text, View } from "react-native";

import {
  buildGenealogyGraph,
  conRiengParentId,
  descendantLine,
  isInLawInCluster,
  nodeYearLine,
  parentAttributionLine,
  spouseBadgeForNode,
} from "@/lib/genealogyLayout";
import { createThemedStyles } from "@/lib/theme";

type Props = {
  node: FamilyTreeNode;
  graph: ReturnType<typeof buildGenealogyGraph>;
  clusterIds?: string[];
  onPress?: () => void;
  selected?: boolean;
};

type CardKind = "male" | "female" | "inLaw" | "unknown";

function cardKind(
  node: FamilyTreeNode,
  graph: ReturnType<typeof buildGenealogyGraph>,
  clusterIds: string[],
): CardKind {
  if (clusterIds.length > 1 && isInLawInCluster(node.id, graph, clusterIds)) {
    return "inLaw";
  }
  if (node.gender_hint === "male") return "male";
  if (node.gender_hint === "female") return "female";
  return "unknown";
}

export function PersonNodeCard({
  node,
  graph,
  clusterIds = [],
  onPress,
  selected,
}: Props) {
  const years = nodeYearLine(node);
  const parentsLine = parentAttributionLine(graph, node.id);
  const spouseLabel = spouseBadgeForNode(graph, node.id, clusterIds);
  const linked = Boolean(node.identity_profile_id);
  const kind = cardKind(node, graph, clusterIds);
  const halfParentId =
    kind === "inLaw" ? null : conRiengParentId(node.id, graph);
  const line =
    kind === "inLaw" || halfParentId
      ? null
      : descendantLine(node.id, graph);

  return (
    <Pressable
      style={[
        styles.card,
        kind === "male" && styles.cardMale,
        kind === "female" && styles.cardFemale,
        kind === "inLaw" && styles.cardInLaw,
        (line === "ngoai" || halfParentId) && styles.cardNgoai,
        selected && styles.cardSelected,
      ]}
      onPress={onPress}
    >
      <View style={styles.nameRow}>
        <View
          style={[
            styles.pip,
            kind === "male" && styles.pipMale,
            kind === "female" && styles.pipFemale,
            kind === "inLaw" && styles.pipInLaw,
          ]}
        />
        <Text style={styles.name} numberOfLines={2}>
          {node.display_name}
        </Text>
      </View>
      {years ? (
        <Text style={styles.meta} numberOfLines={1}>
          {years}
        </Text>
      ) : null}
      {parentsLine ? (
        <Text style={styles.parents} numberOfLines={2}>
          {parentsLine}
        </Text>
      ) : null}
      {line ? (
        <Text
          style={[
            styles.lineBadge,
            line === "ngoai" && styles.lineBadgeNgoai,
          ]}
          numberOfLines={1}
        >
          {line === "noi" ? "Cháu nội" : "Cháu ngoại"}
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
    borderLeftWidth: 3,
    borderLeftColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  cardMale: {
    borderLeftColor: colors.brand,
    backgroundColor: colors.brandWash,
  },
  cardFemale: {
    borderLeftColor: colors.accent,
  },
  cardInLaw: {
    borderLeftColor: colors.inkSoft,
    backgroundColor: colors.bg,
  },
  cardNgoai: {
    backgroundColor: colors.bg,
  },
  cardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.bgDeep,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  pip: {
    width: 7,
    height: 7,
    marginTop: 6,
    borderRadius: 1,
    backgroundColor: colors.line,
  },
  pipMale: {
    borderRadius: 1,
    backgroundColor: colors.brand,
  },
  pipFemale: {
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  pipInLaw: {
    borderRadius: 2,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.inkSoft,
  },
  name: {
    flex: 1,
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
  parents: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.inkSoft,
  },
  lineBadge: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: colors.brand,
  },
  lineBadgeNgoai: {
    color: colors.inkSoft,
    fontWeight: "600",
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
