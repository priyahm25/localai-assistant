const expoTransformer = require('@expo/metro-config/build/babel-transformer');

module.exports = {
  ...expoTransformer,
  transform({ src, filename, ...options }) {
    if (filename.toLowerCase().includes('pdfjs-dist')) {
      src = src.replace(/\bimport\.meta\.url\b/g, "''");
    }

    return expoTransformer.transform({ src, filename, ...options });
  },
};
