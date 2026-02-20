const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const PYTHON_DIR = path.join(ROOT_DIR, "scripts", "python");
const MODELS_DIR = path.join(PYTHON_DIR, "models");
const LEGACY_INPUT_DIR = path.join(PYTHON_DIR, "allpictures");
const POOLS_DIR = path.join(PYTHON_DIR, "pools");
const MODEL_POOLS_DIR = path.join(POOLS_DIR, "models");

const DEFAULT_MODEL_KEY = "chloe";

const MODEL_DEFINITIONS = {
  chloe: {
    key: "chloe",
    name: "Chloe",
    age: 19,
    sourceDir: path.join(PYTHON_DIR, "chloe"),
    legacySources: [
      path.join(MODELS_DIR, "chloe"),
      LEGACY_INPUT_DIR,
    ],
  },
};

function normalizeToken(value) {
  return value
    ? value.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

function resolveModelKey(input) {
  const token = normalizeToken(input);
  if (!token) {
    return DEFAULT_MODEL_KEY;
  }

  for (const [key, def] of Object.entries(MODEL_DEFINITIONS)) {
    if (normalizeToken(key) === token) {
      return key;
    }
  }

  return DEFAULT_MODEL_KEY;
}

function getModelDefinition(modelKey = DEFAULT_MODEL_KEY) {
  return MODEL_DEFINITIONS[modelKey] || MODEL_DEFINITIONS[DEFAULT_MODEL_KEY];
}

function getModelSourceCandidates(modelKey = DEFAULT_MODEL_KEY) {
  const def = getModelDefinition(modelKey);
  const sources = [];
  if (def.sourceDir) {
    sources.push(def.sourceDir);
  }
  if (Array.isArray(def.legacySources)) {
    sources.push(...def.legacySources.filter(Boolean));
  }
  if (!sources.includes(LEGACY_INPUT_DIR)) {
    sources.push(LEGACY_INPUT_DIR);
  }
  return sources;
}

function getModelSourceDir(modelKey = DEFAULT_MODEL_KEY) {
  return getModelSourceCandidates(modelKey)[0];
}

function getPoolDir(appName, modelKey = DEFAULT_MODEL_KEY) {
  const resolved = modelKey || DEFAULT_MODEL_KEY;
  return path.join(MODEL_POOLS_DIR, resolved, appName);
}

function listModelKeys() {
  return Object.keys(MODEL_DEFINITIONS);
}

function getModelDisplayName(modelKey = DEFAULT_MODEL_KEY) {
  const def = getModelDefinition(modelKey);
  return def?.name || modelKey || DEFAULT_MODEL_KEY;
}

function getModelAge(modelKey) {
  if (!modelKey) {
    return null;
  }
  const def = MODEL_DEFINITIONS[modelKey] || MODEL_DEFINITIONS[DEFAULT_MODEL_KEY];
  return typeof def?.age === "number" ? def.age : null;
}

module.exports = {
  DEFAULT_MODEL_KEY,
  MODEL_DEFINITIONS,
  MODEL_POOLS_DIR,
  MODELS_DIR,
  POOLS_DIR,
  PYTHON_DIR,
  LEGACY_INPUT_DIR,
  resolveModelKey,
  getModelDefinition,
  getModelSourceDir,
  getModelSourceCandidates,
  getPoolDir,
  listModelKeys,
  normalizeToken,
  getModelDisplayName,
  getModelAge,
};
