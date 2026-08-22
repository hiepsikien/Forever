import { FamilyTreeNode, GenealogyPayload } from "@forever/api-client";
import { Text, View } from "react-native";

import { PersonNodeCard } from "@/components/genealogy/PersonNodeCard";
import {
  GenerationBand,
  buildGenealogyGraph,
} from "@/lib/genealogyLayout";
import { colors, createThemedStyles } from "@/lib/theme";

type Props = {
  bands: GenerationBand[];
  payload: GenealogyPayload;
  selectedNodeId?: string | null;
  onSelectNode?: (node: FamilyTreeNode) => void;
};

export function GenerationBandView({
  bands,
  payload,
  selectedNodeId,
  onSelectNode,
}: Props) {
  const graph = buildGenealogyGraph(payload);

  return (
    <View style={styles.root}>
      {bands.map((band) => (
        <View key={band.generation} style={styles.band}>
          <Text style={styles.bandLabel}>{band.label}</Text>
          <View style={styles.clusterList}>
            {band.clusters.map((cluster) => (
              <View key={cluster.anchorId} style={styles.cluster}>
                {cluster.ids.map((nodeId, index) => {
                  const node = graph.nodes.get(nodeId);
                  if (!node) return null;
                  return (
                    <View key={nodeId} style={styles.cardWrap}>
                      {index > 0 ? <Text style={styles.union}>♦</Text> : null}
                      <PersonNodeCard
                        node={node}
                        graph={graph}
                        clusterIds={cluster.ids}
                        selected={selectedNodeId === nodeId}
                        onPress={() => onSelectNode?.(node)}
                      />
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { gap: 18 },
  band: { gap: 10 },
  bandLabel: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: colors.inkSoft,
    paddingHorizontal: 2,
  },
  clusterList: { gap: 10 },
  cluster: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  cardWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  union: {
    fontSize: 12,
    color: colors.brandSoft,
    paddingHorizontal: 2,
  },
}));
