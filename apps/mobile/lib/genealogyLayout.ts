import {
  FamilyTreeEdge,
  FamilyTreeNode,
  GenealogyPayload,
} from "@forever/api-client";

export type SpouseLink = {
  nodeId: string;
  edgeId: string;
  order: number;
  label?: string;
};

export type GenealogyGraph = {
  nodes: Map<string, FamilyTreeNode>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  spouses: Map<string, SpouseLink[]>;
};

export type PersonCluster = {
  ids: string[];
  anchorId: string;
};

export type GenerationBand = {
  generation: number;
  label: string;
  clusters: PersonCluster[];
};

export function buildGenealogyGraph(payload: GenealogyPayload): GenealogyGraph {
  const nodes = new Map(payload.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, SpouseLink[]>();

  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };

  for (const edge of payload.edges) {
    if (edge.kind === "parent") {
      push(parents, edge.to_node_id, edge.from_node_id);
      push(children, edge.from_node_id, edge.to_node_id);
      continue;
    }
    if (edge.kind !== "spouse") continue;
    const order =
      typeof edge.meta?.spouse_order === "number" ? edge.meta.spouse_order : 99;
    const label =
      typeof edge.meta?.spouse_label === "string"
        ? edge.meta.spouse_label
        : undefined;
    const aLinks = spouses.get(edge.from_node_id) ?? [];
    aLinks.push({
      nodeId: edge.to_node_id,
      edgeId: edge.id,
      order,
      label,
    });
    spouses.set(edge.from_node_id, aLinks);
    const bLinks = spouses.get(edge.to_node_id) ?? [];
    bLinks.push({
      nodeId: edge.from_node_id,
      edgeId: edge.id,
      order,
      label,
    });
    spouses.set(edge.to_node_id, bLinks);
  }

  for (const [id, links] of spouses) {
    spouses.set(
      id,
      [...links].sort((a, b) => a.order - b.order || a.nodeId.localeCompare(b.nodeId)),
    );
  }

  return { nodes, parents, children, spouses };
}

export function assignGenerations(graph: GenealogyGraph): Map<string, number> {
  const gens = new Map<string, number>();
  for (const id of graph.nodes.keys()) gens.set(id, 0);

  let changed = true;
  let guard = 0;
  while (changed && guard < graph.nodes.size + 8) {
    changed = false;
    guard += 1;
    for (const [child, parentIds] of graph.parents) {
      for (const parentId of parentIds) {
        const next = (gens.get(parentId) ?? 0) + 1;
        if (next > (gens.get(child) ?? 0)) {
          gens.set(child, next);
          changed = true;
        }
      }
    }
    for (const [leftId, links] of graph.spouses) {
      for (const link of links) {
        const synced = Math.max(gens.get(leftId) ?? 0, gens.get(link.nodeId) ?? 0);
        if (synced > (gens.get(leftId) ?? 0)) {
          gens.set(leftId, synced);
          changed = true;
        }
        if (synced > (gens.get(link.nodeId) ?? 0)) {
          gens.set(link.nodeId, synced);
          changed = true;
        }
      }
    }
  }
  return gens;
}

function generationLabel(generation: number, maxGeneration: number): string {
  const fromTop = maxGeneration - generation;
  if (maxGeneration === 0) return "Gia phả";
  if (fromTop === 0) return "Đời xa nhất";
  if (fromTop === 1) return "Ông bà · cụ";
  if (fromTop === 2) return "Cha mẹ";
  if (fromTop === 3) return "Con cháu";
  return `Đời ${fromTop + 1}`;
}

function clusterScore(node: FamilyTreeNode): number {
  return node.birth_order ?? 999;
}

function buildClusters(ids: string[], graph: GenealogyGraph): PersonCluster[] {
  const remaining = new Set(ids);
  const clusters: PersonCluster[] = [];

  while (remaining.size > 0) {
    const start = [...remaining].sort(
      (a, b) =>
        clusterScore(graph.nodes.get(a)!) - clusterScore(graph.nodes.get(b)!) ||
        graph.nodes.get(a)!.display_name.localeCompare(graph.nodes.get(b)!.display_name),
    )[0];
    remaining.delete(start);

    const spouseIds = (graph.spouses.get(start) ?? [])
      .map((s) => s.nodeId)
      .filter((id) => remaining.has(id));
    for (const spouseId of spouseIds) remaining.delete(spouseId);

    const group = [start, ...spouseIds];
    group.sort(
      (a, b) =>
        clusterScore(graph.nodes.get(a)!) - clusterScore(graph.nodes.get(b)!) ||
        graph.nodes.get(a)!.display_name.localeCompare(graph.nodes.get(b)!.display_name),
    );
    clusters.push({ anchorId: start, ids: group });
  }

  clusters.sort(
    (a, b) =>
      clusterScore(graph.nodes.get(a.anchorId)!) -
        clusterScore(graph.nodes.get(b.anchorId)!) ||
      graph.nodes
        .get(a.anchorId)!
        .display_name.localeCompare(graph.nodes.get(b.anchorId)!.display_name),
  );
  return clusters;
}

export function layoutGenerationBands(payload: GenealogyPayload): GenerationBand[] {
  if (!payload.nodes.length) return [];
  const graph = buildGenealogyGraph(payload);
  const gens = assignGenerations(graph);
  const maxGeneration = Math.max(...gens.values());
  const byGen = new Map<number, string[]>();

  for (const [id, gen] of gens) {
    const list = byGen.get(gen) ?? [];
    list.push(id);
    byGen.set(gen, list);
  }

  return [...byGen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([generation, ids]) => ({
      generation,
      label: generationLabel(generation, maxGeneration),
      clusters: buildClusters(ids, graph),
    }));
}

export function spouseLabelForPair(
  graph: GenealogyGraph,
  leftId: string,
  rightId: string,
): string | undefined {
  return graph.spouses
    .get(leftId)
    ?.find((s) => s.nodeId === rightId)?.label;
}

export function nodeYearLine(node: FamilyTreeNode): string | null {
  const birth = node.birth_year;
  const death = node.death_year;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `Sinh ${birth}`;
  if (death) return `Mất ${death}`;
  return null;
}

export function siblingHint(node: FamilyTreeNode): string | null {
  if (!node.birth_order || node.birth_order <= 1) return null;
  if (node.gender_hint === "female") return `Con thứ ${node.birth_order}`;
  if (node.gender_hint === "male") return `Con thứ ${node.birth_order}`;
  return `Thứ ${node.birth_order}`;
}
