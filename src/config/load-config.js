const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function asBool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function loadConfig() {
  const configPath = path.join(process.cwd(), "config", "local-config.json");
  const fileConfig = readJson(configPath);

  const config = {
    ...fileConfig,
    port: Number(process.env.PORT || 3000),
  };

  config.security = config.security || {};
  if (process.env.API_KEY) {
    config.security.apiKey = process.env.API_KEY;
  }
  config.security.allowNoAuth = asBool(
    process.env.ALLOW_NO_AUTH,
    Boolean(config.security.allowNoAuth)
  );

  config.sms = config.sms || {};
  if (process.env.DAISYSMS_API_KEY) {
    config.sms.apiKey = process.env.DAISYSMS_API_KEY;
  }

  config.email = config.email || {};
  if (process.env.ANYMESSAGE_TOKEN) {
    config.email.token = process.env.ANYMESSAGE_TOKEN;
  }

  config.webhooks = config.webhooks || {};
  if (process.env.DAISYSMS_WEBHOOK_TOKEN) {
    config.webhooks.daisysmsToken = process.env.DAISYSMS_WEBHOOK_TOKEN;
  }

  return config;
}

module.exports = {
  loadConfig,
};
