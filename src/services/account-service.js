const { generateBirthDate } = require("../core/photo/date_generator");
const {
  getModelDisplayName,
  getModelAge,
} = require("../../config/photo-models");

function createAccountService({
  sessionsStore,
  locationService,
  proxyService,
  smsService,
  emailService,
  photoService,
  runtimeFlags = {},
}) {
  const rentPhoneEnabled = runtimeFlags.rentPhone !== false;
  const rentEmailEnabled = runtimeFlags.rentEmail !== false;

  async function generateAccount(input) {
    const session = sessionsStore.create();
    const sessionId = session.sessionId;

    const location = await locationService.validateAndResolve(input.state, input.city);
    const locationWithCoords = await locationService.randomizeCoordinates(location);

    sessionsStore.update(sessionId, {
      location: {
        city: locationWithCoords.city,
        state: locationWithCoords.state,
        countryCode:
          locationWithCoords.countryCode ||
          locationWithCoords.CountryCode ||
          "us",
        latitude: locationWithCoords.latitude,
        longitude: locationWithCoords.longitude,
        areaCode: locationWithCoords.areaCode,
      },
    });

    const proxyResult = await proxyService.generate(locationWithCoords);

    let smsResult = null;
    if (rentPhoneEnabled) {
      smsResult = await smsService.requestPhoneNumber(
        locationWithCoords.areaCode || ""
      );
      smsService.startTracking(smsResult.requestId, sessionId);
    } else {
      smsResult = {
        requestId: null,
        phoneNumber: null,
        provider: "disabled",
        status: "skipped",
      };
    }

    let emailResult = null;
    if (rentEmailEnabled) {
      emailResult = await emailService.requestEmail();
      emailService.startTracking(emailResult.orderId, sessionId);
    } else {
      emailResult = {
        orderId: null,
        email: null,
        provider: "disabled",
        status: "skipped",
      };
    }

    const photos = await photoService.generate(input.modelKey || null);

    const modelKey = photos.modelKey;
    const modelName = getModelDisplayName(modelKey);
    const modelAge = getModelAge(modelKey);
    const birthInfo = generateBirthDate({ modelKey, age: modelAge });

    if (smsResult?.requestId) {
      sessionsStore.linkSmsRequest(sessionId, smsResult.requestId);
    }
    if (emailResult?.orderId) {
      sessionsStore.linkEmailOrder(sessionId, emailResult.orderId);
    }

    sessionsStore.update(sessionId, {
      proxy: {
        domain: proxyResult.domain,
        port: proxyResult.port,
        username: proxyResult.username,
        password: proxyResult.password,
        ip: proxyResult.ip,
        provider: proxyResult.provider,
        providerKey: proxyResult.providerKey,
      },
      phone: {
        requestId: smsResult.requestId,
        phoneNumber: smsResult.phoneNumber,
        provider: smsResult.provider,
      },
      email: {
        orderId: emailResult.orderId,
        email: emailResult.email,
        provider: emailResult.provider,
      },
      photos,
      birth: birthInfo,
    });

    return {
      sessionId,
      location: sessionsStore.get(sessionId).location,
      proxy: sessionsStore.get(sessionId).proxy,
      phone: sessionsStore.get(sessionId).phone,
      email: sessionsStore.get(sessionId).email,
      photos,
      birth: birthInfo,
      model: {
        modelKey,
        modelName,
        modelAge,
      },
    };
  }

  async function regenerateProxy(input) {
    const location = await locationService.validateAndResolve(input.state, input.city);
    const locationWithCoords = await locationService.randomizeCoordinates(location);
    const proxyResult = await proxyService.generate(locationWithCoords);
    return {
      location: {
        city: locationWithCoords.city,
        state: locationWithCoords.state,
        latitude: locationWithCoords.latitude,
        longitude: locationWithCoords.longitude,
      },
      proxy: {
        domain: proxyResult.domain,
        port: proxyResult.port,
        username: proxyResult.username,
        password: proxyResult.password,
        ip: proxyResult.ip,
        provider: proxyResult.provider,
        providerKey: proxyResult.providerKey,
      },
    };
  }

  async function regeneratePhone(input) {
    if (!rentPhoneEnabled) {
      const err = new Error("Phone renting is disabled by runtime flag");
      err.code = "PHONE_RENT_DISABLED";
      err.statusCode = 503;
      throw err;
    }

    const smsResult = await smsService.requestPhoneNumber(input.areaCode || "");
    if (input.sessionId) {
      sessionsStore.linkSmsRequest(input.sessionId, smsResult.requestId);
      smsService.startTracking(smsResult.requestId, input.sessionId);
      const session = sessionsStore.get(input.sessionId);
      if (session) {
        sessionsStore.update(input.sessionId, {
          phone: {
            requestId: smsResult.requestId,
            phoneNumber: smsResult.phoneNumber,
            provider: smsResult.provider,
          },
        });
      }
    }
    return smsResult;
  }

  async function regenerateEmail(input) {
    if (!rentEmailEnabled) {
      const err = new Error("Email renting is disabled by runtime flag");
      err.code = "EMAIL_RENT_DISABLED";
      err.statusCode = 503;
      throw err;
    }

    const emailResult = await emailService.requestEmail();
    if (input.sessionId) {
      sessionsStore.linkEmailOrder(input.sessionId, emailResult.orderId);
      emailService.startTracking(emailResult.orderId, input.sessionId);
      const session = sessionsStore.get(input.sessionId);
      if (session) {
        sessionsStore.update(input.sessionId, {
          email: {
            orderId: emailResult.orderId,
            email: emailResult.email,
            provider: emailResult.provider,
          },
        });
      }
    }
    return emailResult;
  }

  async function regeneratePhotos(input) {
    const photos = await photoService.generate(input.modelKey || null);
    if (input.sessionId) {
      const session = sessionsStore.get(input.sessionId);
      if (session) {
        sessionsStore.update(input.sessionId, { photos });
      }
    }
    return photos;
  }

  return {
    generateAccount,
    regenerateProxy,
    regeneratePhone,
    regenerateEmail,
    regeneratePhotos,
  };
}

module.exports = {
  createAccountService,
};
