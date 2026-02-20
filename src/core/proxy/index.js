/**
 * Proxy module main export
 */

const { generateProxyWithFallback } = require("./proxy-fallback-service");
const { generateProxyInfo } = require("./proxy");

module.exports = {
  generateProxyWithFallback,
  generateProxyInfo,
};
