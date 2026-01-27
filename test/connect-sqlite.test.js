const { test, describe } = require('node:test')
const assert = require('node:assert')
const session = require('express-session')

const SQLiteStore = require('../')(session)

// Promisify helper for callback-based methods
const p = (ctx, method) => (...args) =>
  new Promise((resolve, reject) => {
    ctx[method](...args, (err, data) => {
      if (err) reject(err)
      resolve(data)
    })
  })

describe('SQLiteStore', () => {
  describe('constructor', () => {
    test('uses sensible defaults', () => {
      const store = new SQLiteStore()

      assert.strictEqual(store.prefix, 'sess:', 'defaults to sess: prefix')
      assert.strictEqual(store.table, 'sessions', 'defaults to sessions table')
      assert.strictEqual(store.ttl, 86400, 'defaults to one day TTL')
      assert.strictEqual(store.disableTTL, false, 'TTL enabled by default')
      assert.strictEqual(store.disableTouch, false, 'touch enabled by default')
      assert.strictEqual(store.serializer, JSON, 'defaults to JSON serialization')

      store.close()
    })

    test('accepts url option', () => {
      const store = new SQLiteStore({ url: 'sqlite::memory:' })
      assert.ok(store.db, 'database created from URL')

      store.close()
    })

    test('accepts custom options', () => {
      const store = new SQLiteStore({
        prefix: 'myapp:',
        table: 'my_sessions',
        ttl: 3600,
        disableTouch: true
      })

      assert.strictEqual(store.prefix, 'myapp:', 'custom prefix')
      assert.strictEqual(store.table, 'my_sessions', 'custom table')
      assert.strictEqual(store.ttl, 3600, 'custom TTL')
      assert.strictEqual(store.disableTouch, true, 'touch disabled')

      store.close()
    })
  })

  describe('set and get', () => {
    test('stores and retrieves session data', async () => {
      const store = new SQLiteStore()

      const res = await p(store, 'set')('123', { foo: 'bar' })
      assert.strictEqual(res, undefined, 'set returns undefined on success')

      const sess = await p(store, 'get')('123')
      assert.deepStrictEqual(sess, { foo: 'bar' }, 'get returns session data')

      store.close()
    })

    test('returns null for non-existent session', async () => {
      const store = new SQLiteStore()

      const sess = await p(store, 'get')('nonexistent')
      assert.strictEqual(sess, null, 'returns null for non-existent session')

      store.close()
    })
  })

  describe('TTL handling', () => {
    test('respects cookie.expires', async () => {
      const store = new SQLiteStore()

      const ttl = 60 // 60 seconds
      const expires = new Date(Date.now() + ttl * 1000).toISOString()

      await p(store, 'set')('456', { cookie: { expires } })
      const sess = await p(store, 'get')('456')
      assert.deepStrictEqual(sess, { cookie: { expires } }, 'session saved with expires')

      store.close()
    })

    test('respects cookie.maxAge', async () => {
      const store = new SQLiteStore()

      const maxAge = 60000 // 60 seconds in milliseconds

      await p(store, 'set')('789', { cookie: { maxAge } })
      const sess = await p(store, 'get')('789')
      assert.deepStrictEqual(sess, { cookie: { maxAge } }, 'session saved with maxAge')

      store.close()
    })

    test('destroys session with expired TTL', async () => {
      const store = new SQLiteStore()

      // Set session that expires in the past
      const expires = new Date(Date.now() - 1000).toISOString()
      await p(store, 'set')('expired', { cookie: { expires } })

      // Should not be retrievable (set with negative TTL calls destroy)
      const sess = await p(store, 'get')('expired')
      assert.strictEqual(sess, null, 'expired session returns null')

      store.close()
    })
  })

  describe('touch', () => {
    test('updates session expiration', async () => {
      const store = new SQLiteStore()

      const ttl = 60
      const expires = new Date(Date.now() + ttl * 1000).toISOString()
      await p(store, 'set')('touch-test', { cookie: { expires } })

      // Touch with new expiration
      const newTtl = 120
      const newExpires = new Date(Date.now() + newTtl * 1000).toISOString()
      const res = await p(store, 'touch')('touch-test', { cookie: { expires: newExpires } })
      assert.strictEqual(res, 'OK', 'touch returns OK')

      store.close()
    })

    test('does nothing when disableTouch is true', async () => {
      const store = new SQLiteStore({ disableTouch: true })

      await p(store, 'set')('touch-disabled', { foo: 'bar' })
      const res = await p(store, 'touch')('touch-disabled', {})
      assert.strictEqual(res, undefined, 'touch returns undefined when disabled')

      store.close()
    })
  })

  describe('destroy', () => {
    test('removes session', async () => {
      const store = new SQLiteStore()

      await p(store, 'set')('to-destroy', { foo: 'bar' })
      const res = await p(store, 'destroy')('to-destroy')
      assert.strictEqual(res, 1, 'destroy returns 1 for deleted session')

      const sess = await p(store, 'get')('to-destroy')
      assert.strictEqual(sess, null, 'session no longer exists')

      store.close()
    })
  })

  describe('length', () => {
    test('returns session count', async () => {
      const store = new SQLiteStore()

      await p(store, 'set')('len1', { a: 1 })
      await p(store, 'set')('len2', { b: 2 })

      const count = await p(store, 'length')()
      assert.strictEqual(count, 2, 'length returns correct count')

      store.close()
    })
  })

  describe('clear', () => {
    test('removes all sessions', async () => {
      const store = new SQLiteStore()

      await p(store, 'set')('clear1', { a: 1 })
      await p(store, 'set')('clear2', { b: 2 })
      await p(store, 'set')('clear3', { c: 3 })

      const deleted = await p(store, 'clear')()
      assert.strictEqual(deleted, 3, 'clear returns count of deleted sessions')

      const count = await p(store, 'length')()
      assert.strictEqual(count, 0, 'no sessions remain')

      store.close()
    })
  })

  describe('ids', () => {
    test('returns session IDs without prefix', async () => {
      const store = new SQLiteStore()

      await p(store, 'set')('id-a', { a: 1 })
      await p(store, 'set')('id-b', { b: 2 })

      const ids = await p(store, 'ids')()
      ids.sort()
      assert.deepStrictEqual(ids, ['id-a', 'id-b'], 'ids returns session IDs without prefix')

      store.close()
    })
  })

  describe('all', () => {
    test('returns all sessions with data', async () => {
      const store = new SQLiteStore()

      await p(store, 'set')('all-1', { foo: 'bar' })
      await p(store, 'set')('all-2', { baz: 'qux' })

      const sessions = await p(store, 'all')()
      sessions.sort((a, b) => (a.id > b.id ? 1 : -1))

      assert.strictEqual(sessions.length, 2, 'returns all sessions')
      assert.strictEqual(sessions[0].id, 'all-1', 'first session has correct id')
      assert.strictEqual(sessions[0].foo, 'bar', 'first session has correct data')
      assert.strictEqual(sessions[1].id, 'all-2', 'second session has correct id')
      assert.strictEqual(sessions[1].baz, 'qux', 'second session has correct data')

      store.close()
    })
  })

  describe('custom prefix', () => {
    test('works with custom prefix', async () => {
      const store = new SQLiteStore({ prefix: 'app:sess:' })

      await p(store, 'set')('custom-prefix', { foo: 'bar' })
      const sess = await p(store, 'get')('custom-prefix')
      assert.deepStrictEqual(sess, { foo: 'bar' }, 'works with custom prefix')

      const ids = await p(store, 'ids')()
      assert.deepStrictEqual(ids, ['custom-prefix'], 'ids strips custom prefix')

      store.close()
    })
  })

  describe('URL parsing', () => {
    test('parses sqlite: protocol', () => {
      const store = new SQLiteStore({ url: 'sqlite::memory:' })
      assert.ok(store.db, 'sqlite::memory: works')
      store.close()
    })

    test('accepts direct db path', () => {
      const store = new SQLiteStore({ db: ':memory:' })
      assert.ok(store.db, 'direct path works')
      store.close()
    })
  })

  describe('close', () => {
    test('cleans up resources', async () => {
      const store = new SQLiteStore()

      await p(store, 'set')('close-test', { foo: 'bar' })
      store.close()

      assert.strictEqual(store.db, null, 'database reference cleared')
      assert.strictEqual(store._cleanupInterval, null, 'cleanup interval cleared')
    })
  })

  describe('Sails integration', () => {
    test('works with Sails-style config', async () => {
      // Test with config similar to what Sails passes
      const store = new SQLiteStore({
        adapter: '@sailscastshq/connect-sqlite',
        url: 'sqlite::memory:',
        secret: 'test-secret',
        cookie: {
          secure: true,
          maxAge: 24 * 60 * 60 * 1000
        }
      })

      // These extra options should be ignored gracefully
      await p(store, 'set')('sails-test', { user: 'kelvin' })
      const sess = await p(store, 'get')('sails-test')
      assert.deepStrictEqual(sess, { user: 'kelvin' }, 'works with Sails config')

      store.close()
    })
  })
})
