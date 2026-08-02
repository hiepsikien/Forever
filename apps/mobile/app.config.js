// Dynamic Expo config — bakes EXPO_PUBLIC_* into the native/release bundle.
/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || "http://localhost:8001";
  const allowCleartext = apiUrl.startsWith("http://");

  return {
    ...config,
    name: "Forever",
    slug: "forever",
    version: "0.1.0",
    orientation: "portrait",
    scheme: "forever",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#2d4a3e",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.nguyendinhanh.forever",
    },
    android: {
      package: "com.nguyendinhanh.forever",
      versionCode: 2,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#2d4a3e",
      },
      permissions: [
        "INTERNET",
        "RECORD_AUDIO",
        "READ_MEDIA_IMAGES",
        "READ_MEDIA_AUDIO",
        "CAMERA",
      ],
      allowBackup: false,
      softwareKeyboardLayoutMode: "resize",
    },
    androidNavigationBar: {
      backgroundColor: "#f4efe6",
      barStyle: "dark-content",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-asset",
      "expo-font",
      [
        "expo-image-picker",
        {
          photosPermission:
            "Forever cần ảnh để lưu vào thư viện ký ức gia đình.",
        },
      ],
      [
        "expo-media-library",
        {
          photosPermission:
            "Forever cần truy cập thư viện để lưu audio TTS.",
          savePhotosPermission:
            "Forever cần quyền lưu file audio TTS vào thư viện thiết bị.",
        },
      ],
      [
        "expo-audio",
        {
          microphonePermission:
            "Forever cần micro để ghi giọng nói trong chat và Time-Capsule.",
        },
      ],
      "expo-web-browser",
      "@react-native-google-signin/google-signin",
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: allowCleartext,
            minSdkVersion: 24,
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      apiUrl,
      authDev: process.env.EXPO_PUBLIC_AUTH_DEV !== "false",
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "",
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "",
      firebaseMessagingSenderId:
        process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "",
      googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "",
    },
  };
};
