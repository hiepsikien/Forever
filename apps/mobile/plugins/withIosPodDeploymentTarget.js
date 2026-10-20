/**
 * Xcode 27 / Expo SDK 58 error when any CocoaPods target (including
 * resource bundles) still has IPHONEOS_DEPLOYMENT_TARGET below 16.4.
 * React Native's post_install only bumps native_target.
 */
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "Forever: bump Pod IPHONEOS_DEPLOYMENT_TARGET";
const MIN = "16.4";

const SNIPPET = `
  # ${MARKER} — Xcode 27 / SDK 58 reject Pods below iOS 16.4.
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      if current.nil? || current.to_f < ${MIN}.to_f
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN}'
      end
    end
  end
`;

function withIosPodDeploymentTarget(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let src = await fs.promises.readFile(podfile, "utf8");
      if (src.includes(MARKER)) return cfg;
      if (!src.includes("react_native_post_install")) {
        throw new Error(
          "Podfile missing react_native_post_install; cannot bump Pod deployment targets.",
        );
      }
      src = src.replace(
        /react_native_post_install\(\s*[\s\S]*?\)\n/,
        (match) => `${match}\n${SNIPPET}`,
      );
      if (!src.includes(MARKER)) {
        throw new Error("Failed to insert iOS deployment-target bump into Podfile.");
      }
      await fs.promises.writeFile(podfile, src);
      return cfg;
    },
  ]);
}

module.exports = withIosPodDeploymentTarget;
