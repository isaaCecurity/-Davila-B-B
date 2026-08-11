// BakeFlow Metro configuration.
//
// Deliberately minimal. @expo/metro-config@57 already derives monorepo
// watchFolders and nodeModulesPaths from the root package.json `workspaces`
// globs (see getWatchFolders.js / getModulesPaths.js in that package), so the
// hand-written watchFolders/nodeModulesPaths block found in older Expo monorepo
// guides is redundant here and would only drift from what Expo computes.
//
// The single reason this file exists is NativeWind's CSS pipeline.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
