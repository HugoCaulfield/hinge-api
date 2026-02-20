const fs = require("fs").promises;
const path = require("path");
const { log } = require("../../utils/logger");
const { APP_CONFIGS } = require("../../../config/app-config");
const {
  DEFAULT_MODEL_KEY,
  getPoolDir,
  getModelSourceCandidates,
  resolveModelKey,
} = require("../../../config/photo-models");
const { getModelKeyForUser } = require("./user-models");

/**
 * Pool-based Photo Manager
 *
 * Consumes pre-generated photos from app-specific pools for instant delivery
 */

// Photos per request for each app type
const PHOTOS_PER_SET = {
  "tinder-dev": 3,
  "tinder-prod-1": 3,
  "tinder-prod-2": 3,
  "tinder-prod-3": 3,
  "hinge-dev": 6,
  "hinge-prod-1": 6,
  "hinge-prod-2": 6,
  "hinge-prod-3": 6,
  "hinge-prod-4": 6,
  "bumble-prod-1": 6,
  "hinge-no-spoofing-1": 6,
  "hinge-no-spoofing-2": 6,
  "hinge-no-spoofing-3": 6,
};

function describePool(appName, modelKey = DEFAULT_MODEL_KEY) {
  return modelKey && modelKey !== DEFAULT_MODEL_KEY
    ? `${appName}@${modelKey}`
    : appName;
}

async function ensurePoolDirectory(appName, modelKey = DEFAULT_MODEL_KEY) {
  const poolDir = getPoolDir(appName, modelKey);
  await fs.mkdir(poolDir, { recursive: true });
  return poolDir;
}

async function resolveModelKeyForRequest(userId, requestedModelKey = null) {
  if (requestedModelKey) {
    return resolveModelKey(requestedModelKey);
  }

  if (userId !== undefined && userId !== null) {
    try {
      return await getModelKeyForUser(userId);
    } catch (error) {
      log(
        `⚠️ Could not resolve model for user ${userId}, falling back to default: ${error.message}`
      );
    }
  }

  return DEFAULT_MODEL_KEY;
}

async function resolveSourceDir(modelKey = DEFAULT_MODEL_KEY) {
  const candidates = getModelSourceCandidates(modelKey);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") {
        log(`⚠️ Could not access source dir ${candidate}: ${error.message}`);
      }
    }
  }

  // Create the first candidate so that downstream code has a stable path
  const fallback = candidates[0];
  await fs.mkdir(fallback, { recursive: true });
  return fallback;
}

function resolveAppPhotoSettings(appName = "") {
  const normalized = (appName || "").toLowerCase();
  return APP_CONFIGS?.[normalized]?.photos || null;
}

function isSpoofingEnabled(appName = "") {
  const flag = (process.env.PHOTOS_USE_SPOOFING || "true").toLowerCase();
  const envEnabled = flag !== "false" && flag !== "0";

  const photoSettings = resolveAppPhotoSettings(appName);
  if (photoSettings?.useSpoofing === false) {
    return false;
  }

  if (!envEnabled) {
    return false;
  }

  if (photoSettings?.useSpoofing === true) {
    return true;
  }

  return envEnabled;
}

function buildFileOptions(photoPath, index = 1) {
  const ext = (path.extname(photoPath) || ".jpg").toLowerCase();
  let contentType = "image/jpeg";

  if (ext === ".heic" || ext === ".heif") {
    contentType = "image/heic";
  } else if (ext === ".png") {
    contentType = "image/png";
  }

  const filename = path.basename(photoPath) || `photo_${index}${ext}`;
  return {
    filename,
    contentType,
  };
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function loadLegacyOriginalNamesMapping(poolDir) {
  const legacyPath = path.join(poolDir, ".original_names");

  try {
    const data = await fs.readFile(legacyPath, "utf8");
    const mapping = {};

    for (const rawLine of data.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const [generated, original] = line.split(/\t+/, 2);
      if (generated) {
        mapping[generated] = original || generated;
      }
    }

    const count = Object.keys(mapping).length;
    if (count > 0) {
      log(
        `ℹ️ Loaded legacy original names mapping from .original_names (${count} entr${
          count > 1 ? "ies" : "y"
        })`
      );
    }

    return mapping;
  } catch (error) {
    if (error.code !== "ENOENT") {
      log(`⚠️ Could not load legacy original names mapping: ${error.message}`);
    }
    return {};
  }
}

async function persistOriginalNamesMapping(poolDir, mapping) {
  const mappingFile = path.join(poolDir, ".original-names.json");
  const legacyFile = path.join(poolDir, ".original_names");

  const jsonContent = JSON.stringify(mapping, null, 2);
  const legacyLines = Object.entries(mapping).map(
    ([generated, original]) => `${generated}\t${original}`
  );
  const legacyContent =
    legacyLines.length > 0 ? `${legacyLines.join("\n")}\n` : "";

  await fs.writeFile(mappingFile, jsonContent);
  await fs.writeFile(legacyFile, legacyContent);
}

/**
 * Get the current app name from environment
 */
function getCurrentAppName() {
  return process.env.SELECTED_APP || "tinder-dev";
}

/**
 * Get available photos from app pool for a model
 * @param {string} appName - App name (e.g., "tinder-prod-1")
 * @param {string} modelKey - Model key (e.g., "shine")
 * @returns {Promise<string[]>} Array of photo file paths
 */
async function getAvailablePhotosFromPool(appName, modelKey = DEFAULT_MODEL_KEY) {
  const poolDir = getPoolDir(appName, modelKey);

  try {
    await fs.access(poolDir);
    const files = await fs.readdir(poolDir);

    // Filter for image files
    const photoFiles = files
      .filter((file) => file.match(/\.(jpg|jpeg|png|heic|heif)$/i))
      .map((file) => path.join(poolDir, file));

    // Sort by modification time (newest first)
    const photoStats = await Promise.all(
      photoFiles.map(async (filePath) => {
        const stats = await fs.stat(filePath);
        return { filePath, mtime: stats.mtime };
      })
    );

    return photoStats
      .sort((a, b) => b.mtime - a.mtime)
      .map((item) => item.filePath);
  } catch (error) {
    log(
      `⚠️ Could not access pool directory for ${describePool(
        appName,
        modelKey
      )}: ${error.message}`
    );
    return [];
  }
}

/**
 * Load original names mapping from pool directory
 * @param {string} poolDir - Pool directory path
 * @returns {Promise<Object>} Mapping of generated filename to original name
 */
async function loadOriginalNamesMapping(poolDir) {
  try {
    const mappingFile = path.join(poolDir, ".original-names.json");
    const data = await fs.readFile(mappingFile, "utf8");
    return JSON.parse(data);
  } catch (error) {
    log(`⚠️ Could not load original names mapping JSON: ${error.message}`);
    const legacyMapping = await loadLegacyOriginalNamesMapping(poolDir);
    if (Object.keys(legacyMapping).length > 0) {
      return legacyMapping;
    }
    return {};
  }
}

/**
 * Update original names mapping by removing consumed photo entries
 * @param {string} poolDir - Pool directory path
 * @param {string[]} consumedFileNames - Array of filenames that were consumed
 */
async function cleanupOriginalNamesMapping(poolDir, consumedFileNames) {
  try {
    let mapping = await loadOriginalNamesMapping(poolDir);

    // Remove entries for consumed photos
    let removedCount = 0;
    for (const fileName of consumedFileNames) {
      if (mapping[fileName]) {
        delete mapping[fileName];
        removedCount++;
        log(`🗑️ Removed mapping entry: ${fileName}`);
      }
    }

    // Save updated mapping back to file
    if (removedCount > 0) {
      await persistOriginalNamesMapping(poolDir, mapping);
      log(`💾 Updated original names mapping, removed ${removedCount} entries`);
    }
  } catch (error) {
    log(`⚠️ Error cleaning up original names mapping: ${error.message}`);
  }
}

/**
 * Move photos from pool to temp directory for user
 * @param {string[]} sourcePaths - Array of source photo paths
 * @returns {Promise<{photoPaths: string[], originalNames: string[]}>}
 */
async function movePhotosToUserTemp(sourcePaths) {
  const tempDir = path.join(__dirname, "..", "temp");

  // Ensure temp directory exists
  try {
    await fs.access(tempDir);
  } catch (error) {
    await fs.mkdir(tempDir, { recursive: true });
  }

  const sessionDir = path.join(
    tempDir,
    `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.mkdir(sessionDir, { recursive: true });

  // Load original names mapping from the pool directory
  let originalNamesMapping = {};
  let poolDir = "";
  if (sourcePaths.length > 0) {
    poolDir = path.dirname(sourcePaths[0]);
    originalNamesMapping = await loadOriginalNamesMapping(poolDir);
  }

  const photoPaths = [];
  const originalNames = [];
  const consumedFileNames = [];

  for (const sourcePath of sourcePaths) {
    try {
      const generatedFileName = path.basename(sourcePath);
      let tempFileName = generatedFileName;
      let tempPath = path.join(sessionDir, tempFileName);
      let attempt = 1;

      while (true) {
        try {
          await fs.access(tempPath);
          attempt += 1;
          const parsed = path.parse(generatedFileName);
          tempFileName = `${parsed.name}_${attempt}${parsed.ext}`;
          tempPath = path.join(sessionDir, tempFileName);
        } catch (accessError) {
          if (accessError.code === "ENOENT") {
            break;
          }
          throw accessError;
        }
      }

      await fs.rename(sourcePath, tempPath);

      photoPaths.push(tempPath);
      consumedFileNames.push(generatedFileName);

      // Get the original name from mapping, fallback to generated name
      const originalName =
        originalNamesMapping[generatedFileName] || generatedFileName;
      originalNames.push(originalName);

      log(
        `📦 Moved photo from pool: ${generatedFileName} (original: ${originalName}) -> ${path.relative(
          tempDir,
          tempPath
        )}`
      );
    } catch (error) {
      log(`❌ Failed to move photo ${sourcePath}: ${error.message}`);
    }
  }

  // Clean up the original names mapping for consumed photos
  if (consumedFileNames.length > 0 && poolDir) {
    await cleanupOriginalNamesMapping(poolDir, consumedFileNames);
  }

  return { photoPaths, originalNames };
}

/**
 * Copy original photos (without spoofing) into the temp directory
 * @param {number} photosNeeded - Number of photos requested
 * @returns {Promise<{photoPaths: string[], originalNames: string[]}>}
 */
async function copyOriginalPhotosToTemp(photosNeeded, modelKey = DEFAULT_MODEL_KEY) {
  if (!photosNeeded || photosNeeded <= 0) {
    log("ℹ️ Photo count is zero, no original photos will be copied");
    return { photoPaths: [], originalNames: [] };
  }

  try {
    const sourceDir = await resolveSourceDir(modelKey);
    const files = await fs.readdir(sourceDir);
    const photoFiles = files
      .filter((file) =>
        file.match(/\.(jpg|jpeg|png|heic|heif|webp|bmp)$/i)
      )
      .map((file) => path.join(sourceDir, file));

    if (photoFiles.length === 0) {
      log(
        `⚠️ No original photos found in ${sourceDir}. Cannot fulfill request.`
      );
      return { photoPaths: [], originalNames: [] };
    }

    const selected = shuffleArray(photoFiles).slice(
      0,
      Math.min(photosNeeded, photoFiles.length)
    );

    if (selected.length < photosNeeded) {
      log(
      `⚠️ Only ${selected.length} original photos available (requested ${photosNeeded})`
      );
    }

    const tempRootDir = path.join(__dirname, "..", "temp");
    await fs.mkdir(tempRootDir, { recursive: true });
    const sessionDir = path.join(
      tempRootDir,
      `original_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    await fs.mkdir(sessionDir, { recursive: true });

    const photoPaths = [];
    const originalNames = [];

    for (const sourcePath of selected) {
      try {
        const originalName = path.basename(sourcePath);
        let tempFileName = originalName;
        let tempPath = path.join(sessionDir, tempFileName);
        let attempt = 1;

        while (true) {
          try {
            await fs.access(tempPath);
            attempt += 1;
            const parsed = path.parse(originalName);
            tempFileName = `${parsed.name}_${attempt}${parsed.ext}`;
            tempPath = path.join(sessionDir, tempFileName);
          } catch (error) {
            if (error.code === "ENOENT") {
              break;
            }
            throw error;
          }
        }

        await fs.copyFile(sourcePath, tempPath);
        photoPaths.push(tempPath);
        originalNames.push(originalName);
      } catch (error) {
        log(
          `⚠️ Failed to copy original photo ${path.basename(
            sourcePath
          )}: ${error.message}`
        );
      }
    }

    log(
      `📸 Prepared ${photoPaths.length} original photo(s) without spoofing from ${sourceDir}`
    );

    return { photoPaths, originalNames };
  } catch (error) {
    log(`❌ Error while reading original photos: ${error.message}`);
    return { photoPaths: [], originalNames: [] };
  }
}

/**
 * Extract original photo names from file paths
 * @param {string[]} photoPaths - Array of photo file paths
 * @returns {string[]} Array of original photo names
 */
function extractOriginalNames(photoPaths) {
  return photoPaths.map((photoPath) => {
    const fileName = path.basename(photoPath);
    // Extract original name from pattern: user_timestamp_random_originalname.ext
    const match = fileName.match(/^user_\d+_[a-z0-9]+_(.+)$/);
    return match ? match[1] : fileName;
  });
}

/**
 * Generate random photos using pre-generated pool (INSTANT)
 * @returns {Promise<{photoPaths: string[], originalNames: string[]}>}
 */
async function generateRandomPhotos(options = {}) {
  const { userId = null, modelKey = null, appName: explicitApp = null } =
    options || {};
  const appName = (explicitApp || getCurrentAppName()).toLowerCase();
  const photosNeeded = PHOTOS_PER_SET[appName] || 3;
  const activeModelKey = await resolveModelKeyForRequest(userId, modelKey);
  const poolLabel = describePool(appName, activeModelKey);

  if (!photosNeeded || photosNeeded <= 0) {
    log(`ℹ️ Photo count for ${poolLabel} is ${photosNeeded}. Skipping generation.`);
    return { photoPaths: [], originalNames: [], modelKey: activeModelKey };
  }

  const spoofingEnabled = isSpoofingEnabled(appName);

  if (!spoofingEnabled) {
    log(
      `🎯 Photo spoofing disabled for ${poolLabel} (app config or env). Serving original photos instead of pool files.`
    );
    return {
      ...(await copyOriginalPhotosToTemp(photosNeeded, activeModelKey)),
      modelKey: activeModelKey,
    };
  }

  log(`🎭 Requesting ${photosNeeded} photos for ${poolLabel} from pool...`);

  try {
    // Get available photos from pool
    let availablePhotos = await getAvailablePhotosFromPool(appName, activeModelKey);
    let poolDir = getPoolDir(appName, activeModelKey);
    let originalNamesMapping = await loadOriginalNamesMapping(poolDir);

    if (availablePhotos.length < photosNeeded) {
      log(
        `⚠️ Insufficient photos in pool for ${poolLabel}! Available: ${availablePhotos.length}, Needed: ${photosNeeded}`
      );
      log(`⚠️ The background worker may not be running or stock is depleted.`);

      // If pool is empty, do not fall back to raw originals
      if (availablePhotos.length === 0) {
        log(
          `🚫 No pool photos available for ${poolLabel}. Skipping photo delivery instead of sending source files.`
        );
        return { photoPaths: [], originalNames: [], modelKey: activeModelKey };
      }
    }

    const uniqueSelection = [];
    const seenOriginals = new Set();

    for (const photoPath of availablePhotos) {
      const generatedName = path.basename(photoPath);
      const originalName =
        originalNamesMapping[generatedName] || generatedName;

      if (seenOriginals.has(originalName)) {
        continue;
      }

      uniqueSelection.push(photoPath);
      seenOriginals.add(originalName);

      if (uniqueSelection.length === photosNeeded) {
        break;
      }
    }

    if (uniqueSelection.length < photosNeeded) {
      log(
        `⚠️ Only ${uniqueSelection.length} unique originals available for ${appName} (need ${photosNeeded}). Allowing duplicates to fulfill request.`
      );

      for (const photoPath of availablePhotos) {
        if (uniqueSelection.includes(photoPath)) {
          continue;
        }
        uniqueSelection.push(photoPath);
        if (uniqueSelection.length === photosNeeded) {
          break;
        }
      }
    }

    const selectedPhotos = uniqueSelection;

    // Move photos from pool to user temp directory
    const result = await movePhotosToUserTemp(selectedPhotos);

    log(
      `✅ Instantly provided ${result.photoPaths.length} photos for ${poolLabel} from pool`
    );
    log(`📸 Original names: ${result.originalNames.join(", ")}`);

    return { ...result, modelKey: activeModelKey };
  } catch (error) {
    log(`❌ Error getting photos from pool: ${error.message}`);
    return { photoPaths: [], originalNames: [], modelKey: activeModelKey };
  }
}

/**
 * Send photos as files to Telegram chat in bulk (using media group)
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {string[]} photoPaths - Array of photo file paths
 */
async function sendPhotosAsFiles(bot, chatId, photoPaths) {
  if (!photoPaths || photoPaths.length === 0) {
    log("⚠️ No photos to send");
    return;
  }

  try {
    log(`📤 Sending ${photoPaths.length} photos as files in bulk...`);

    // Telegram media groups support 2-10 items
    // If we have only 1 photo or more than 10, we need different handling
    if (photoPaths.length === 1) {
      // Send single photo as document
      const photoPath = photoPaths[0];
      const fileOptions = buildFileOptions(photoPath, 1);
      await bot.sendDocument(
        chatId,
        photoPath,
        {
          caption: `📸 Generated Photo`,
        },
        {
          filename: fileOptions.filename,
          contentType: fileOptions.contentType,
        }
      );
      log(`✅ Sent single photo as document: ${path.basename(photoPath)}`);
    } else {
      // Prepare media array for bulk sending (documents to avoid compression)
      const media = photoPaths.map((photoPath, index) => {
        const fileOptions = buildFileOptions(photoPath, index + 1);
        return {
          type: "document",
          media: {
            source: photoPath,
            filename: fileOptions.filename,
            contentType: fileOptions.contentType,
          },
          caption: index === 0 ? `📸 Generated Photos (${photoPaths.length} total)` : undefined,
        };
      });

      try {
        // Send in chunks of 10 (Telegram limit for media groups)
        for (let i = 0; i < media.length; i += 10) {
          const chunk = media.slice(i, i + 10);
          await bot.sendMediaGroup(chatId, chunk);
          log(`✅ Sent media group chunk: ${i + 1}-${Math.min(i + 10, media.length)} of ${media.length}`);
        }
        log(`✅ Successfully sent all ${photoPaths.length} photos as documents in media group(s)`);
      } catch (error) {
        // Fallback to individual sending if media group fails
        log(`⚠️ Media group failed, falling back to individual sends: ${error.message}`);

        for (let i = 0; i < photoPaths.length; i++) {
          const photoPath = photoPaths[i];
          const fileOptions = buildFileOptions(photoPath, i + 1);

          try {
            await bot.sendDocument(
              chatId,
              photoPath,
              {
                caption: `📸 Generated Photo ${i + 1}/${photoPaths.length}`,
              },
              {
                filename: fileOptions.filename,
                contentType: fileOptions.contentType,
              }
            );
            log(
              `✅ Sent photo ${i + 1}/${photoPaths.length}: ${path.basename(
                photoPath
              )}`
            );
          } catch (individualError) {
            log(`❌ Failed to send photo ${photoPath}: ${individualError.message}`);
          }
        }
      }
    }

    // Clean up temporary files after sending
    await cleanupGeneratedPhotos(photoPaths);
  } catch (error) {
    log(`❌ Error sending photos: ${error.message}`);
    // Still try to cleanup on error
    await cleanupGeneratedPhotos(photoPaths);
  }
}

/**
 * Clean up generated photo files
 * @param {string[]} photoPaths - Array of photo file paths to delete
 */
async function cleanupGeneratedPhotos(photoPaths) {
  if (!photoPaths || photoPaths.length === 0) {
    return;
  }

  try {
    log(`🗑️ Cleaning up ${photoPaths.length} generated photos...`);

    for (const photoPath of photoPaths) {
      try {
        await fs.unlink(photoPath);
        log(`🗑️ Deleted: ${path.basename(photoPath)}`);
      } catch (error) {
        log(`⚠️ Could not delete ${photoPath}: ${error.message}`);
      }
    }
  } catch (error) {
    log(`❌ Error during photo cleanup: ${error.message}`);
  }
}

/**
 * Handle photo regeneration request (from callback button)
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID to edit
 * @param {Object} appConfig - App configuration
 */
async function handleRegeneratePhotos(bot, chatId, messageId, appConfig, userId = null) {
  try {
    // Check if photo regeneration is allowed for this app
    if (!appConfig?.photos?.allowRegenerate) {
      await bot.editMessageText(
        "❌ Photo regeneration is not enabled for this app.",
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );
      return;
    }

    await bot.editMessageText("⏳ Regenerating photos from pool...", {
      chat_id: chatId,
      message_id: messageId,
    });

    const photoResult = await generateRandomPhotos({ userId });

    if (photoResult.photoPaths && photoResult.photoPaths.length > 0) {
      await bot.editMessageText(
        `✅ Successfully regenerated ${photoResult.photoPaths.length} photos! Sending them now...`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      await sendPhotosAsFiles(bot, chatId, photoResult.photoPaths);
    } else {
      await bot.editMessageText(
        "❌ No photos available for regeneration. Please try again later or contact support.",
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );
    }
  } catch (error) {
    log(`❌ Error in handleRegeneratePhotos: ${error.message}`);
    await bot.editMessageText(
      "❌ Error regenerating photos. Please try again later.",
      {
        chat_id: chatId,
        message_id: messageId,
      }
    );
  }
}

/**
 * Get pool statistics for monitoring
 * @param {string} appName - App name
 * @returns {Promise<Object>} Pool statistics
 */
async function getPoolStats(appName, modelKey = DEFAULT_MODEL_KEY) {
  try {
    const availablePhotos = await getAvailablePhotosFromPool(appName, modelKey);
    const photosPerSet = PHOTOS_PER_SET[appName] || 3;
    const completeSets = Math.floor(availablePhotos.length / photosPerSet);

    return {
      appName,
      modelKey,
      totalPhotos: availablePhotos.length,
      completeSets,
      photosPerSet,
      canServe: completeSets > 0,
    };
  } catch (error) {
    return {
      appName,
      modelKey,
      totalPhotos: 0,
      completeSets: 0,
      photosPerSet: PHOTOS_PER_SET[appName] || 3,
      canServe: false,
      error: error.message,
    };
  }
}

module.exports = {
  generateRandomPhotos,
  sendPhotosAsFiles,
  cleanupGeneratedPhotos,
  handleRegeneratePhotos,
  getPoolStats,
  extractOriginalNames,
  getCurrentAppName,
  loadOriginalNamesMapping,
  PHOTOS_PER_SET,
};
