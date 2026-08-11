// jsxImportSource: "nativewind" is required by NativeWind v4's JSX transform.
// Verified present in BabelPresetExpoOptions for babel-preset-expo@57.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
