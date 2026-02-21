const fs = require("fs").promises;
const path = require("path");

function resolveTempTargets() {
  const root = process.cwd();
  return [
    path.join(root, "src", "core", "temp"),
    path.join(root, "scripts", "python", "DONE"),
  ];
}

async function resetDirectory(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}

async function clearTempFilesOnStartup() {
  const targets = resolveTempTargets();

  for (const target of targets) {
    await resetDirectory(target);
  }
}

module.exports = {
  clearTempFilesOnStartup,
};
