/**
 * Photo module main export
 */

const photoManager = require('./photo-manager');
const { generateBirthDate } = require('./date_generator');
const { createProxyJSON, sendProxyFile } = require('./file_manager');

module.exports = {
  ...photoManager,
  generateBirthDate,
  createProxyJSON,
  sendProxyFile,
};