const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { log } = require("../../utils/logger");
const { getAppConfig } = require("../../../config/app-config");
const {
  DEFAULT_SPOOFER,
  getSpooferRuntimeConfig,
} = require("./spoofer-registry");

/**
 * Get the correct Python executable for the current platform
 * @returns {string} - Python executable name
 */
function getPythonExecutable() {
  const platform = os.platform();

  // On Windows, try 'python' first, then 'py'
  // On macOS/Linux, try 'python3' first, then 'python'
  if (platform === "win32") {
    return "python"; // Windows typically uses 'python'
  } else {
    return "python3"; // macOS/Linux typically uses 'python3'
  }
}

/**
 * Try to execute Python with fallback options
 * @param {string} scriptPath - Path to the Python script
 * @param {string} workingDir - Working directory
 * @param {string[]} args - Additional arguments for the Python script
 * @returns {Promise<Object>} - Child process and python command used
 */
function spawnPythonWithFallback(scriptPath, workingDir, args = []) {
  const platform = os.platform();

  // Define fallback options based on platform
  const pythonCommands =
    platform === "win32"
      ? [
          "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python313\\python.exe",
          "python",
          "py",
          "python3",
        ]
      : ["python3", "python", "py"];

  return new Promise((resolve, reject) => {
    let attemptedCommands = [];

    function tryNextCommand(index) {
      if (index >= pythonCommands.length) {
        reject(
          new Error(
            `No Python executable found. Tried: ${attemptedCommands.join(", ")}`
          )
        );
        return;
      }

      const pythonCmd = pythonCommands[index];
      attemptedCommands.push(pythonCmd);

      const python = spawn(pythonCmd, [scriptPath, ...args], {
        cwd: workingDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      // If spawn fails immediately (ENOENT), try the next command
      python.on("error", (error) => {
        if (error.code === "ENOENT") {
          log(`⚠️  ${pythonCmd} not found, trying next option...`);
          tryNextCommand(index + 1);
        } else {
          reject(error);
        }
      });

      // If the process starts successfully, return it
      python.on("spawn", () => {
        resolve({ process: python, command: pythonCmd });
      });
    }

    tryNextCommand(0);
  });
}

function getCurrentAppName() {
  return (process.env.SELECTED_APP || "tinder-dev").toLowerCase();
}

let cachedPhotoConfig = null;
let cachedConfigAppName = null;
let warnedAboutConfig = false;

function getCurrentPhotoSettings() {
  const appName = getCurrentAppName();
  if (cachedPhotoConfig && cachedConfigAppName === appName) {
    return cachedPhotoConfig;
  }

  try {
    const config = getAppConfig(appName);
    cachedPhotoConfig = config.photos || {};
    cachedConfigAppName = appName;
    return cachedPhotoConfig;
  } catch (error) {
    if (!warnedAboutConfig) {
      log(
        `⚠️  Unable to load app configuration for ${appName}: ${error.message}`
      );
      warnedAboutConfig = true;
    }
    cachedPhotoConfig = {};
    cachedConfigAppName = appName;
    return cachedPhotoConfig;
  }
}

function getSpooferSettings() {
  const photoSettings = getCurrentPhotoSettings();
  let envOptions = {};

  if (process.env.PHOTO_SPOOFER_OPTIONS) {
    try {
      envOptions = JSON.parse(process.env.PHOTO_SPOOFER_OPTIONS);
    } catch (error) {
      if (!warnedAboutConfig) {
        log(
          `⚠️  Unable to parse PHOTO_SPOOFER_OPTIONS: ${error.message}. Ignoring overrides.`
        );
        warnedAboutConfig = true;
      }
    }
  }

  return {
    name:
      process.env.PHOTO_SPOOFER ||
      photoSettings.spoofer ||
      DEFAULT_SPOOFER,
    options: {
      ...(photoSettings.spooferOptions || {}),
      ...envOptions,
    },
  };
}

function parseOriginalNamesFromOutput(output) {
  const originalNames = [];
  if (!output) {
    return originalNames;
  }

  const lines = output.split("\n");
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "ORIGINAL_NAMES_START") {
      inSection = true;
      continue;
    }

    if (line === "ORIGINAL_NAMES_END") {
      break;
    }

    if (inSection && line.startsWith("ORIGINAL:")) {
      const payload = line.replace("ORIGINAL:", "").trim();
      if (payload) {
        originalNames.push(payload);
      }
    }
  }

  return originalNames;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

/**
 * Generate random photos using Python script
 * @returns {Promise<{photoPaths: string[], originalNames: string[]}>} - Object with generated photo paths and original photo names
 */
async function generateRandomPhotos() {
  return new Promise(async (resolve) => {
    log("🖼️  Generating random photos...");

    const requestedPhotoCount = normalizePositiveInteger(
      process.env.PHOTO_COUNT,
      3
    );
    const { name: spooferName, options: spooferOptions } = getSpooferSettings();
    const runtimeConfig = getSpooferRuntimeConfig(spooferName, {
      photoCount: requestedPhotoCount,
      options: spooferOptions,
    });

    let python;
    let pythonCommand;

    try {
      log(`🪄 Using photo spoofer: ${runtimeConfig.spoofer.name}`);
      log(`🔍 Script path: ${runtimeConfig.spoofer.scriptPath}`);
      log(`🔍 Working directory: ${runtimeConfig.spoofer.workingDir}`);
      log(`📸 Requested photo count: ${requestedPhotoCount}`);

      const result = await spawnPythonWithFallback(
        runtimeConfig.spoofer.scriptPath,
        runtimeConfig.spoofer.workingDir,
        runtimeConfig.args
      );
      python = result.process;
      pythonCommand = result.command;
      log(`✅ Using Python command: ${pythonCommand}`);
    } catch (error) {
      log(`❌ Failed to start Python: ${error.message}`);
      resolve({ photoPaths: [], originalNames: [] });
      return;
    }

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
      log(`🐍 Python stderr: ${chunk.trim()}`);
    });

    python.on("error", (error) => {
      log(`❌ Python process error: ${error.message}`);
      clearTimeout(timeoutId);
      resolve({ photoPaths: [], originalNames: [] });
    });

    // Set a timeout to prevent hanging - increased to 120 seconds for image processing
    const timeoutId = setTimeout(() => {
      python.kill("SIGTERM");
      log("❌ Python script timeout after 120 seconds");
      log(`❌ Script output so far: ${output}`);
      log(`❌ Script errors: ${errorOutput}`);
      resolve({ photoPaths: [], originalNames: [] });
    }, 120000); // Increased to 120 second timeout for heavy image processing

    python.on("close", async (code) => {
      clearTimeout(timeoutId); // Clear timeout when process completes

      if (code !== 0) {
        log(`❌ Python script failed with code ${code}: ${errorOutput}`);
        resolve({ photoPaths: [], originalNames: [] });
        return;
      }

      try {
        log(`🔍 Full Python output for name extraction: ${output}`);

        // Extract original photo names from Python script output
        let originalNames = parseOriginalNamesFromOutput(output);

        log(`🔍 Full Python output for name extraction: ${output}`);

        if (!originalNames.length) {
          const selectedPhotosMatch = output.match(
            /Photos sélectionnées: \[(.*?)\]/
          );
          if (selectedPhotosMatch) {
            log(`📋 Found selected photos match: ${selectedPhotosMatch[1]}`);
            const photosString = selectedPhotosMatch[1];
            const photoNamesRaw = photosString
              .split(",")
              .map((name) => name.trim().replace(/'/g, "").replace(/"/g, ""));
            originalNames = photoNamesRaw;
          } else {
            log(`⚠️  No photos selection match found in output`);
          }
        }

        if (originalNames.length) {
          log(`📋 Original photo names extracted: ${originalNames.join(", ")}`);
        }

        // Check if DONE folder exists and get generated files
        const doneFolder = runtimeConfig.outputDir;
        const files = await fs.readdir(doneFolder);
        const imageFiles = files.filter(
          (file) =>
            file.toLowerCase().endsWith(".jpg") ||
            file.toLowerCase().endsWith(".jpeg") ||
            file.toLowerCase().endsWith(".png")
        );

        // Get the most recent files (assuming they're the ones just generated)
        const sortedFiles = imageFiles.map((file) => ({
          name: file,
          path: path.join(doneFolder, file),
          time: fs
            .stat(path.join(doneFolder, file))
            .then((stats) => stats.mtime),
        }));

        // Wait for all stat calls to complete
        for (let file of sortedFiles) {
          file.time = await file.time;
        }

        // Sort by modification time and get the newest files (based on photo count)
        const photoCount = requestedPhotoCount;
        const newestFiles = sortedFiles
          .sort((a, b) => b.time - a.time)
          .slice(0, photoCount)
          .map((file) => file.path);

        log(`✅ Generated ${newestFiles.length} photos successfully`);
        resolve({
          photoPaths: newestFiles,
          originalNames: originalNames,
        });
      } catch (error) {
        log(`❌ Error reading generated photos: ${error.message}`);
        resolve({ photoPaths: [], originalNames: [] });
      }
    });
  });
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
  return { filename, contentType };
}

/**
 * Send generated photos as files to the user and clean them up afterwards
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {string[]} photoPaths - Array of photo file paths
 */
async function sendPhotosAsFiles(bot, chatId, photoPaths) {
  if (!photoPaths || photoPaths.length === 0) {
    log("⚠️  No photos to send");
    return;
  }

  try {
    log(`📤 Sending ${photoPaths.length} photos as files...`);

    for (let i = 0; i < photoPaths.length; i++) {
      const photoPath = photoPaths[i];
      const fileOptions = buildFileOptions(photoPath, i + 1);

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

      // Small delay between sends to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    log("✅ All photos sent successfully");

    // Clean up the generated photos after successful sending
    await cleanupGeneratedPhotos(photoPaths);
  } catch (error) {
    log(`❌ Error sending photos: ${error.message}`);
    // Still attempt cleanup even if sending failed
    await cleanupGeneratedPhotos(photoPaths);
  }
}

/**
 * Clean up generated photo files to free disk space
 * @param {string[]} photoPaths - Array of photo file paths to delete
 */
async function cleanupGeneratedPhotos(photoPaths) {
  if (!photoPaths || photoPaths.length === 0) {
    return;
  }

  try {
    log(`🗑️  Cleaning up ${photoPaths.length} generated photos...`);

    for (const photoPath of photoPaths) {
      try {
        await fs.unlink(photoPath);
        log(`✅ Deleted: ${path.basename(photoPath)}`);
      } catch (error) {
        log(
          `⚠️  Could not delete ${path.basename(photoPath)}: ${error.message}`
        );
      }
    }

    log("✅ Photo cleanup completed");
  } catch (error) {
    log(`❌ Error during photo cleanup: ${error.message}`);
  }
}

/**
 * Handle photo regeneration request
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID to edit
 */
async function handleRegeneratePhotos(bot, chatId, messageId) {
  log(
    `🖼️ handleRegeneratePhotos called for chatId: ${chatId}, messageId: ${messageId}`
  );

  try {
    const loadingMessage = await bot.editMessageText(
      "⏳ Regenerating photos...",
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }, // Clear buttons
      }
    );

    const photoResult = await generateRandomPhotos();

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
        "❌ Failed to regenerate photos. Please try again later.",
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );
    }
  } catch (error) {
    log(`❌ Error in handleRegeneratePhotos: ${error.message}`);
    try {
      await bot.editMessageText(
        "❌ Error regenerating photos. Please try again later.",
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );
    } catch (editError) {
      log(`❌ Error editing message: ${editError.message}`);
    }
  }
}

module.exports = {
  getPythonExecutable,
  spawnPythonWithFallback,
  generateRandomPhotos,
  sendPhotosAsFiles,
  cleanupGeneratedPhotos,
  handleRegeneratePhotos,
};
