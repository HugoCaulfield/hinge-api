#!/usr/bin/env node

/**
 * Photo Worker Startup Script
 * 
 * This script starts the background photo pre-generation worker
 */

const { spawn } = require("child_process");
const path = require("path");

console.log("🎭 Starting Photo Pre-Generation Worker...");
console.log("======================================");

// Start the background worker
const workerPath = path.join(__dirname, "src", "core", "photo", "photo-pool-worker.js");

const worker = spawn("node", [workerPath], {
  stdio: "inherit", // Forward all output to parent process
  cwd: __dirname
});

worker.on("close", (code) => {
  console.log(`\n🎭 Photo worker exited with code ${code}`);
  
  if (code !== 0) {
    console.log("🔄 Restarting worker in 5 seconds...");
    setTimeout(() => {
      // Restart the worker
      const restartedWorker = spawn("node", [workerPath], {
        stdio: "inherit",
        cwd: __dirname
      });
      
      restartedWorker.on("close", (restartCode) => {
        console.log(`\n🎭 Restarted photo worker exited with code ${restartCode}`);
        process.exit(restartCode);
      });
    }, 5000);
  }
});

worker.on("error", (error) => {
  console.error(`🚨 Failed to start photo worker: ${error.message}`);
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down photo worker...");
  worker.kill("SIGINT");
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down photo worker...");
  worker.kill("SIGTERM");
});
