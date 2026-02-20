const { randomUUID } = require("crypto");

function createJobsStore(ttlMs = 86400000) {
  const jobs = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function create(type, input) {
    const jobId = randomUUID();
    const createdAt = nowIso();
    const job = {
      jobId,
      type,
      input,
      status: "queued",
      progressStep: "queued",
      progressPct: 0,
      result: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    jobs.set(jobId, job);
    return job;
  }

  function update(jobId, patch) {
    const existing = jobs.get(jobId);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    jobs.set(jobId, next);
    return next;
  }

  function get(jobId) {
    return jobs.get(jobId) || null;
  }

  function sweepExpired() {
    const now = Date.now();
    for (const [jobId, job] of jobs.entries()) {
      if (Date.parse(job.expiresAt) <= now) {
        jobs.delete(jobId);
      }
    }
  }

  setInterval(sweepExpired, 60000).unref();

  return {
    create,
    update,
    get,
  };
}

module.exports = {
  createJobsStore,
};
