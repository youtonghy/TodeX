const baseConfig = require("./app.json");

function readPositiveInteger(value) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

module.exports = () => {
  const buildVersion = process.env.TODEX_BUILD_VERSION;
  const androidVersionCode = readPositiveInteger(
    process.env.TODEX_ANDROID_VERSION_CODE,
  );
  const expo = baseConfig.expo;

  return {
    expo: {
      ...expo,
      version: buildVersion || expo.version,
      ios: {
        ...expo.ios,
        ...(buildVersion ? { buildNumber: buildVersion } : {}),
      },
      android: {
        ...expo.android,
        ...(androidVersionCode ? { versionCode: androidVersionCode } : {}),
      },
    },
  };
};
