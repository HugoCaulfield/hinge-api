const APP_CONFIGS = {
  "hinge-prod-1": {
    name: "Hinge (Local API)",
    telegram: { token: "" },
    photos: {
      count: 6,
      allowRegenerate: true,
      useSpoofing: true,
      spoofer: "random_three",
    },
    sms: {
      service: "420",
      serviceCode: "vz",
      providers: ["daisysms"],
    },
    proxy: {
      providers: ["anyIp"],
    },
  },
};

function getAppConfig(appName) {
  const normalizedName = String(appName || "").toLowerCase();
  if (!APP_CONFIGS[normalizedName]) {
    throw new Error(
      `Unknown app: ${appName}. Available apps: ${Object.keys(APP_CONFIGS).join(", ")}`
    );
  }
  return APP_CONFIGS[normalizedName];
}

function getAvailableApps() {
  return Object.keys(APP_CONFIGS);
}

module.exports = {
  APP_CONFIGS,
  getAppConfig,
  getAvailableApps,
};
