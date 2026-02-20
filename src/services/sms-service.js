const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSmsService(config, smsStore, sessionsStore) {
  const intervals = new Map();
  const baseUrl = config.sms.baseUrl;
  const apiKey = config.sms.apiKey;

  if (!apiKey) {
    console.warn("[sms] DAISY api key missing. Set config.sms.apiKey or DAISYSMS_API_KEY");
  }

  async function requestPhoneNumber(areaCode) {
    const serviceCode = config.sms.serviceCode || "vz";
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts += 1;
      const params = new URLSearchParams({
        api_key: apiKey,
        action: "getNumber",
        service: serviceCode,
        max_price: "1.0",
      });
      if (areaCode) {
        params.set("areas", areaCode);
      }

      const url = `${baseUrl}?${params.toString()}`;
      const response = await axios.get(url, { timeout: 15000 });
      const data = String(response.data || "");

      if (data.startsWith("ACCESS_NUMBER")) {
        const [, requestId, number] = data.split(":");
        return {
          requestId,
          phoneNumber: number,
          provider: "daisysms",
        };
      }

      if (attempts < maxAttempts) {
        await sleep(1200);
      }
    }

    const err = new Error("No DaisySMS number available");
    err.code = "SMS_NUMBER_UNAVAILABLE";
    throw err;
  }

  function parseStatus(raw) {
    const text = String(raw || "");
    const normalized = text.toUpperCase();

    if (normalized.startsWith("STATUS_OK:")) {
      const code = text.split(":")[1] || null;
      return { status: "code_received", code };
    }
    if (normalized.includes("STATUS_CANCEL") || normalized.includes("NO_ACTIVATION")) {
      return { status: "cancelled", code: null };
    }
    if (normalized.includes("STATUS_WAIT_CODE") || normalized.includes("STATUS_WAIT_RETRY") || normalized.includes("ACCESS_READY")) {
      return { status: "pending", code: null };
    }

    return { status: "pending", code: null };
  }

  async function pollStatus(requestId) {
    const params = new URLSearchParams({
      api_key: apiKey,
      action: "getStatus",
      id: String(requestId),
    });
    const url = `${baseUrl}?${params.toString()}`;
    const response = await axios.get(url, { timeout: 15000 });
    return parseStatus(response.data);
  }

  function startTracking(requestId, sessionId) {
    const requestKey = String(requestId);
    const pollMs = Number(config.sms.pollIntervalMs || 10000);
    const timeoutMs = Number(config.sms.timeoutMs || 420000);

    smsStore.upsert(requestKey, {
      requestId: requestKey,
      sessionId,
      status: "pending",
      code: null,
      provider: "daisysms",
    });
    sessionsStore.linkSmsRequest(sessionId, requestKey);

    if (intervals.has(requestKey)) {
      clearInterval(intervals.get(requestKey));
    }

    const interval = setInterval(async () => {
      try {
        const status = await pollStatus(requestKey);
        const record = smsStore.upsert(requestKey, status);

        if (record.status === "code_received" || record.status === "cancelled") {
          clearInterval(interval);
          intervals.delete(requestKey);
        }
      } catch (error) {
        smsStore.upsert(requestKey, { status: "error", error: error.message });
      }
    }, pollMs);

    intervals.set(requestKey, interval);

    setTimeout(() => {
      if (!intervals.has(requestKey)) {
        return;
      }
      clearInterval(interval);
      intervals.delete(requestKey);
      const existing = smsStore.get(requestKey);
      if (existing && existing.status === "pending") {
        smsStore.upsert(requestKey, { status: "timeout" });
      }
    }, timeoutMs).unref();
  }

  async function cancelRequest(requestId) {
    const requestKey = String(requestId);
    const params = new URLSearchParams({
      api_key: apiKey,
      action: "setStatus",
      id: requestKey,
      status: "8",
    });
    const url = `${baseUrl}?${params.toString()}`;
    await axios.get(url, { timeout: 15000 });

    const interval = intervals.get(requestKey);
    if (interval) {
      clearInterval(interval);
      intervals.delete(requestKey);
    }

    smsStore.upsert(requestKey, { status: "cancelled" });
  }

  function handleWebhook(payload) {
    const requestId = String(
      payload.activationId || payload.requestId || payload.id || payload.orderId || ""
    );
    if (!requestId) {
      return { handled: false, reason: "missing_activation_id" };
    }

    const existing = smsStore.get(requestId);
    if (existing && existing.status === "code_received") {
      return { handled: false, reason: "duplicate" };
    }

    const text = String(payload.text || "");
    const code = payload.code || (text.match(/\b(\d{4,8})\b/) || [])[1] || null;

    if (code) {
      smsStore.upsert(requestId, {
        status: "code_received",
        code,
      });
      const interval = intervals.get(requestId);
      if (interval) {
        clearInterval(interval);
        intervals.delete(requestId);
      }
      return { handled: true };
    }

    return { handled: false, reason: "code_not_found" };
  }

  return {
    requestPhoneNumber,
    startTracking,
    cancelRequest,
    handleWebhook,
  };
}

module.exports = {
  createSmsService,
};
