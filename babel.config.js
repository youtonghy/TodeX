module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['./scripts/babel-heroui-imports.cjs', 'react-native-worklets/plugin'],
  };
};
