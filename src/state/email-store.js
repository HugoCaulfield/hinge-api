function createEmailStore() {
  const emails = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function upsert(orderId, patch) {
    const key = String(orderId);
    const existing = emails.get(key) || {
      orderId: key,
      status: "pending",
      code: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      provider: "anymessage",
      sessionId: null,
    };
    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    emails.set(key, next);
    return next;
  }

  function get(orderId) {
    return emails.get(String(orderId)) || null;
  }

  return {
    upsert,
    get,
  };
}

module.exports = {
  createEmailStore,
};
