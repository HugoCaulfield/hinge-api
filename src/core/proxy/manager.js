const { generateProxyInfo } = require("./proxy");
const { log } = require("../../utils/logger");
const { PROXY_PROVIDERS, MAX_RETRIES } = require("../../utils/constants");
const { createProxyJSON, sendProxyFile } = require("../photo/file_manager");
const { getRandomLocationInCity } = require("../location/locations");

// Track active proxy searches to prevent duplicates
const activeProxySearches = new Map();

/**
 * Generate proxy with configurable provider order (fallback support)
 * @param {object} location - Location object
 * @param {object} appConfig - App configuration containing proxy provider settings
 * @returns {Promise<object>} Proxy result with success/failure info
 */
async function generateProxyWithFallback(location, appConfig = null) {
  const defaultProviders = ["dataimpulse", "marsproxies", "proxyempire"];
  const providers =
    appConfig && appConfig.proxy && appConfig.proxy.providers
      ? appConfig.proxy.providers
      : defaultProviders;

  log(
    `🔗 Attempting to get proxy using provider order: ${providers.join(", ")}`
  );

  const errors = [];

  for (const provider of providers) {
    try {
      log(`🔗 Trying ${PROXY_PROVIDERS[provider] || provider}...`);

      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          log(`🔄 Attempt ${retries + 1}/${MAX_RETRIES} with ${provider}...`);
          const result = await generateProxyInfo(location, provider, "city");

          if (result !== null) {
            log(
              `✅ Successfully got proxy from ${
                PROXY_PROVIDERS[provider] || provider
              }`
            );
            return {
              success: true,
              ...result,
              provider: PROXY_PROVIDERS[provider] || provider, // Formatted name for display
              providerKey: provider, // Original key for downstream metadata
            };
          } else {
            log(
              `❌ No proxy found with ${provider} (attempt ${
                retries + 1
              }/${MAX_RETRIES})`
            );
          }
        } catch (error) {
          log(
            `❌ Error generating proxy with ${provider} (attempt ${
              retries + 1
            }/${MAX_RETRIES}): ${error.message}`
          );
        }

        retries++;
        if (retries < MAX_RETRIES) {
          log(`🔄 Retrying with ${provider} in a moment...`);
          await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between retries
        }
      }

      errors.push(`${provider}: Failed after ${MAX_RETRIES} attempts`);
      log(`❌ ${provider} failed after ${MAX_RETRIES} attempts`);
    } catch (error) {
      log(`❌ ${provider} failed: ${error.message}`);
      errors.push(`${provider}: ${error.message}`);
    }
  }

  return {
    success: false,
    error: `All configured proxy providers failed. ${errors.join(", ")}`,
    provider: "All",
  };
}

/**
 * Generate proxy for a specific location with specific provider (legacy function for backwards compatibility)
 * @param {object} location - Location object
 * @param {string} provider - Provider name
 * @returns {object|null} - Proxy information or null if not found
 */
async function generateProxy(location, provider = null) {
  if (provider) {
    const providers = provider ? [provider] : Object.keys(PROXY_PROVIDERS);

    for (const currentProvider of providers) {
      let retries = 0;
      log(
        `\n🔍 Recherche de proxy pour ${location.city} avec le fournisseur ${currentProvider}...`
      );

      while (retries < MAX_RETRIES) {
        try {
          console.log("\n");
          const result = await generateProxyInfo(
            location,
            currentProvider,
            "city"
          );

          if (result !== null) {
            return result;
          }
        } catch (error) {
          log(`Erreur lors de la génération du proxy: ${error.message}`);
        }

        if (retries < MAX_RETRIES - 1) {
          retries++;
          continue;
        }
        break;
      }
    }

    return null;
  } else {
    const result = await generateProxyWithFallback(location);
    return result.success ? result : null;
  }
}

/**
 * Check if user has an active proxy search
 * @param {number} chatId - Chat ID
 * @returns {boolean} - True if user has active search
 */
function hasActiveProxySearch(chatId) {
  return activeProxySearches.has(chatId);
}

/**
 * Start tracking a proxy search for a user
 * @param {number} chatId - Chat ID
 * @param {object} searchData - Search session data
 */
function startProxySearch(chatId, searchData = {}) {
  const sessionData = {
    startTime: new Date().toISOString(),
    chatId: chatId,
    ...searchData,
  };
  activeProxySearches.set(chatId, sessionData);
  log(`🔍 Started proxy search tracking for user: ${chatId}`);
}

/**
 * Clear proxy search tracking for a user
 * @param {number} chatId - Chat ID
 * @returns {boolean} - True if search was cleared
 */
function clearProxySearch(chatId) {
  if (activeProxySearches.has(chatId)) {
    activeProxySearches.delete(chatId);
    log(`🗑️  Cleared proxy search tracking for user: ${chatId}`);
    return true;
  }
  return false;
}

/**
 * Get active proxy search data for a user
 * @param {number} chatId - Chat ID
 * @returns {object|null} - Search data or null
 */
function getActiveProxySearch(chatId) {
  return activeProxySearches.get(chatId) || null;
}

/**
 * Clear all active proxy searches (used when bot starts)
 */
function clearAllProxySearches() {
  const activeCount = activeProxySearches.size;
  activeProxySearches.clear();
  if (activeCount > 0) {
    log(`🗑️  Cleared ${activeCount} active proxy searches on bot restart`);
  }
}

/**
 * Get count of active proxy searches
 * @returns {number} - Number of active searches
 */
function getActiveProxySearchCount() {
  return activeProxySearches.size;
}

/**
 * Handle proxy generation request
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID to edit
 * @param {string} locationInput - Location input string
 * @param {string} provider - Provider name
 * @param {Object} appConfig - App configuration
 */
async function handleProxyGeneration(
  bot,
  chatId,
  messageId,
  locationInput,
  provider,
  appConfig
) {
  // Implementation would be moved from bot_handlers.js
  // This is a placeholder for the main proxy generation handler
  log(`🔗 Handling proxy generation for ${locationInput} with ${provider}`);
}

/**
 * Handle new proxy request
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID to edit
 * @param {string} locationInput - Location string (e.g., "Ohio, Cleveland")
 * @param {string} provider - Provider name (optional, will use fallback if null)
 * @param {Object} appConfig - App configuration
 */
async function handleNewProxy(bot, chatId, messageId, locationInput, provider = null, appConfig = null) {
  const loadingMessage = await bot.editMessageText(
    provider 
      ? `⏳ Getting new proxy with ${PROXY_PROVIDERS[provider] || provider}...`
      : `⏳ Getting new proxy...`,
    {
      chat_id: chatId,
      message_id: messageId,
    }
  );

  try {
    // First find the location data from the input string
    const { findAndValidateLocation } = require("../location/location-utils");
    const locationResult = await findAndValidateLocation(locationInput);
    
    if (!locationResult.success) {
      await bot.editMessageText(
        `❌ Invalid location: ${locationResult.error}`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );
      return;
    }

    // Generate GPS coordinates for the location before proxy generation
    const locationWithCoords = await getRandomLocationInCity(locationResult.location);

    // Use fallback system if no provider specified, otherwise use specific provider
    const proxyConfig = provider 
      ? { proxy: { providers: [provider] } }
      : appConfig;

    const proxyResult = await generateProxyWithFallback(locationWithCoords, proxyConfig);

    if (proxyResult.success) {
      const proxyConfig = await createProxyJSON(
        proxyResult,
        locationWithCoords
      );

      // Helper function to escape HTML
      const escHtml = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const code = (s = "") => `<code>${escHtml(s)}</code>`;

      // Format response in same style as main message
      const responseHtml =
        `✅ Proxy in ${code(locationWithCoords.city)}!\n\n` +
        `🔗 ${code(
          `${proxyResult.domain}:${proxyResult.port}:${proxyResult.username}:${proxyResult.password}`
        )}\n\n` +
        `📱 IP: ${code(proxyResult.ip)}\n` +
        (proxyResult.asn && proxyResult.asnOrg
          ? `ASN: ${escHtml(String(proxyResult.asn))} (${escHtml(proxyResult.asnOrg)})\n`
          : "") +
        (proxyResult.timezone ? `Timezone: ${escHtml(proxyResult.timezone)}\n` : "") +
        `🌍 City: ${code(locationWithCoords.city)}`;

      // Send with HTML parse mode and fallback to plain text on parse error
      try {
        await bot.editMessageText(responseHtml, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch (err) {
        // Fallback to plain text if HTML parsing fails
        const plainText = responseHtml.replace(/<[^>]*>/g, '');
        await bot.editMessageText(plainText, {
          chat_id: chatId,
          message_id: messageId,
        });
      }

      await sendProxyFile(bot, chatId, proxyConfig, locationWithCoords.city);
    } else {
      await bot.editMessageText(
        `❌ Failed to generate new proxy: ${proxyResult.error}`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );
    }
  } catch (error) {
    log(`❌ Error in handleNewProxy: ${error.message}`);
    await bot.editMessageText(
      "❌ Error generating new proxy. Please try again later.",
      {
        chat_id: chatId,
        message_id: messageId,
      }
    );
  }
}

module.exports = {
  generateProxyWithFallback,
  generateProxy,
  hasActiveProxySearch,
  startProxySearch,
  clearProxySearch,
  getActiveProxySearch,
  clearAllProxySearches,
  getActiveProxySearchCount,
  handleProxyGeneration,
  handleNewProxy,
};
