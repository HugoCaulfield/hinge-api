/**
 * Location module main export
 */

const locationUtils = require('./location-utils');
const { loadLocations, getRandomLocationInCity } = require('./locations');

module.exports = {
  ...locationUtils,
  loadLocations,
  getRandomLocationInCity,
};