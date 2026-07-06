// metro.config.js
// Permite importar modelos .tflite como assets (react-native-fast-tflite).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite');

module.exports = config;
