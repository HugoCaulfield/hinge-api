function createSmsStore() {
  const sms = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function upsert(requestId, patch) {
    const key = String(requestId);
    const existing = sms.get(key) || {
      requestId: key,
      status: "pending",
      code: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      provider: "daisysms",
      sessionId: null,
    };
    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    sms.set(key, next);
    return next;
  }

  function get(requestId) {
    return sms.get(String(requestId)) || null;
  }

  return {
    upsert,
    get,
  };
}

module.exports = {
  createSmsStore,
};
