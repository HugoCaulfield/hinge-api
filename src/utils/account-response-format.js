const COUNTRY_BY_CODE = {
  us: "USA",
  uk: "United Kingdom",
  gb: "United Kingdom",
  it: "Italy",
  au: "Australia",
  ca: "Canada",
};

const DEFAULT_TIMEZONE_BY_COUNTRY = {
  us: "America/New_York",
  uk: "Europe/London",
  gb: "Europe/London",
  it: "Europe/Rome",
  au: "Australia/Sydney",
  ca: "America/Toronto",
};

const US_TIMEZONE_BY_STATE = {
  alaska: "America/Anchorage",
  alabama: "America/Chicago",
  arizona: "America/Phoenix",
  arkansas: "America/Chicago",
  california: "America/Los_Angeles",
  colorado: "America/Denver",
  connecticut: "America/New_York",
  delaware: "America/New_York",
  florida: "America/New_York",
  georgia: "America/New_York",
  hawaii: "Pacific/Honolulu",
  idaho: "America/Boise",
  illinois: "America/Chicago",
  indiana: "America/Indiana/Indianapolis",
  iowa: "America/Chicago",
  kansas: "America/Chicago",
  kentucky: "America/New_York",
  louisiana: "America/Chicago",
  maine: "America/New_York",
  maryland: "America/New_York",
  massachusetts: "America/New_York",
  michigan: "America/Detroit",
  minnesota: "America/Chicago",
  mississippi: "America/Chicago",
  missouri: "America/Chicago",
  montana: "America/Denver",
  nebraska: "America/Chicago",
  nevada: "America/Los_Angeles",
  "new hampshire": "America/New_York",
  "new jersey": "America/New_York",
  "new mexico": "America/Denver",
  "new york": "America/New_York",
  "north carolina": "America/New_York",
  "north dakota": "America/Chicago",
  ohio: "America/New_York",
  oklahoma: "America/Chicago",
  oregon: "America/Los_Angeles",
  pennsylvania: "America/New_York",
  "rhode island": "America/New_York",
  "south carolina": "America/New_York",
  "south dakota": "America/Chicago",
  tennessee: "America/Chicago",
  texas: "America/Chicago",
  utah: "America/Denver",
  vermont: "America/New_York",
  virginia: "America/New_York",
  washington: "America/Los_Angeles",
  "west virginia": "America/New_York",
  wisconsin: "America/Chicago",
  wyoming: "America/Denver",
};

const STATIC_ACCOUNT_INFO = {
  pronouns: ["she", "her"],
  gender: "Woman",
  sexuality: "Straight",
  dating_preferences: ["Men"],
  relationship_preferences: ["Monogamy"],
  dating_intentions: "Long-term relationship",
  height_feet: "5'4\"",
  ethnicity: ["Hispanic/Latino"],
  have_children: "Don't have children",
  want_children: "Want children",
  hometown: "",
  workplace: "",
  job: "",
  school: "",
  education_level: "High School",
  religious_beliefs: ["Catholic"],
  political_beliefs: "Not Political",
  drinking_habits: "Sometimes",
  smoking_habits: "No",
  marijuana_use: "No",
  drugs_use: "No",
  prompts: [
    {
      category: "About me",
      prompt: "I go crazy for",
      answer: "chocolate and dogs",
    },
    {
      category: "About me",
      prompt: "Typical Sunday",
      answer: "brunch with friends and a walk in the park",
    },
    {
      category: "About me",
      prompt: "The way to win me over is",
      answer: "being genuine and kind",
    },
  ],
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatBirthDate(input = "") {
  // Convert MM/DD/YYYY -> DD-MM-YYYY
  const [mm, dd, yyyy] = String(input).split("/");
  if (!mm || !dd || !yyyy) {
    return input;
  }
  return `${String(dd).padStart(2, "0")}-${String(mm).padStart(2, "0")}-${yyyy}`;
}

function resolveCountry(countryCode = "") {
  const code = String(countryCode || "").toLowerCase();
  return COUNTRY_BY_CODE[code] || (code ? code.toUpperCase() : "USA");
}

function resolveTimezone(countryCode = "", state = "") {
  const code = String(countryCode || "").toLowerCase();
  const normalizedState = String(state || "").trim().toLowerCase();

  if (code === "us" && US_TIMEZONE_BY_STATE[normalizedState]) {
    return US_TIMEZONE_BY_STATE[normalizedState];
  }

  return DEFAULT_TIMEZONE_BY_COUNTRY[code] || "America/New_York";
}

function buildProxyUrl(proxy = {}) {
  const domain = proxy.domain || "";
  const port = proxy.port || "";
  const username = proxy.username || "";
  const password = proxy.password || "";
  return `${domain}:${port}:${username}:${password}`;
}

function mapGenerateAccountResponse(payload = {}) {
  const location = payload.location || {};
  const photos = payload.photos || {};
  const phone = payload.phone || {};
  const email = payload.email || {};
  const proxy = payload.proxy || {};
  const birth = payload.birth || {};
  const model = payload.model || {};

  const countryCode = location.countryCode || location.CountryCode || "us";
  const firstName = model.modelName || "Chloe";

  return {
    method: "fast_v1.01",
    localisation: {
      city: location.city || "",
      country: resolveCountry(countryCode),
      timezone: resolveTimezone(countryCode, location.state),
      coordinates: {
        latitude: toNumber(location.latitude),
        longitude: toNumber(location.longitude),
      },
    },
    pictures: Array.isArray(photos.photoPaths) ? photos.photoPaths : [],
    account_info: {
      first_name: firstName,
      last_name: "",
      birth_date: formatBirthDate(birth.birthDate || ""),
      ...STATIC_ACCOUNT_INFO,
    },
    proxy_url: buildProxyUrl(proxy),
    phone_number: phone.phoneNumber
      ? phone.phoneNumber.startsWith("+")
        ? phone.phoneNumber
        : `+${phone.phoneNumber}`
      : "",
    email: email.email || "",
    session_id: payload.sessionId || "",
    sms_request_id: phone.requestId || "",
    email_order_id: email.orderId || "",
  };
}

module.exports = {
  mapGenerateAccountResponse,
};
