import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, LogBox, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { Sentry } from "@/lib/sentry";
import { ThemeProvider, useTheme } from "@/lib/theme";

// Expo Go on Android: keep-awake can fail if the Activity isn't ready. Harmless,
// but without ignoreLogs it surfaces as a full-screen Console Error.
if (__DEV__) {
  LogBox.ignoreLogs([
    "Unable to activate keep awake",
    "Unable to deactivate keep awake",
  ]);
}

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { colors: palette } = useTheme();
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
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.bg,
        }}
      >
        <ActivityIndicator color={palette.brand} />
      </View>
    );
  }

  return <>{children}</>;
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedStack />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const { colors: palette } = useTheme();
  return (
    <>
      <StatusBar style={palette.isDark ? "light" : "dark"} />
      <Gate>
        <Stack
            screenOptions={{
              headerStyle: { backgroundColor: palette.bg },
              headerTintColor: palette.ink,
              headerTitleStyle: { fontFamily: "Georgia", fontWeight: "600" },
              contentStyle: { backgroundColor: palette.bg },
            }}
          >
            <Stack.Screen name="index" options={{ title: "Forever" }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="invite" options={{ title: "Tham gia gia đình" }} />
            <Stack.Screen name="space/[id]" options={{ title: "Gia đình" }} />
            <Stack.Screen
              name="awakening/[spaceId]"
              options={{ title: "Thổi hồn", headerBackTitle: "Nhà" }}
            />
            <Stack.Screen name="chat/[threadId]" options={{ title: "Trò chuyện" }} />
            <Stack.Screen
              name="call/[threadId]"
              options={{ title: "Gọi", headerBackTitle: "Nhà" }}
            />
            <Stack.Screen name="library/[spaceId]/index" options={{ title: "Thư viện ký ức" }} />
            <Stack.Screen
              name="library/[spaceId]/person/[identityId]"
              options={{ title: "Ký ức", headerBackTitle: "Thư viện" }}
            />
            <Stack.Screen
              name="profile/[spaceId]/[identityId]"
              options={{ title: "Bản sắc", headerBackTitle: "Cài đặt" }}
            />
            <Stack.Screen name="interview/[spaceId]" options={{ title: "Time-Capsule" }} />
            <Stack.Screen name="voice/[spaceId]/index" options={{ title: "Voice DNA" }} />
            <Stack.Screen
              name="voice/[spaceId]/samples"
              options={{ title: "Mẫu giọng" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/record"
              options={{ title: "Ghi sample" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/upload"
              options={{ title: "Tải file audio" }}
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
            <Stack.Screen
              name="voice/[spaceId]/extract/new"
              options={{ title: "Giọng từ ký ức" }}
            />
            <Stack.Screen
              name="voice/[spaceId]/extract/[jobId]"
              options={{ title: "Duyệt đoạn tách" }}
            />
            <Stack.Screen name="settings/[spaceId]" options={{ title: "Cài đặt" }} />
            <Stack.Screen
              name="settings/philosophy"
              options={{ title: "Triết lý Forever" }}
            />
          </Stack>
        </Gate>
    </>
  );
}

export default Sentry.wrap(RootLayout);
