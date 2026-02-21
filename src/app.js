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

async function boot() {
  await clearTempFilesOnStartup();
  const config = loadConfig();

  process.env.SELECTED_APP = config.appName || "hinge-prod-1";
  process.env.PHOTOS_USE_SPOOFING = config.photos.useSpoofing ? "true" : "false";

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
