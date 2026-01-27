# @sailscastshq/connect-sqlite

SQLite session store for Sails.js using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).

## Installation

```bash
npm install @sailscastshq/connect-sqlite
```

## Usage with Sails.js

In your `config/session.js`:

```javascript
module.exports.session = {
  secret: process.env.SESSION_SECRET,
  adapter: '@sailscastshq/connect-sqlite',
  url: 'sqlite:./db/sessions.db',

  cookie: {
    secure: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};
```

### URL Formats

```javascript
// File-based database
url: 'sqlite:./db/sessions.db'
url: 'sqlite:/absolute/path/to/sessions.db'

// In-memory database (for testing)
url: 'sqlite::memory:'

// Or use the db option directly
db: './db/sessions.db'
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `url` | - | SQLite URL (`sqlite:./path/to/db.sqlite` or `sqlite::memory:`) |
| `db` | `:memory:` | Database file path (alternative to url) |
| `client` | - | Existing better-sqlite3 Database instance |
| `table` | `'sessions'` | Table name for sessions |
| `prefix` | `'sess:'` | Key prefix for session IDs |
| `ttl` | `86400` | Default TTL in seconds (1 day) |
| `disableTTL` | `false` | Disable TTL expiration |
| `disableTouch` | `false` | Disable touch updates |
| `serializer` | `JSON` | Custom serializer with `parse`/`stringify` |
| `wal` | `true` | Enable WAL mode for better concurrency |

## API

### Required Methods (Session Store Interface)

- `get(sid, callback)` - Retrieve session by ID
- `set(sid, session, callback)` - Store session data
- `destroy(sid, callback)` - Delete session
- `touch(sid, session, callback)` - Refresh session TTL

### Optional Methods

- `length(callback)` - Get session count
- `clear(callback)` - Delete all sessions
- `ids(callback)` - Get all session IDs
- `all(callback)` - Get all sessions with data
- `close()` - Close database connection

## Features

- **Synchronous SQLite** - Uses better-sqlite3 for fast, synchronous operations
- **WAL Mode** - Enabled by default for better concurrent access
- **Automatic Cleanup** - Expired sessions are pruned hourly
- **Prepared Statements** - Optimized queries for better performance
- **URL Configuration** - Familiar `sqlite:` URL format

## Development

```bash
npm install
npm test
```

## License

MIT
