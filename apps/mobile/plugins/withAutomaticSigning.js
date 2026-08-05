/**
 * Ensure all native targets use Automatic signing + Development Team.
 */
const { IOSConfig, withXcodeProject } = require("@expo/config-plugins");

function withAutomaticSigning(config) {
  const teamId = config.ios?.appleTeamId;
  if (!teamId) return config;

  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const targets = IOSConfig.Target.findSignableTargets(project);

    for (const [nativeTargetId, nativeTarget] of targets) {
      IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
        project,
        nativeTarget.buildConfigurationList,
      ).forEach(([, item]) => {
        item.buildSettings.CODE_SIGN_STYLE = "Automatic";
        item.buildSettings.DEVELOPMENT_TEAM = teamId;
      });

      for (const [, section] of Object.entries(
        IOSConfig.XcodeUtils.getProjectSection(project),
      ).filter(IOSConfig.XcodeUtils.isNotComment)) {
        if (!section.attributes) continue;
        if (!section.attributes.TargetAttributes) {
          section.attributes.TargetAttributes = {};
        }
        const attrs = section.attributes.TargetAttributes[nativeTargetId] ?? {};
        attrs.DevelopmentTeam = teamId;
        attrs.ProvisioningStyle = "Automatic";
        section.attributes.TargetAttributes[nativeTargetId] = attrs;
      }
    }

    return cfg;
  });
}

module.exports = withAutomaticSigning;
