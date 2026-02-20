const {
  generateRandomPhotos,
  getPoolStats,
} = require("../core/photo/pool-photo-manager");
const {
  listModelKeys,
  DEFAULT_MODEL_KEY,
} = require("../../config/photo-models");

function createPhotoService(config) {
  function applyRuntimeEnv() {
    process.env.SELECTED_APP = config.appName || "hinge-prod-1";
    process.env.PHOTOS_USE_SPOOFING = config.photos.useSpoofing ? "true" : "false";
    process.env.PHOTO_SPOOFER = config.photos.spoofer || "random_three";
  }

  async function generate(modelKey = null) {
    applyRuntimeEnv();
    const result = await generateRandomPhotos({
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
      const modelStats = await getPoolStats(config.appName, modelKey);
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
