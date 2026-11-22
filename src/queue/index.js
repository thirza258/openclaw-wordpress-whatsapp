'use strict';

const db = require('../db');
const { ExecutionLogs } = require('../db/models');
const logger = require('../utils/logger').child('Queue');
const crypto = require('crypto');

class JobQueue {
  constructor() {
    this.handlers = new Map();
    this.running = false;
    this.pollInterval = null;
    this.concurrency = 3;
    this.activeJobsCount = 0;
  }

  registerHandler(jobType, handlerFn) {
    this.handlers.set(jobType, handlerFn);
    logger.debug(`Registered job handler for [${jobType}]`);
  }

  async enqueue(jobType, { campaignId = null, payload = {}, priority = 10, maxAttempts = 3, idempotencyKey = null }) {
    await db.initialize();
    const id = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    if (idempotencyKey) {
      const existing = await db.get(
        "SELECT * FROM jobs WHERE idempotency_key = ? AND status IN ('queued', 'running', 'completed')",
        [idempotencyKey]
      );
      if (existing) {
        logger.info(`Idempotent job hit: skipping duplicate enqueue for key [${idempotencyKey}]`, {
          existingJobId: existing.id,
        });
        return existing;
      }
    }

    await db.run(
      `INSERT INTO jobs (id, campaign_id, job_type, status, priority, attempts, max_attempts, payload, idempotency_key, created_at)
       VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)`,
      [id, campaignId, jobType, priority, maxAttempts, JSON.stringify(payload), idempotencyKey, now]
    );

    logger.info(`Job enqueued: ${id} [${jobType}] (Priority: ${priority})`, { campaignId });
    // Trigger immediate poll
    setImmediate(() => this.processNext());
    return { id, jobType, campaignId, status: 'queued', payload };
  }

  async start(intervalMs = 1000) {
    if (this.running) return;
    this.running = true;
    logger.info('Queue worker started');
    this.pollInterval = setInterval(() => this.processNext(), intervalMs);
    this.processNext();
  }

  async stop() {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info('Queue worker stopped');
  }

  async processNext() {
    if (!this.running || this.activeJobsCount >= this.concurrency) return;

    try {
      // Find highest priority queued job
      const job = await db.get(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 1"
      );
      if (!job) return;

      const handler = this.handlers.get(job.job_type);
      if (!handler) {
        logger.warn(`No handler registered for job type: ${job.job_type}`);
        return;
      }

      this.activeJobsCount++;
      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      await db.run('UPDATE jobs SET status = "running", attempts = attempts + 1, started_at = ? WHERE id = ?', [
        startedAt,
        job.id,
      ]);

      const payload = job.payload ? JSON.parse(job.payload) : {};
      logger.info(`Processing job ${job.id} [${job.job_type}] (Attempt ${job.attempts + 1}/${job.max_attempts})...`);

      try {
        const result = await handler(payload, job);
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startTime;

        await db.run('UPDATE jobs SET status = "completed", result = ?, completed_at = ? WHERE id = ?', [
          JSON.stringify(result || {}),
          finishedAt,
          job.id,
        ]);

        await ExecutionLogs.log({
          jobId: job.id,
          campaignId: job.campaign_id,
          tool: `queue.${job.job_type}`,
          status: 'success',
          durationMs,
          startedAt,
          finishedAt,
        });

        logger.info(`Job ${job.id} [${job.job_type}] completed successfully in ${durationMs}ms`);
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startTime;
        const attemptsMade = job.attempts + 1;
        const willRetry = attemptsMade < job.max_attempts;

        await db.run(
          `UPDATE jobs SET status = ?, error = ?, completed_at = ? WHERE id = ?`,
          [willRetry ? 'queued' : 'failed', err.message, finishedAt, job.id]
        );

        await ExecutionLogs.log({
          jobId: job.id,
          campaignId: job.campaign_id,
          tool: `queue.${job.job_type}`,
          status: willRetry ? 'retry_pending' : 'failed',
          durationMs,
          startedAt,
          finishedAt,
          error: err.message,
        });

        logger.error(`Job ${job.id} [${job.job_type}] failed: ${err.message}${willRetry ? ' (will retry)' : ' (dead-lettered)'}`);
      } finally {
        this.activeJobsCount--;
        if (this.running) {
          setImmediate(() => this.processNext());
        }
      }
    } catch (e) {
      logger.error('Error during queue processing loop', { error: e.message });
    }
  }

  async getJob(id) {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [id]);
    if (!job) return null;
    return {
      ...job,
      payload: job.payload ? JSON.parse(job.payload) : {},
      result: job.result ? JSON.parse(job.result) : null,
    };
  }
}

module.exports = new JobQueue();
