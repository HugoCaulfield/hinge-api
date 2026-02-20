/**
 * Base class for proxy providers
 */

class BaseProxyProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  /**
   * Generate proxy for given location
   * @param {Object} location - Location object
   * @param {string} searchType - Type of search (city, state, etc.)
   * @returns {Promise<Object|null>} - Proxy information or null
   */
  async generateProxy(location, searchType = 'city') {
    throw new Error(`generateProxy method must be implemented by ${this.name} provider`);
  }

  /**
   * Validate proxy configuration
   * @param {Object} proxy - Proxy object to validate
   * @returns {boolean} - True if valid
   */
  validateProxy(proxy) {
    return proxy && proxy.host && proxy.port && proxy.username && proxy.password;
  }

  /**
   * Get provider display name
   * @returns {string} - Provider name
   */
  getDisplayName() {
    return this.name;
  }
}

module.exports = BaseProxyProvider;