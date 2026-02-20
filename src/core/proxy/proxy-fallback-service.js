const { generateProxyInfo } = require("./proxy");
const { log } = require("../../utils/logger");
const { PROXY_PROVIDERS, MAX_RETRIES } = require("../../utils/constants");

async function generateProxyWithFallback(location, appConfig = null) {
  const defaultProviders = ["anyIp", "dataimpulse", "marsproxies", "proxyempire"];
  const providers =
    appConfig && appConfig.proxy && Array.isArray(appConfig.proxy.providers)
      ? appConfig.proxy.providers
      : defaultProviders;

  log(`🔗 Attempting proxy providers in order: ${providers.join(", ")}`);

  const errors = [];

  for (const provider of providers) {
    try {
      log(`🔗 Trying ${PROXY_PROVIDERS[provider] || provider}...`);

      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          const result = await generateProxyInfo(location, provider, "city");

          if (result) {
            return {
              success: true,
              ...result,
              provider: PROXY_PROVIDERS[provider] || provider,
              providerKey: provider,
            };
          }
        } catch (error) {
          log(
            `❌ Proxy generation error with ${provider} (attempt ${
              retries + 1
            }/${MAX_RETRIES}): ${error.message}`
          );
        }

        retries += 1;
        if (retries < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      errors.push(`${provider}: failed after ${MAX_RETRIES} attempts`);
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }

  return {
    success: false,
    error: `All configured proxy providers failed. ${errors.join(", ")}`,
    provider: "All",
  };
}

module.exports = {
  generateProxyWithFallback,
};
