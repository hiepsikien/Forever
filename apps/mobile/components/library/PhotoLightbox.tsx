import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { saveLocalImageToLibrary } from "@/lib/media";
import { colors } from "@/lib/theme";

type Props = {
  uri: string | null | undefined;
  visible: boolean;
  onClose: () => void;
};

export function PhotoLightbox({ uri, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const save = async () => {
    if (!uri) return;
    try {
      await saveLocalImageToLibrary(uri);
      Alert.alert("Đã lưu", "Ảnh nằm trong thư viện ảnh trên máy.");
    } catch (e) {
      Alert.alert(
        "Không lưu được",
        e instanceof Error ? e.message : "Thử lại sau.",
      );
    }
  };

  return (
    <Modal
      visible={visible && Boolean(uri)}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        ) : null}
        <View
          style={[
            styles.bar,
            { paddingTop: Math.max(insets.top, 12), paddingBottom: 12 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.barBtn}>
            <Text style={styles.barText}>Đóng</Text>
          </Pressable>
          <Pressable onPress={() => void save()} hitSlop={12} style={styles.barBtn}>
            <Text style={styles.barText}>Tải về</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0d100e",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    backgroundColor: "rgba(13, 16, 14, 0.55)",
  },
  barBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  barText: {
    color: colors.card,
    fontSize: 16,
    fontWeight: "700",
  },
});
