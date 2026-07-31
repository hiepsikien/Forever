import { ChatMessage } from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { api, user } = useAuth();
  const navigation = useNavigation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const [thread, res] = await Promise.all([
        api.getThread(threadId),
        api.listMessages(threadId, { limit: 100 }),
      ]);
      navigation.setOptions({ title: thread.title });
      setMessages(res.messages);
    } finally {
      setLoading(false);
    }
  }, [api, navigation, threadId]);

  useLayoutEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!threadId) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.listMessages(threadId, { limit: 100 });
        setMessages(res.messages);
      } catch {
        // ignore poll errors
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [api, threadId]);

  const send = async () => {
    const body = text.trim();
    if (!body || !threadId || sending) return;
    setSending(true);
    setText("");
    try {
      const msg = await api.sendMessage(threadId, body);
      setMessages((prev) => [...prev, msg]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setText(body);
    } finally {
      setSending(false);
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.sender_user_id === user?.id;
          return (
            <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
              {!mine ? (
                <Text style={styles.sender}>{item.sender_name ?? "Thành viên"}</Text>
              ) : null}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>
              </View>
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Nhắn cho cả nhà…"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={send}
          disabled={sending || !text.trim()}
          style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]}
        >
          <Text style={styles.sendText}>Gửi</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  list: { padding: 16, paddingBottom: 8 },
  row: { marginBottom: 12, maxWidth: "85%" },
  rowMine: { alignSelf: "flex-end" },
  rowTheirs: { alignSelf: "flex-start" },
  sender: {
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 4,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: colors.bubbleMine },
  bubbleTheirs: {
    backgroundColor: colors.bubbleTheirs,
    borderWidth: 1,
    borderColor: colors.line,
  },
  body: { fontSize: 16, lineHeight: 22, color: colors.ink },
  bodyMine: { color: "#f4efe6" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
  },
  send: {
    backgroundColor: colors.brand,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendText: { color: "#f4efe6", fontWeight: "600" },
});
