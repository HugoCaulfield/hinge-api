// Configuration constants
const MAX_RETRIES = 10;
const RETRY_DELAY = 0;
const REQUEST_TIMEOUT = 30000;

// Available proxy providers
const PROXY_PROVIDERS = {
  marsproxies: "Mars Proxies",
  dataimpulse: "DataImpulse",
  dataimpulse_mobile: "DataImpulse Mobile",
  proxyempire: "ProxyEmpire",
  anyIp: "AnyIP",
};

// Export configuration
const BOT_CONFIG = {
  maxRetries: MAX_RETRIES,
  retryDelay: RETRY_DELAY,
  requestTimeout: REQUEST_TIMEOUT,
};

module.exports = {
  MAX_RETRIES,
  RETRY_DELAY,
  REQUEST_TIMEOUT,
  PROXY_PROVIDERS,
  BOT_CONFIG,
};
