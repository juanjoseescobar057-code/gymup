module.exports = function (api) {
  // Cachear por entorno: el set de plugins cambia entre dev y producción.
  api.cache.using(() => process.env.NODE_ENV);
  const isProd = process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';

  const plugins = [];
  // OWASP M8/M9: en producción se eliminan TODOS los console.* para no
  // filtrar datos ni ruido en builds de tienda.
  if (isProd) plugins.push('transform-remove-console');
  // El plugin de worklets DEBE ir al final. Necesario para los
  // frame processors de react-native-vision-camera.
  plugins.push('react-native-worklets-core/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
