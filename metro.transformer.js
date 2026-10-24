
const upstreamTransformer = require('@expo/metro-config/babel-transformer');

module.exports = {
  ...upstreamTransformer,

  transform({ src, filename, ...options }) {
    if (filename.toLowerCase().includes('pdfjs-dist')) {
      src = src.replace(/\bimport\.meta\.url\b/g, "''");
    }

    return upstreamTransformer.transform({ src, filename, ...options });
  },
};
