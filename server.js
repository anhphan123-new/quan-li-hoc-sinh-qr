const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'people.sqlite');
const ACCESS_USER = process.env.ACCESS_USER || 'admin';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

if (!ACCESS_PASSWORD) {
  console.error('Thiếu ACCESS_PASSWORD. Hãy đặt biến môi trường này trước khi chạy máy chủ.');
  process.exit(1);
}

require('fs').mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    consent INTEGER NOT NULL CHECK(consent = 1),
    registeredAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    time TEXT NOT NULL
  );
`);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Quan ly nguoi di qua", charset="UTF-8"');
    return res.status(401).send('Cần đăng nhập để truy cập hệ thống.');
  }
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch (_) {}
  const splitAt = decoded.indexOf(':');
  const user = splitAt >= 0 ? decoded.slice(0, splitAt) : '';
  const password = splitAt >= 0 ? decoded.slice(splitAt + 1) : '';
  if (user !== ACCESS_USER || password !== ACCESS_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Quan ly nguoi di qua", charset="UTF-8"');
    return res.status(401).send('Tên đăng nhập hoặc mật khẩu không đúng.');
  }
  next();
});
app.use(express.json({ limit: '2mb' }));

function readPeople() {
  const rows = db.prepare('SELECT * FROM people ORDER BY registeredAt').all();
  const getVisits = db.prepare('SELECT time FROM visits WHERE person_id = ? ORDER BY id');
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    note: row.note,
    consent: row.consent === 1,
    registeredAt: row.registeredAt,
    visits: getVisits.all(row.id).map(v => ({ time: v.time }))
  }));
}

app.get('/api/people', (req, res) => {
  try { res.json({ version: 1, people: readPeople() }); }
  catch (_) { res.status(500).json({ error: 'Không thể đọc dữ liệu.' }); }
});

app.put('/api/people', (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.people) || data.people.length > 10000) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  }
  const valid = data.people.every(p =>
    p && typeof p.id === 'string' && p.id.length <= 100 &&
    typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 100 &&
    typeof p.contact === 'string' && p.contact.length <= 80 &&
    typeof p.note === 'string' && p.note.length <= 300 &&
    p.consent === true && typeof p.registeredAt === 'string' &&
    Array.isArray(p.visits) && p.visits.every(v => v && typeof v.time === 'string')
  );
  if (!valid) return res.status(400).json({ error: 'Bản ghi không hợp lệ.' });

  const replaceAll = db.transaction(people => {
    db.prepare('DELETE FROM people').run();
    const insertPerson = db.prepare(`
      INSERT INTO people (id, name, contact, note, consent, registeredAt)
      VALUES (@id, @name, @contact, @note, 1, @registeredAt)
    `);
    const insertVisit = db.prepare('INSERT INTO visits (person_id, time) VALUES (?, ?)');
    for (const p of people) {
      insertPerson.run({
        id: p.id, name: p.name.trim(), contact: p.contact,
        note: p.note, registeredAt: p.registeredAt
      });
      for (const visit of p.visits) insertVisit.run(p.id, visit.time);
    }
  });
  try {
    replaceAll(data.people);
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: 'Không thể lưu dữ liệu.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quản lý người đi qua đang chạy tại http://localhost:${PORT}`);
});
