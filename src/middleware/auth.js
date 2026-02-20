function createAuthMiddleware(config) {
  const apiKey = config.security.apiKey;
  const allowNoAuth = Boolean(config.security.allowNoAuth);

  return function authMiddleware(req, res, next) {
    if (allowNoAuth) {
      return next();
    }

    const incoming = req.header("x-api-key") || req.header("authorization")?.replace(/^Bearer\s+/i, "");

    if (!apiKey) {
      return res.status(500).json({
        error: {
          code: "MISSING_SERVER_API_KEY",
          message: "Server API key is not configured",
          details: {},
        },
      });
    }

    if (!incoming || incoming !== apiKey) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key",
          details: {},
        },
      });
    }

    return next();
  };
}

module.exports = {
  createAuthMiddleware,
};
