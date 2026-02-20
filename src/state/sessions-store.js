const { randomUUID } = require("crypto");

function createSessionsStore(ttlMs = 86400000) {
  const sessions = new Map();
  const smsRequestToSession = new Map();
  const emailOrderToSession = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function create(initial = {}) {
    const sessionId = randomUUID();
    const createdAt = nowIso();
    const session = {
      sessionId,
      status: "active",
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      location: null,
      proxy: null,
      phone: null,
      email: null,
      photos: null,
      birth: null,
      ...initial,
    };
    sessions.set(sessionId, session);
    return session;
  }

  function update(sessionId, patch) {
    const existing = sessions.get(sessionId);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    sessions.set(sessionId, next);
    return next;
  }

  function get(sessionId) {
    return sessions.get(sessionId) || null;
  }

  function linkSmsRequest(sessionId, requestId) {
    smsRequestToSession.set(String(requestId), sessionId);
  }

  function linkEmailOrder(sessionId, orderId) {
    emailOrderToSession.set(String(orderId), sessionId);
  }

  function getSessionIdBySmsRequestId(requestId) {
    return smsRequestToSession.get(String(requestId)) || null;
  }

  function getSessionIdByEmailOrderId(orderId) {
    return emailOrderToSession.get(String(orderId)) || null;
  }

  function sweepExpired() {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (Date.parse(session.expiresAt) <= now) {
        sessions.delete(sessionId);
      }
    }
  }

  setInterval(sweepExpired, 60000).unref();

  return {
    create,
    update,
    get,
    linkSmsRequest,
    linkEmailOrder,
    getSessionIdBySmsRequestId,
    getSessionIdByEmailOrderId,
  };
}

module.exports = {
  createSessionsStore,
};
