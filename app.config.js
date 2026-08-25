function readPositiveInteger(value) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

module.exports = ({ config }) => {
  const buildVersion = process.env.TODEX_BUILD_VERSION;
  const androidVersionCode = readPositiveInteger(
    process.env.TODEX_ANDROID_VERSION_CODE,
  );

  return {
    ...config,
    version: buildVersion || config.version,
    ios: {
      ...config.ios,
      ...(buildVersion ? { buildNumber: buildVersion } : {}),
    },
    android: {
      ...config.android,
      ...(androidVersionCode ? { versionCode: androidVersionCode } : {}),
    },
  };
};
