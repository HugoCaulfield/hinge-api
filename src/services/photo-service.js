const {
  buildPhotoSet,
  getPhotoPoolStats,
} = require("../core/photo/photo-pool-service");
const {
  listModelKeys,
  DEFAULT_MODEL_KEY,
} = require("../../config/photo-models");

function createPhotoService(config) {
  function applyRuntimeEnv() {
    process.env.SELECTED_APP = config.appName || "hinge-prod-1";
    process.env.PHOTO_COUNT = String(config.photos.count || 6);
    process.env.PHOTOS_USE_SPOOFING = config.photos.useSpoofing ? "true" : "false";
    process.env.PHOTO_METADATA_SPOOFER =
      config.photos.metadataSpoofer || "iphone_exif_gui_reconstructed";
  }

  async function generate(modelKey = null) {
    applyRuntimeEnv();
    const result = await buildPhotoSet({
      appName: config.appName,
      modelKey,
    });

    return {
      photoPaths: result.photoPaths || [],
      originalNames: result.originalNames || [],
      modelKey: result.modelKey || modelKey || DEFAULT_MODEL_KEY,
    };
  }

  async function getStats() {
    applyRuntimeEnv();
    const models = listModelKeys();
    const stats = [];
    for (const modelKey of models) {
      const modelStats = await getPhotoPoolStats(config.appName, modelKey);
      stats.push(modelStats);
    }
    return stats;
  }

  return {
    generate,
    getStats,
  };
}

module.exports = {
  createPhotoService,
};
