module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Vision Camera frame-processor worklets
    ['react-native-worklets-core/plugin'],
    // Reanimated plugin MUST be listed last.
    'react-native-reanimated/plugin',
  ],
};
