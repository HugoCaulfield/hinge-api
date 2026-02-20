const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const {
  DEFAULT_MODEL_KEY,
  resolveModelKey,
  normalizeToken,
  listModelKeys,
} = require("../../../config/photo-models");
const { log } = require("../../utils/logger");

const USER_MODELS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "user-models.json"
);

let cachedAssignments = null;
let assignmentsWatcherStarted = false;
let assignmentsWatcherTimer = null;

async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function persistAssignments(assignments) {
  await fs.mkdir(path.dirname(USER_MODELS_PATH), { recursive: true });
  await fs.writeFile(
    USER_MODELS_PATH,
    JSON.stringify(assignments, null, 2),
    "utf8"
  );
}

async function ensureAssignmentsLoaded() {
  if (!assignmentsWatcherStarted) {
    startUserModelsWatcher().catch((error) =>
      log(`⚠️ Could not start user-model watcher: ${error.message}`)
    );
  }

  if (cachedAssignments) {
    return cachedAssignments;
  }

  const assignments = await readJson(USER_MODELS_PATH, null);
  if (assignments) {
    cachedAssignments = assignments;
    return cachedAssignments;
  }

  cachedAssignments = {};
  await persistAssignments(cachedAssignments);
  return cachedAssignments;
}

async function getAssignments() {
  const assignments = await ensureAssignmentsLoaded();
  return { ...assignments };
}

async function getActiveModelKeys() {
  const assignments = await ensureAssignmentsLoaded();
  const active = new Set(listModelKeys());
  Object.values(assignments || {}).forEach((value) => {
    active.add(resolveModelKey(value));
  });
  return Array.from(active);
}

function normalizeName(name) {
  return normalizeToken(name);
}

async function startUserModelsWatcher() {
  if (assignmentsWatcherStarted) {
    return;
  }

  assignmentsWatcherStarted = true;

  try {
    await fs.mkdir(path.dirname(USER_MODELS_PATH), { recursive: true });
    const existing = await readJson(USER_MODELS_PATH, null);
    if (!existing) {
      await persistAssignments({});
    }
  } catch (error) {
    log(`⚠️ Could not initialize user-model assignments: ${error.message}`);
    assignmentsWatcherStarted = false;
    return;
  }

  try {
    fsSync.watch(USER_MODELS_PATH, { persistent: false }, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }

      if (assignmentsWatcherTimer) {
        clearTimeout(assignmentsWatcherTimer);
      }

      assignmentsWatcherTimer = setTimeout(async () => {
        try {
          cachedAssignments = null;
          await ensureAssignmentsLoaded();
          log("🔄 User-model assignments reloaded from shared file");
        } catch (error) {
          log(`⚠️ Failed to reload user-model assignments: ${error.message}`);
        }
      }, 150);
    });
    log("👀 Watching user-models.json for changes");
  } catch (error) {
    log(`⚠️ Could not start user-models watcher: ${error.message}`);
    assignmentsWatcherStarted = false;
  }
}

async function getModelKeyForUser(userId) {
  const assignments = await ensureAssignmentsLoaded();
  const stored = assignments?.[userId];
  return stored ? resolveModelKey(stored) : DEFAULT_MODEL_KEY;
}

async function setModelKeyForUser(userId, modelInput) {
  const assignments = await ensureAssignmentsLoaded();
  const resolvedModel = resolveModelKey(modelInput);
  const previous = assignments?.[userId];
  const previousModelKey = previous
    ? resolveModelKey(previous)
    : DEFAULT_MODEL_KEY;

  if (previousModelKey === resolvedModel) {
    return {
      changed: false,
      modelKey: resolvedModel,
      previousModelKey,
    };
  }

  assignments[userId] = resolvedModel;
  await persistAssignments(assignments);

  return {
    changed: true,
    modelKey: resolvedModel,
    previousModelKey,
  };
}

async function assignModelByIdentifier(userIdentifier, modelInput) {
  const userId = Number(userIdentifier);
  if (!Number.isFinite(userId)) {
    return {
      success: false,
      reason: "invalid-user-id",
      userIdentifier,
      modelKey: resolveModelKey(modelInput),
    };
  }

  const result = await setModelKeyForUser(userId, modelInput);

  return {
    success: true,
    userId,
    modelKey: result.modelKey,
    previousModelKey: result.previousModelKey,
    changed: result.changed,
  };
}

async function applyInlineModelCommands(configFilePath) {
  const content = await fs.readFile(configFilePath, "utf8");
  const commandPattern = /\/\/\s*changemodel\s*:\s*([^\s]+)\s+([^\r\n]+)/gi;

  const results = {
    applied: [],
    skipped: [],
    totalCommands: 0,
  };

  let match;
  while ((match = commandPattern.exec(content))) {
    results.totalCommands += 1;
    const userIdentifier = match[1].trim();
    const modelInput = match[2].trim();

    const assignResult = await assignModelByIdentifier(
      userIdentifier,
      modelInput
    );

    if (!assignResult.success) {
      results.skipped.push(assignResult);
      continue;
    }

    results.applied.push(assignResult);
  }

  return results;
}

async function listAssignments() {
  const assignments = await ensureAssignmentsLoaded();

  return Object.entries(assignments).map(([userId, model]) => ({
    userId: Number(userId),
    modelKey: resolveModelKey(model),
  }));
}

module.exports = {
  USER_MODELS_PATH,
  getAssignments,
  getActiveModelKeys,
  getModelKeyForUser,
  setModelKeyForUser,
  assignModelByIdentifier,
  applyInlineModelCommands,
  listAssignments,
  startUserModelsWatcher,
  DEFAULT_MODEL_KEY,
  resolveModelKey,
  normalizeName,
  listModelKeys,
};
