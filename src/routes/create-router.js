const express = require("express");
const { z } = require("zod");

function createRouter({
  config,
  authMiddleware,
  accountService,
  sessionsStore,
  smsStore,
  emailStore,
  smsService,
  emailService,
  photoService,
}) {
  const router = express.Router();

  function withMeta(data) {
    return {
      data,
      meta: {
        requestId: reqId(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  function reqId() {
    return Math.random().toString(36).slice(2, 14);
  }

  function parse(schema, payload) {
    const result = schema.safeParse(payload);
    if (!result.success) {
      const err = new Error("Validation failed");
      err.statusCode = 400;
      err.code = "VALIDATION_ERROR";
      err.details = result.error.flatten();
      throw err;
    }
    return result.data;
  }

  const generateSchema = z.object({
    state: z.string().min(1),
    city: z.string().min(1),
    modelKey: z.string().optional(),
    requestIdempotencyKey: z.string().optional(),
  });

  const regenProxySchema = z.object({
    state: z.string().min(1),
    city: z.string().min(1),
    sessionId: z.string().optional(),
  });

  const regenPhoneSchema = z.object({
    areaCode: z.string().optional(),
    sessionId: z.string().optional(),
  });

  const regenEmailSchema = z.object({
    sessionId: z.string().min(1),
  });

  const regenPhotosSchema = z.object({
    sessionId: z.string().min(1),
    modelKey: z.string().optional(),
  });

  router.get("/health", (req, res) => {
    res.json({
      data: {
        status: "ok",
        app: "hinge-api",
        appName: config.appName,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  });

  router.post("/v1/webhooks/daisysms", (req, res) => {
    const configuredToken = config.webhooks.daisysmsToken;
    if (configuredToken) {
      const incomingToken = req.header("x-webhook-token") || req.query.token;
      if (incomingToken !== configuredToken) {
        return res.status(401).json({
          error: {
            code: "UNAUTHORIZED_WEBHOOK",
            message: "Invalid webhook token",
            details: {},
          },
        });
      }
    }

    const result = smsService.handleWebhook(req.body || {});
    return res.status(result.handled ? 200 : 202).json(withMeta(result));
  });

  router.use("/v1", authMiddleware);

  router.post("/v1/accounts/generate", async (req, res, next) => {
    try {
      const input = parse(generateSchema, req.body);
      const result = await accountService.generateAccount(input);
      return res.json(withMeta(result));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/v1/proxies/regenerate", async (req, res, next) => {
    try {
      const input = parse(regenProxySchema, req.body);
      const result = await accountService.regenerateProxy(input);
      return res.json(withMeta(result));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/v1/phones/regenerate", async (req, res, next) => {
    try {
      const input = parse(regenPhoneSchema, req.body);
      const result = await accountService.regeneratePhone(input);
      return res.json(withMeta(result));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/v1/emails/regenerate", async (req, res, next) => {
    try {
      const input = parse(regenEmailSchema, req.body);
      const result = await accountService.regenerateEmail(input);
      return res.json(withMeta(result));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/v1/photos/regenerate", async (req, res, next) => {
    try {
      const input = parse(regenPhotosSchema, req.body);
      const result = await accountService.regeneratePhotos(input);
      return res.json(withMeta(result));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/v1/sms/:requestId/status", (req, res) => {
    const record = smsStore.get(req.params.requestId);
    if (!record) {
      return res.status(404).json({
        error: {
          code: "SMS_REQUEST_NOT_FOUND",
          message: "SMS request not found",
          details: {},
        },
      });
    }
    return res.json(withMeta({
      requestId: record.requestId,
      status: record.status,
      provider: record.provider,
    }));
  });

  router.get("/v1/sms/:requestId/code", (req, res) => {
    const record = smsStore.get(req.params.requestId);
    if (!record) {
      return res.status(404).json({
        error: {
          code: "SMS_REQUEST_NOT_FOUND",
          message: "SMS request not found",
          details: {},
        },
      });
    }
    return res.json(withMeta({
      requestId: record.requestId,
      status: record.status,
      code: record.code || null,
      provider: record.provider,
    }));
  });

  router.get("/v1/emails/:orderId/status", (req, res) => {
    const record = emailStore.get(req.params.orderId);
    if (!record) {
      return res.status(404).json({
        error: {
          code: "EMAIL_ORDER_NOT_FOUND",
          message: "Email order not found",
          details: {},
        },
      });
    }
    return res.json(withMeta({
      orderId: record.orderId,
      status: record.status,
      provider: record.provider,
    }));
  });

  router.get("/v1/emails/:orderId/code", (req, res) => {
    const record = emailStore.get(req.params.orderId);
    if (!record) {
      return res.status(404).json({
        error: {
          code: "EMAIL_ORDER_NOT_FOUND",
          message: "Email order not found",
          details: {},
        },
      });
    }
    return res.json(withMeta({
      orderId: record.orderId,
      status: record.status,
      code: record.code || null,
      provider: record.provider,
    }));
  });

  router.post("/v1/sessions/:sessionId/cancel", async (req, res, next) => {
    try {
      const session = sessionsStore.get(req.params.sessionId);
      if (!session) {
        return res.status(404).json({
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Session not found",
            details: {},
          },
        });
      }

      const smsRequestId = session.phone?.requestId;
      const emailOrderId = session.email?.orderId;

      if (smsRequestId) {
        await smsService.cancelRequest(smsRequestId).catch(() => null);
      }

      if (emailOrderId) {
        await emailService.cancelOrder(emailOrderId).catch(() => null);
      }

      sessionsStore.update(session.sessionId, { status: "cancelled" });

      return res.json(withMeta({
        sessionId: session.sessionId,
        status: "cancelled",
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/v1/photos/pools/stats", async (req, res, next) => {
    try {
      const stats = await photoService.getStats();
      return res.json(withMeta({ stats }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createRouter,
};
