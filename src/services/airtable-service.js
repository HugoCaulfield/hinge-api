const {
  generateAirtableUrls,
} = require("../../current_telegram_bot/src/core/sms/providers/daisysms");

function createAirtableService(config) {
  function buildLinks(context, status = null) {
    process.env.SELECTED_APP = config.appName || "hinge-prod-1";

    const urls = generateAirtableUrls(context || {});
    if (!status) {
      return urls;
    }

    const key = String(status || "").toLowerCase();
    return {
      [key]: urls[key] || null,
    };
  }

  return {
    buildLinks,
  };
}

module.exports = {
  createAirtableService,
};
