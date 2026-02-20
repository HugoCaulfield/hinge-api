const fs = require("fs");
const path = require("path");

// Créer le dossier logs s'il n'existe pas
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Créer le nom du fichier de log avec la date et l'heure
const now = new Date();
const logFileName = `bot_${now.toISOString().replace(/[:.]/g, "-")}.log`;
const logFilePath = path.join(logsDir, logFileName);

const LOG_MAX_DAYS = Number.parseInt(process.env.LOG_MAX_DAYS || "14", 10);
const LOG_MAX_FILES = Number.parseInt(process.env.LOG_MAX_FILES || "200", 10);
const LOG_MAX_BYTES = Number.parseInt(process.env.LOG_MAX_BYTES || "1073741824", 10);
const LOG_CLEANUP_EVERY = Number.parseInt(process.env.LOG_CLEANUP_EVERY || "200", 10);
let logWriteCount = 0;

function getLogFiles() {
  const files = fs.readdirSync(logsDir)
    .filter((file) => file.endsWith(".log"))
    .map((file) => {
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      return { name: file, path: filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  return files;
}

function cleanupLogs() {
  const nowMs = Date.now();
  const maxAgeMs = LOG_MAX_DAYS > 0 ? LOG_MAX_DAYS * 24 * 60 * 60 * 1000 : 0;
  let files = getLogFiles();

  if (maxAgeMs > 0) {
    for (const file of files) {
      if (nowMs - file.mtimeMs > maxAgeMs) {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.error(`Failed to delete old log ${file.name}: ${error.message}`);
        }
      }
    }
    files = getLogFiles();
  }

  if (LOG_MAX_FILES > 0 && files.length > LOG_MAX_FILES) {
    const excess = files.length - LOG_MAX_FILES;
    for (let i = 0; i < excess; i += 1) {
      try {
        fs.unlinkSync(files[i].path);
      } catch (error) {
        console.error(`Failed to delete log ${files[i].name}: ${error.message}`);
      }
    }
    files = getLogFiles();
  }

  if (LOG_MAX_BYTES > 0) {
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let index = 0;
    while (totalBytes > LOG_MAX_BYTES && index < files.length) {
      try {
        fs.unlinkSync(files[index].path);
        totalBytes -= files[index].size;
      } catch (error) {
        console.error(`Failed to delete log ${files[index].name}: ${error.message}`);
      }
      index += 1;
    }
  }
}

cleanupLogs();

/**
 * Fonction de log qui écrit dans la console et dans un fichier
 * @param {string} message - Message à logger
 * @param {Object} [data] - Données optionnelles à logger
 */
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] ${message}`;

  if (data) {
    logMessage += "\n" + JSON.stringify(data, null, 2);
  }

  // Écrire dans la console
  console.log(logMessage);

  // Écrire dans le fichier
  fs.appendFileSync(logFilePath, logMessage + "\n");

  logWriteCount += 1;
  if (LOG_CLEANUP_EVERY > 0 && logWriteCount % LOG_CLEANUP_EVERY === 0) {
    cleanupLogs();
  }
}

module.exports = {
  log
};
