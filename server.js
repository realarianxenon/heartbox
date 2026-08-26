// ============================================================
//  🏥 HeartBox — سرور کلینیک آنلاین
//  نسخه: نهایی | دیتابیس: SQLite داخلی Node.js (بدون نصب اضافه)
// ============================================================

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------
// 🗄 راه‌اندازی دیتابیس
// ------------------------------------------------------------
const db = new DatabaseSync(path.join(__dirname, 'clinic.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT UNIQUE NOT NULL,
  password      TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'patient',
  medical_id    TEXT,
  specialty     TEXT,
  pharmacy_name TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id    INTEGER PRIMARY KEY,
  age        INTEGER,
  gender     TEXT,
  blood      TEXT,
  weight     REAL,
  height     REAL,
  diseases   TEXT,
  allergies  TEXT,
  address    TEXT,
  emergency  TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  role       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pending',
  doctor_note TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// ------------------------------------------------------------
// 🛠 ابزارهای کمکی
// ------------------------------------------------------------

/** هش رمز عبور */
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/** ساخت توکن نشست */
const newToken = () => crypto.randomBytes(32).toString('hex');

/** پاکسازی ورودی‌ها */
const clean = v => typeof v === 'string' ? v.trim().slice(0, 500) : '';

/** میدل‌ور احراز هویت — هدر لازم: Authorization: Bearer TOKEN */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error:'ابتدا وارد شوید' });

  let sess;
  try {
    sess = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  } catch(e) { console.error(e); }

  if (!sess) return res.status(401).json({ ok:false, error:'نشست منقضی شده، دوباره وارد شوید' });

  req.user = db.prepare(
    'SELECT id, phone, full_name, role, medical_id, specialty, pharmacy_name FROM users WHERE id=?'
  ).get(sess.user_id);

  if (!req.user) return res.status(401).json({ ok:false, error:'کاربر یافت نشد' });
  next();
}

/** ایجاد نشست جدید در جدول sessions */
function createSession(userId, role) {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, role) VALUES (?,?,?)').run(token, userId, role);
  return token;
}

// ============================================================
// 🔐 احراز هویت
// ============================================================

/**
 * POST /api/auth/register
 * بدنه: { phone, password, full_name, role, medical_id?, specialty?, pharmacy_name? }
 */
app.post('/api/auth/register', (req, res) => {
  const { phone, password, full_name, role } = req.body;

  // ✔ اعتبارسنجی
  if (!phone || !/^09\d{9}$/.test(String(phone).trim()))
    return res.json({ ok:false, error:'شماره موبایل معتبر نیست (مثال: 09123456789)' });

  if (!password || String(password).length < 6)
    return res.json({ ok:false, error:'رمز عبور باید حداقل ۶ کاراکتر باشد' });

  if (!full_name || full_name.trim().length < 3)
    return res.json({ ok:false, error:'نام و نام خانوادگی را کامل وارد کنید' });

  const validRoles = ['patient', 'doctor', 'pharmacist'];
  const finalRole  = validRoles.includes(role) ? role : 'patient';

  // ⚕️ پزشک/داروساز باید مدرک بدهد
  let medicalId = null;
  if (finalRole !== 'patient') {
    medicalId = clean(req.body.medical_id);
    if (!medicalId)
      return res.json({
        ok:false,
        error: finalRole === 'doctor' ? 'کد نظام پزشکی الزامی است' : 'شماره پروانه داروسازی الزامی است'
      });
  }

  try {
    const info = db.prepare(`
      INSERT INTO users (phone, password, full_name, role, medical_id, specialty, pharmacy_name)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      clean(phone), hash(password), full_name.trim(), finalRole, medicalId,
      clean(req.body.specialty), clean(req.body.pharmacy_name)
    );

    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(userId);

    const token = createSession(userId, finalRole);
    res.json({ ok:true, token, role:finalRole, name:full_name.trim() });

  } catch(e) {
    if (String(e.message).includes('UNIQUE'))
      return res.json({ ok:false, error:'این شماره قبلاً ثبت شده است' });
    console.error(e);
    res.json({ ok:false, error:'خطای سرور، دوباره تلاش کنید' });
  }
});

/**
 * POST /api/auth/login
 * بدنه: { phone, password }
 */
app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password)
    return res.json({ ok:false, error:'شماره و رمز عبور الزامی است' });

  const user = db.prepare('SELECT * FROM users WHERE phone=? AND password=?')
    .get(clean(phone), hash(password));

  if (!user)
    return res.json({ ok:false, error:'شماره موبایل یا رمز عبور اشتباه است' });

  const token = createSession(user.id, user.role);
  res.json({ ok:true, token, role:user.role, name:user.full_name });
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?')
    .run(req.headers.authorization.slice(7));
  res.json({ ok:true });
});

// ============================================================
// 👤 پروفایل
// ============================================================

/** GET /api/profile — اطلاعات کاربر + پروفایل سلامتی */
app.get('/api/profile', auth, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id=?')
    .get(req.user.id) || {};
  res.json({ ok:true, user:req.user, profile });
});

/** PUT /api/profile — ذخیره پروفایل سلامتی */
app.put('/api/profile', auth, (req, res) => {
  const b = req.body;

  db.prepare(`
    UPDATE profiles SET
      age        = ?,
      gender     = ?,
      blood      = ?,
      weight     = ?,
      height     = ?,
      diseases   = ?,
      allergies  = ?,
      address    = ?,
      emergency  = ?,
      updated_at = datetime('now')
    WHERE user_id = ?
  `).run(
    parseInt(b.age)       || null,
    clean(b.gender),
    clean(b.blood),
    parseFloat(b.weight)  || null,
    parseFloat(b.height)  || null,
    clean(b.diseases),
    clean(b.allergies),
    clean(b.address),
    clean(b.emergency),
    req.user.id
  );

  res.json({ ok:true });
});

/** PUT /api/profile/password — تغییر رمز عبور */
app.put('/api/profile/password', auth, (req, res) => {
  const { old_password, new_password } = req.body;

  const u = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if (!u || u.password !== hash(old_password))
    return res.json({ ok:false, error:'رمز فعلی اشتباه است' });

  if (!new_password || String(new_password).length < 6)
    return res.json({ ok:false, error:'رمز جدید حداقل ۶ کاراکتر باشد' });

  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(new_password), req.user.id);
  res.json({ ok:true });
});

// ============================================================
// 🧾 سفارش‌ها
// ============================================================

/** GET /api/orders — لیست سفارش‌های کاربر جاری */
app.get('/api/orders', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC')
    .all(req.user.id);
  res.json({ ok:true, orders:rows });
});

/** POST /api/orders — ثبت سفارش جدید */
app.post('/api/orders', auth, (req, res) => {
  const { title, description } = req.body;

  if (!title || !title.trim())
    return res.json({ ok:false, error:'عنوان سفارش الزامی است' });

  const info = db.prepare('INSERT INTO orders (user_id, title, description) VALUES (?,?,?)')
    .run(req.user.id, clean(title), clean(description));

  res.json({ ok:true, order:{ id:Number(info.lastInsertRowid), status:'pending' } });
});

/** DELETE /api/orders/:id — حذف سفارش خود کاربر */
app.delete('/api/orders/:id', auth, (req, res) => {
  db.prepare('DELETE FROM orders WHERE id=? AND user_id=?')
    .run(req.params.id, req.user.id);
  res.json({ ok:true });
});

// ============================================================
// 🩺 پنل پزشک / ادمین
// ============================================================

/** GET /api/doctor/patients — همه سفارش‌ها با نام بیمار */
app.get('/api/doctor/patients', auth, (req, res) => {
  if (req.user.role !== 'doctor' && req.user.role !== 'admin')
    return res.status(403).json({ ok:false, error:'دسترسی فقط برای پزشک' });

  const rows = db.prepare(`
    SELECT o.*, u.full_name, u.phone
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC
    LIMIT 200
  `).all();

  res.json({ ok:true, orders:rows });
});

/** PUT /api/doctor/orders/:id — تغییر وضعیت و یادداشت پزشک */
app.put('/api/doctor/orders/:id', auth, (req, res) => {
  if (req.user.role !== 'doctor' && req.user.role !== 'admin')
    return res.status(403).json({ ok:false, error:'دسترسی فقط برای پزشک' });

  if (!['pending','approved','rejected','done'].includes(req.body.status))
    return res.json({ ok:false, error:'وضعیت نامعتبر' });

  db.prepare('UPDATE orders SET status=?, doctor_note=? WHERE id=?')
    .run(req.body.status, clean(req.body.doctor_note), req.params.id);

  res.json({ ok:true });
});

// ============================================================
// 🌐 روت اصلی + مدیریت خطاها + شروع سرور
// ============================================================

// صفحه ورود به‌عنوان صفحه اول سایت
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'auth.html'))
);

// هر مسیر API ناشناخته → 404 JSON
app.use('/api', (req, res) =>
  res.status(404).json({ ok:false, error:'مسیر یافت نشد' })
);

// خطاهای غیرمنتظره → 500 JSON (نه صفحه HTML خطا)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok:false, error:'خطای داخلی سرور' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   🏥 HeartBox روشن شد!                ║');
  console.log(`  ║   🔗 http://localhost:${PORT}          ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
