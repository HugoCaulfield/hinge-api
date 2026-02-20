function createJobRunner({ jobsStore, handlers, concurrency = 1 }) {
  const queue = [];
  let active = 0;

  async function processQueue() {
    if (active >= concurrency || queue.length === 0) {
      return;
    }

    const entry = queue.shift();
    active += 1;
    const { jobId, type, input } = entry;

    try {
      jobsStore.update(jobId, {
        status: "running",
        progressStep: "running",
        progressPct: 10,
      });

      const handler = handlers[type];
      if (!handler) {
        throw new Error(`No handler registered for job type: ${type}`);
      }

      const result = await handler(input, (progressStep, progressPct) => {
        jobsStore.update(jobId, { progressStep, progressPct });
      });

      jobsStore.update(jobId, {
        status: "completed",
        progressStep: "completed",
        progressPct: 100,
        result,
      });
    } catch (error) {
      jobsStore.update(jobId, {
        status: "failed",
        progressStep: "failed",
        error: {
          message: error.message,
          code: error.code || "JOB_FAILED",
        },
      });
    } finally {
      active -= 1;
      processQueue();
    }
  }

  function submit(type, input) {
    const job = jobsStore.create(type, input);
    queue.push({ jobId: job.jobId, type, input });
    processQueue();
    return job;
  }

  return {
    submit,
  };
}

module.exports = {
  createJobRunner,
};
