const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { log } = require("../../utils/logger");
const { loadConfig } = require("../../config/load-config");
const {
  DEFAULT_MODEL_KEY,
  getPoolDir,
  getModelSourceCandidates,
  resolveModelKey,
} = require("../../../config/photo-models");
const { getSpooferRuntimeConfig } = require("./photo-spoofer-registry");
const { getModelKeyForUser } = require("./user-models");

const PHOTOS_PER_SET = {
  "hinge-prod-1": 6,
};

function describePool(appName, modelKey = DEFAULT_MODEL_KEY) {
  return modelKey && modelKey !== DEFAULT_MODEL_KEY
    ? `${appName}@${modelKey}`
    : appName;
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

  const fallback = candidates[0];
  await fs.mkdir(fallback, { recursive: true });
  return fallback;
}

function getConfiguredPhotoSettings() {
  try {
    const config = loadConfig();
    return config?.photos || {};
  } catch (error) {
    log(`⚠️ Unable to load photo settings from local-config: ${error.message}`);
    return {};
  }
}

function getPhotosPerSet(appName = "") {
  const envCount = Number(process.env.PHOTO_COUNT || "");
  if (Number.isFinite(envCount) && envCount > 0) {
    return Math.floor(envCount);
  }

  const settings = getConfiguredPhotoSettings();
  if (Number.isFinite(settings?.count) && settings.count > 0) {
    return Math.floor(settings.count);
  }

  return PHOTOS_PER_SET[(appName || "").toLowerCase()] || 6;
}

function isVisualSpoofingEnabled(appName = "") {
  const envFlag = (process.env.PHOTOS_USE_SPOOFING || "true").toLowerCase();
  const envEnabled = envFlag !== "false" && envFlag !== "0";
  const photoSettings = getConfiguredPhotoSettings();

  if (photoSettings?.useSpoofing === false) {
    return false;
  }

  return envEnabled;
}

function getMetadataSpooferName(appName = "") {
  const envSpoofer = process.env.PHOTO_METADATA_SPOOFER;
  if (envSpoofer) {
    return envSpoofer;
  }

  const settings = getConfiguredPhotoSettings();
  return settings?.metadataSpoofer || "iphone_exif_gui_reconstructed";
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
  const legacyContent = legacyLines.length > 0 ? `${legacyLines.join("\n")}\n` : "";

  await fs.writeFile(mappingFile, jsonContent);
  await fs.writeFile(legacyFile, legacyContent);
}

function getRuntimeAppName() {
  return process.env.SELECTED_APP || "hinge-prod-1";
}

async function getAvailablePhotosFromPool(appName, modelKey = DEFAULT_MODEL_KEY) {
  const poolDir = getPoolDir(appName, modelKey);

  try {
    await fs.access(poolDir);
    const files = await fs.readdir(poolDir);

    const photoFiles = files
      .filter((file) => file.match(/\.(jpg|jpeg|png|heic|heif)$/i))
      .map((file) => path.join(poolDir, file));

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

async function loadOriginalNamesMapping(poolDir) {
  try {
    const mappingFile = path.join(poolDir, ".original-names.json");
    const data = await fs.readFile(mappingFile, "utf8");
    return JSON.parse(data);
  } catch (error) {
    const legacyMapping = await loadLegacyOriginalNamesMapping(poolDir);
    if (Object.keys(legacyMapping).length > 0) {
      return legacyMapping;
    }
    return {};
  }
}

async function cleanupOriginalNamesMapping(poolDir, consumedFileNames) {
  try {
    const mapping = await loadOriginalNamesMapping(poolDir);

    let removedCount = 0;
    for (const fileName of consumedFileNames) {
      if (mapping[fileName]) {
        delete mapping[fileName];
        removedCount += 1;
      }
    }

    if (removedCount > 0) {
      await persistOriginalNamesMapping(poolDir, mapping);
    }
  } catch (error) {
    log(`⚠️ Error cleaning up original names mapping: ${error.message}`);
  }
}

async function movePhotosToUserTemp(sourcePaths) {
  const tempDir = path.join(__dirname, "..", "temp");

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
      const tempPath = path.join(sessionDir, generatedFileName);

      await fs.rename(sourcePath, tempPath);

      photoPaths.push(tempPath);
      consumedFileNames.push(generatedFileName);

      const originalName = originalNamesMapping[generatedFileName] || generatedFileName;
      originalNames.push(originalName);
    } catch (error) {
      log(`❌ Failed to move photo ${sourcePath}: ${error.message}`);
    }
  }

  if (consumedFileNames.length > 0 && poolDir) {
    await cleanupOriginalNamesMapping(poolDir, consumedFileNames);
  }

  return { photoPaths, originalNames };
}

async function copyOriginalPhotosToTemp(photosNeeded, modelKey = DEFAULT_MODEL_KEY) {
  if (!photosNeeded || photosNeeded <= 0) {
    return { photoPaths: [], originalNames: [] };
  }

  try {
    const sourceDir = await resolveSourceDir(modelKey);
    const files = await fs.readdir(sourceDir);
    const photoFiles = files
      .filter((file) => file.match(/\.(jpg|jpeg|png|heic|heif|webp|bmp)$/i))
      .map((file) => path.join(sourceDir, file));

    if (photoFiles.length === 0) {
      return { photoPaths: [], originalNames: [] };
    }

    const selected = shuffleArray(photoFiles).slice(
      0,
      Math.min(photosNeeded, photoFiles.length)
    );

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
      const originalName = path.basename(sourcePath);
      const tempPath = path.join(sessionDir, originalName);
      await fs.copyFile(sourcePath, tempPath);
      photoPaths.push(tempPath);
      originalNames.push(originalName);
    }

    return { photoPaths, originalNames };
  } catch (error) {
    log(`❌ Error while copying original photos: ${error.message}`);
    return { photoPaths: [], originalNames: [] };
  }
}

function parseOriginalNamesFromOutput(output = "") {
  const names = [];
  let inSection = false;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();

    if (line === "ORIGINAL_NAMES_START") {
      inSection = true;
      continue;
    }

    if (line === "ORIGINAL_NAMES_END") {
      break;
    }

    if (inSection && line.startsWith("ORIGINAL:")) {
      const value = line.replace("ORIGINAL:", "").trim();
      if (value) {
        names.push(value);
      }
    }
  }

  return names;
}

function getPythonExecutable() {
  const preferred = "/Users/hugocaulfield/miniforge3/bin/python3";
  try {
    fsSync.accessSync(preferred, fsSync.constants.X_OK);
    return preferred;
  } catch (_) {
    const platform = os.platform();
    return platform === "win32" ? "python" : "python3";
  }
}

async function runMetadataOnlySpoofing(photosNeeded, modelKey, appName) {
  const sourceDir = await resolveSourceDir(modelKey);
  const tempRootDir = path.join(__dirname, "..", "temp");
  await fs.mkdir(tempRootDir, { recursive: true });

  const sessionDir = path.join(
    tempRootDir,
    `metadata_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.mkdir(sessionDir, { recursive: true });

  const spooferName = getMetadataSpooferName(appName);
  const runtimeConfig = getSpooferRuntimeConfig(spooferName, {
    photoCount: photosNeeded,
    outputDir: sessionDir,
    options: {
      inputDir: sourceDir,
      versions: 1,
      modificationLevel: 0,
      flatOutput: true,
      quiet: true,
    },
  });

  const pythonExecutable = getPythonExecutable();
  const workingDir = runtimeConfig.workingDirOverride || runtimeConfig.spoofer.workingDir;

  const runResult = await new Promise((resolve) => {
    const child = spawn(pythonExecutable, [runtimeConfig.spoofer.scriptPath, ...runtimeConfig.args], {
      cwd: workingDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });

  if (runResult.code !== 0) {
    throw new Error(
      `metadata-only spoofer failed (${spooferName}): ${runResult.stderr || runResult.stdout}`
    );
  }

  const files = await fs.readdir(sessionDir);
  const imageFiles = files
    .filter((file) => file.match(/\.(jpg|jpeg|png|heic|heif)$/i))
    .map((file) => path.join(sessionDir, file));

  const withStats = await Promise.all(
    imageFiles.map(async (filePath) => {
      const stat = await fs.stat(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
  );

  const photoPaths = withStats
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, photosNeeded)
    .map((entry) => entry.filePath);

  if (photoPaths.length === 0) {
    throw new Error("metadata-only spoofer returned no files");
  }

  const originalNamesParsed = parseOriginalNamesFromOutput(runResult.stdout);
  const originalNames =
    originalNamesParsed.length > 0
      ? originalNamesParsed.slice(0, photoPaths.length)
      : photoPaths.map((p) => path.basename(p));

  return { photoPaths, originalNames };
}

async function buildPhotoSet(options = {}) {
  const { userId = null, modelKey = null, appName: explicitApp = null } = options || {};
  const appName = (explicitApp || getRuntimeAppName()).toLowerCase();
  const photosNeeded = getPhotosPerSet(appName);
  const activeModelKey = await resolveModelKeyForRequest(userId, modelKey);
  const poolLabel = describePool(appName, activeModelKey);

  if (!photosNeeded || photosNeeded <= 0) {
    return { photoPaths: [], originalNames: [], modelKey: activeModelKey };
  }

  const visualSpoofingEnabled = isVisualSpoofingEnabled(appName);

  if (!visualSpoofingEnabled) {
    log(
      `📱 useSpoofing=false for ${poolLabel}: applying metadata-only spoofing (no pixel edits).`
    );

    try {
      const metadataOnlyResult = await runMetadataOnlySpoofing(
        photosNeeded,
        activeModelKey,
        appName
      );
      return {
        ...metadataOnlyResult,
        modelKey: activeModelKey,
      };
    } catch (error) {
      log(`⚠️ Metadata-only spoofing failed, falling back to originals: ${error.message}`);
      return {
        ...(await copyOriginalPhotosToTemp(photosNeeded, activeModelKey)),
        modelKey: activeModelKey,
      };
    }
  }

  log(`🎭 Requesting ${photosNeeded} photos for ${poolLabel} from pool...`);

  try {
    const availablePhotos = await getAvailablePhotosFromPool(appName, activeModelKey);
    const poolDir = getPoolDir(appName, activeModelKey);
    const originalNamesMapping = await loadOriginalNamesMapping(poolDir);

    if (availablePhotos.length < photosNeeded) {
      if (availablePhotos.length === 0) {
        log(
          `🚫 No pool photos available for ${poolLabel}. Skipping photo delivery.`
        );
        return { photoPaths: [], originalNames: [], modelKey: activeModelKey };
      }
    }

    const uniqueSelection = [];
    const seenOriginals = new Set();

    for (const photoPath of availablePhotos) {
      const generatedName = path.basename(photoPath);
      const originalName = originalNamesMapping[generatedName] || generatedName;

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
      for (const photoPath of availablePhotos) {
        if (!uniqueSelection.includes(photoPath)) {
          uniqueSelection.push(photoPath);
        }
        if (uniqueSelection.length === photosNeeded) {
          break;
        }
      }
    }

    const result = await movePhotosToUserTemp(uniqueSelection);

    return { ...result, modelKey: activeModelKey };
  } catch (error) {
    log(`❌ Error getting photos from pool: ${error.message}`);
    return { photoPaths: [], originalNames: [], modelKey: activeModelKey };
  }
}

async function getPhotoPoolStats(appName, modelKey = DEFAULT_MODEL_KEY) {
  try {
    const availablePhotos = await getAvailablePhotosFromPool(appName, modelKey);
    const photosPerSet = getPhotosPerSet(appName);
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
      photosPerSet: getPhotosPerSet(appName),
      canServe: false,
      error: error.message,
    };
  }
}

module.exports = {
  buildPhotoSet,
  getPhotoPoolStats,
  getRuntimeAppName,
  loadOriginalNamesMapping,
  PHOTOS_PER_SET,
};
