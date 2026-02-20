#!/usr/bin/env node

/**
 * Background Photo Pre-Generation Worker
 *
 * This service runs independently and maintains pre-generated photo pools
 * for all bot instances to ensure instant photo delivery.
 */

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { loadConfig } = require("../../config/load-config");
const {
  DEFAULT_SPOOFER,
  getSpooferRuntimeConfig,
  listAvailableSpoofers,
} = require("./photo-spoofer-registry");
const {
  DEFAULT_MODEL_KEY,
  getPoolDir,
  POOLS_DIR,
  resolveModelKey,
  getModelSourceCandidates,
} = require("../../../config/photo-models");
const { getActiveModelKeys } = require("./user-models");

// Configuration
const CONFIG = {
  // Minimum number of photo sets to maintain per app
  MIN_STOCK_LEVELS: {
    "hinge-prod-1": 10,
  },

  // Photos per request for each app type
  PHOTOS_PER_SET: {
    "hinge-prod-1": 6,
  },

  // How often to check stock levels (in milliseconds)
  CHECK_INTERVAL: 15000, // 15 seconds

  // Upper bound of sets generated for a pool before re-evaluating global stock
  GENERATION_BATCH_SIZE: 8,
  // Consider a lock stale after this many ms (in case of crash/kill)
  LOCK_TTL_MS: 10 * 60 * 1000, // 10 minutes
  // Kill/abort Python generation if it hangs too long
  PYTHON_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes

  PYTHON_WORKING_DIR: path.join(
    __dirname,
    "..",
    "..",
    "..",
    "scripts",
    "python"
  ),
  POOLS_BASE_DIR: POOLS_DIR,
};

const DEV_APP_PATTERN = /(^|-)dev($|-\d+$)/i;
const PHOTO_EXT_PATTERN = /\.(jpg|jpeg|png|heic|heif)$/i;
const LOCKFILE_NAME = ".generation.lock";

function describePool(appName, modelKey = DEFAULT_MODEL_KEY) {
  const resolved = resolveModelKey(modelKey);
  return resolved === DEFAULT_MODEL_KEY ? appName : `${appName}@${resolved}`;
}

/**
 * Logger with timestamp
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🎭 PhotoWorker: ${message}`);
}

/**
 * Get the correct Python executable for the current platform
 */
function getPythonExecutable() {
  const preferred = "/Users/hugocaulfield/miniforge3/bin/python3";
  try {
    fsSync.accessSync(preferred, fsSync.constants.X_OK);
    return preferred;
  } catch (e) {
    // ignore and fallback
  }
  const platform = os.platform();
  return platform === "win32" ? "python" : "python3";
}

/**
 * Execute Python script to generate photos
 */
function runSpooferScript(runtimeConfig) {
  return new Promise((resolve, reject) => {
    const pythonExecutable = getPythonExecutable();
    const scriptPath = runtimeConfig?.spoofer?.scriptPath;
    const workingDir =
      runtimeConfig?.workingDirOverride || runtimeConfig?.spoofer?.workingDir;
    const args = runtimeConfig?.args || [];
    const targetOutputDir = runtimeConfig?.outputDir;
    const photoCount = runtimeConfig?.photoCount || args[0] || "?";
    const timeoutMs = runtimeConfig?.timeoutMs || CONFIG.PYTHON_TIMEOUT_MS;

    if (!scriptPath || !workingDir) {
      reject(new Error("Invalid spoofer configuration: missing script path"));
      return;
    }

    log(
      `🐍 Generating ${photoCount} photos in ${targetOutputDir} using ${runtimeConfig.spoofer.name}...`
    );

    const python = spawn(
      pythonExecutable,
      [scriptPath, ...args],
      {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      log(`❌ Python generation timed out after ${Math.round(timeoutMs / 1000)}s`);
      python.kill("SIGTERM");
      reject(new Error(`Python generation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      log(`🐍 Python stdout: ${chunk.trim()}`);
    });

    python.stderr.on("data", (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      log(`⚠️ Python stderr: ${chunk.trim()}`);
    });

    python.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (code === 0) {
        log(`✅ Photo generation completed successfully`);

        // Parse original photo names from Python output
        const originalNames = parseOriginalNamesFromOutput(output);
        log(`📝 Extracted ${originalNames.length} original photo names`);

        resolve({ success: true, output, originalNames });
      } else {
        log(`❌ Photo generation failed with code ${code}`);
        reject(new Error(`Python script failed: ${errorOutput || output}`));
      }
    });

    python.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      log(`❌ Failed to start Python process: ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Ensure pool directory exists for an app
 */
async function ensurePoolDirectory(appName, modelKey = DEFAULT_MODEL_KEY) {
  const poolDir = getPoolDir(appName, modelKey);
  try {
    await fs.access(poolDir);
  } catch (error) {
    log(`📁 Creating pool directory for ${describePool(appName, modelKey)}: ${poolDir}`);
    await fs.mkdir(poolDir, { recursive: true });
  }
  return poolDir;
}

/**
 * Count existing photo sets in a pool directory
 */
async function countPhotoSets(poolDir, photosPerSet) {
  try {
    const files = await fs.readdir(poolDir);
    const photoFiles = files.filter((file) =>
      file.match(PHOTO_EXT_PATTERN)
    );
    await cleanOriginalNamesMapping(poolDir, photoFiles, { quiet: true });
    const sets = Math.floor(photoFiles.length / photosPerSet);
    return { sets, totalPhotos: photoFiles.length };
  } catch (error) {
    log(`⚠️ Error counting photos in ${poolDir}: ${error.message}`);
    return { sets: 0, totalPhotos: 0 };
  }
}

async function findModelSourceWithPhotos(modelKey = DEFAULT_MODEL_KEY) {
  const candidates = getModelSourceCandidates(modelKey);
  let firstCandidate = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const resolved = path.resolve(candidate);
    if (!firstCandidate) {
      firstCandidate = resolved;
    }

    try {
      const entries = await fs.readdir(resolved);
      const photoCount = entries.filter((entry) =>
        PHOTO_EXT_PATTERN.test(entry)
      ).length;

      if (photoCount > 0) {
        return { inputDir: resolved, photoCount };
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        log(`⚠️ Could not read source dir ${resolved}: ${error.message}`);
      }
    }
  }

  return { inputDir: firstCandidate, photoCount: 0 };
}

async function acquirePoolLock(poolDir) {
  const lockPath = path.join(poolDir, LOCKFILE_NAME);
  const payload = `${process.pid}:${Date.now()}`;

  async function readLockInfo() {
    try {
      const raw = await fs.readFile(lockPath, "utf8");
      const [pidPart, tsPart] = raw.trim().split(":");
      const pid = Number(pidPart);
      const ts = Number(tsPart);
      return {
        pid: Number.isFinite(pid) ? pid : null,
        ts: Number.isFinite(ts) ? ts : null,
        raw,
      };
    } catch (error) {
      return { pid: null, ts: null, raw: null, error };
    }
  }

  function isProcessAlive(pid) {
    if (!pid || !Number.isFinite(pid)) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== "ESRCH";
    }
  }

  async function isLockStale() {
    const info = await readLockInfo();
    if (!info.ts) {
      try {
        const stats = await fs.stat(lockPath);
        const ageMs = Date.now() - stats.mtimeMs;
        return ageMs > CONFIG.LOCK_TTL_MS;
      } catch (error) {
        return false;
      }
    }
    const ageMs = Date.now() - info.ts;
    if (ageMs > CONFIG.LOCK_TTL_MS) {
      return true;
    }
    if (info.pid && !isProcessAlive(info.pid)) {
      return true;
    }
    return false;
  }

  try {
    await fs.writeFile(lockPath, payload, { flag: "wx" });
    return async () => {
      try {
        await fs.unlink(lockPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          log(
            `⚠️ Failed to release lock for ${path.basename(
              poolDir
            )}: ${error.message}`
          );
        }
      }
    };
  } catch (error) {
    if (error.code === "EEXIST") {
      try {
        const stale = await isLockStale();
        if (stale) {
          log(
            `🧹 Stale lock detected for ${path.basename(
              poolDir
            )}, removing and retrying`
          );
          await fs.unlink(lockPath);
          return acquirePoolLock(poolDir);
        }
      } catch (staleError) {
        log(
          `⚠️ Failed to check stale lock for ${path.basename(
            poolDir
          )}: ${staleError.message}`
        );
      }

      log(
        `🔒 Pool ${path.basename(
          poolDir
        )} is already being generated by another worker, skipping this attempt`
      );
      return null;
    }

    log(
      `⚠️ Could not acquire lock for ${path.basename(
        poolDir
      )}: ${error.message}`
    );
    return null;
  }
}

function getAppSpooferSettings() {
  let photosConfig = {};
  try {
    const config = loadConfig();
    photosConfig = config?.photos || {};
  } catch (error) {
    log(
      `⚠️ Could not load spoofer settings from local-config.json, using defaults: ${error.message}`
    );
  }
  return {
    name: photosConfig.spoofer || DEFAULT_SPOOFER,
    options: photosConfig.spooferOptions || {},
  };
}

/**
 * Determine if an app corresponds to a development pool
 * @param {string} appName
 * @returns {boolean}
 */
function isDevApp(appName) {
  return DEV_APP_PATTERN.test(appName);
}

/**
 * Load current stock status for an app pool
 * @param {string} appName
 * @returns {Promise<{appName: string, sets: number, totalPhotos: number, minStock: number, photosPerSet: number, deficit: number}>}
 */
async function getAppStockStatus(appName, modelKey = DEFAULT_MODEL_KEY) {
  const minStock = CONFIG.MIN_STOCK_LEVELS[appName];
  const photosPerSet = CONFIG.PHOTOS_PER_SET[appName];

  if (typeof minStock !== "number") {
    throw new Error(`No minimum stock configured for ${appName}`);
  }

  if (typeof photosPerSet !== "number") {
    throw new Error(`No photos-per-set configured for ${appName}`);
  }

  const poolDir = await ensurePoolDirectory(appName, modelKey);
  const { sets, totalPhotos } = await countPhotoSets(poolDir, photosPerSet);

  return {
    appName,
    modelKey,
    sets,
    totalPhotos,
    minStock,
    photosPerSet,
    deficit: Math.max(0, minStock - sets),
  };
}

/**
 * Load stock status for all production pools
 * @returns {Promise<ReturnType<typeof getAppStockStatus>[]>}
 */
async function getActiveAppStockStatuses() {
  const entries = Object.keys(CONFIG.MIN_STOCK_LEVELS).filter(
    (appName) => !isDevApp(appName)
  );

  let modelKeys = [DEFAULT_MODEL_KEY];
  try {
    modelKeys = await getActiveModelKeys();
  } catch (error) {
    log(`⚠️ Could not load active model keys, using default only: ${error.message}`);
  }

  const tasks = [];
  for (const appName of entries) {
    for (const modelKey of modelKeys) {
      tasks.push(getAppStockStatus(appName, modelKey));
    }
  }

  return Promise.all(tasks);
}

function logStockSummaries(statuses, heading = "📊 Pool stock levels") {
  log(heading);
  statuses.forEach(({ appName, modelKey = DEFAULT_MODEL_KEY, sets, totalPhotos, minStock }) => {
    const label = describePool(appName, modelKey);
    log(
      `📊 ${label}: ${sets} sets available (${totalPhotos} photos), minimum: ${minStock} sets`
    );
  });
}

/**
 * Parse original photo names from Python script output
 * @param {string} output - Python script stdout
 * @returns {string[]} Array of original photo names
 */
function parseOriginalNamesFromOutput(output) {
  const originalNames = [];
  const lines = output.split("\n");
  let inOriginalNamesSection = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === "ORIGINAL_NAMES_START") {
      inOriginalNamesSection = true;
      continue;
    }

    if (trimmedLine === "ORIGINAL_NAMES_END") {
      inOriginalNamesSection = false;
      break;
    }

    if (inOriginalNamesSection && trimmedLine.startsWith("ORIGINAL: ")) {
      const originalName = trimmedLine.replace("ORIGINAL: ", "");
      originalNames.push(originalName);
    }
  }

  return originalNames;
}

async function readExistingOriginalNamesMapping(poolDir, { quiet = false } = {}) {
  const mappingFile = path.join(poolDir, ".original-names.json");
  try {
    const data = await fs.readFile(mappingFile, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!quiet) {
        log(
          `📝 Creating new original names mapping for ${path.basename(poolDir)}`
        );
      }
    } else {
      if (!quiet) {
        log(
          `⚠️ Could not load original names mapping JSON for ${path.basename(
            poolDir
          )}: ${error.message}`
        );
      }
    }
    const legacyFile = path.join(poolDir, ".original_names");
    try {
      const legacyData = await fs.readFile(legacyFile, "utf8");
      const mapping = {};
      for (const rawLine of legacyData.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        const [generated, original] = line.split(/\t+/, 2);
        if (generated) {
          mapping[generated] = original || generated;
        }
      }
      if (Object.keys(mapping).length > 0 && !quiet) {
        log(
          `ℹ️ Loaded legacy original names mapping from .original_names for ${path.basename(
            poolDir
          )}`
        );
      }
      return mapping;
    } catch (legacyError) {
      if (legacyError.code !== "ENOENT" && !quiet) {
        log(
          `⚠️ Could not load legacy original names mapping for ${path.basename(
            poolDir
          )}: ${legacyError.message}`
        );
      }
      return {};
    }
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

async function cleanOriginalNamesMapping(
  poolDir,
  validFileNames,
  { quiet = false, existingMapping = null } = {}
) {
  const normalizedNames = (validFileNames || []).map((entry) => {
    if (!entry) {
      return null;
    }
    if (typeof entry === "string") {
      return entry;
    }
    if (typeof entry.name === "string") {
      return entry.name;
    }
    if (typeof entry.path === "string") {
      return path.basename(entry.path);
    }
    return null;
  });

  const validSet = new Set(normalizedNames.filter(Boolean));
  let mapping = existingMapping;

  try {
    if (!mapping) {
      mapping = await readExistingOriginalNamesMapping(poolDir, { quiet });
    }
  } catch (error) {
    if (!quiet) {
      log(
        `⚠️ Unable to read original names mapping for ${path.basename(
          poolDir
        )}: ${error.message}`
      );
    }
    return {};
  }

  const staleEntries = Object.keys(mapping).filter(
    (generatedName) => !validSet.has(generatedName)
  );

  if (staleEntries.length > 0) {
    for (const name of staleEntries) {
      delete mapping[name];
    }
    await persistOriginalNamesMapping(poolDir, mapping);
    log(
      `🧹 Removed ${staleEntries.length} stale original name entr${
        staleEntries.length > 1 ? "ies" : "y"
      } for ${path.basename(poolDir)}`
    );
  }

  return mapping;
}

async function cleanupPartialGeneration(poolDir, preExistingFiles) {
  try {
    const files = await fs.readdir(poolDir);
    const photoFiles = files.filter((file) => PHOTO_EXT_PATTERN.test(file));
    const existingSet = new Set(preExistingFiles || []);
    const newFiles = photoFiles.filter((file) => !existingSet.has(file));

    if (!newFiles.length) {
      return;
    }

    for (const file of newFiles) {
      try {
        await fs.unlink(path.join(poolDir, file));
      } catch (error) {
        log(`⚠️ Failed to remove partial file ${file}: ${error.message}`);
      }
    }

    log(
      `🧹 Removed ${newFiles.length} partial photo(s) for ${path.basename(
        poolDir
      )}`
    );
  } catch (error) {
    log(
      `⚠️ Failed to cleanup partial generation for ${path.basename(
        poolDir
      )}: ${error.message}`
    );
  }
}

/**
 * Store original photo names mapping for generated photos
 * @param {string} poolDir - Pool directory path
 * @param {string[]} originalNames - Array of original photo names
 */
async function storeOriginalNamesMapping(poolDir, originalNames) {
  if (!Array.isArray(originalNames) || originalNames.length === 0) {
    log("ℹ️ No original names were emitted by the spoofer, skipping mapping update");
    return;
  }

  try {
    const files = await fs.readdir(poolDir);
    const photoFiles = files
      .filter((file) => file.match(/\.(jpg|jpeg|png|heic)$/i))
      .map((file) => ({
        name: file,
        path: path.join(poolDir, file),
      }));

    if (!photoFiles.length) {
      log(
        `⚠️ Cannot store original names for ${path.basename(
          poolDir
        )}: no generated photos found`
      );
      return;
    }

    let mapping = await cleanOriginalNamesMapping(
      poolDir,
      photoFiles.map((file) => file.name),
      { quiet: true }
    );

    // Sort by modification time to get the newest files
    const photoStats = await Promise.all(
      photoFiles.map(async (file) => {
        const stats = await fs.stat(file.path);
        const mtimeMs =
          typeof stats.mtimeMs === "number"
            ? stats.mtimeMs
            : stats.mtime.getTime();
        return { ...file, mtime: mtimeMs };
      })
    );

    const newestPhotos = photoStats
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, originalNames.length);

    const pairsToMap = Math.min(newestPhotos.length, originalNames.length);
    for (let i = 0; i < pairsToMap; i++) {
      const generatedFileName = newestPhotos[i].name;
      const originalName = originalNames[i];
      mapping[generatedFileName] = originalName;
      log(`📝 Mapped: ${generatedFileName} → ${originalName}`);
    }

    if (pairsToMap === 0) {
      log(
        `⚠️ Unable to match any freshly generated photos with their original names for ${path.basename(
          poolDir
        )}`
      );
      return;
    }

    await persistOriginalNamesMapping(poolDir, mapping);
    log(
      `💾 Saved original names mapping with ${
        Object.keys(mapping).length
      } entries (${pairsToMap} new)`
    );
  } catch (error) {
    log(`❌ Error storing original names mapping: ${error.message}`);
  }
}

/**
 * Generate a batch of photo sets for an app
 */
async function generateBatchForApp(appOrStatus, requestedSets, options = {}) {
  const { preAcquiredLock = null } = options;
  const appName =
    typeof appOrStatus === "string" ? appOrStatus : appOrStatus?.appName;
  const modelKey =
    typeof appOrStatus === "object" && appOrStatus?.modelKey
      ? appOrStatus.modelKey
      : DEFAULT_MODEL_KEY;

  async function releasePreLockIfNeeded() {
    if (preAcquiredLock) {
      try {
        await preAcquiredLock();
      } catch (error) {
        log(`⚠️ Failed to release pre-acquired lock: ${error.message}`);
      }
    }
  }

  if (!appName) {
    log("⚠️ Cannot generate batch: missing app identifier");
    await releasePreLockIfNeeded();
    return false;
  }

  if (isDevApp(appName)) {
    log(`🚫 ${appName} is a dev pool and will not be generated automatically`);
    await releasePreLockIfNeeded();
    return false;
  }

  const poolDir = await ensurePoolDirectory(appName, modelKey);
  const photosPerSet = CONFIG.PHOTOS_PER_SET[appName];
  if (typeof photosPerSet !== "number") {
    log(`⚠️ Cannot determine photos-per-set for ${appName}, skipping generation`);
    await releasePreLockIfNeeded();
    return false;
  }

  const status =
    typeof appOrStatus === "object" && typeof appOrStatus.deficit === "number"
      ? appOrStatus
      : await getAppStockStatus(appName, modelKey);

  const previousTotalPhotos = status.totalPhotos || 0;
  const deficit = Math.max(0, status.deficit || 0);
  if (deficit === 0) {
    log(`ℹ️ ${describePool(appName, modelKey)} already meets minimum stock, skipping generation`);
    await releasePreLockIfNeeded();
    return false;
  }

  const configuredBatch = Math.max(1, Math.floor(CONFIG.GENERATION_BATCH_SIZE));
  const requestedBatch =
    typeof requestedSets === "number" && requestedSets > 0
      ? Math.floor(requestedSets)
      : configuredBatch;
  const targetBatch = Math.max(1, Math.min(requestedBatch, deficit));

  const { inputDir: modelSourceDir, photoCount: availableSourcePhotos } =
    await findModelSourceWithPhotos(modelKey);

  if (!modelSourceDir) {
    log(
      `⚠️ Could not resolve a source directory for model ${modelKey}, skipping generation`
    );
    await releasePreLockIfNeeded();
    return false;
  }

  if (availableSourcePhotos === 0) {
    log(
      `🚫 No source photos found for model ${modelKey} (${describePool(
        appName,
        modelKey
      )}), skipping this cycle`
    );
    await releasePreLockIfNeeded();
    return false;
  }

  const maxSetsFromSource = Math.floor(
    availableSourcePhotos / photosPerSet
  );

  if (maxSetsFromSource <= 0) {
    log(
      `🚫 Not enough source photos for ${describePool(
        appName,
        modelKey
      )} (${availableSourcePhotos} found, need at least ${photosPerSet})`
    );
    await releasePreLockIfNeeded();
    return false;
  }

  const generationBatch = Math.min(targetBatch, maxSetsFromSource);
  const totalPhotosToGenerate = photosPerSet * generationBatch;
  const cappedBySource = generationBatch < targetBatch;

  log(
    `🎨 Generating ${generationBatch} set${
      generationBatch > 1 ? "s" : ""
    } for ${describePool(appName, modelKey)} (${totalPhotosToGenerate} photos requested, deficit ${
      deficit
    } sets${cappedBySource ? `, limited by ${availableSourcePhotos} source photos` : ""})`
  );

  let releaseLock = preAcquiredLock;
  if (!releaseLock) {
    releaseLock = await acquirePoolLock(poolDir);
    if (!releaseLock) {
      return false;
    }
  }

  let preExistingFiles = [];
  try {
    const existingFiles = await fs.readdir(poolDir);
    preExistingFiles = existingFiles.filter((file) =>
      PHOTO_EXT_PATTERN.test(file)
    );
  } catch (error) {
    log(`⚠️ Could not snapshot pool files for ${describePool(appName, modelKey)}: ${error.message}`);
  }

  try {
    const spooferSettings = getAppSpooferSettings();
    const modelWorkingDir = path.dirname(modelSourceDir);
    await fs.mkdir(modelSourceDir, { recursive: true });
    const runtimeConfig = getSpooferRuntimeConfig(spooferSettings.name, {
      photoCount: totalPhotosToGenerate,
      outputDir: poolDir,
      options: {
        ...(spooferSettings.options || {}),
        // Ensure spoofers look at the model's own photo source
        inputDir: modelSourceDir,
        // Keep working directory aligned with the model root for compatibility
        workingDir: spooferSettings.name === "random_three" ? modelWorkingDir : undefined,
      },
    });

    log(
      `🪄 Using spoofer ${runtimeConfig.spoofer.name} for ${describePool(
        appName,
        modelKey
      )} (output: ${runtimeConfig.outputDir}, cwd: ${runtimeConfig.workingDirOverride || runtimeConfig.spoofer.workingDir})`
    );

    const result = await runSpooferScript(runtimeConfig);

    const { sets, totalPhotos } = await countPhotoSets(poolDir, photosPerSet);

    if (totalPhotos - previousTotalPhotos <= 0) {
      log(
        `⚠️ ${describePool(
          appName,
          modelKey
        )} generation produced no new photos (source had ${availableSourcePhotos} available)`
      );
      await cleanupPartialGeneration(poolDir, preExistingFiles);
      return false;
    }

    if (result.originalNames && result.originalNames.length > 0) {
      await storeOriginalNamesMapping(poolDir, result.originalNames);
    }

    log(
      `✅ ${describePool(appName, modelKey)} pool now has ${sets} complete sets (${totalPhotos} total photos)`
    );

    return true;
  } catch (error) {
    log(`❌ Failed to generate batch for ${describePool(appName, modelKey)}: ${error.message}`);
    await cleanupPartialGeneration(poolDir, preExistingFiles);
    return false;
  } finally {
    await releaseLock();
  }
}

/**
 * Check stock levels for all apps and generate if needed
 */
async function checkAndMaintainStock() {
  log(`🔍 Checking stock levels for all apps...`);

  const devApps = Object.keys(CONFIG.MIN_STOCK_LEVELS).filter(isDevApp);
  if (devApps.length > 0) {
    log(`🚫 Skipping dev pools: ${devApps.join(", ")}`);
  }

  let statuses;
  try {
    statuses = await getActiveAppStockStatuses();
  } catch (error) {
    log(`❌ Failed to load pool statuses: ${error.message}`);
    return;
  }

  if (!statuses.length) {
    log(`⚠️ No production pools configured for automatic generation`);
    return;
  }

  logStockSummaries(statuses);

  const failedAppsThisCycle = new Set();

  while (true) {
    const lowStock = statuses.filter(({ deficit }) => deficit > 0);

    if (lowStock.length === 0) {
      log(`✅ All pools meet minimum stock requirements`);
      break;
    }

    const candidates = lowStock
      .filter(({ appName, modelKey = DEFAULT_MODEL_KEY }) =>
        !failedAppsThisCycle.has(`${appName}:${modelKey}`)
      )
      .sort((a, b) => {
        if (a.totalPhotos === b.totalPhotos) {
          return b.deficit - a.deficit;
        }
        return a.totalPhotos - b.totalPhotos;
      });

    if (candidates.length === 0) {
      const remaining = lowStock
        .map(({ appName, modelKey = DEFAULT_MODEL_KEY }) =>
          describePool(appName, modelKey)
        )
        .join(", ");
      log(
        `⚠️ Remaining low pools already failed generation this cycle: ${remaining}`
      );
      break;
    }

    let target = null;
    let preAcquiredLock = null;

    for (const candidate of candidates) {
      const poolDir = await ensurePoolDirectory(
        candidate.appName,
        candidate.modelKey
      );
      const releaseLock = await acquirePoolLock(poolDir);
      if (!releaseLock) {
        continue;
      }
      target = candidate;
      preAcquiredLock = releaseLock;
      break;
    }

    if (!target) {
      log(
        `⚠️ All low pools are currently locked by other workers, skipping this cycle`
      );
      break;
    }

    log(
      `🚨 ${describePool(target.appName, target.modelKey)} is the lowest stock unlocked pool (${target.sets} sets / ${target.totalPhotos} photos, minimum ${target.minStock} sets)`
    );

    const fairnessMode = lowStock.length > 1;
    const setsToGenerate = fairnessMode
      ? 1
      : Math.max(
          1,
          Math.min(CONFIG.GENERATION_BATCH_SIZE, target.deficit || 1)
        );

    if (fairnessMode && CONFIG.GENERATION_BATCH_SIZE > 1) {
      log(
        `🔁 Multiple pools are below minimum stock, limiting ${describePool(
          target.appName,
          target.modelKey
        )} to a single set before re-evaluating`
      );
    }

    const success = await generateBatchForApp(target, setsToGenerate, {
      preAcquiredLock,
    });

    if (!success) {
      failedAppsThisCycle.add(
        `${target.appName}:${target.modelKey || DEFAULT_MODEL_KEY}`
      );
    }

    try {
      statuses = await getActiveAppStockStatuses();
    } catch (error) {
      log(`❌ Failed to refresh pool statuses: ${error.message}`);
      break;
    }

    logStockSummaries(statuses, "📊 Updated pool stock levels");
  }
}

/**
 * Clean up old temporary files
 */
async function cleanupOldFiles() {
  try {
    // Clean up old DONE folder files (legacy)
    const doneDir = path.join(CONFIG.PYTHON_WORKING_DIR, "DONE");
    const files = await fs.readdir(doneDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      try {
        const filePath = path.join(doneDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          log(`🧹 Cleaned up old file: ${file}`);
        }
      } catch (error) {
        // Ignore individual file errors
      }
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Initialize the background worker
 */
async function initialize() {
  log(`🚀 Starting Background Photo Worker`);
  log(`📁 Base directory: ${CONFIG.POOLS_BASE_DIR}`);
  log(
    `🪄 Available spoofers: ${listAvailableSpoofers()
      .map((name) => name)
      .join(", ")}`
  );

  // Ensure base pools directory exists
  await fs.mkdir(CONFIG.POOLS_BASE_DIR, { recursive: true });

  // Initial stock check
  await checkAndMaintainStock();

  // Start periodic checking without overlapping cycles
  const runCycle = async () => {
    try {
      await checkAndMaintainStock();
      await cleanupOldFiles();
    } catch (error) {
      log(`❌ Error in periodic check: ${error.message}`);
    } finally {
      setTimeout(runCycle, CONFIG.CHECK_INTERVAL);
    }
  };

  runCycle();

  log(
    `✅ Background worker initialized, checking every ${
      CONFIG.CHECK_INTERVAL / 1000
    } seconds`
  );
}

/**
 * Handle graceful shutdown
 */
process.on("SIGINT", () => {
  log(`👋 Shutting down gracefully...`);
  process.exit(0);
});

process.on("SIGTERM", () => {
  log(`👋 Received SIGTERM, shutting down...`);
  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  log(`💥 Uncaught exception: ${error.message}`);
  console.error(error);
});

process.on("unhandledRejection", (reason, promise) => {
  log(`💥 Unhandled rejection: ${reason}`);
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Start the worker if this file is run directly
if (require.main === module) {
  initialize().catch((error) => {
    log(`💥 Failed to initialize: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  initialize,
  checkAndMaintainStock,
  generateBatchForApp,
  countPhotoSets,
  CONFIG,
};
