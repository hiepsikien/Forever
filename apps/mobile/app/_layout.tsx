import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

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
        </Stack>
      </Gate>
    </AuthProvider>
  );
}
