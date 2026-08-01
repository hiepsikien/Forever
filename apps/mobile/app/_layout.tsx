import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments[0] === "login";
    if (!user && !onLogin) router.replace("/login");
    if (user && onLogin) router.replace("/");
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.ink,
              headerTitleStyle: { fontFamily: "Georgia", fontWeight: "600" },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ title: "Forever" }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="invite" options={{ title: "Tham gia gia đình" }} />
            <Stack.Screen name="space/[id]" options={{ title: "Gia đình" }} />
            <Stack.Screen name="chat/[threadId]" options={{ title: "Trò chuyện" }} />
            <Stack.Screen name="library/[spaceId]" options={{ title: "Thư viện ký ức" }} />
            <Stack.Screen name="interview/[spaceId]" options={{ title: "Time-Capsule" }} />
            <Stack.Screen name="voice/[spaceId]/index" options={{ title: "Voice DNA" }} />
            <Stack.Screen
              name="voice/[spaceId]/samples"
              options={{ title: "Sample đã ghi" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/record"
              options={{ title: "Ghi sample" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/speak"
              options={{ title: "Tạo giọng từ text" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/renders"
              options={{ title: "Bản TTS đã tạo" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/clones"
              options={{ title: "Lịch sử clone" }}
            />
            <Stack.Screen name="settings/[spaceId]" options={{ title: "Cài đặt" }} />
          </Stack>
        </Gate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
