import {
  FamilyTreeNode,
  GenealogyPayload,
  IdentityProfile,
} from "@forever/api-client";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import { GenerationBandView } from "@/components/genealogy/GenerationBandView";
import { PersonRelationsBlock } from "@/components/genealogy/PersonRelationsBlock";
import { PhotoLightbox } from "@/components/library/PhotoLightbox";
import { useAuth } from "@/lib/auth";
import { isLoginMirror, identityChipLabel } from "@/lib/identityDisplay";
import {
  buildGenealogyGraph,
  enrichGenealogyPayload,
  genderOfIdentity,
  genderOfNode,
  genderWord,
  inferGenderFromText,
  isHusbandSpouseLabel,
  isWifeSpouseLabel,
  layoutGenerationBands,
  nodeYearLine,
  conRiengParentId,
  type GenderHint,
  type GenealogyGraph,
} from "@/lib/genealogyLayout";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, createThemedStyles } from "@/lib/theme";

function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

type AddMode = "person" | "spouse" | "parent" | "child" | "edit";

type OtherParentHint = {
  id: string;
  name: string;
  role: "father" | "mother";
};

const WIFE_RANK_LABELS = ["Vợ cả", "Vợ hai", "Vợ lẽ"] as const;

function parentRoleForNode(
  node: FamilyTreeNode | undefined,
  identities: IdentityProfile[],
): "father" | "mother" | "unknown" {
  if (!node) return "unknown";
  const gender = genderOfNode(node, identities);
  if (gender === "female") return "mother";
  if (gender === "male") return "father";
  return "unknown";
}

function collectOtherParentHints(
  graph: GenealogyGraph,
  nodes: FamilyTreeNode[],
  identities: IdentityProfile[],
  anchorId: string,
  childId: string | null,
): OtherParentHint[] {
  const knownParents = new Set<string>(
    childId ? (graph.parents.get(childId) ?? []) : [],
  );
  knownParents.add(anchorId);

  let hasMother = false;
  let hasFather = false;
  for (const id of knownParents) {
    const role = parentRoleForNode(
      nodes.find((n) => n.id === id),
      identities,
    );
    if (role === "mother") hasMother = true;
    if (role === "father") hasFather = true;
  }

  const hints: OtherParentHint[] = [];
  for (const link of graph.spouses.get(anchorId) ?? []) {
    if (knownParents.has(link.nodeId)) continue;
    const node = nodes.find((n) => n.id === link.nodeId);
    if (!node) continue;
    const gender = genderOfNode(node, identities);
    const role: "father" | "mother" | null =
      gender === "female"
        ? "mother"
        : gender === "male"
          ? "father"
          : isWifeSpouseLabel(link.label)
            ? "mother"
            : isHusbandSpouseLabel(link.label)
              ? "father"
              : null;
    if (!role) continue;
    if (role === "mother" && hasMother) continue;
    if (role === "father" && hasFather) continue;
    hints.push({ id: node.id, name: node.display_name, role });
  }
  return hints;
}

function pickAlsoParentId(
  hints: OtherParentHint[],
  current: string | null,
): string | null {
  if (current && hints.some((h) => h.id === current)) return current;
  return hints.length === 1 ? hints[0].id : null;
}

function parseDeathInput(raw: string): {
  year: number | null;
  date: string | null;
  invalid: boolean;
} {
  const t = raw.trim();
  if (!t) return { year: null, date: null, invalid: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return { year: Number(t.slice(0, 4)), date: t, invalid: false };
  }
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (dmy) {
    const date = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return { year: Number(dmy[3]), date, invalid: false };
  }
  if (/^\d{4}$/.test(t)) return { year: Number(t), date: null, invalid: false };
  return { year: null, date: null, invalid: true };
}

function formatDeathInput(node: FamilyTreeNode): string {
  if (node.death_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(node.death_date.trim());
    if (m) return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
  }
  if (node.death_year) return String(node.death_year);
  return "";
}

export default function GenealogyScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api } = useAuth();
  const [payload, setPayload] = useState<GenealogyPayload>({ nodes: [], edges: [] });
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("person");
  const [anchorNodeId, setAnchorNodeId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [deathInput, setDeathInput] = useState("");
  const [genderHint, setGenderHint] = useState<GenderHint>("unknown");
  const [birthOrder, setBirthOrder] = useState("");
  const [notes, setNotes] = useState("");
  const [spouseLabel, setSpouseLabel] = useState("Vợ");
  const [spouseOrder, setSpouseOrder] = useState("1");
  const [pickedIdentityId, setPickedIdentityId] = useState<string | null>(null);
  const [pickedTreeNodeId, setPickedTreeNodeId] = useState<string | null>(null);
  const [alsoParentNodeId, setAlsoParentNodeId] = useState<string | null>(null);
  const [conRieng, setConRieng] = useState(false);
  const [conRiengOfParentId, setConRiengOfParentId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [photoPick, setPhotoPick] = useState<{
    uri: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [editorPhotoUri, setEditorPhotoUri] = useState<string | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();
  const listRef = useRef<ScrollView>(null);
  const actionOffsetY = useRef(0);
  const pendingScrollToActions = useRef(false);
  const treeYOnList = useRef(0);
  const nodeYOnTree = useRef(new Map<string, number>());
  const pendingTreeScrollId = useRef<string | null>(null);
  /**
   * Android edge-to-edge no longer resizes the window, so KeyboardAvoidingView
   * cannot lift this sheet. Pad by the keyboard height the system reports.
   */
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);

  useSpaceScreenOptions({
    spaceId,
    title: "Gia phả",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setError(null);
    try {
      const [tree, idRes, spaceRes, stewardRes] = await Promise.all([
        api.getGenealogy(spaceId),
        api.listIdentities(spaceId),
        api.getSpace(spaceId),
        api.getStewardship(spaceId).catch(() => null),
      ]);
      setPayload(tree);
      setIdentities(idRes.identities);
      setCanEdit(
        spaceRes.role === "owner" ||
          spaceRes.role === "moderator" ||
          Boolean(stewardRes?.is_steward),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được gia phả.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, spaceId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (Platform.OS !== "android" || !editorOpen) {
      setAndroidKeyboardInset(0);
      return;
    }
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setAndroidKeyboardInset(Math.max(0, e.endCoordinates?.height ?? 0));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setAndroidKeyboardInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [editorOpen]);

  useEffect(() => {
    if (!selectedNodeId || !pendingScrollToActions.current) return;
    const timer = setTimeout(() => {
      if (!pendingScrollToActions.current) return;
      pendingScrollToActions.current = false;
      listRef.current?.scrollTo({
        y: Math.max(0, actionOffsetY.current - 16),
        animated: true,
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [selectedNodeId]);

  const scrollToNodeOnTree = (id: string) => {
    pendingScrollToActions.current = false;
    const rel = nodeYOnTree.current.get(id);
    if (rel == null) {
      pendingTreeScrollId.current = id;
      return;
    }
    pendingTreeScrollId.current = null;
    listRef.current?.scrollTo({
      y: Math.max(0, treeYOnList.current + rel - 12),
      animated: true,
    });
  };

  const closeEditor = () => {
    Keyboard.dismiss();
    setEditorOpen(false);
    setError(null);
  };

  const displayPayload = useMemo(
    () => enrichGenealogyPayload(payload, identities),
    [payload, identities],
  );
  const bands = useMemo(
    () => layoutGenerationBands(displayPayload),
    [displayPayload],
  );
  const graph = useMemo(
    () => buildGenealogyGraph(displayPayload),
    [displayPayload],
  );
  const selectedNode = useMemo(
    () => payload.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [payload.nodes, selectedNodeId],
  );

  useEffect(() => {
    setLightboxOpen(false);
    if (!spaceId || !selectedNode?.has_photo) {
      setSelectedPhotoUri(null);
      return;
    }
    setSelectedPhotoUri(null);
    let cancelled = false;
    void (async () => {
      try {
        const uri = await fetchAuthedMediaUri(
          api.genealogyPhotoUrl(spaceId, selectedNode.id),
          `gia-pha-photo-${selectedNode.id}-${String(selectedNode.updated_at).replace(/[^\w.-]+/g, "")}`,
          selectedNode.photo_mime || "image/jpeg",
        );
        if (!cancelled) setSelectedPhotoUri(uri);
      } catch {
        if (!cancelled) setSelectedPhotoUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    spaceId,
    selectedNode?.id,
    selectedNode?.has_photo,
    selectedNode?.photo_mime,
    selectedNode?.updated_at,
  ]);

  useEffect(() => {
    if (
      addMode === "edit" &&
      editorOpen &&
      !photoPick &&
      !clearPhoto &&
      selectedPhotoUri
    ) {
      setEditorPhotoUri(selectedPhotoUri);
    }
  }, [addMode, editorOpen, photoPick, clearPhoto, selectedPhotoUri]);

  const nameMatches = useMemo(() => {
    const q = foldName(searchQuery);
    if (q.length < 1) return [];
    const order = new Map(
      bands
        .flatMap((band) => band.clusters.flatMap((cluster) => cluster.ids))
        .map((id, i) => [id, i]),
    );
    return payload.nodes
      .filter((n) => foldName(n.display_name).includes(q))
      .sort(
        (a, b) =>
          (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999) ||
          a.display_name.localeCompare(b.display_name, "vi"),
      );
  }, [bands, payload.nodes, searchQuery]);
  const firstMatchId = nameMatches[0]?.id ?? null;

  useEffect(() => {
    if (!firstMatchId) {
      pendingTreeScrollId.current = null;
      return;
    }
    const timer = setTimeout(() => {
      pendingScrollToActions.current = false;
      setSelectedNodeId(firstMatchId);
      scrollToNodeOnTree(firstMatchId);
    }, 160);
    return () => clearTimeout(timer);
  }, [firstMatchId]);
  const anchorName =
    payload.nodes.find((n) => n.id === anchorNodeId)?.display_name ?? "người này";
  const addingPersonName = pickedTreeNodeId
    ? (payload.nodes.find((n) => n.id === pickedTreeNodeId)?.display_name ?? "Người này")
    : displayName.trim() || "Người này";

  const linkableIdentities = useMemo(() => {
    const used = new Set(
      payload.nodes
        .map((n) => n.identity_profile_id)
        .filter((id): id is string => Boolean(id)),
    );
    return identities.filter(
      (ident) => !isLoginMirror(ident) && !used.has(ident.id),
    );
  }, [identities, payload.nodes]);

  const linkableTreeNodes = useMemo(() => {
    if (!anchorNodeId) return [];
    const taken = new Set<string>([anchorNodeId]);
    if (addMode === "spouse") {
      for (const link of graph.spouses.get(anchorNodeId) ?? []) {
        taken.add(link.nodeId);
      }
    } else if (addMode === "parent") {
      for (const parentId of graph.parents.get(anchorNodeId) ?? []) {
        taken.add(parentId);
      }
    } else if (addMode === "child") {
      for (const childId of graph.children.get(anchorNodeId) ?? []) {
        taken.add(childId);
      }
      for (const parentId of graph.parents.get(anchorNodeId) ?? []) {
        taken.add(parentId);
      }
      for (const link of graph.spouses.get(anchorNodeId) ?? []) {
        taken.add(link.nodeId);
      }
    } else {
      return [];
    }
    const preferred = genderHint === "male" || genderHint === "female" ? genderHint : null;
    return payload.nodes
      .filter((n) => !taken.has(n.id))
      .sort((a, b) => {
        if (!preferred) return 0;
        const ga = genderOfNode(a, identities) === preferred ? 0 : 1;
        const gb = genderOfNode(b, identities) === preferred ? 0 : 1;
        return ga - gb;
      });
  }, [addMode, anchorNodeId, genderHint, graph, identities, payload.nodes]);

  const openEditor = (
    mode: AddMode,
    anchorId?: string | null,
    preset?: { gender?: GenderHint },
  ) => {
    const anchor = payload.nodes.find(
      (n) => n.id === (anchorId ?? selectedNodeId),
    );
    const anchorGender = anchor ? genderOfNode(anchor, identities) : "unknown";
    setAddMode(mode);
    setAnchorNodeId(anchorId ?? selectedNodeId);
    setDisplayName("");
    setBirthYear("");
    setDeathInput("");
    setBirthOrder("");
    setNotes("");
    setPickedIdentityId(null);
    setPickedTreeNodeId(null);
    setAlsoParentNodeId(null);
    setConRieng(false);
    setConRiengOfParentId(null);
    setPhotoPick(null);
    setClearPhoto(false);
    setEditorPhotoUri(null);
    if (mode === "spouse") {
      const adding: GenderHint =
        preset?.gender ?? (anchorGender === "female" ? "male" : "female");
      setGenderHint(adding);
      const existing = graph.spouses.get(anchorId ?? selectedNodeId ?? "") ?? [];
      if (adding === "male") {
        setSpouseLabel("Chồng");
        setSpouseOrder("1");
      } else if (existing.length > 0) {
        const rankIndex = Math.min(existing.length, 2);
        setSpouseLabel(WIFE_RANK_LABELS[rankIndex]);
        setSpouseOrder(String(rankIndex + 1));
      } else {
        setSpouseLabel("Vợ");
        setSpouseOrder("1");
      }
    } else if (mode === "edit") {
      if (!anchor) return;
      setDisplayName(anchor.display_name);
      setBirthYear(anchor.birth_year ? String(anchor.birth_year) : "");
      setDeathInput(formatDeathInput(anchor));
      setBirthOrder(anchor.birth_order ? String(anchor.birth_order) : "");
      setNotes(anchor.notes ?? "");
      setConRieng(Boolean(anchor.con_rieng));
      setConRiengOfParentId(
        anchor.con_rieng
          ? (graph.parents.get(anchor.id) ?? [])[0] ?? null
          : null,
      );
      if (anchor.has_photo) setEditorPhotoUri(selectedPhotoUri);
      const stored =
        anchor.gender_hint === "male" || anchor.gender_hint === "female"
          ? anchor.gender_hint
          : "unknown";
      const inferred = genderOfNode(anchor, identities);
      setGenderHint(stored !== "unknown" ? stored : inferred);
    } else if (mode === "parent") {
      setGenderHint(preset?.gender ?? "unknown");
    } else {
      setSpouseLabel("Vợ");
      setSpouseOrder("1");
      setGenderHint(preset?.gender ?? "unknown");
    }
    if (mode === "child") {
      const id = anchorId ?? selectedNodeId;
      if (id) {
        setAlsoParentNodeId(
          pickAlsoParentId(
            collectOtherParentHints(graph, payload.nodes, identities, id, null),
            null,
          ),
        );
      }
    }
    setEditorOpen(true);
  };

  const applyGender = (gender: GenderHint) => {
    setGenderHint(gender);
    if (addMode !== "spouse") return;
    if (gender === "male") setSpouseLabel("Chồng");
    if (gender === "female") {
      setSpouseLabel((prev) =>
        prev === "Vợ cả" || prev === "Vợ hai" || prev === "Vợ lẽ" ? prev : "Vợ",
      );
    }
  };

  const resolvedAddingGender = (): GenderHint => {
    if (pickedTreeNodeId) {
      const node = payload.nodes.find((n) => n.id === pickedTreeNodeId);
      if (node) {
        const g = genderOfNode(node, identities);
        if (g !== "unknown") return g;
      }
    }
    if (pickedIdentityId) {
      const ident = identities.find((i) => i.id === pickedIdentityId);
      if (ident) {
        const g = genderOfIdentity(ident);
        if (g !== "unknown") return g;
      }
    }
    if (genderHint !== "unknown") return genderHint;
    return inferGenderFromText(displayName);
  };

  const saveEditor = async () => {
    if (!spaceId || saving) return;
    const death = parseDeathInput(deathInput);
    if (death.invalid) {
      setError("Năm mất ghi 1971, hoặc ngày 12/3/1971.");
      return;
    }
    const name = displayName.trim();
    if (!pickedTreeNodeId && !pickedIdentityId && !name) {
      setError("Chọn người hoặc nhập tên.");
      return;
    }
    if (addMode === "edit" && !name) {
      setError("Nhập tên.");
      return;
    }
    if (
      addMode === "edit" &&
      conRieng &&
      (graph.parents.get(anchorNodeId ?? "") ?? []).length > 1 &&
      !conRiengOfParentId
    ) {
      setError("Chọn con riêng của mẹ hay của cha.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const gender = resolvedAddingGender();
      if (addMode === "edit") {
        if (!anchorNodeId) throw new Error("Không tìm thấy người trên gia phả.");
        await api.updateGenealogyNode(spaceId, anchorNodeId, {
          display_name: name,
          birth_year: birthYear ? Number(birthYear) : null,
          death_year: death.year,
          death_date: death.date,
          clear_death_date: !death.date,
          gender_hint: gender,
          birth_order: birthOrder ? Number(birthOrder) : null,
          notes: notes.trim(),
          con_rieng: conRieng,
        });
        if (conRieng) {
          const keep =
            conRiengOfParentId ??
            (graph.parents.get(anchorNodeId) ?? [])[0] ??
            null;
          if (keep) {
            for (const parentId of graph.parents.get(anchorNodeId) ?? []) {
              if (parentId === keep) continue;
              const extra = payload.edges.find(
                (e) =>
                  e.kind === "parent" &&
                  e.from_node_id === parentId &&
                  e.to_node_id === anchorNodeId,
              );
              if (extra) await api.deleteGenealogyEdge(spaceId, extra.id);
            }
          }
        }
        if (photoPick) {
          await api.uploadGenealogyPhoto(spaceId, anchorNodeId, photoPick);
        } else if (clearPhoto) {
          await api.deleteGenealogyPhoto(spaceId, anchorNodeId);
        }
        closeEditor();
        await load();
        setSelectedNodeId(anchorNodeId);
        return;
      }
      const wifeLabel =
        spouseLabel === "Vợ cả" || spouseLabel === "Vợ hai" || spouseLabel === "Vợ lẽ"
          ? spouseLabel
          : gender === "male"
            ? "Chồng"
            : "Vợ";

      const makeSpouseEdge = async (fromId: string, toId: string) => {
        await api.createGenealogyEdge(spaceId, {
          from_node_id: fromId,
          to_node_id: toId,
          kind: "spouse",
          meta: {
            spouse_order: Number(spouseOrder) || 1,
            spouse_label: wifeLabel,
          },
        });
      };

      const childHints =
        addMode === "child" && anchorNodeId
          ? collectOtherParentHints(
              graph,
              payload.nodes,
              identities,
              anchorNodeId,
              pickedTreeNodeId,
            )
          : [];
      const childConRieng =
        addMode === "child" && childHints.length > 0 && !alsoParentNodeId;

      const persistChildConRieng = async (childId: string) => {
        await api.updateGenealogyNode(spaceId, childId, {
          con_rieng: childConRieng,
        });
        if (!childConRieng || !anchorNodeId) return;
        const knownParents = new Set(graph.parents.get(childId) ?? []);
        knownParents.add(anchorNodeId);
        for (const parentId of knownParents) {
          if (parentId === anchorNodeId) continue;
          const extra = payload.edges.find(
            (e) =>
              e.kind === "parent" &&
              e.from_node_id === parentId &&
              e.to_node_id === childId,
          );
          if (extra) await api.deleteGenealogyEdge(spaceId, extra.id);
        }
      };

      const persistGender = async (node: FamilyTreeNode) => {
        if (gender === "unknown") return;
        if (node.gender_hint === gender) return;
        await api.updateGenealogyNode(spaceId, node.id, { gender_hint: gender });
      };

      const makeParentEdge = async (
        parentId: string,
        childId: string,
        role: "father" | "mother" | "unknown",
      ) => {
        if ((graph.parents.get(childId) ?? []).includes(parentId)) return;
        await api.createGenealogyEdge(spaceId, {
          from_node_id: parentId,
          to_node_id: childId,
          kind: "parent",
          meta: { parent_role: role },
        });
      };

      const attachChildParents = async (childId: string) => {
        if (!anchorNodeId) return;
        const anchor = payload.nodes.find((n) => n.id === anchorNodeId);
        await makeParentEdge(
          anchorNodeId,
          childId,
          parentRoleForNode(anchor, identities),
        );
        const hints = collectOtherParentHints(
          graph,
          payload.nodes,
          identities,
          anchorNodeId,
          childId === pickedTreeNodeId ? childId : null,
        );
        if (!alsoParentNodeId || alsoParentNodeId === childId) return;
        const hint = hints.find((h) => h.id === alsoParentNodeId);
        if (!hint) return;
        await makeParentEdge(hint.id, childId, hint.role);
      };

      if (pickedTreeNodeId) {
        const existing = payload.nodes.find((n) => n.id === pickedTreeNodeId);
        if (!existing) throw new Error("Không tìm thấy người trên gia phả.");
        await persistGender(existing);
        if (addMode === "spouse" && anchorNodeId) {
          await makeSpouseEdge(anchorNodeId, existing.id);
        } else if (addMode === "parent" && anchorNodeId) {
          await makeParentEdge(
            existing.id,
            anchorNodeId,
            gender === "female" ? "mother" : gender === "male" ? "father" : "unknown",
          );
        } else if (addMode === "child" && anchorNodeId) {
          await attachChildParents(existing.id);
          await persistChildConRieng(existing.id);
        }
        closeEditor();
        await load();
        setSelectedNodeId(existing.id);
        return;
      }

      const node = await api.createGenealogyNode(spaceId, {
        display_name: name || "Người nhà",
        identity_profile_id: pickedIdentityId,
        birth_year: birthYear ? Number(birthYear) : null,
        death_year: death.year,
        death_date: death.date,
        gender_hint: gender,
        birth_order: birthOrder ? Number(birthOrder) : null,
        notes: notes.trim(),
        con_rieng: childConRieng,
      });
      if (photoPick) {
        await api.uploadGenealogyPhoto(spaceId, node.id, photoPick);
      }

      if (addMode === "spouse" && anchorNodeId) {
        await makeSpouseEdge(anchorNodeId, node.id);
      } else if (addMode === "parent" && anchorNodeId) {
        await makeParentEdge(
          node.id,
          anchorNodeId,
          gender === "female" ? "mother" : gender === "male" ? "father" : "unknown",
        );
      } else if (addMode === "child" && anchorNodeId) {
        await attachChildParents(node.id);
      }

      closeEditor();
      await load();
      setSelectedNodeId(node.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const openProfile = (node: FamilyTreeNode) => {
    if (!spaceId || !node.identity_profile_id) return;
    const ident = identities.find((i) => i.id === node.identity_profile_id);
    if (!ident) return;
    if (ident.status === "remembered") {
      router.push(`/library/${spaceId}/person/${ident.id}`);
    } else {
      router.push(`/people/${spaceId}/${ident.id}`);
    }
  };

  const removeSelected = async () => {
    if (!spaceId || !selectedNodeId || !canEdit) return;
    try {
      await api.deleteGenealogyNode(spaceId, selectedNodeId);
      setSelectedNodeId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được.");
    }
  };

  const pickGravePhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setPhotoPick({
      uri: asset.uri,
      name: asset.fileName ?? "mo.jpg",
      mimeType: asset.mimeType ?? "image/jpeg",
    });
    setEditorPhotoUri(asset.uri);
    setClearPhoto(false);
  };

  const addingGender = resolvedAddingGender();
  const editorTitle =
    addMode === "parent" && genderHint === "male"
      ? `Cha của ${anchorName}`
      : addMode === "parent" && genderHint === "female"
        ? `Mẹ của ${anchorName}`
        : addMode === "parent"
          ? `Cha/mẹ của ${anchorName}`
          : addMode === "spouse" && genderHint === "male"
            ? `Chồng của ${anchorName}`
            : addMode === "spouse"
              ? `Vợ của ${anchorName}`
              : addMode === "child"
                ? `Con của ${anchorName}`
                : addMode === "edit"
                  ? `Sửa ${anchorName}`
                  : "Thêm người";
  const showWifeRank =
    addMode === "spouse" &&
    addingGender === "female" &&
    (graph.spouses.get(anchorNodeId ?? "")?.length ?? 0) > 0;
  const otherParentHints =
    addMode === "child" && anchorNodeId
      ? collectOtherParentHints(
          graph,
          payload.nodes,
          identities,
          anchorNodeId,
          pickedTreeNodeId,
        )
      : [];
  const editParents =
    addMode === "edit" && anchorNodeId
      ? (graph.parents.get(anchorNodeId) ?? [])
          .map((id) => payload.nodes.find((n) => n.id === id))
          .filter((n): n is FamilyTreeNode => Boolean(n))
      : [];
  const showConRiengEditor =
    addMode === "edit" &&
    (conRieng ||
      editParents.some((p) => (graph.spouses.get(p.id) ?? []).length > 0));

  const treeChipLabel = (node: FamilyTreeNode) => {
    const g = genderWord(genderOfNode(node, identities));
    return g ? `${node.display_name} · ${g}` : node.display_name;
  };
  const selectedGenderWord = selectedNode
    ? genderWord(genderOfNode(selectedNode, identities))
    : null;
  const selectedConRiengParent = selectedNode
    ? conRiengParentId(selectedNode.id, graph)
    : null;
  const selectedConRiengName = selectedConRiengParent
    ? (graph.nodes.get(selectedConRiengParent)?.display_name ?? null)
    : null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <>
      <View style={styles.root}>
        {payload.nodes.length > 0 ? (
          <View style={styles.searchSticky}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Tìm theo tên"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {foldName(searchQuery) ? (
              nameMatches.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.pickerRow}>
                    {nameMatches.map((node) => (
                      <Pressable
                        key={node.id}
                        style={[
                          styles.pickChip,
                          selectedNodeId === node.id && styles.pickChipOn,
                        ]}
                        onPress={() => {
                          pendingScrollToActions.current = false;
                          setSelectedNodeId(node.id);
                          scrollToNodeOnTree(node.id);
                        }}
                      >
                        <Text
                          style={[
                            styles.pickChipText,
                            selectedNodeId === node.id && styles.pickChipTextOn,
                          ]}
                          numberOfLines={1}
                        >
                          {node.display_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <Text style={styles.fieldHint}>
                  Không thấy tên này trên gia phả.
                </Text>
              )
            ) : null}
          </View>
        ) : null}
        <ScrollView
          ref={listRef}
          style={styles.scroll}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.brand}
            />
          }
        >
          <Text style={styles.hint}>
            Cuộn theo từng đời. Nam trong họ hơi xanh, nữ hơi vàng, dâu và rể
            thẻ nhạt hơn. Cháu nội / cháu ngoại / con riêng ghi trên thẻ. Chạm
            một người để sửa hoặc thêm quan hệ.
          </Text>

          {payload.nodes.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Chưa có gia phả</Text>
            <Text style={styles.emptyBody}>
              Bắt đầu từ cụ, ông bà hoặc người được nhớ — chọn người đã có trong
              nhà hoặc thêm tên mới.
            </Text>
            {canEdit ? (
              <Pressable style={styles.primaryBtn} onPress={() => openEditor("person")}>
                <Text style={styles.primaryBtnText}>Thêm người đầu tiên</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View
            collapsable={false}
            onLayout={(e) => {
              treeYOnList.current = e.nativeEvent.layout.y;
            }}
          >
            <GenerationBandView
              bands={bands}
              payload={displayPayload}
              selectedNodeId={selectedNodeId}
              onCardOffset={(id, y) => {
                nodeYOnTree.current.set(id, y);
                if (pendingTreeScrollId.current !== id) return;
                pendingTreeScrollId.current = null;
                listRef.current?.scrollTo({
                  y: Math.max(0, treeYOnList.current + y - 12),
                  animated: true,
                });
              }}
              onSelectNode={(node) =>
                setSelectedNodeId((prev) => {
                  if (prev === node.id) {
                    pendingScrollToActions.current = false;
                    return null;
                  }
                  pendingScrollToActions.current = true;
                  return node.id;
                })
              }
            />
          </View>
        )}

        {selectedNode ? (
          <View
            collapsable={false}
            style={styles.actionPanel}
            onLayout={(e) => {
              actionOffsetY.current = e.nativeEvent.layout.y;
              if (!pendingScrollToActions.current) return;
              pendingScrollToActions.current = false;
              listRef.current?.scrollTo({
                y: Math.max(0, e.nativeEvent.layout.y - 16),
                animated: true,
              });
            }}
          >
            <Text style={styles.actionTitle}>{selectedNode.display_name}</Text>
            {nodeYearLine(selectedNode) ? (
              <Text style={styles.actionYears}>{nodeYearLine(selectedNode)}</Text>
            ) : null}
            {selectedGenderWord ? (
              <Text style={styles.actionYears}>{selectedGenderWord}</Text>
            ) : null}
            {selectedConRiengName ? (
              <Text style={styles.actionYears}>
                Con riêng của {selectedConRiengName}
              </Text>
            ) : null}
            {selectedNode.notes?.trim() ? (
              <View style={styles.notesBlock}>
                <Text style={styles.notesLabel}>Chú thích</Text>
                <Text style={styles.notesBody}>{selectedNode.notes.trim()}</Text>
              </View>
            ) : canEdit ? (
              <Text style={styles.fieldHint}>
                Chưa có chú thích. Sửa thông tin để ghi tên hiệu, nghề, nơi táng…
              </Text>
            ) : null}
            {selectedPhotoUri ? (
              <View style={styles.notesBlock}>
                <Text style={styles.notesLabel}>Ảnh mộ / bài vị</Text>
                <Pressable onPress={() => setLightboxOpen(true)}>
                  <Image
                    source={{ uri: selectedPhotoUri }}
                    style={styles.photoThumb}
                    resizeMode="cover"
                  />
                </Pressable>
              </View>
            ) : selectedNode.has_photo ? null : canEdit ? (
              <Text style={styles.fieldHint}>
                Chưa có ảnh mộ hay bài vị. Thêm khi sửa thông tin.
              </Text>
            ) : null}
            <PersonRelationsBlock
              graph={graph}
              nodeId={selectedNode.id}
              onPressPerson={(id) => {
                pendingScrollToActions.current = true;
                setSelectedNodeId(id);
              }}
            />
            {canEdit ? (
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => openEditor("edit", selectedNode.id)}
                >
                  <Text style={styles.secondaryBtnText}>Sửa thông tin</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() =>
                    openEditor("parent", selectedNode.id, { gender: "male" })
                  }
                >
                  <Text style={styles.secondaryBtnText}>Thêm cha</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() =>
                    openEditor("parent", selectedNode.id, { gender: "female" })
                  }
                >
                  <Text style={styles.secondaryBtnText}>Thêm mẹ</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => openEditor("child", selectedNode.id)}
                >
                  <Text style={styles.secondaryBtnText}>Thêm con</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() =>
                    openEditor("spouse", selectedNode.id, { gender: "female" })
                  }
                >
                  <Text style={styles.secondaryBtnText}>Thêm vợ</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() =>
                    openEditor("spouse", selectedNode.id, { gender: "male" })
                  }
                >
                  <Text style={styles.secondaryBtnText}>Thêm chồng</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.actionRow}>
              {selectedNode.identity_profile_id ? (
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => openProfile(selectedNode)}
                >
                  <Text style={styles.secondaryBtnText}>Mở hồ sơ</Text>
                </Pressable>
              ) : null}
              {canEdit ? (
                <Pressable style={styles.dangerBtn} onPress={() => void removeSelected()}>
                  <Text style={styles.dangerBtnText}>Xóa khỏi gia phả</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {canEdit && payload.nodes.length > 0 ? (
          <Pressable style={styles.primaryBtn} onPress={() => openEditor("person")}>
            <Text style={styles.primaryBtnText}>Thêm người</Text>
          </Pressable>
        ) : null}

        {error && !editorOpen ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      </View>

      <Modal
        visible={editorOpen}
        animationType="slide"
        transparent
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          style={styles.modalFlex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          <View
            style={[
              styles.modalBackdrop,
              Platform.OS === "android"
                ? { paddingBottom: androidKeyboardInset }
                : null,
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeEditor}
              accessibilityRole="button"
              accessibilityLabel="Đóng"
            />
            <View
              style={[
                styles.modalSheet,
                { paddingBottom: Math.max(insets.bottom, 12) },
              ]}
            >
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <Text style={styles.modalTitle}>{editorTitle}</Text>
                <Text style={styles.fieldHint}>
                  {addMode === "edit"
                    ? "Đổi tên, năm sinh, ngày mất hoặc giới tính."
                    : addMode === "parent"
                    ? `Người bạn chọn là bố hoặc mẹ của ${anchorName}.`
                    : addMode === "spouse"
                      ? genderHint === "male"
                        ? `Chọn hoặc nhập chồng của ${anchorName}.`
                        : `Chọn hoặc nhập vợ của ${anchorName}.`
                      : addMode === "child"
                        ? `Thêm con của ${anchorName}.`
                        : "Thêm một người vào gia phả."}
                </Text>
                {addMode !== "edit" && addingGender !== "unknown" ? (
                  <Text style={styles.fieldHint}>
                    {addingPersonName} · {genderWord(addingGender)}
                    {addMode === "parent"
                      ? ` · sẽ là ${addingGender === "male" ? "cha" : "mẹ"} của ${anchorName}`
                      : addMode === "spouse"
                        ? ` · sẽ là ${addingGender === "male" ? "chồng" : "vợ"} của ${anchorName}`
                        : ""}
                    .
                  </Text>
                ) : null}

                {addMode !== "edit" && linkableTreeNodes.length ? (
                  <View style={styles.pickerBlock}>
                    <Text style={styles.fieldLabel}>Đã có trên gia phả</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View style={styles.pickerRow}>
                        <Pressable
                          style={[
                            styles.pickChip,
                            !pickedTreeNodeId && styles.pickChipOn,
                          ]}
                          onPress={() => {
                            setPickedTreeNodeId(null);
                            if (addMode === "child" && anchorNodeId) {
                              setAlsoParentNodeId(
                                pickAlsoParentId(
                                  collectOtherParentHints(
                                    graph,
                                    payload.nodes,
                                    identities,
                                    anchorNodeId,
                                    null,
                                  ),
                                  alsoParentNodeId,
                                ),
                              );
                            }
                          }}
                        >
                          <Text
                            style={[
                              styles.pickChipText,
                              !pickedTreeNodeId && styles.pickChipTextOn,
                            ]}
                          >
                            {addMode === "parent"
                              ? genderHint === "male"
                                ? "Nhập cha mới"
                                : genderHint === "female"
                                  ? "Nhập mẹ mới"
                                  : "Nhập tên mới"
                              : addMode === "spouse"
                                ? genderHint === "male"
                                  ? "Nhập chồng mới"
                                  : "Nhập vợ mới"
                                : addMode === "child"
                                  ? "Nhập con mới"
                                  : "Người mới"}
                          </Text>
                        </Pressable>
                        {linkableTreeNodes.map((node) => (
                          <Pressable
                            key={node.id}
                            style={[
                              styles.pickChip,
                              pickedTreeNodeId === node.id && styles.pickChipOn,
                            ]}
                            onPress={() => {
                              setPickedTreeNodeId(node.id);
                              setPickedIdentityId(null);
                              setDisplayName(node.display_name);
                              const g = genderOfNode(node, identities);
                              if (g !== "unknown") applyGender(g);
                              if (addMode === "child" && anchorNodeId) {
                                setAlsoParentNodeId(
                                  pickAlsoParentId(
                                    collectOtherParentHints(
                                      graph,
                                      payload.nodes,
                                      identities,
                                      anchorNodeId,
                                      node.id,
                                    ),
                                    alsoParentNodeId,
                                  ),
                                );
                              }
                            }}
                          >
                            <Text
                              style={[
                                styles.pickChipText,
                                pickedTreeNodeId === node.id &&
                                  styles.pickChipTextOn,
                              ]}
                              numberOfLines={1}
                            >
                              {treeChipLabel(node)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}

                {pickedTreeNodeId ? (
                  <View style={styles.pickerBlock}>
                    <Text style={styles.fieldLabel}>
                      Quan hệ đã ghi của {addingPersonName}
                    </Text>
                    <PersonRelationsBlock
                      graph={graph}
                      nodeId={pickedTreeNodeId}
                      compact
                    />
                  </View>
                ) : null}

                {addMode !== "edit" &&
                linkableIdentities.length &&
                !pickedTreeNodeId ? (
                  <View style={styles.pickerBlock}>
                    <Text style={styles.fieldLabel}>Hồ sơ trong nhà</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View style={styles.pickerRow}>
                        <Pressable
                          style={[
                            styles.pickChip,
                            !pickedIdentityId && styles.pickChipOn,
                          ]}
                          onPress={() => setPickedIdentityId(null)}
                        >
                          <Text
                            style={[
                              styles.pickChipText,
                              !pickedIdentityId && styles.pickChipTextOn,
                            ]}
                          >
                            Nhập tên mới
                          </Text>
                        </Pressable>
                        {linkableIdentities.map((ident) => (
                          <Pressable
                            key={ident.id}
                            style={[
                              styles.pickChip,
                              pickedIdentityId === ident.id && styles.pickChipOn,
                            ]}
                            onPress={() => {
                              setPickedIdentityId(ident.id);
                              setDisplayName(ident.display_name);
                              const guessed = genderOfIdentity(ident);
                              if (guessed !== "unknown") applyGender(guessed);
                            }}
                          >
                            <Text
                              style={[
                                styles.pickChipText,
                                pickedIdentityId === ident.id &&
                                  styles.pickChipTextOn,
                              ]}
                              numberOfLines={1}
                            >
                              {identityChipLabel(ident)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}

                {pickedTreeNodeId ? null : (
                  <>
                    <Text style={styles.fieldLabel}>Tên</Text>
                    <TextInput
                      style={styles.input}
                      value={displayName}
                      onChangeText={(v) => {
                        setDisplayName(v);
                        const g = inferGenderFromText(v);
                        if (g !== "unknown") applyGender(g);
                      }}
                      placeholder="Nguyễn Văn …"
                      placeholderTextColor={colors.inkSoft}
                      editable={!pickedIdentityId}
                      returnKeyType="next"
                    />

                    <Text style={styles.fieldLabel}>Năm sinh (tuỳ chọn)</Text>
                    <TextInput
                      style={styles.input}
                      value={birthYear}
                      onChangeText={setBirthYear}
                      keyboardType="number-pad"
                      placeholder="1940"
                      placeholderTextColor={colors.inkSoft}
                    />

                    <Text style={styles.fieldLabel}>
                      Năm hoặc ngày mất (tuỳ chọn)
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={deathInput}
                      onChangeText={setDeathInput}
                      placeholder="1971 hoặc 12/3/1971"
                      placeholderTextColor={colors.inkSoft}
                      autoCapitalize="none"
                    />
                    <Text style={styles.fieldHint}>
                      Có ngày dương thì Forever ghi vào lịch gia đình.
                    </Text>

                    <Text style={styles.fieldLabel}>Chú thích (tuỳ chọn)</Text>
                    <TextInput
                      style={[styles.input, styles.notesInput]}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Tên hiệu, nghề sinh thời, táng tại…"
                      placeholderTextColor={colors.inkSoft}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.fieldLabel}>Ảnh mộ / bài vị (tuỳ chọn)</Text>
                    {editorPhotoUri && !clearPhoto ? (
                      <Image
                        source={{ uri: editorPhotoUri }}
                        style={styles.photoThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.fieldHint}>
                        Thường là ảnh bia mộ hoặc bài vị trên bàn thờ.
                      </Text>
                    )}
                    <View style={styles.actionRow}>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => void pickGravePhoto()}
                      >
                        <Text style={styles.secondaryBtnText}>
                          {editorPhotoUri && !clearPhoto ? "Đổi ảnh" : "Thêm ảnh"}
                        </Text>
                      </Pressable>
                      {editorPhotoUri && !clearPhoto ? (
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={() => {
                            setPhotoPick(null);
                            setEditorPhotoUri(null);
                            setClearPhoto(true);
                          }}
                        >
                          <Text style={styles.secondaryBtnText}>Gỡ ảnh</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </>
                )}

                {addMode === "spouse" ? null : (
                  <>
                    <Text style={styles.fieldLabel}>
                      {addMode === "parent"
                        ? "Người này là"
                        : addMode === "child"
                          ? "Con trai / con gái"
                          : "Giới tính"}
                    </Text>
                    <View style={styles.actionRow}>
                      {(addMode === "parent"
                        ? ([
                            ["male", "Cha"],
                            ["female", "Mẹ"],
                          ] as const)
                        : addMode === "child"
                          ? ([
                              ["male", "Con trai"],
                              ["female", "Con gái"],
                              ["unknown", "Chưa rõ"],
                            ] as const)
                          : ([
                              ["male", "Nam"],
                              ["female", "Nữ"],
                              ["unknown", "Chưa rõ"],
                            ] as const)
                      ).map(([g, label]) => (
                        <Pressable
                          key={g}
                          style={[
                            styles.pickChip,
                            genderHint === g && styles.pickChipOn,
                          ]}
                          onPress={() => applyGender(g)}
                        >
                          <Text
                            style={[
                              styles.pickChipText,
                              genderHint === g && styles.pickChipTextOn,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}

                {addMode === "child" || addMode === "person" || addMode === "edit" ? (
                  <>
                    <Text style={styles.fieldLabel}>
                      Thứ tự anh chị em (tuỳ chọn)
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={birthOrder}
                      onChangeText={setBirthOrder}
                      keyboardType="number-pad"
                      placeholder="1 = trưởng"
                      placeholderTextColor={colors.inkSoft}
                    />
                  </>
                ) : null}

                {addMode === "child" && otherParentHints.length ? (
                  <View style={styles.pickerBlock}>
                    <Text style={styles.fieldLabel}>
                      Cha/mẹ kia (bỏ chọn nếu con riêng)
                    </Text>
                    <View style={styles.actionRow}>
                      {otherParentHints.map((hint) => {
                        const on = alsoParentNodeId === hint.id;
                        return (
                          <Pressable
                            key={hint.id}
                            style={[styles.pickChip, on && styles.pickChipOn]}
                            onPress={() => {
                              const next = on ? null : hint.id;
                              setAlsoParentNodeId(next);
                              setConRieng(!next);
                              setConRiengOfParentId(
                                next ? null : (anchorNodeId ?? null),
                              );
                            }}
                          >
                            <Text
                              style={[
                                styles.pickChipText,
                                on && styles.pickChipTextOn,
                              ]}
                              numberOfLines={1}
                            >
                              {hint.role === "mother" ? "Mẹ là" : "Cha là"}{" "}
                              {hint.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.fieldHint}>
                      Để chip bật nếu là con của cả hai — hầu hết đúng. Chỉ bỏ
                      khi là con riêng, như cô Tâm với bà nội.
                    </Text>
                  </View>
                ) : null}

                {showConRiengEditor ? (
                  <View style={styles.pickerBlock}>
                    <Text style={styles.fieldLabel}>Con chung hay con riêng</Text>
                    <View style={styles.actionRow}>
                      <Pressable
                        style={[styles.pickChip, !conRieng && styles.pickChipOn]}
                        onPress={() => {
                          setConRieng(false);
                          setConRiengOfParentId(null);
                        }}
                      >
                        <Text
                          style={[
                            styles.pickChipText,
                            !conRieng && styles.pickChipTextOn,
                          ]}
                        >
                          Con chung
                        </Text>
                      </Pressable>
                      {editParents.map((parent) => {
                        const on =
                          conRieng && conRiengOfParentId === parent.id;
                        return (
                          <Pressable
                            key={parent.id}
                            style={[styles.pickChip, on && styles.pickChipOn]}
                            onPress={() => {
                              setConRieng(true);
                              setConRiengOfParentId(parent.id);
                            }}
                          >
                            <Text
                              style={[
                                styles.pickChipText,
                                on && styles.pickChipTextOn,
                              ]}
                              numberOfLines={1}
                            >
                              Con riêng của {parent.display_name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.fieldHint}>
                      Con chung giữ vợ/chồng đã lưu. Chỉ chọn con riêng khi
                      như cô Tâm — con của bà nội, không phải của ông nội.
                    </Text>
                  </View>
                ) : null}

                {showWifeRank ? (
                  <>
                    <Text style={styles.fieldLabel}>
                      {anchorName} đã có vợ — đây là vợ thứ mấy?
                    </Text>
                    <View style={styles.actionRow}>
                      {WIFE_RANK_LABELS.map((label, index) => (
                        <Pressable
                          key={label}
                          style={[
                            styles.pickChip,
                            spouseLabel === label && styles.pickChipOn,
                          ]}
                          onPress={() => {
                            setSpouseLabel(label);
                            setSpouseOrder(String(index + 1));
                            setGenderHint("female");
                          }}
                        >
                          <Text
                            style={[
                              styles.pickChipText,
                              spouseLabel === label && styles.pickChipTextOn,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
              </ScrollView>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.modalActions}>
                <Pressable style={styles.secondaryBtn} onPress={closeEditor}>
                  <Text style={styles.secondaryBtnText}>Huỷ</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => void saveEditor()}
                  disabled={saving}
                >
                  <Text style={styles.primaryBtnText}>
                    {saving ? "Đang lưu…" : "Lưu"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <PhotoLightbox
        uri={selectedPhotoUri}
        visible={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  list: { padding: 16, paddingBottom: 48, gap: 12 },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  searchSticky: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  emptyBox: {
    gap: 10,
    paddingVertical: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
  },
  emptyBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  actionPanel: {
    marginTop: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 10,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  actionYears: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    marginTop: -4,
  },
  notesBlock: { gap: 4, marginTop: 2 },
  notesLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  notesBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  notesInput: {
    minHeight: 88,
    paddingTop: 10,
  },
  photoThumb: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: "#f4efe6",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  secondaryBtnText: {
    color: colors.brandSoft,
    fontWeight: "600",
    fontSize: 14,
  },
  dangerBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  dangerBtnText: {
    color: colors.danger,
    fontWeight: "600",
    fontSize: 14,
  },
  error: { color: colors.danger, paddingTop: 4 },
  modalFlex: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalSheet: {
    width: "100%",
    maxHeight: "92%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalScrollContent: { gap: 10, paddingBottom: 8 },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  fieldHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  pickerBlock: { gap: 8 },
  pickerRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  pickChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pickChipOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  pickChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  pickChipTextOn: { color: "#f4efe6" },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
}));
