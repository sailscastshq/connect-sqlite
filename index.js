/*!
 * @sailscastshq/connect-sqlite
 * SQLite session store for Sails.js using better-sqlite3
 * MIT Licensed
 */

const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

/**
 * One day in seconds (default TTL)
 */
const ONE_DAY = 86400

/**
 * Return the SQLiteStore extending connect's session Store.
 *
 * @param {object} session - express-session module
 * @returns {Function} SQLiteStore class
 * @api public
 */
module.exports = function (session) {
  const Store = session.Store

  class SQLiteStore extends Store {
    /**
     * Initialize SQLiteStore with the given options.
     *
     * @param {Object} options
     * @param {string} [options.url] - Database path (e.g. './db/sessions.db' or ':memory:')
     * @param {Object} [options.client] - Existing better-sqlite3 Database instance
     * @param {string} [options.table='sessions'] - Table name for sessions
     * @param {string} [options.prefix='sess:'] - Key prefix for session IDs
     * @param {number} [options.ttl=86400] - Default TTL in seconds (1 day)
     * @param {boolean} [options.disableTTL=false] - Disable TTL expiration
     * @param {boolean} [options.disableTouch=false] - Disable touch updates
     * @param {Object} [options.serializer=JSON] - Custom serializer with parse/stringify
     * @param {boolean} [options.wal=true] - Enable WAL mode for better concurrency
     * @api public
     */
    constructor(options = {}) {
      super(options)

      this.prefix = options.prefix == null ? 'sess:' : options.prefix
      this.table = options.table || 'sessions'
      this.ttl = options.ttl || ONE_DAY
      this.disableTTL = options.disableTTL || false
      this.disableTouch = options.disableTouch || false
      this.serializer = options.serializer || JSON

      // Initialize database connection
      if (options.client) {
        // Use provided better-sqlite3 instance
        this.db = options.client
        this._ownDb = false
      } else {
        const dbPath = options.url || ':memory:'

        // Ensure parent directory exists for file-based databases
        if (dbPath !== ':memory:') {
          const dir = path.dirname(dbPath)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
        }

        this.db = new Database(dbPath)
        this._ownDb = true

        // Enable WAL mode for better concurrent access (unless explicitly disabled)
        if (options.wal !== false && dbPath !== ':memory:') {
          this.db.pragma('journal_mode = WAL')
        }
      }

      // Create sessions table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expired INTEGER NOT NULL
        )
      `)

      // Create index on expired for faster cleanup
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_${this.table}_expired
        ON ${this.table} (expired)
      `)

      // Prepare statements for better performance
      this._statements = {
        get: this.db.prepare(`SELECT sess FROM ${this.table} WHERE sid = ? AND expired > ?`),
        set: this.db.prepare(`INSERT OR REPLACE INTO ${this.table} (sid, sess, expired) VALUES (?, ?, ?)`),
        touch: this.db.prepare(`UPDATE ${this.table} SET expired = ? WHERE sid = ? AND expired > ?`),
        destroy: this.db.prepare(`DELETE FROM ${this.table} WHERE sid = ?`),
        length: this.db.prepare(`SELECT COUNT(*) as count FROM ${this.table} WHERE expired > ?`),
        clear: this.db.prepare(`DELETE FROM ${this.table}`),
        all: this.db.prepare(`SELECT sid, sess FROM ${this.table} WHERE expired > ?`),
        ids: this.db.prepare(`SELECT sid FROM ${this.table} WHERE expired > ?`),
        prune: this.db.prepare(`DELETE FROM ${this.table} WHERE expired <= ?`)
      }

      // Initial cleanup of expired sessions
      this._prune()

      // Set up periodic cleanup (every hour)
      this._cleanupInterval = setInterval(() => this._prune(), 3600000)
      this._cleanupInterval.unref()
    }

    /**
     * Get session data by session ID.
     *
     * @param {string} sid - Session ID
     * @param {Function} cb - Callback (err, session)
     * @api public
     */
    get(sid, cb = () => {}) {
      const key = this.prefix + sid
      const now = Date.now()

      try {
        const row = this._statements.get.get(key, now)

        if (!row) {
          return cb(null, null)
        }

        const session = this.serializer.parse(row.sess)
        return cb(null, session)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Set session data for a session ID.
     *
     * @param {string} sid - Session ID
     * @param {Object} sess - Session data
     * @param {Function} cb - Callback (err)
     * @api public
     */
    set(sid, sess, cb = () => {}) {
      const key = this.prefix + sid

      try {
        const ttl = this._getTTL(sess)

        // If TTL is negative or zero, destroy the session instead
        if (ttl <= 0) {
          return this.destroy(sid, cb)
        }

        const expired = Date.now() + (ttl * 1000)
        const value = this.serializer.stringify(sess)

        this._statements.set.run(key, value, expired)
        return cb(null)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Touch (refresh) a session's TTL without modifying data.
     *
     * @param {string} sid - Session ID
     * @param {Object} sess - Session data (used to calculate new TTL)
     * @param {Function} cb - Callback (err)
     * @api public
     */
    touch(sid, sess, cb = () => {}) {
      if (this.disableTouch || this.disableTTL) {
        return cb(null)
      }

      const key = this.prefix + sid
      const now = Date.now()

      try {
        const ttl = this._getTTL(sess)
        const expired = now + (ttl * 1000)

        const result = this._statements.touch.run(expired, key, now)

        if (result.changes === 0) {
          return cb(null, 'EXPIRED')
        }

        return cb(null, 'OK')
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Destroy a session by ID.
     *
     * @param {string} sid - Session ID
     * @param {Function} cb - Callback (err)
     * @api public
     */
    destroy(sid, cb = () => {}) {
      const key = this.prefix + sid

      try {
        const result = this._statements.destroy.run(key)
        return cb(null, result.changes)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Get the count of all active sessions.
     *
     * @param {Function} cb - Callback (err, count)
     * @api public
     */
    length(cb = () => {}) {
      const now = Date.now()

      try {
        const row = this._statements.length.get(now)
        return cb(null, row.count)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Delete all sessions.
     *
     * @param {Function} cb - Callback (err, count)
     * @api public
     */
    clear(cb = () => {}) {
      try {
        const result = this._statements.clear.run()
        return cb(null, result.changes)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Get all active session IDs.
     *
     * @param {Function} cb - Callback (err, ids)
     * @api public
     */
    ids(cb = () => {}) {
      const now = Date.now()
      const prefixLen = this.prefix.length

      try {
        const rows = this._statements.ids.all(now)
        const ids = rows.map(row => row.sid.slice(prefixLen))
        return cb(null, ids)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Get all active sessions with their data.
     *
     * @param {Function} cb - Callback (err, sessions)
     * @api public
     */
    all(cb = () => {}) {
      const now = Date.now()
      const prefixLen = this.prefix.length

      try {
        const rows = this._statements.all.all(now)
        const sessions = rows.map(row => {
          const session = this.serializer.parse(row.sess)
          session.id = row.sid.slice(prefixLen)
          return session
        })
        return cb(null, sessions)
      } catch (err) {
        return cb(err)
      }
    }

    /**
     * Close the database connection.
     * Call this when shutting down to clean up resources.
     *
     * @api public
     */
    close() {
      if (this._cleanupInterval) {
        clearInterval(this._cleanupInterval)
        this._cleanupInterval = null
      }

      if (this._ownDb && this.db) {
        this.db.close()
        this.db = null
      }
    }

    /**
     * Calculate TTL from session cookie or default.
     *
     * @param {Object} sess - Session object
     * @returns {number} TTL in seconds
     * @private
     */
    _getTTL(sess) {
      if (this.disableTTL) {
        return ONE_DAY * 365 // ~1 year if TTL disabled
      }

      if (sess && sess.cookie) {
        // Prefer expires if set (express-session sets this from maxAge)
        if (sess.cookie.expires) {
          const ms = Number(new Date(sess.cookie.expires)) - Date.now()
          return Math.ceil(ms / 1000)
        }
        // Fallback to maxAge if no expires (maxAge is in milliseconds)
        if (sess.cookie.maxAge) {
          return Math.ceil(sess.cookie.maxAge / 1000)
        }
      }

      return this.ttl
    }

    /**
     * Remove expired sessions from database.
     *
     * @private
     */
    _prune() {
      try {
        const now = Date.now()
        this._statements.prune.run(now)
      } catch (err) {
        // Silently ignore prune errors
        console.error('Session prune error:', err.message)
      }
    }
  }

  return SQLiteStore
}
