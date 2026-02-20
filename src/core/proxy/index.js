/**
 * Proxy module main export
 */

const proxyManager = require('./manager');
const { generateProxyInfo } = require('./proxy');

module.exports = {
  ...proxyManager,
  generateProxyInfo,
};