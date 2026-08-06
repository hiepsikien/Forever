const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

// getSentryExpoConfig assigns Debug IDs so release stack traces unminify.
const config = getSentryExpoConfig(projectRoot, {
  // Forever does not ship Session Replay (chat / memory must stay on-device).
  includeWebReplay: false,
});

// Watch monorepo packages (e.g. @forever/api-client) for Fast Refresh.
config.watchFolders = [workspaceRoot];

// Prefer the app's node_modules, then the repo root.
// Keep hierarchical lookup ON so nested deps (e.g. react-native →
// @react-native/virtualized-lists) still resolve.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
