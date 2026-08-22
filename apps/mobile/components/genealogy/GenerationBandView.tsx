import { useRef, type ReactNode, type RefObject } from "react";
import { Text, View } from "react-native";

import { PersonNodeCard } from "@/components/genealogy/PersonNodeCard";
import {
  GenerationBand,
  buildGenealogyGraph,
} from "@/lib/genealogyLayout";
import { colors, createThemedStyles } from "@/lib/theme";
import { FamilyTreeNode, GenealogyPayload } from "@forever/api-client";

type Props = {
  bands: GenerationBand[];
  payload: GenealogyPayload;
  selectedNodeId?: string | null;
  onSelectNode?: (node: FamilyTreeNode) => void;
  onCardOffset?: (nodeId: string, y: number) => void;
};

export function GenerationBandView({
  bands,
  payload,
  selectedNodeId,
  onSelectNode,
  onCardOffset,
}: Props) {
  const graph = buildGenealogyGraph(payload);
  const rootRef = useRef<View>(null);

  return (
    <View ref={rootRef} collapsable={false} style={styles.root}>
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
                    <CardAnchor
                      key={nodeId}
                      nodeId={nodeId}
                      rootRef={rootRef}
                      onOffset={onCardOffset}
                    >
                      {index > 0 ? <Text style={styles.union}>♦</Text> : null}
                      <PersonNodeCard
                        node={node}
                        graph={graph}
                        clusterIds={cluster.ids}
                        selected={selectedNodeId === nodeId}
                        onPress={() => onSelectNode?.(node)}
                      />
                    </CardAnchor>
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

function CardAnchor({
  nodeId,
  rootRef,
  onOffset,
  children,
}: {
  nodeId: string;
  rootRef: RefObject<View | null>;
  onOffset?: (nodeId: string, y: number) => void;
  children: ReactNode;
}) {
  const selfRef = useRef<View>(null);
  const report = () => {
    const self = selfRef.current;
    const root = rootRef.current;
    if (!self || !root || !onOffset) return;
    self.measureLayout(
      root,
      (_x, y) => onOffset(nodeId, y),
      () => {},
    );
  };
  return (
    <View
      ref={selfRef}
      collapsable={false}
      style={styles.cardWrap}
      onLayout={report}
    >
      {children}
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
