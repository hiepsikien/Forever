import {
  FamilyTreeNode,
  GenealogyPayload,
  IdentityProfile,
} from "@forever/api-client";

export type SpouseDirection = "from" | "to";

export type SpouseLink = {
  nodeId: string;
  edgeId: string;
  order: number;
  label?: string;
  /** Whether `nodeId`'s partner (the map key) is the edge's from_node or to_node. */
  direction: SpouseDirection;
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

const WIFE_LABEL = /vợ|thê|thất thế/i;
const HUSBAND_LABEL = /chồng/i;

export function isWifeSpouseLabel(label?: string): boolean {
  return Boolean(label && WIFE_LABEL.test(label));
}

export function isHusbandSpouseLabel(label?: string): boolean {
  return Boolean(label && HUSBAND_LABEL.test(label));
}

export function complementSpouseLabel(label?: string): string {
  if (isHusbandSpouseLabel(label)) return "Vợ";
  if (isWifeSpouseLabel(label)) return "Chồng";
  return "Chồng";
}

export type GenderHint = "male" | "female" | "unknown";

export function inferGenderFromText(text: string): GenderHint {
  const raw = (text || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (/\bthị\b/.test(raw)) return "female";
  if (/\bvăn\b/.test(raw)) return "male";
  if (
    /bà nội|bà ngoại|\bbà\b|\bmẹ\b|\bcô\b|\bdì\b|thím|mợ|\bvợ\b|\bchị\b|em gái|con gái|cháu gái/.test(
      raw,
    )
  ) {
    return "female";
  }
  if (
    /ông nội|ông ngoại|\bông\b|\bbố\b|\bcha\b|\bchú\b|\bcậu\b|\bchồng\b|\banh\b|em trai|con trai|cháu trai/.test(
      raw,
    )
  ) {
    return "male";
  }
  return "unknown";
}

export function genderOfIdentity(ident: IdentityProfile): GenderHint {
  return inferGenderFromText(`${ident.relation_label ?? ""} ${ident.display_name}`);
}

export function genderOfNode(
  node: FamilyTreeNode,
  identities: IdentityProfile[] = [],
): GenderHint {
  if (node.gender_hint === "male" || node.gender_hint === "female") {
    return node.gender_hint;
  }
  if (node.identity_profile_id) {
    const ident = identities.find((i) => i.id === node.identity_profile_id);
    if (ident) {
      const fromProfile = genderOfIdentity(ident);
      if (fromProfile !== "unknown") return fromProfile;
    }
  }
  return inferGenderFromText(node.display_name);
}

export function withInferredGender(
  node: FamilyTreeNode,
  identities: IdentityProfile[],
): FamilyTreeNode {
  const inferred = genderOfNode(node, identities);
  if (inferred === "unknown" || node.gender_hint === inferred) return node;
  return { ...node, gender_hint: inferred };
}

export function enrichGenealogyPayload(
  payload: GenealogyPayload,
  identities: IdentityProfile[],
): GenealogyPayload {
  return {
    ...payload,
    nodes: payload.nodes.map((n) => withInferredGender(n, identities)),
  };
}

export function genderWord(gender: GenderHint): string | null {
  if (gender === "male") return "Nam";
  if (gender === "female") return "Nữ";
  return null;
}

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
      direction: "from",
    });
    spouses.set(edge.from_node_id, aLinks);
    const bLinks = spouses.get(edge.to_node_id) ?? [];
    bLinks.push({
      nodeId: edge.from_node_id,
      edgeId: edge.id,
      order,
      label,
      direction: "to",
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
  if (maxGeneration === 0) return "Gia phả";
  const fromYoungest = maxGeneration - generation;
  if (generation === 0) return "Đời xa nhất";
  if (fromYoungest === 0) return "Con cháu";
  if (fromYoungest === 1) return "Cha mẹ";
  if (fromYoungest === 2) return "Ông bà · cụ";
  return `Đời ${generation + 1}`;
}

function clusterScore(node: FamilyTreeNode): number {
  return node.birth_order ?? 999;
}

function birthYearRank(node: FamilyTreeNode | undefined): number {
  const year = node?.birth_year;
  return year && year > 0 ? year : 9999;
}

function byBirthThenName(
  graph: GenealogyGraph,
  a: string,
  b: string,
): number {
  const na = graph.nodes.get(a);
  const nb = graph.nodes.get(b);
  return (
    birthYearRank(na) - birthYearRank(nb) ||
    clusterScore(na!) - clusterScore(nb!) ||
    (na?.display_name ?? "").localeCompare(nb?.display_name ?? "")
  );
}

function hasParentsOnTree(graph: GenealogyGraph, id: string): boolean {
  return (graph.parents.get(id) ?? []).length > 0;
}

function ancestorDepth(graph: GenealogyGraph, id: string): number {
  const seen = new Set<string>();
  const walk = (nid: string): number => {
    if (seen.has(nid)) return 0;
    seen.add(nid);
    const parents = graph.parents.get(nid) ?? [];
    if (!parents.length) return 0;
    return 1 + Math.max(...parents.map(walk));
  };
  return walk(id);
}

function siblingCount(graph: GenealogyGraph, id: string): number {
  const sibs = new Set<string>();
  for (const parentId of graph.parents.get(id) ?? []) {
    for (const childId of graph.children.get(parentId) ?? []) {
      if (childId !== id) sibs.add(childId);
    }
  }
  return sibs.size;
}

function bloodlineStrength(graph: GenealogyGraph, id: string): number {
  return ancestorDepth(graph, id) * 10 + siblingCount(graph, id);
}

function spouseOrderInCluster(
  id: string,
  graph: GenealogyGraph,
  clusterIds: string[],
): number {
  const links = (graph.spouses.get(id) ?? []).filter((s) =>
    clusterIds.includes(s.nodeId),
  );
  return (
    links.find((s) => s.direction === "to")?.order ?? links[0]?.order ?? 99
  );
}

/**
 * Dâu / rể: married into the line. The blood-line child (has parents on
 * this tree, or the founding male) stands first; the in-law stands after.
 */
export function isInLawInCluster(
  id: string,
  graph: GenealogyGraph,
  clusterIds: string[],
): boolean {
  const mates = clusterIds.filter((oid) => oid !== id);
  if (!mates.length) return false;
  const selfHasParents = hasParentsOnTree(graph, id);
  const mateHasParents = mates.some((oid) => hasParentsOnTree(graph, oid));
  if (!selfHasParents && mateHasParents) return true;
  if (selfHasParents && !mateHasParents) return false;
  const links = (graph.spouses.get(id) ?? []).filter((s) =>
    mates.includes(s.nodeId),
  );
  if (selfHasParents && mateHasParents) {
    const self = bloodlineStrength(graph, id);
    const bestMate = Math.max(
      ...mates.map((oid) => bloodlineStrength(graph, oid)),
    );
    if (self !== bestMate) return self < bestMate;
    const isTo = links.some((s) => s.direction === "to");
    const isFrom = links.some((s) => s.direction === "from");
    if (isTo && !isFrom) return true;
    if (isFrom && !isTo) return false;
    return false;
  }
  const node = graph.nodes.get(id);
  if (node?.gender_hint === "female") return true;
  if (node?.gender_hint === "male") return false;
  if (
    links.some(
      (s) => s.direction === "to" && isHusbandSpouseLabel(s.label),
    )
  ) {
    return false;
  }
  if (
    links.some(
      (s) =>
        (s.direction === "to" && isWifeSpouseLabel(s.label)) ||
        (s.direction === "from" && isHusbandSpouseLabel(s.label)),
    )
  ) {
    return true;
  }
  return false;
}

function isMarkedConRieng(graph: GenealogyGraph, id: string): boolean {
  return Boolean(graph.nodes.get(id)?.con_rieng);
}

function hasGrandparentOnTree(graph: GenealogyGraph, id: string): boolean {
  const parents = graph.parents.get(id) ?? [];
  const skipSpouse = isMarkedConRieng(graph, id);
  for (const parentId of parents) {
    if (hasParentsOnTree(graph, parentId)) return true;
    if (skipSpouse) continue;
    for (const mate of graph.spouses.get(parentId) ?? []) {
      if (hasParentsOnTree(graph, mate.nodeId)) return true;
    }
  }
  return false;
}

/** The blood-line parent this child hangs from (son or daughter of the house). */
function throughBloodlineParent(
  graph: GenealogyGraph,
  id: string,
): string | null {
  const parents = graph.parents.get(id) ?? [];
  const withAncestry = parents
    .filter((parentId) => hasParentsOnTree(graph, parentId))
    .sort(
      (a, b) => bloodlineStrength(graph, b) - bloodlineStrength(graph, a),
    );
  if (withAncestry.length) return withAncestry[0];
  if (isMarkedConRieng(graph, id)) return parents[0] ?? null;
  for (const parentId of parents) {
    const mates = (graph.spouses.get(parentId) ?? [])
      .map((link) => link.nodeId)
      .filter((mateId) => hasParentsOnTree(graph, mateId))
      .sort(
        (a, b) => bloodlineStrength(graph, b) - bloodlineStrength(graph, a),
      );
    if (mates.length) return mates[0];
  }
  return null;
}

/** Explicit con riêng only — missing the other parent is not enough. */
export function conRiengParentId(
  id: string,
  graph: GenealogyGraph,
): string | null {
  if (!isMarkedConRieng(graph, id)) return null;
  const parents = graph.parents.get(id) ?? [];
  return parents[0] ?? null;
}

export type DescendantLine = "noi" | "ngoai";

/**
 * Grandchild onward: nội = through a son of this house; ngoại = through a
 * daughter (and stays ngoại for their descendants).
 */
export function descendantLine(
  id: string,
  graph: GenealogyGraph,
): DescendantLine | null {
  const cache = new Map<string, DescendantLine | null>();
  const visit = (nid: string, stack: Set<string>): DescendantLine | null => {
    if (cache.has(nid)) return cache.get(nid) ?? null;
    if (stack.has(nid)) return null;
    stack.add(nid);
    let result: DescendantLine | null = null;
    if (hasGrandparentOnTree(graph, nid)) {
      const through = throughBloodlineParent(graph, nid);
      if (through) {
        const parentLine = hasGrandparentOnTree(graph, through)
          ? visit(through, stack)
          : null;
        const gender = graph.nodes.get(through)?.gender_hint;
        if (parentLine === "ngoai" || gender === "female") result = "ngoai";
        else if (gender === "male" || parentLine === "noi") result = "noi";
      }
    }
    stack.delete(nid);
    cache.set(nid, result);
    return result;
  };
  return visit(id, new Set());
}

/** Lower = further left. Blood-line first, dâu/rể after. */
export function clanFirstRank(
  id: string,
  graph: GenealogyGraph,
  clusterIds: string[],
): number {
  const order = spouseOrderInCluster(id, graph, clusterIds);
  if (isInLawInCluster(id, graph, clusterIds)) return 1000 + order;
  return -bloodlineStrength(graph, id);
}

function buildClusters(ids: string[], graph: GenealogyGraph): PersonCluster[] {
  const remaining = new Set(ids);
  const clusters: PersonCluster[] = [];

  const pickStart = () =>
    [...remaining].sort(
      (a, b) =>
        clanFirstRank(a, graph, [...remaining]) -
          clanFirstRank(b, graph, [...remaining]) ||
        byBirthThenName(graph, a, b),
    )[0];

  while (remaining.size > 0) {
    const start = pickStart();
    remaining.delete(start);
    const group = [start];
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const link of graph.spouses.get(id) ?? []) {
        if (!remaining.has(link.nodeId)) continue;
        remaining.delete(link.nodeId);
        group.push(link.nodeId);
        queue.push(link.nodeId);
      }
    }
    group.sort(
      (a, b) =>
        clanFirstRank(a, graph, group) - clanFirstRank(b, graph, group) ||
        byBirthThenName(graph, a, b),
    );
    clusters.push({ anchorId: group[0], ids: group });
  }

  clusters.sort((a, b) => byBirthThenName(graph, a.anchorId, b.anchorId));
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

export type NamedRelation = {
  id: string;
  name: string;
  role: string;
};

export type PersonRelations = {
  parents: NamedRelation[];
  spouses: NamedRelation[];
  children: NamedRelation[];
};

function parentRoleOf(graph: GenealogyGraph, parentId: string): string {
  const node = graph.nodes.get(parentId);
  if (node?.gender_hint === "female") return "Mẹ";
  if (node?.gender_hint === "male") return "Cha";
  return "Cha/mẹ";
}

function childRoleOf(graph: GenealogyGraph, childId: string): string {
  const node = graph.nodes.get(childId);
  if (node?.gender_hint === "female") return "Con gái";
  if (node?.gender_hint === "male") return "Con trai";
  return "Con";
}

/** How `partnerId` is labeled relative to `selfId`. */
export function spouseRoleOfPartner(
  graph: GenealogyGraph,
  selfId: string,
  partnerId: string,
): string {
  const cluster = [selfId, partnerId];
  const badge = spouseBadgeForNode(graph, partnerId, cluster);
  if (badge) return badge;
  const link = graph.spouses.get(selfId)?.find((s) => s.nodeId === partnerId);
  if (!link) return "Vợ/chồng";
  return link.direction === "from"
    ? link.label || "Vợ/chồng"
    : complementSpouseLabel(link.label);
}

export function relationsOf(
  graph: GenealogyGraph,
  nodeId: string,
): PersonRelations {
  const nameOf = (id: string) => graph.nodes.get(id)?.display_name ?? "Người nhà";
  return {
    parents: (graph.parents.get(nodeId) ?? []).map((id) => ({
      id,
      name: nameOf(id),
      role: parentRoleOf(graph, id),
    })),
    spouses: (graph.spouses.get(nodeId) ?? []).map((link) => ({
      id: link.nodeId,
      name: nameOf(link.nodeId),
      role: spouseRoleOfPartner(graph, nodeId, link.nodeId),
    })),
    children: [...(graph.children.get(nodeId) ?? [])]
      .sort((a, b) => byBirthThenName(graph, a, b))
      .map((id) => ({
        id,
        name: nameOf(id),
        role: childRoleOf(graph, id),
      })),
  };
}

/** Badge on one card inside a couple/household cluster. */
export function spouseBadgeForNode(
  graph: GenealogyGraph,
  nodeId: string,
  clusterIds: string[],
): string | undefined {
  const mates = (graph.spouses.get(nodeId) ?? []).filter(
    (s) => s.nodeId !== nodeId && clusterIds.includes(s.nodeId),
  );
  if (!mates.length) return undefined;

  if (!isInLawInCluster(nodeId, graph, clusterIds)) return undefined;

  const node = graph.nodes.get(nodeId);
  if (node?.gender_hint === "male") return "Rể";
  const wifeLabel = mates.find(
    (m) => m.label && isWifeSpouseLabel(m.label),
  )?.label;
  if (wifeLabel) return wifeLabel;
  if (mates.some((m) => isHusbandSpouseLabel(m.label))) return "Rể";
  if (node?.gender_hint === "female") return "Vợ";
  return "Vợ";
}

function formatDeathDay(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

export function nodeYearLine(node: FamilyTreeNode): string | null {
  const birth = node.birth_year;
  const deathDay = node.death_date ? formatDeathDay(node.death_date) : null;
  const death = node.death_year;
  if (birth && deathDay) return `${birth} – ${deathDay}`;
  if (birth && death) return `${birth} – ${death}`;
  if (deathDay) return `Mất ${deathDay}`;
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
