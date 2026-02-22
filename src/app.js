require("dotenv").config();
const express = require("express");
const { loadConfig } = require("./config/load-config");
const { createSessionsStore } = require("./state/sessions-store");
const { createSmsStore } = require("./state/sms-store");
const { createEmailStore } = require("./state/email-store");
const { createLocationService } = require("./services/location-service");
const { createProxyService } = require("./services/proxy-service");
const { createSmsService } = require("./services/sms-service");
const { createEmailService } = require("./services/email-service");
const { createPhotoService } = require("./services/photo-service");
const { createAccountService } = require("./services/account-service");
const { createAuthMiddleware } = require("./middleware/auth");
const { errorHandler } = require("./middleware/error-handler");
const { createRouter } = require("./routes/create-router");
const { clearTempFilesOnStartup } = require("./utils/temp-files");

function parseRuntimeFlags(argv = process.argv.slice(2)) {
  const args = new Set(argv || []);
  const rentPhone =
    !args.has("--no-phone") && !args.has("--no-rent-phone");
  const rentEmail =
    !args.has("--no-email") && !args.has("--no-rent-email");

  return {
    rentPhone,
    rentEmail,
  };
}

async function boot() {
  await clearTempFilesOnStartup();
  const config = loadConfig();
  const runtimeFlags = parseRuntimeFlags();

  process.env.SELECTED_APP = config.appName || "hinge-prod-1";
  process.env.PHOTOS_USE_SPOOFING = config.photos.useSpoofing ? "true" : "false";

  if (!runtimeFlags.rentPhone || !runtimeFlags.rentEmail) {
    console.log(
      `[hinge-api] runtime flags: rentPhone=${runtimeFlags.rentPhone}, rentEmail=${runtimeFlags.rentEmail}`
    );
  }

  const sessionsStore = createSessionsStore(config.sessions.ttlMs);
  const smsStore = createSmsStore();
  const emailStore = createEmailStore();

  const locationService = createLocationService();
  const proxyService = createProxyService(config);
  const smsService = createSmsService(config, smsStore, sessionsStore);
  const emailService = createEmailService(config, emailStore, sessionsStore);
  const photoService = createPhotoService(config);

  const accountService = createAccountService({
    sessionsStore,
    locationService,
    proxyService,
    smsService,
    emailService,
    photoService,
    runtimeFlags,
  });

  const authMiddleware = createAuthMiddleware(config);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const router = createRouter({
    config,
    authMiddleware,
    accountService,
    sessionsStore,
    smsStore,
    emailStore,
    smsService,
    emailService,
    photoService,
  });

  app.use(router);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`[hinge-api] listening on port ${config.port}`);
  });
}

boot().catch((error) => {
  console.error(`[hinge-api] failed to boot: ${error.message}`);
  process.exit(1);
});
