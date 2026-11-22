'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger').child('Database');

let dbInstance = null;
let dbType = 'sqlite'; // 'sqlite' or 'postgres'
let pgPool = null;

class DatabaseClient {
  constructor() {
    this.initialized = false;
    this._initPromise = null;
  }

  async initialize() {
    if (this.initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      // Check if PostgreSQL is configured and reachable
      if (config.database.postgresUrl) {
        try {
          const { Pool } = require('pg');
          const testPool = new Pool({
            connectionString: config.database.postgresUrl,
            connectionTimeoutMillis: 3000,
          });
          await testPool.query('SELECT 1');
          pgPool = testPool;
          dbType = 'postgres';
          logger.info('Connected to PostgreSQL database', { url: config.database.postgresUrl });
        } catch (err) {
          logger.warn('PostgreSQL connection failed, falling back to embedded SQLite', {
            error: err.message,
          });
          dbType = 'sqlite';
        }
      } else {
        dbType = 'sqlite';
      }

      if (dbType === 'sqlite') {
        const { DatabaseSync } = require('node:sqlite');
        const sqliteFile = config.database.sqlitePath;
        const dir = path.dirname(sqliteFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        dbInstance = new DatabaseSync(sqliteFile);
        try {
          dbInstance.exec('PRAGMA journal_mode = WAL;');
          dbInstance.exec('PRAGMA foreign_keys = ON;');
        } catch (e) {}
        logger.info('Connected to SQLite database', { path: sqliteFile });
      }

      this.initialized = true;

      await this.runMigrations();
      await this.syncProjectsFromCatalog();
    })();

    return this._initPromise;
  }

  async runMigrations() {
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) return;
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    if (dbType === 'postgres') {
      const statements = schemaSql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await pgPool.query(statement);
      }
    } else {
      dbInstance.exec(schemaSql);
    }
    logger.info('Database schema verified & migrations executed');
  }

  async syncProjectsFromCatalog() {
    try {
      const catalogPath = config.paths.catalog;
      if (!fs.existsSync(catalogPath)) return;
      const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const projects = Array.isArray(catalogData) ? catalogData : catalogData.projects || [];

      for (const proj of projects) {
        if (!proj.id || !proj.name) continue;
        const now = new Date().toISOString();
        const existing = await this.get('SELECT id FROM projects WHERE id = ?', [proj.id]);
        if (!existing) {
          await this.run(
            `INSERT INTO projects (
              id, name, description, url, repository, wordpress_category,
              target_audience, keywords, competitors, brand_voice, active,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              proj.id,
              proj.name,
              proj.short_description || proj.description || '',
              proj.url || '',
              proj.github || proj.repository || '',
              proj.category || 'Software Architecture & Engineering',
              JSON.stringify(proj.use_cases || []),
              JSON.stringify(proj.focus_keywords || proj.tags || []),
              JSON.stringify(proj.competitors || []),
              proj.brand_voice || 'Authoritative, technical, accessible',
              1,
              now,
              now,
            ]
          );
        }
      }
      logger.info(`Synced ${projects.length} project(s) from catalog to DB`);
    } catch (err) {
      logger.warn('Warning syncing projects from catalog', { error: err.message });
    }
  }

  async query(sql, params = []) {
    await this.initialize();
    if (dbType === 'postgres') {
      let pIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
      const res = await pgPool.query(pgSql, params);
      return res.rows;
    } else {
      const stmt = dbInstance.prepare(sql);
      return stmt.all(...params);
    }
  }

  async get(sql, params = []) {
    await this.initialize();
    if (dbType === 'postgres') {
      let pIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
      const res = await pgPool.query(pgSql, params);
      return res.rows[0] || null;
    } else {
      const stmt = dbInstance.prepare(sql);
      return stmt.get(...params) || null;
    }
  }

  async all(sql, params = []) {
    return this.query(sql, params);
  }

  async run(sql, params = []) {
    await this.initialize();
    if (dbType === 'postgres') {
      let pIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
      const res = await pgPool.query(pgSql, params);
      return { changes: res.rowCount, lastInsertRowid: null };
    } else {
      const stmt = dbInstance.prepare(sql);
      return stmt.run(...params);
    }
  }

  async close() {
    if (pgPool) {
      await pgPool.end();
      pgPool = null;
    }
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }
    this.initialized = false;
    this._initPromise = null;
  }
}

module.exports = new DatabaseClient();
