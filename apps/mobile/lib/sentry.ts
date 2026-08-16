import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || undefined;

const extra = Constants.expoConfig?.extra as { appVariant?: string } | undefined;
const environment =
  extra?.appVariant === "production" ? "production" : "dev";

Sentry.init({
  dsn,
  // Local Metro / Expo Go: no crash noise while iterating. Release builds
  // (dev or production APK/IPA) report when a DSN is present.
  enabled: Boolean(dsn) && !__DEV__,
  environment,
  sendDefaultPii: false,
  tracesSampleRate: 0.2,
  // Family chat and memory text must not leave the device as breadcrumbs.
  beforeBreadcrumb(crumb) {
    if (crumb.category === "console" || crumb.category === "ui.input") {
      return null;
    }
    return crumb;
  },
});

export { Sentry };
