// SQLite データ層 (Node 22 組み込みの node:sqlite を使用)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'ippo.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
-- 削除したデータの中身をファイル上でゼロで上書きする (緊急データ削除で痕跡を残さないため)
PRAGMA secure_delete = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  reply_to INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  repost_of INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_repost ON posts(user_id, repost_of) WHERE repost_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id);
CREATE INDEX IF NOT EXISTS idx_posts_reply ON posts(reply_to);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followee_id)
);
-- ダイレクトメッセージ (1対1)
CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS idx_dm_recipient ON dm_messages(recipient_id, id);
-- どこまで読んだか (未読数の計算用)
CREATE TABLE IF NOT EXISTS dm_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, peer_id)
);
`);

// コミュニティ
db.exec(`
CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON community_members(user_id);
`);

// 既存のデータベースに列を追加する (すでにあれば何もしない)
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('posts', 'community_id', 'INTEGER REFERENCES communities(id) ON DELETE CASCADE');
addColumn('posts', 'question_day', 'TEXT'); // 今日の質問への回答なら、その日付 (YYYY-MM-DD, 日本時間)
addColumn('posts', 'quote_of', 'INTEGER'); // 引用リポストの元投稿 (元が消えても「削除されました」と出せるよう FK なし)

db.exec(`
CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id, id);
CREATE INDEX IF NOT EXISTS idx_posts_question ON posts(question_day, id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
`);

// 招待制
db.exec(`
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invites_creator ON invites(creator_id);
`);
addColumn('users', 'invited_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'); // 誰の招待で登録したか

// ---------- マイグレーション ----------
// 新しいテーブルはここを通して追加する。適用済みのバージョンは schema_migrations に記録され、二度と実行されない
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
db.migrate = function migrate(version, sql) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) return false;
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log(`[migration] ${version} を適用しました`);
  return true;
};

module.exports = db;
