require("dotenv").config();
const express = require("express");
const { loadConfig } = require("./config/load-config");
const { createJobsStore } = require("./state/jobs-store");
const { createSessionsStore } = require("./state/sessions-store");
const { createSmsStore } = require("./state/sms-store");
const { createEmailStore } = require("./state/email-store");
const { createLocationService } = require("./services/location-service");
const { createProxyService } = require("./services/proxy-service");
const { createSmsService } = require("./services/sms-service");
const { createEmailService } = require("./services/email-service");
const { createPhotoService } = require("./services/photo-service");
const { createAirtableService } = require("./services/airtable-service");
const { createAccountService } = require("./services/account-service");
const { createJobRunner } = require("./jobs/create-job-runner");
const { createAuthMiddleware } = require("./middleware/auth");
const { errorHandler } = require("./middleware/error-handler");
const { createRouter } = require("./routes/create-router");

function boot() {
  const config = loadConfig();

  process.env.SELECTED_APP = config.appName || "hinge-prod-1";
  process.env.PHOTOS_USE_SPOOFING = config.photos.useSpoofing ? "true" : "false";
  process.env.PHOTO_SPOOFER = config.photos.spoofer || "random_three";

  const jobsStore = createJobsStore(config.jobs.ttlMs);
  const sessionsStore = createSessionsStore(config.sessions.ttlMs);
  const smsStore = createSmsStore();
  const emailStore = createEmailStore();

  const locationService = createLocationService();
  const proxyService = createProxyService(config);
  const smsService = createSmsService(config, smsStore, sessionsStore);
  const emailService = createEmailService(config, emailStore, sessionsStore);
  const photoService = createPhotoService(config);
  const airtableService = createAirtableService(config);

  const accountService = createAccountService({
    sessionsStore,
    locationService,
    proxyService,
    smsService,
    emailService,
    photoService,
    airtableService,
  });

  const handlers = {
    "account.generate": async (input, progress) => {
      progress("validating_location", 20);
      const result = await accountService.generateAccount(input);
      progress("done", 100);
      return result;
    },
    "proxy.regenerate": async (input, progress) => {
      progress("regenerating_proxy", 40);
      const result = await accountService.regenerateProxy(input);
      progress("done", 100);
      return result;
    },
    "phone.regenerate": async (input, progress) => {
      progress("regenerating_phone", 40);
      const result = await accountService.regeneratePhone(input);
      progress("done", 100);
      return result;
    },
    "email.regenerate": async (input, progress) => {
      progress("regenerating_email", 40);
      const result = await accountService.regenerateEmail(input);
      progress("done", 100);
      return result;
    },
    "photos.regenerate": async (input, progress) => {
      progress("regenerating_photos", 40);
      const result = await accountService.regeneratePhotos(input);
      progress("done", 100);
      return result;
    },
  };

  const jobRunner = createJobRunner({
    jobsStore,
    handlers,
    concurrency: Number(config.jobs.concurrency || 1),
  });

  const authMiddleware = createAuthMiddleware(config);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const router = createRouter({
    config,
    authMiddleware,
    jobsStore,
    jobRunner,
    sessionsStore,
    smsStore,
    emailStore,
    smsService,
    emailService,
    photoService,
    airtableService,
  });

  app.use(router);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`[hinge-api] listening on port ${config.port}`);
  });
}

boot();
