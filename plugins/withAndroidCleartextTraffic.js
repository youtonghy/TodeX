const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidCleartextTraffic = (config) =>
  withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return manifestConfig;
  });

module.exports = withAndroidCleartextTraffic;
