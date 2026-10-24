
const expoTransformer = require(
  require.resolve('@expo/metro-config/build/babel-transformer', {
    paths: [require.resolve('expo/package.json')],
  })
);

module.exports = {
  ...expoTransformer,
  transform({ src, filename, ...options }) {
    if (filename.toLowerCase().includes('pdfjs-dist')) {
      src = src.replace(/\bimport\.meta\.url\b/g, "''");
    }

    return expoTransformer.transform({ src, filename, ...options });
  },
};
