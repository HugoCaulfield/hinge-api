const {
  generateProxyWithFallback,
} = require("../core/proxy/proxy-fallback-service");

function createProxyService(config) {
  async function generate(location) {
    const appConfig = {
      proxy: {
        providers: config.proxy.providers,
      },
    };

    const result = await generateProxyWithFallback(location, appConfig);
    if (!result.success) {
      const err = new Error(result.error || "Failed to generate proxy");
      err.code = "PROXY_GENERATION_FAILED";
      throw err;
    }

    return result;
  }

  return {
    generate,
  };
}

module.exports = {
  createProxyService,
};
