const fs = require("fs");
const path = require("path");
const { log } = require("../../utils/logger");

/**
 * Create proxy JSON data structure
 * @param {object} proxyResult - Proxy information from generateProxyInfo
 * @param {object} location - Location object
 * @returns {object} - JSON data for proxy configuration
 */
function createProxyJSON(proxyResult, location) {
  const currentTime = Date.now() / 1000;
  const countryFlag = (location?.CountryCode || location?.countryCode || "US").toUpperCase();

  return {
    host: proxyResult.domain,
    file: "",
    obfsParam: "",
    alpn: "",
    cert: "",
    created: currentTime,
    updated: currentTime,
    flag: countryFlag,
    ping: 75,
    privateKey: "",
    hpkk: "",
    uuid: "",
    type: "SOCKS5",
    downmbps: "",
    user: proxyResult.username,
    ech: "",
    plugin: "none",
    method: "",
    password: proxyResult.password,
    udp: 1,
    filter: "",
    protoParam: "",
    reserved: "",
    alterId: "",
    upmbps: "",
    keepalive: "",
    port: proxyResult.port,
    obfs: "",
    dns: "",
    publicKey: "",
    peer: "",
    title: `${location.city}_${currentTime}`,
    weight: currentTime,
  };
}

/**
 * Send proxy configuration file to user
 * @param {TelegramBot} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {object} jsonData - JSON data to send
 * @param {string} cityName - City name for file naming
 */
async function sendProxyFile(bot, chatId, jsonData, cityName) {
  const tempDir = path.join(__dirname, "..", "temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const fileName = `proxy_${cityName}_${Date.now()}.json`;
  const filePath = path.join(tempDir, fileName);

  try {
    // Write JSON file
    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

    // Send file to user
    await bot.sendDocument(chatId, filePath);

    // Delete temporary file
    fs.unlinkSync(filePath);

    log(`✅ Proxy file sent successfully: ${fileName}`);
  } catch (error) {
    log(`❌ Error sending proxy file: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up temporary files (utility function)
 */
function cleanupTempFiles() {
  const tempDir = path.join(__dirname, "..", "temp");

  if (!fs.existsSync(tempDir)) {
    return;
  }

  try {
    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    const maxAge = 3600000; // 1 hour in milliseconds

    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        log(`🧹 Cleaned up old temp file: ${file}`);
      }
    });
  } catch (error) {
    log(`⚠️ Error cleaning temp files: ${error.message}`);
  }
}

// Schedule cleanup every hour
setInterval(cleanupTempFiles, 3600000);

module.exports = {
  createProxyJSON,
  sendProxyFile,
  cleanupTempFiles,
};
