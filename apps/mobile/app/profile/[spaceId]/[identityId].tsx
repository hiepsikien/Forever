import {
  FamilySpace,
  IdentityProfile,
  IdentityProfileRevision,
  StewardshipStatus,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

/**
 * Bản sắc — the Identity Lock behind a remembered person's voice.
 *
 * This is what decides whether the entity sounds like your father or like a
 * chatbot wearing his name. Entry is from Cài đặt, not the library — changing
 * who someone was should take a deliberate walk, not a chip on a shelf.
 */

type AddressPair = { self: string; other: string; notes?: string };

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const label = row.label ?? row.text;
        return typeof label === "string" ? label : "";
      }
      return "";
    })
    .filter((text) => text.trim().length > 0);
}

function asPair(value: unknown, fallback: AddressPair): AddressPair {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  return {
    self: typeof row.self === "string" ? row.self : fallback.self,
    other: typeof row.other === "string" ? row.other : fallback.other,
    notes: typeof row.notes === "string" ? row.notes : undefined,
  };
}

function formatRevisionWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Date(t).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Bỏ dòng trống — sửa tại chỗ nghĩa là một dòng có thể bị xoá sạch chữ. */
function cleanList(items: string[]): string[] {
  return items.map((i) => i.trim()).filter(Boolean);
}

function ListEditor({
  label,
  help,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  help: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, text]);
    setDraft("");
  };
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.help}>{help}</Text>
      {items.map((item, idx) => (
        <View key={`row-${idx}`} style={styles.listRow}>
          <TextInput
            style={styles.listInput}
            value={item}
            onChangeText={(text) =>
              onChange(items.map((v, i) => (i === idx ? text : v)))
            }
            placeholder={placeholder}
            placeholderTextColor={colors.inkSoft}
            multiline
          />
          <Pressable
            hitSlop={8}
            onPress={() => onChange(items.filter((_, i) => i !== idx))}
          >
            <Text style={styles.remove}>Xoá</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.addInput]}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.inkSoft}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Pressable
          style={[styles.smallBtn, !draft.trim() && styles.disabled]}
          onPress={add}
          disabled={!draft.trim()}
        >
          <Text style={styles.smallBtnText}>Thêm</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function IdentityLockScreen() {
  const { spaceId, identityId } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [identity, setIdentity] = useState<IdentityProfile | null>(null);
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [stewardship, setStewardship] = useState<StewardshipStatus | null>(null);
  const [revisions, setRevisions] = useState<IdentityProfileRevision[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [relation, setRelation] = useState("");
  const [coreValues, setCoreValues] = useState<string[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [hardTaboos, setHardTaboos] = useState<string[]>([]);
  const [withChildren, setWithChildren] = useState<AddressPair>({
    self: "",
    other: "",
  });
  const [withSpouse, setWithSpouse] = useState<AddressPair>({
    self: "",
    other: "",
  });
  const [withGrandchildren, setWithGrandchildren] = useState<AddressPair>({
    self: "",
    other: "",
  });
  const [dynamicContext, setDynamicContext] = useState("");

  useSpaceScreenOptions({
    spaceId,
    title: "Bản sắc",
    showSettings: false,
    backTitle: "Cài đặt",
  });

  const hydrate = useCallback((row: IdentityProfile) => {
    setIdentity(row);
    setDisplayName(row.display_name ?? "");
    setHandle((row.handle ?? "").replace(/^@/, ""));
    setRelation(row.relation_label ?? "");
    setCoreValues(asStringList(row.core_values));
    setRoles(asStringList(row.roles));
    const speech = (row.speech_style ?? {}) as Record<string, unknown>;
    setTraits(asStringList(speech.traits));
    const taboos = (row.taboos ?? {}) as Record<string, unknown>;
    setHardTaboos(asStringList(taboos.hard));
    const address = (row.address_forms ?? {}) as Record<string, unknown>;
    setWithChildren(asPair(address.with_children, { self: "", other: "" }));
    setWithSpouse(asPair(address.with_spouse, { self: "", other: "" }));
    setWithGrandchildren(
      asPair(address.with_grandchildren, { self: "", other: "" }),
    );
    setDynamicContext(row.dynamic_context ?? "");
  }, []);

  const loadRevisions = useCallback(async () => {
    if (!spaceId || !identityId) return;
    try {
      const res = await api.listIdentityRevisions(spaceId, identityId);
      setRevisions(res.revisions);
    } catch {
      setRevisions([]);
    }
  }, [api, identityId, spaceId]);

  const load = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setLoading(true);
    try {
      const [res, spaceRes, stewardRes] = await Promise.all([
        api.listIdentities(spaceId, true),
        api.getSpace(spaceId),
        api.getStewardship(spaceId),
      ]);
      const row = res.identities.find((i) => i.id === identityId);
      if (!row) throw new Error("Không tìm thấy hồ sơ này.");
      setSpace(spaceRes);
      setStewardship(stewardRes);
      hydrate(row);
      await loadRevisions();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải được hồ sơ.");
    } finally {
      setLoading(false);
    }
  }, [api, hydrate, identityId, loadRevisions, spaceId]);

  useLayoutEffect(() => {
    void load();
  }, [load]);

  const missing = useMemo(() => {
    const gaps: string[] = [];
    const values = cleanList(coreValues);
    if (values.length < 3) {
      gaps.push(`Giá trị sống — cần ít nhất 3, đang có ${values.length}`);
    }
    if (cleanList(traits).length < 1) gaps.push("Khẩu khí — cần ít nhất 1 nét");
    if (!withChildren.self.trim() && !withSpouse.self.trim()) {
      gaps.push("Cách xưng hô — điền ít nhất một cặp");
    }
    if (cleanList(hardTaboos).length < 1) {
      gaps.push("Điều không bao giờ nói — cần ít nhất 1");
    }
    return gaps;
  }, [coreValues, traits, withChildren, withSpouse, hardTaboos]);

  const buildPayload = () => {
    const address: Record<string, AddressPair> = {};
    if (withChildren.self.trim() || withChildren.other.trim()) {
      address.with_children = {
        self: withChildren.self.trim(),
        other: withChildren.other.trim(),
      };
    }
    if (withSpouse.self.trim() || withSpouse.other.trim()) {
      address.with_spouse = {
        self: withSpouse.self.trim(),
        other: withSpouse.other.trim(),
        ...(withSpouse.notes ? { notes: withSpouse.notes } : {}),
      };
    }
    if (withGrandchildren.self.trim() || withGrandchildren.other.trim()) {
      address.with_grandchildren = {
        self: withGrandchildren.self.trim(),
        other: withGrandchildren.other.trim(),
      };
    }
    return {
      display_name: displayName.trim(),
      relation_label: relation.trim(),
      handle: handle.trim().replace(/^@/, "").toLowerCase() || undefined,
      core_values: cleanList(coreValues),
      roles: cleanList(roles),
      speech_style: { traits: cleanList(traits) },
      taboos: { hard: cleanList(hardTaboos) },
      address_forms: address,
      dynamic_context: dynamicContext.trim(),
    };
  };

  const save = async (markReviewed: boolean) => {
    if (!spaceId || !identityId || saving) return;
    if (!displayName.trim()) {
      Alert.alert("Thiếu tên", "Hồ sơ cần một cái tên.");
      return;
    }
    const handleClean = handle.trim().replace(/^@/, "").toLowerCase();
    if (handleClean && (handleClean.length < 2 || handleClean.length > 32)) {
      Alert.alert("@handle", "Handle cần từ 2 đến 32 ký tự (a–z, 0–9, _).");
      return;
    }
    if (markReviewed && missing.length) {
      Alert.alert(
        "Chưa đủ để duyệt",
        `Còn thiếu:\n\n${missing.map((m) => `· ${m}`).join("\n")}`,
      );
      return;
    }
    setSaving(true);
    try {
      const row = await api.updateIdentity(spaceId, identityId, {
        ...buildPayload(),
        ...(markReviewed ? { mark_profile_reviewed: true } : {}),
      });
      hydrate(row);
      await loadRevisions();
      Alert.alert(
        "Đã lưu",
        markReviewed
          ? "Bản sắc đã được duyệt. Thực thể ký ức có thể thức tỉnh."
          : "Đã lưu bản nháp.",
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const restoreRevision = (rev: IdentityProfileRevision) => {
    if (!spaceId || !identityId || restoring) return;
    Alert.alert(
      "Khôi phục bản này?",
      `Đưa Bản sắc về trạng thái lúc ${formatRevisionWhen(rev.created_at)}${
        rev.created_by_name ? ` (lưu bởi ${rev.created_by_name})` : ""
      }. Bản hiện tại sẽ được giữ trong lịch sử.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Khôi phục",
          onPress: () => {
            void (async () => {
              setRestoring(true);
              try {
                const res = await api.restoreIdentityRevision(
                  spaceId,
                  identityId,
                  rev.id,
                );
                hydrate(res.identity);
                await loadRevisions();
                Alert.alert("Đã khôi phục", "Bản sắc đã về đúng bản bạn chọn.");
              } catch (e) {
                Alert.alert(
                  "Lỗi",
                  e instanceof Error ? e.message : "Không khôi phục được.",
                );
              } finally {
                setRestoring(false);
              }
            })();
          },
        },
      ],
    );
  };

  const canArchive =
    space?.role === "owner" || Boolean(stewardship?.is_steward);
  const canShelve =
    canArchive &&
    !!identity &&
    !identity.archived_at &&
    !identity.linked_user_id;

  const confirmArchive = () => {
    if (!spaceId || !identityId || !identity || archiveBusy) return;
    Alert.alert(
      `Lưu trữ ${identity.display_name}?`,
      "Hồ sơ sẽ ẩn khỏi Thư viện và Voice DNA. Không có gì bị xoá — khôi phục lại bất cứ lúc nào từ Cài đặt.",
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Lưu trữ",
          onPress: () => {
            void (async () => {
              setArchiveBusy(true);
              try {
                await api.archiveIdentity(spaceId, identityId);
                Alert.alert("Đã lưu trữ", "Hồ sơ đã ẩn khỏi danh sách.");
                router.back();
              } catch (e) {
                Alert.alert(
                  "Lỗi",
                  e instanceof Error ? e.message : "Không lưu trữ được.",
                );
              } finally {
                setArchiveBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const previous = revisions[0] ?? null;
  const busy = saving || restoring || archiveBusy;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.intro}>
          Lớp riêng người này: giá trị, khẩu khí, xưng hô. Forever giữ hai lớp
          kia — quy tắc ứng dụng (không bịa, không giả còn sống) và hiến chương
          gia đình (không chia rẽ, không quyết thay người sống). Chỉ ghi điều nhà
          mình biết chắc.
        </Text>

        <View style={[styles.card, missing.length ? styles.cardWarn : styles.cardOk]}>
          <Text style={styles.cardTitle}>
            {missing.length ? "Còn thiếu để duyệt" : "Đủ điều kiện duyệt"}
          </Text>
          {missing.length ? (
            missing.map((gap) => (
              <Text key={gap} style={styles.gap}>
                · {gap}
              </Text>
            ))
          ) : (
            <Text style={styles.gap}>
              {identity?.profile_reviewed_at
                ? "Bản sắc đã được duyệt."
                : "Bấm «Lưu và duyệt» để mở đường cho Thức tỉnh."}
            </Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Tên hiển thị</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="vd. Nguyễn Đình Triệu"
            placeholderTextColor={colors.inkSoft}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>@handle</Text>
          <Text style={styles.help}>
            Tên ngắn để @ trong chat (a–z, 0–9, _). Owner và moderator đổi được.
            Hồ sơ gắn tài khoản: đổi ở đây cũng đổi @ tài khoản.
          </Text>
          <TextInput
            style={styles.input}
            value={handle}
            onChangeText={(t) =>
              setHandle(t.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
            placeholder="vd. bo_trieu"
            placeholderTextColor={colors.inkSoft}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>
            {identity?.status === "remembered"
              ? "Cả nhà gọi người này"
              : "Với người đã mất, đây là"}
          </Text>
          <Text style={styles.help}>
            {identity?.status === "remembered"
              ? "Bố, Ông… — cách cả nhà gọi, không phải vai trò với tài khoản quản trị."
              : "Vợ, Con hoặc Cháu của người đã mất. Không phải Anh/Chị/Mẹ theo mắt chủ nhà."}
          </Text>
          <TextInput
            style={styles.input}
            value={relation}
            onChangeText={setRelation}
            placeholder={
              identity?.status === "remembered" ? "vd. Bố" : "vd. Con"
            }
            placeholderTextColor={colors.inkSoft}
          />
        </View>

        <ListEditor
          label="Giá trị sống"
          help="Điều người ấy coi trọng nhất. Cần ít nhất ba — đây là thứ thực thể soi vào khi trả lời."
          placeholder="vd. Thật thà"
          items={coreValues}
          onChange={setCoreValues}
        />

        <ListEditor
          label="Khẩu khí"
          help="Cách nói: ngắn gọn, hay ví von, hay pha trò, hay im lặng lâu…"
          placeholder="vd. Nói ngắn, ít khen thẳng"
          items={traits}
          onChange={setTraits}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Cách xưng hô</Text>
          <Text style={styles.help}>
            Sai chỗ này là hỏng cả cuộc trò chuyện. Ghi đúng cách người ấy vẫn
            gọi. Mỗi hàng là một vai khác nhau — cụ bà xưng «mẹ» với con nhưng
            «bà» với cháu.
          </Text>
          <Text style={styles.sublabel}>Với con</Text>
          <View style={styles.pairRow}>
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={withChildren.self}
              onChangeText={(t) => setWithChildren((p) => ({ ...p, self: t }))}
              placeholder="tự xưng — bố / mẹ"
              placeholderTextColor={colors.inkSoft}
            />
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={withChildren.other}
              onChangeText={(t) => setWithChildren((p) => ({ ...p, other: t }))}
              placeholder="gọi — con"
              placeholderTextColor={colors.inkSoft}
            />
          </View>
          <Text style={styles.sublabel}>Với cháu / chắt</Text>
          <View style={styles.pairRow}>
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={withGrandchildren.self}
              onChangeText={(t) =>
                setWithGrandchildren((p) => ({ ...p, self: t }))
              }
              placeholder="tự xưng — ông / bà"
              placeholderTextColor={colors.inkSoft}
            />
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={withGrandchildren.other}
              onChangeText={(t) =>
                setWithGrandchildren((p) => ({ ...p, other: t }))
              }
              placeholder="gọi — cháu"
              placeholderTextColor={colors.inkSoft}
            />
          </View>
          <Text style={styles.hint}>
            Để trống hàng cháu thì app tự dùng «ông / bà — cháu».
          </Text>
          <Text style={styles.sublabel}>Với vợ / chồng</Text>
          <View style={styles.pairRow}>
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={withSpouse.self}
              onChangeText={(t) => setWithSpouse((p) => ({ ...p, self: t }))}
              placeholder="tự xưng — anh / em"
              placeholderTextColor={colors.inkSoft}
            />
            <TextInput
              style={[styles.input, styles.pairInput]}
              value={withSpouse.other}
              onChangeText={(t) => setWithSpouse((p) => ({ ...p, other: t }))}
              placeholder="gọi — em / anh"
              placeholderTextColor={colors.inkSoft}
            />
          </View>
        </View>

        <ListEditor
          label="Vai trò trong nhà"
          help="Chồng của ai, bố của mấy người con, làm nghề gì — những điều đã chắc chắn."
          placeholder="vd. Chồng của ..."
          items={roles}
          onChange={setRoles}
        />

        <ListEditor
          label="Điều không bao giờ nói"
          help="Điều riêng người này không nói. Quy tắc Forever và hiến chương gia đình không ghi lại đây."
          placeholder="vd. Không bàn chuyện chính trị"
          items={hardTaboos}
          onChange={setHardTaboos}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Bối cảnh hiện tại</Text>
          <Text style={styles.help}>
            Điều gia đình muốn thực thể biết lúc này — vd. cháu vừa vào lớp một.
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={dynamicContext}
            onChangeText={setDynamicContext}
            placeholder="Để trống nếu chưa cần"
            placeholderTextColor={colors.inkSoft}
            multiline
          />
        </View>

        <Pressable
          style={[styles.btn, busy && styles.disabled]}
          onPress={() => void save(true)}
          disabled={busy}
        >
          <Text style={styles.btnText}>
            {saving ? "Đang lưu…" : "Lưu và duyệt"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.btnGhost, busy && styles.disabled]}
          onPress={() => void save(false)}
          disabled={busy}
        >
          <Text style={styles.btnGhostText}>Lưu nháp</Text>
        </Pressable>

        {canShelve ? (
          <View style={styles.archiveBlock}>
            <Text style={styles.label}>Lưu trữ</Text>
            <Text style={styles.help}>
              Ẩn hồ sơ khỏi Thư viện và Voice DNA — không xoá ký ức hay mẫu giọng.
              Khôi phục từ Cài đặt → Lưu trữ hồ sơ.
            </Text>
            <Pressable
              style={[styles.btnArchive, busy && styles.disabled]}
              onPress={confirmArchive}
              disabled={busy}
            >
              <Text style={styles.btnArchiveText}>
                {archiveBusy ? "Đang lưu trữ…" : "Lưu trữ hồ sơ này"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.historyHeader}>
          <Text style={styles.label}>Lịch sử chỉnh sửa</Text>
          {previous ? (
            <Pressable
              style={[styles.smallBtnGhost, busy && styles.disabled]}
              disabled={busy}
              onPress={() => restoreRevision(previous)}
            >
              <Text style={styles.smallBtnGhostText}>Trở về bản trước</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.help}>
          Mỗi lần lưu có thay đổi, Forever giữ lại bản cũ. Khôi phục cũng được ghi
          lại — luôn đảo ngược được.
        </Text>
        {revisions.length ? (
          <View style={styles.card}>
            {revisions.map((rev) => (
              <View key={rev.id} style={styles.revisionRow}>
                <View style={styles.revisionMain}>
                  <Text style={styles.revisionWhen}>
                    {formatRevisionWhen(rev.created_at)}
                  </Text>
                  <Text style={styles.metaLine}>
                    {rev.created_by_name ?? "Thành viên"}
                    {rev.display_name ? ` · ${rev.display_name}` : ""}
                    {rev.profile_reviewed ? " · Đã duyệt" : ""}
                  </Text>
                </View>
                <Pressable
                  style={[styles.smallBtnGhost, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => restoreRevision(rev)}
                >
                  <Text style={styles.smallBtnGhostText}>
                    {restoring ? "…" : "Khôi phục"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.gap}>
            Chưa có bản cũ — lần lưu đầu tiên sẽ bắt đầu lịch sử.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  root: { padding: 20, gap: 18, paddingBottom: 48 },
  intro: { fontSize: 14, color: colors.inkSoft, lineHeight: 21 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 4,
    backgroundColor: colors.card,
    borderColor: colors.line,
  },
  cardOk: { backgroundColor: colors.card, borderColor: colors.line },
  cardWarn: { backgroundColor: "#fdf6ec", borderColor: colors.accent },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 4,
  },
  gap: { fontSize: 13, color: colors.inkSoft, lineHeight: 20 },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sublabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.inkSoft,
    marginTop: 8,
  },
  help: { fontSize: 13, color: colors.inkSoft, lineHeight: 19 },
  hint: {
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 17,
    marginTop: 6,
    fontStyle: "italic",
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  listInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    padding: 0,
    minHeight: 22,
  },
  remove: { fontSize: 13, fontWeight: "600", color: colors.danger, paddingTop: 2 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addInput: { flex: 1 },
  pairRow: { flexDirection: "row", gap: 8 },
  pairInput: { flex: 1 },
  smallBtn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  smallBtnText: { color: "#f4efe6", fontWeight: "700", fontSize: 14 },
  smallBtnGhost: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  smallBtnGhostText: { color: colors.inkSoft, fontWeight: "600", fontSize: 13 },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnText: { color: "#f4efe6", fontWeight: "700", fontSize: 16 },
  btnGhost: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnGhostText: { color: colors.inkSoft, fontWeight: "600", fontSize: 15 },
  archiveBlock: { gap: 8, marginTop: 8 },
  btnArchive: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.danger,
  },
  btnArchiveText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  revisionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  revisionMain: { flex: 1, gap: 2 },
  revisionWhen: { fontSize: 14, fontWeight: "600", color: colors.ink },
  metaLine: { fontSize: 12, color: colors.inkSoft },
}));
