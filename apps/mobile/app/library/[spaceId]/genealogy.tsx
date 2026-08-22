import {
  FamilyTreeNode,
  GenealogyPayload,
  IdentityProfile,
} from "@forever/api-client";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { GenerationBandView } from "@/components/genealogy/GenerationBandView";
import { GenealogyTabs } from "@/components/genealogy/GenealogyTabs";
import { useAuth } from "@/lib/auth";
import { isLoginMirror } from "@/lib/identityDisplay";
import { layoutGenerationBands } from "@/lib/genealogyLayout";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, createThemedStyles } from "@/lib/theme";

type AddMode = "person" | "spouse" | "parent" | "child";

const SPOUSE_LABELS = ["Vợ cả", "Vợ lẽ", "Thất thế", "Vợ", "Chồng"];

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
  const [genderHint, setGenderHint] = useState<"male" | "female" | "unknown">(
    "unknown",
  );
  const [birthOrder, setBirthOrder] = useState("");
  const [spouseLabel, setSpouseLabel] = useState("Vợ");
  const [spouseOrder, setSpouseOrder] = useState("1");
  const [pickedIdentityId, setPickedIdentityId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: "Lịch & gia phả",
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

  const bands = useMemo(() => layoutGenerationBands(payload), [payload]);
  const selectedNode = useMemo(
    () => payload.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [payload.nodes, selectedNodeId],
  );

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

  const openEditor = (mode: AddMode, anchorId?: string | null) => {
    setAddMode(mode);
    setAnchorNodeId(anchorId ?? selectedNodeId);
    setDisplayName("");
    setBirthYear("");
    setGenderHint("unknown");
    setBirthOrder("");
    setSpouseLabel(mode === "spouse" ? "Vợ" : "Vợ cả");
    setSpouseOrder("1");
    setPickedIdentityId(null);
    setEditorOpen(true);
  };

  const saveEditor = async () => {
    if (!spaceId || saving) return;
    const name = displayName.trim();
    if (!pickedIdentityId && !name) {
      setError("Nhập tên hoặc chọn người trong nhà.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const node = await api.createGenealogyNode(spaceId, {
        display_name: name || "Người nhà",
        identity_profile_id: pickedIdentityId,
        birth_year: birthYear ? Number(birthYear) : null,
        gender_hint: genderHint,
        birth_order: birthOrder ? Number(birthOrder) : null,
      });

      if (addMode === "spouse" && anchorNodeId) {
        await api.createGenealogyEdge(spaceId, {
          from_node_id: anchorNodeId,
          to_node_id: node.id,
          kind: "spouse",
          meta: {
            spouse_order: Number(spouseOrder) || 1,
            spouse_label: spouseLabel.trim() || "Vợ",
          },
        });
      } else if (addMode === "parent" && anchorNodeId) {
        await api.createGenealogyEdge(spaceId, {
          from_node_id: node.id,
          to_node_id: anchorNodeId,
          kind: "parent",
          meta: {
            parent_role:
              genderHint === "female"
                ? "mother"
                : genderHint === "male"
                  ? "father"
                  : "unknown",
          },
        });
      } else if (addMode === "child" && anchorNodeId) {
        await api.createGenealogyEdge(spaceId, {
          from_node_id: anchorNodeId,
          to_node_id: node.id,
          kind: "parent",
          meta: {
            parent_role: "unknown",
          },
        });
      }

      setEditorOpen(false);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.list}
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
        <GenealogyTabs spaceId={spaceId ?? ""} />
        <Text style={styles.hint}>
          Cuộn theo từng đời — một người có thể có nhiều vợ hoặc chồng. Chạm
          vào tên để thêm quan hệ.
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
          <GenerationBandView
            bands={bands}
            payload={payload}
            selectedNodeId={selectedNodeId}
            onSelectNode={(node) =>
              setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
            }
          />
        )}

        {selectedNode ? (
          <View style={styles.actionPanel}>
            <Text style={styles.actionTitle}>{selectedNode.display_name}</Text>
            {canEdit ? (
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => openEditor("parent", selectedNode.id)}
                >
                  <Text style={styles.secondaryBtnText}>Thêm cha/mẹ</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => openEditor("child", selectedNode.id)}
                >
                  <Text style={styles.secondaryBtnText}>Thêm con</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => openEditor("spouse", selectedNode.id)}
                >
                  <Text style={styles.secondaryBtnText}>Thêm vợ/chồng</Text>
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

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <Modal visible={editorOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {addMode === "person"
                ? "Thêm người"
                : addMode === "spouse"
                  ? "Thêm vợ/chồng"
                  : addMode === "parent"
                    ? "Thêm cha/mẹ"
                    : "Thêm con"}
            </Text>

            {linkableIdentities.length ? (
              <View style={styles.pickerBlock}>
                <Text style={styles.fieldLabel}>Chọn trong nhà</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                        }}
                      >
                        <Text
                          style={[
                            styles.pickChipText,
                            pickedIdentityId === ident.id && styles.pickChipTextOn,
                          ]}
                          numberOfLines={1}
                        >
                          {ident.display_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Tên</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Nguyễn Văn …"
              placeholderTextColor={colors.inkSoft}
              editable={!pickedIdentityId}
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

            <Text style={styles.fieldLabel}>Giới tính (gợi ý anh/chị/em)</Text>
            <View style={styles.actionRow}>
              {(["male", "female", "unknown"] as const).map((g) => (
                <Pressable
                  key={g}
                  style={[styles.pickChip, genderHint === g && styles.pickChipOn]}
                  onPress={() => setGenderHint(g)}
                >
                  <Text
                    style={[
                      styles.pickChipText,
                      genderHint === g && styles.pickChipTextOn,
                    ]}
                  >
                    {g === "male" ? "Nam" : g === "female" ? "Nữ" : "Chưa rõ"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {addMode === "child" || addMode === "person" ? (
              <>
                <Text style={styles.fieldLabel}>Thứ tự anh chị em (tuỳ chọn)</Text>
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

            {addMode === "spouse" ? (
              <>
                <Text style={styles.fieldLabel}>Nhãn vợ/chồng</Text>
                <View style={styles.actionRow}>
                  {SPOUSE_LABELS.map((label) => (
                    <Pressable
                      key={label}
                      style={[
                        styles.pickChip,
                        spouseLabel === label && styles.pickChipOn,
                      ]}
                      onPress={() => setSpouseLabel(label)}
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
                <Text style={styles.fieldLabel}>Thứ tự (vợ thứ mấy)</Text>
                <TextInput
                  style={styles.input}
                  value={spouseOrder}
                  onChangeText={setSpouseOrder}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={colors.inkSoft}
                />
              </>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setEditorOpen(false)}
              >
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
      </Modal>
    </>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
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
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalSheet: {
    maxHeight: "88%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 10,
  },
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
  },
}));
