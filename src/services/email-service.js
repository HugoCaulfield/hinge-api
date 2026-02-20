const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(str = "") {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripHtml(text = "") {
  const decoded = decodeHtmlEntities(text);
  return decoded.replace(/<[^>]*>/g, " ");
}

function extractCodeFromAny(payload) {
  if (!payload) return null;

  const pickFromText = (text) => {
    const cleaned = stripHtml(String(text || ""));
    const matches = [...cleaned.matchAll(/\b(\d{4,8})\b/g)].map((m) => m[1]);
    if (!matches.length) return null;
    return matches.find((m) => m.length === 6 || m.length === 7) || matches[0];
  };

  if (typeof payload === "string") {
    return pickFromText(payload);
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const code = extractCodeFromAny(item);
      if (code) return code;
    }
    return null;
  }

  if (typeof payload === "object") {
    const keys = ["message", "value", "body", "text", "subject", "messages", "data", "inbox", "results", "items"];
    for (const key of keys) {
      if (payload[key] !== undefined) {
        const code = extractCodeFromAny(payload[key]);
        if (code) return code;
      }
    }

    for (const value of Object.values(payload)) {
      const code = extractCodeFromAny(value);
      if (code) return code;
    }
  }

  return null;
}

function createEmailService(config, emailStore, sessionsStore) {
  const intervals = new Map();
  const baseUrl = config.email.baseUrl;
  const token = config.email.token;
  const site = config.email.site || "hinge.co";
  const domains = config.email.domains || ["gmail.com", "outlook.com"];

  if (!token) {
    console.warn("[email] AnyMessage token missing. Set config.email.token or ANYMESSAGE_TOKEN");
  }

  function buildUrl(pathname, params = {}) {
    const query = new URLSearchParams({ token, ...params });
    return `${baseUrl}${pathname}?${query.toString()}`;
  }

  function parseOrderResponse(data) {
    if (!data) return { email: null, orderId: null, error: "empty response" };

    if (typeof data === "string") {
      const emailMatch = data.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const idMatch = data.match(/\b\d{4,}\b/);
      return {
        email: emailMatch ? emailMatch[0] : null,
        orderId: idMatch ? idMatch[0] : null,
        error: emailMatch && idMatch ? null : data,
      };
    }

    if (typeof data === "object") {
      return {
        email: data.email || data.mail || data.address || data.data?.email || null,
        orderId:
          data.orderId ||
          data.order_id ||
          data.id ||
          data.request_id ||
          data.data?.id ||
          null,
        error: data.error || data.message || null,
      };
    }

    return { email: null, orderId: null, error: "unsupported response" };
  }

  async function requestEmail() {
    for (let i = 0; i < domains.length; i += 1) {
      const domain = domains[i];
      const url = buildUrl("/email/order", { site, domain });
      const response = await axios.get(url, { timeout: 20000 });
      const parsed = parseOrderResponse(response.data);
      if (parsed.email && parsed.orderId) {
        return {
          email: parsed.email,
          orderId: String(parsed.orderId),
          domain,
          provider: "anymessage",
        };
      }
      if (i < domains.length - 1) {
        await sleep(1000);
      }
    }

    const err = new Error("No AnyMessage email available");
    err.code = "EMAIL_UNAVAILABLE";
    throw err;
  }

  async function getEmailMessage(orderId) {
    const url = buildUrl("/email/getmessage", { id: String(orderId) });
    const response = await axios.get(url, { timeout: 20000 });
    return response.data;
  }

  function startTracking(orderId, sessionId) {
    const key = String(orderId);
    const pollMs = Number(config.email.pollIntervalMs || 7000);
    const timeoutMs = Number(config.email.timeoutMs || 420000);

    emailStore.upsert(key, {
      orderId: key,
      sessionId,
      status: "pending",
      code: null,
      provider: "anymessage",
    });
    sessionsStore.linkEmailOrder(sessionId, key);

    if (intervals.has(key)) {
      clearInterval(intervals.get(key));
    }

    const interval = setInterval(async () => {
      try {
        const payload = await getEmailMessage(key);

        if (payload && typeof payload === "object" && String(payload.status || "").toLowerCase() === "error") {
          const value = String(payload.value || "").toLowerCase();
          if (value.includes("cancel") || value.includes("no activation")) {
            emailStore.upsert(key, { status: "cancelled" });
            clearInterval(interval);
            intervals.delete(key);
            return;
          }
          if (value.includes("expired") || value.includes("timeout")) {
            emailStore.upsert(key, { status: "expired" });
            clearInterval(interval);
            intervals.delete(key);
            return;
          }
        }

        const code = extractCodeFromAny(payload);
        if (code) {
          emailStore.upsert(key, { status: "code_received", code });
          clearInterval(interval);
          intervals.delete(key);
          return;
        }

        emailStore.upsert(key, { status: "pending" });
      } catch (error) {
        emailStore.upsert(key, { status: "error", error: error.message });
      }
    }, pollMs);

    intervals.set(key, interval);

    setTimeout(async () => {
      if (!intervals.has(key)) {
        return;
      }
      clearInterval(interval);
      intervals.delete(key);
      const existing = emailStore.get(key);
      if (existing && existing.status === "pending") {
        emailStore.upsert(key, { status: "timeout" });
        try {
          await cancelOrder(key);
        } catch (error) {
          emailStore.upsert(key, { status: "timeout", cancelError: error.message });
        }
      }
    }, timeoutMs).unref();
  }

  async function cancelOrder(orderId) {
    const key = String(orderId);
    const url = buildUrl("/email/cancel", { id: key });
    await axios.get(url, { timeout: 20000 });

    const interval = intervals.get(key);
    if (interval) {
      clearInterval(interval);
      intervals.delete(key);
    }

    emailStore.upsert(key, { status: "cancelled" });
  }

  return {
    requestEmail,
    startTracking,
    cancelOrder,
  };
}

module.exports = {
  createEmailService,
};
