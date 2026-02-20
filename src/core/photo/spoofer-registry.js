const path = require("path");
const {
  DEFAULT_MODEL_KEY,
  getModelSourceDir,
  LEGACY_INPUT_DIR,
} = require("../../../config/photo-models");

const ROOT_DIR = path.join(__dirname, "..", "..", "..");
const PYTHON_DIR = path.join(ROOT_DIR, "scripts", "python");
const DEFAULT_DONE_DIR = path.join(PYTHON_DIR, "DONE");
const DEFAULT_INPUT_DIR =
  (typeof getModelSourceDir === "function" &&
    getModelSourceDir(DEFAULT_MODEL_KEY)) ||
  LEGACY_INPUT_DIR ||
  path.join(PYTHON_DIR, "allpictures");

const DEFAULT_SPOOFER = "random_three";

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function buildRandomThreeArgs({ photoCount, outputDir, options = {} }) {
  const safeCount = toPositiveInteger(photoCount, 1);
  const resolvedOutputDir = outputDir
    ? path.resolve(outputDir)
    : DEFAULT_DONE_DIR;
  const resolvedInputDir = options.inputDir
    ? path.resolve(options.inputDir)
    : DEFAULT_INPUT_DIR;

  const args = [safeCount.toString()];
  if (outputDir) {
    args.push(resolvedOutputDir);
  }
  if (resolvedInputDir) {
    args.push("--input", resolvedInputDir);
  }

  return {
    args,
    outputDir: resolvedOutputDir,
    inputDir: resolvedInputDir,
  };
}

function buildIphoneCliArgs({ photoCount, outputDir, options = {} }) {
  const safeCount = toPositiveInteger(photoCount, 1);
  const resolvedOutputDir = outputDir
    ? path.resolve(outputDir)
    : DEFAULT_DONE_DIR;
  const inputDir = options.inputDir
    ? path.resolve(options.inputDir)
    : DEFAULT_INPUT_DIR;
  const versions = toPositiveInteger(
    options.versions,
    toPositiveInteger(options.batchCount, 1)
  );
  const modificationLevel =
    typeof options.modificationLevel === "number"
      ? Math.max(0, options.modificationLevel)
      : 2;

  const args = [
    "--cli",
    "--input",
    inputDir,
    "--output",
    resolvedOutputDir,
    "--count",
    safeCount.toString(),
    "--versions",
    versions.toString(),
    "--modification-level",
    modificationLevel.toString(),
  ];

  // flatOutput=true is required when the worker points directly at a pool dir,
  // otherwise the Python script nests everything under batch_* folders.
  if (options.flatOutput === false) {
    args.push("--no-flat-output");
  } else {
    args.push("--flat-output");
  }

  if (options.quiet !== false) {
    args.push("--quiet");
  }

  if (Array.isArray(options.extraArgs)) {
    for (const arg of options.extraArgs) {
      if (arg !== undefined && arg !== null) {
        args.push(String(arg));
      }
    }
  }

  return { args, outputDir: resolvedOutputDir };
}

const SPOOFERS = {
  random_three: {
    name: "random_three",
    scriptPath: path.join(PYTHON_DIR, "random_three.py"),
    workingDir: PYTHON_DIR,
    defaultOptions: {
      inputDir: DEFAULT_INPUT_DIR,
    },
    buildArgs: buildRandomThreeArgs,
  },
  iphone_exif_gui_reconstructed: {
    name: "iphone_exif_gui_reconstructed",
    scriptPath: path.join(PYTHON_DIR, "iphone_exif_gui_reconstructed.py"),
    workingDir: ROOT_DIR,
    defaultOptions: {
      inputDir: DEFAULT_INPUT_DIR,
      modificationLevel: 3,
      versions: 1,
      flatOutput: true,
      quiet: true,
    },
    buildArgs: buildIphoneCliArgs,
  },
};

function getSpooferDefinition(name) {
  return SPOOFERS[name] || SPOOFERS[DEFAULT_SPOOFER];
}

function getSpooferRuntimeConfig(
  spooferName,
  { photoCount, outputDir, options } = {}
) {
  const spoofer = getSpooferDefinition(spooferName);
  const mergedOptions = {
    ...(spoofer.defaultOptions || {}),
    ...(options || {}),
  };

  const { args, outputDir: resolvedOutputDir } = spoofer.buildArgs({
    photoCount,
    outputDir,
    options: mergedOptions,
  });

  return {
    spoofer,
    args,
    outputDir: resolvedOutputDir,
    options: mergedOptions,
    workingDirOverride: mergedOptions.workingDir || mergedOptions.workingDirOverride,
    photoCount: photoCount || null,
  };
}

function listAvailableSpoofers() {
  return Object.keys(SPOOFERS);
}

module.exports = {
  DEFAULT_SPOOFER,
  DEFAULT_DONE_DIR,
  DEFAULT_INPUT_DIR,
  getSpooferDefinition,
  getSpooferRuntimeConfig,
  listAvailableSpoofers,
};
