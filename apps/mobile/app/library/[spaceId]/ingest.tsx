import {
  IdentityProfile,
  LibraryIngestJob,
  LibraryIngestProposal,
} from "@forever/api-client";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { identityChipLabel } from "@/lib/identityDisplay";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

const KIND_LABEL: Record<string, string> = {
  poem: "Thơ",
  milestone: "Ngày gia đình",
  note: "Ghi chú",
  knowledge: "Điều nghe được",
};

export default function LibraryIngestScreen() {
  const { spaceId, identityId, jobId: focusJobId } = useLocalSearchParams<{
    spaceId: string;
    identityId?: string;
    jobId?: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<LibraryIngestJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(
    typeof focusJobId === "string" ? focusJobId : null,
  );
  const [proposals, setProposals] = useState<LibraryIngestProposal[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [canIngest, setCanIngest] = useState(false);
  const [targetIdentityId, setTargetIdentityId] = useState<string | null>(
    typeof identityId === "string" && identityId ? identityId : null,
  );

  useSpaceScreenOptions({
    spaceId,
    title: "Nhập tài liệu",
    backTitle: "Thư viện",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setError(null);
    try {
      const [jobRes, idRes, spaceRes, stewRes] = await Promise.all([
        api.listLibraryIngestJobs(spaceId),
        api.listIdentities(spaceId),
        api.getSpace(spaceId).catch(() => null),
        api.getStewardship(spaceId).catch(() => null),
      ]);
      setJobs(jobRes.jobs);
      setIdentities(idRes.identities);
      setCanIngest(
        spaceRes?.role === "owner" || Boolean(stewRes?.is_steward),
      );
      const watchId =
        activeJobId ||
        jobRes.jobs.find((j) => j.status === "needs_review")?.id ||
        jobRes.jobs[0]?.id ||
        null;
      if (watchId) {
        setActiveJobId(watchId);
        const propRes = await api.listLibraryIngestProposals(spaceId, watchId);
        setProposals(propRes.proposals);
      } else {
        setProposals([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeJobId, api, spaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!spaceId || !activeJobId) return;
    const job = jobs.find((j) => j.id === activeJobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const t = setInterval(() => {
      void (async () => {
        try {
          const fresh = await api.getLibraryIngestJob(spaceId, activeJobId);
          setJobs((prev) =>
            prev.map((j) => (j.id === fresh.id ? fresh : j)),
          );
          if (fresh.status === "needs_review" || fresh.status === "done") {
            const propRes = await api.listLibraryIngestProposals(
              spaceId,
              activeJobId,
            );
            setProposals(propRes.proposals);
          }
          if (fresh.status === "failed") {
            setError(fresh.error_message || "Xử lý thất bại.");
          }
        } catch {
          // ignore poll errors
        }
      })();
    }, 2500);
    return () => clearInterval(t);
  }, [activeJobId, api, jobs, spaceId]);

  const pickAndUpload = async (source: "image" | "document") => {
    if (!spaceId || !canIngest || uploading) return;
    const neoId =
      targetIdentityId ||
      (typeof identityId === "string" && identityId ? identityId : null);
    if (!neoId) {
      Alert.alert(
        "Chọn người",
        "Chọn người (ví dụ Bố Triệu) để neo tài liệu vào kệ trước khi tải lên.",
      );
      return;
    }
    try {
      setUploading(true);
      setError(null);
      let uri = "";
      let name = "document";
      let mimeType = "application/octet-stream";
      if (source === "image") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Cần quyền", "Cho phép truy cập ảnh để nhập tài liệu.");
          return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.9,
        });
        if (picked.canceled || !picked.assets[0]) return;
        const asset = picked.assets[0];
        uri = asset.uri;
        name = asset.fileName ?? "page.jpg";
        mimeType = asset.mimeType ?? "image/jpeg";
      } else {
        const picked = await DocumentPicker.getDocumentAsync({
          type: [
            "application/pdf",
            "image/*",
            "application/msword",
            "com.microsoft.word.doc",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "org.openxmlformats.wordprocessingml.document",
          ],
          copyToCacheDirectory: true,
        });
        if (picked.canceled || !picked.assets?.[0]) return;
        const asset = picked.assets[0];
        uri = asset.uri;
        name = asset.name || "document.pdf";
        const lower = name.toLowerCase();
        if (lower.endsWith(".docx")) {
          mimeType =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        } else if (lower.endsWith(".doc")) {
          mimeType = "application/msword";
        } else {
          mimeType = asset.mimeType || "application/pdf";
        }
      }
      const job = await api.createLibraryIngestJob(spaceId, {
        uri,
        name,
        mimeType,
        identityId: neoId,
      });
      setActiveJobId(job.id);
      setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
      setProposals([]);
      Alert.alert(
        "Đã nhận tài liệu",
        "Hệ thống đang đọc và đề nghị các món đưa vào Thư viện. Bạn duyệt từng đề nghị.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải lên được.");
    } finally {
      setUploading(false);
    }
  };

  const settle = async (prop: LibraryIngestProposal, action: "approve" | "reject") => {
    if (!spaceId || !activeJobId) return;
    const neoId =
      prop.identity_id ||
      activeJob?.identity_id ||
      targetIdentityId ||
      (typeof identityId === "string" ? identityId : null);
    if (action === "approve" && !neoId) {
      Alert.alert(
        "Chưa neo người",
        "Chọn người ở trên (ví dụ Nguyễn Đình Triệu) rồi bấm lại Approve.",
      );
      return;
    }
    setBusyId(prop.id);
    try {
      if (action === "approve" && neoId && !prop.identity_id && !activeJob?.identity_id) {
        await api.patchLibraryIngestJob(spaceId, activeJobId, {
          identity_id: neoId,
        });
        setJobs((prev) =>
          prev.map((j) =>
            j.id === activeJobId ? { ...j, identity_id: neoId } : j,
          ),
        );
        setProposals((prev) =>
          prev.map((p) =>
            p.review_status === "pending" ? { ...p, identity_id: neoId } : p,
          ),
        );
      }
      const result = await api.settleLibraryIngestProposals(spaceId, activeJobId, {
        proposal_ids: [prop.id],
        action,
      });
      const skip = (result.skipped || []).find((s) => s.id === prop.id);
      if (skip) {
        const reason =
          skip.reason === "missing_identity"
            ? "Chưa neo người — chọn người rồi Approve lại."
            : skip.reason === "duplicate"
              ? "Trùng bài đã có trong Thư viện."
              : skip.reason === "empty_body"
                ? "Nội dung trống."
                : skip.reason;
        Alert.alert("Không lưu được", reason);
        await load();
        return;
      }
      if (action === "approve" && !(result.created_memory_ids || []).length) {
        Alert.alert("Không lưu được", "Server không tạo món mới — thử lại.");
        await load();
        return;
      }
      setProposals((prev) =>
        prev.map((p) =>
          p.id === prop.id
            ? {
                ...p,
                review_status: action === "approve" ? "approved" : "rejected",
                identity_id: p.identity_id || neoId,
              }
            : p,
        ),
      );
      if (action === "approve") {
        const destId = neoId;
        Alert.alert(
          prop.kind === "poem" ? "Đã vào kệ Thơ" : "Đã vào Thư viện",
          "Món đã lưu theo người được neo.",
          [
            { text: "Ở lại", style: "cancel" },
            {
              text: "Xem trong Thư viện",
              onPress: () => {
                if (destId) {
                  router.push(
                    `/library/${spaceId}/person/${destId}?shelf=poems`,
                  );
                } else {
                  router.push(`/library/${spaceId}`);
                }
              },
            },
          ],
        );
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setBusyId(null);
    }
  };

  const applyJobIdentity = async (nextId: string) => {
    setTargetIdentityId(nextId);
    if (!spaceId || !activeJobId || !canIngest) return;
    setBusyId(`job-${activeJobId}`);
    try {
      const job = await api.patchLibraryIngestJob(spaceId, activeJobId, {
        identity_id: nextId,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      setProposals((prev) =>
        prev.map((p) =>
          p.review_status === "pending" ? { ...p, identity_id: nextId } : p,
        ),
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không neo được.");
    } finally {
      setBusyId(null);
    }
  };

  const setAuthorship = async (
    prop: LibraryIngestProposal,
    authorship: "own" | "gift",
  ) => {
    if (!spaceId || !activeJobId || prop.authorship === authorship) return;
    setBusyId(prop.id);
    try {
      const updated = await api.editLibraryIngestProposal(
        spaceId,
        activeJobId,
        prop.id,
        { authorship },
      );
      setProposals((prev) =>
        prev.map((p) => (p.id === prop.id ? { ...p, ...updated } : p)),
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không đổi được.");
    } finally {
      setBusyId(null);
    }
  };

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;
  const pending = proposals.filter((p) => p.review_status === "pending");
  const neoIdentityId =
    activeJob?.identity_id ||
    targetIdentityId ||
    (typeof identityId === "string" && identityId ? identityId : null);
  const rememberedIdentities = identities.filter(
    (i) => i.status === "remembered" || i.status === "living",
  );

  useEffect(() => {
    if (activeJob?.identity_id) {
      setTargetIdentityId(activeJob.identity_id);
    }
  }, [activeJob?.identity_id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.lead}>
        Tải ảnh trang thơ, PDF, DOC hoặc DOCX. Forever đọc, đề nghị chỗ đưa vào
        Thư viện — bạn chỉ Approve hoặc Bỏ.
      </Text>
      {!canIngest ? (
        <Text style={styles.warn}>
          Chỉ người giữ nhà / chủ nhà mới nhập được tài liệu.
        </Text>
      ) : (
        <>
          <Text style={styles.neoLabel}>Neo vào người</Text>
          <View style={styles.neoRow}>
            {rememberedIdentities.map((person) => {
              const selected = neoIdentityId === person.id;
              return (
                <Pressable
                  key={person.id}
                  style={[styles.neoChip, selected && styles.neoChipOn]}
                  disabled={busyId !== null}
                  onPress={() => void applyJobIdentity(person.id)}
                >
                  <Text
                    style={[styles.neoChipText, selected && styles.neoChipTextOn]}
                  >
                    {identityChipLabel(person)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!neoIdentityId ? (
            <Text style={styles.warn}>
              Chọn người (ví dụ Bố) trước khi tải lên hoặc Approve — nếu không,
              thơ sẽ không vào kệ.
            </Text>
          ) : null}
          <View style={styles.uploadRow}>
            <Pressable
              style={[styles.uploadBtn, uploading && styles.disabled]}
              disabled={uploading}
              onPress={() => void pickAndUpload("image")}
            >
              <Text style={styles.uploadText}>
                {uploading ? "Đang tải…" : "Ảnh trang"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.uploadBtn, uploading && styles.disabled]}
              disabled={uploading}
              onPress={() => void pickAndUpload("document")}
            >
              <Text style={styles.uploadText}>PDF / Word</Text>
            </Pressable>
          </View>
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {activeJob ? (
        <View style={styles.jobCard}>
          <Text style={styles.jobTitle}>{activeJob.original_filename}</Text>
          <Text style={styles.jobStatus}>
            {activeJob.status === "queued" || activeJob.status === "running"
              ? "Đang xử lý…"
              : activeJob.status === "needs_review"
                ? `${pending.length} đề nghị chờ duyệt`
                : activeJob.status === "failed"
                  ? `Lỗi: ${activeJob.error_message || "thất bại"}`
                  : "Đã xong"}
          </Text>
          {neoIdentityId ? (
            <Text style={styles.jobNeo}>
              Neo:{" "}
              {(() => {
                const person = identities.find((i) => i.id === neoIdentityId);
                return person
                  ? identityChipLabel(person)
                  : neoIdentityId.slice(0, 8);
              })()}
            </Text>
          ) : (
            <Text style={styles.warnInline}>
              Chưa neo người — chọn ở trên rồi Approve lại các bài đang chờ.
            </Text>
          )}
        </View>
      ) : null}

      <FlatList
        data={proposals}
        keyExtractor={(item) => item.id}
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
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {activeJob?.status === "queued" || activeJob?.status === "running"
              ? "Đang đọc tài liệu…"
              : "Chưa có đề nghị. Tải ảnh, PDF hoặc Word để bắt đầu."}
          </Text>
        }
        renderItem={({ item }) => {
          const identity = identities.find((i) => i.id === item.identity_id);
          const settled = item.review_status !== "pending";
          const expanded = Boolean(expandedIds[item.id]);
          const bodyText = item.body || "";
          const canExpand =
            bodyText.length > 220 || bodyText.split("\n").length > 8;
          return (
            <View style={[styles.card, settled && styles.cardSettled]}>
              <Text style={styles.kind}>
                {KIND_LABEL[item.kind] ?? item.kind}
                {identity
                  ? ` · ${identityChipLabel(identity)}`
                  : ""}
              </Text>
              {item.title ? (
                <Text style={styles.title}>{item.title}</Text>
              ) : null}
              <Text
                style={styles.body}
                numberOfLines={expanded || !canExpand ? undefined : 8}
              >
                {bodyText}
              </Text>
              {canExpand ? (
                <Pressable
                  onPress={() =>
                    setExpandedIds((prev) => ({
                      ...prev,
                      [item.id]: !expanded,
                    }))
                  }
                  hitSlop={8}
                >
                  <Text style={styles.expandLink}>
                    {expanded ? "Thu gọn" : "Xem thêm"}
                  </Text>
                </Pressable>
              ) : null}
              {item.kind === "poem" && item.review_status === "pending" && canIngest ? (
                <View style={styles.authRow}>
                  <Text style={styles.authLabel}>Phân loại</Text>
                  <Pressable
                    style={[
                      styles.authChip,
                      (item.authorship || "own") === "own" && styles.authChipOn,
                    ]}
                    disabled={busyId === item.id}
                    onPress={() => void setAuthorship(item, "own")}
                  >
                    <Text
                      style={[
                        styles.authChipText,
                        (item.authorship || "own") === "own" &&
                          styles.authChipTextOn,
                      ]}
                    >
                      Của người này
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.authChip,
                      item.authorship === "gift" && styles.authChipOn,
                    ]}
                    disabled={busyId === item.id}
                    onPress={() => void setAuthorship(item, "gift")}
                  >
                    <Text
                      style={[
                        styles.authChipText,
                        item.authorship === "gift" && styles.authChipTextOn,
                      ]}
                    >
                      Thơ tặng
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {item.kind === "poem" && item.review_status !== "pending" ? (
                <Text style={styles.authMeta}>
                  {item.authorship === "gift" ? "Thơ tặng" : "Thơ của người này"}
                </Text>
              ) : null}
              {item.review_status === "pending" && canIngest ? (
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.keep, busyId === item.id && styles.disabled]}
                    disabled={busyId === item.id}
                    onPress={() => void settle(item, "approve")}
                  >
                    <Text style={styles.keepText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    style={styles.drop}
                    disabled={busyId === item.id}
                    onPress={() => void settle(item, "reject")}
                  >
                    <Text style={styles.dropText}>Bỏ</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={styles.settledLabel}>
                    {item.review_status === "approved"
                      ? item.kind === "poem"
                        ? "Đã vào kệ Thơ"
                        : "Đã vào Thư viện"
                      : item.review_status === "rejected"
                        ? "Đã bỏ"
                        : item.review_status}
                  </Text>
                  {item.review_status === "approved" ? (
                    <Pressable
                      onPress={() => {
                        const destId =
                          item.identity_id ||
                          activeJob?.identity_id ||
                          (typeof identityId === "string" ? identityId : null);
                        if (destId) {
                          router.push(
                            `/library/${spaceId}/person/${destId}?shelf=poems`,
                          );
                        } else if (spaceId) {
                          router.push(`/library/${spaceId}`);
                        }
                      }}
                      hitSlop={6}
                    >
                      <Text style={styles.expandLink}>Xem trong Thư viện →</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          );
        }}
      />

      {identityId ? (
        <Pressable
          style={styles.backLink}
          onPress={() =>
            router.push(`/library/${spaceId}/person/${identityId}`)
          }
        >
          <Text style={styles.backLinkText}>← Về kệ người này</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 12 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  lead: {
    paddingHorizontal: 16,
    fontSize: 14,
    lineHeight: 21,
    color: colors.inkSoft,
    marginBottom: 10,
  },
  warn: {
    paddingHorizontal: 16,
    color: "#8a5a00",
    marginBottom: 8,
    fontSize: 13,
  },
  warnInline: { fontSize: 13, color: "#8a5a00", marginTop: 4 },
  neoLabel: {
    paddingHorizontal: 16,
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  neoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  neoChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  neoChipOn: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  neoChipText: { fontSize: 13, color: colors.inkSoft, fontWeight: "600" },
  neoChipTextOn: { color: "#fff" },
  uploadRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  uploadBtn: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  uploadText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
  error: { color: "#b3261e", paddingHorizontal: 16, marginBottom: 8 },
  jobCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
    gap: 4,
  },
  jobTitle: { fontWeight: "700", color: colors.ink },
  jobStatus: { fontSize: 13, color: colors.inkSoft },
  jobNeo: { fontSize: 13, color: colors.brand, fontWeight: "600", marginTop: 2 },
  list: { padding: 16, paddingTop: 8, gap: 10, paddingBottom: 40 },
  empty: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 6,
  },
  cardSettled: { opacity: 0.72 },
  kind: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brand,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
  },
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  expandLink: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
    marginTop: 2,
  },
  authRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  authLabel: { fontSize: 12, color: colors.inkSoft, fontWeight: "600" },
  authChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  authChipOn: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  authChipText: { fontSize: 13, color: colors.inkSoft, fontWeight: "600" },
  authChipTextOn: { color: "#fff" },
  authMeta: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  keep: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  keepText: { color: "#fff", fontWeight: "700" },
  drop: { paddingHorizontal: 10, paddingVertical: 10 },
  dropText: { color: colors.inkSoft, fontWeight: "600" },
  settledLabel: { fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  backLink: { padding: 16 },
  backLinkText: { color: colors.brand, fontWeight: "600" },
}));
