// ============================================================
//  🏥 HeartBox — سرور کلینیک آنلاین (نسخه Railway)
// ============================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.use(express.json());

console.log('🚀 HeartBox در حال راه‌اندازی...');

// ============================================================
// 🗄 دیتابیس
// ============================================================

const DB_PATH = path.join(__dirname, 'clinic.db');
console.log(`📁 مسیر دیتابیس: ${DB_PATH}`);

let db;
try {
  db = new DatabaseSync(DB_PATH);
  console.log('✅ دیتابیس متصل شد');
} catch (err) {
  console.error('❌ خطا در اتصال به دیتابیس:', err.message);
  process.exit(1);
}

// ============================================================
// 📁 ایجاد پوشه uploads
// ============================================================

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('✅ پوشه uploads ایجاد شد');
}

// ============================================================
// 🗄 ایجاد جدول‌ها
// ============================================================

try {
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

CREATE TABLE IF NOT EXISTS history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  disease      TEXT NOT NULL,
  diagnosed_at TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS medicines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL,
  price     INTEGER NOT NULL,
  emoji     TEXT,
  descr     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  filename    TEXT NOT NULL,
  note        TEXT,
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  total       INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'در انتظار پرداخت',
  items       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  patient_name TEXT NOT NULL,
  phone       TEXT NOT NULL,
  doctor      TEXT NOT NULL,
  appt_date   TEXT,
  time_slot   TEXT,
  status      TEXT DEFAULT 'در انتظار تأیید',
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT,
  doctor_id   INTEGER,
  answered_at TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS meetings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor      TEXT NOT NULL,
  patient_email TEXT,
  starts_at   TEXT NOT NULL,
  duration_min INTEGER DEFAULT 30,
  created_at  TEXT DEFAULT (datetime('now'))
);
`);
  console.log('✅ جدول‌ها ایجاد شدند');
} catch (err) {
  console.error('❌ خطا در ایجاد جدول‌ها:', err.message);
  process.exit(1);
}

// ============================================================
// 💊 اضافه کردن داروهای نمونه
// ============================================================

try {
  const meds = db.prepare('SELECT COUNT(*) as c FROM medicines').get();
  if (meds.c === 0) {
    const sampleMeds = [
      ['استامینوفن', 'مسکن', 15000, '💊', 'مسکن و تب‌بر'],
      ['ایبوپروفن', 'مسکن', 22000, '💊', 'ضدالتهاب غیراستروئیدی'],
      ['آموکسی‌سیلین', 'آنتی‌بیوتیک', 35000, '💊', 'آنتی‌بیوتیک پنی‌سیلینی'],
      ['لوزارتان', 'فشار خون', 28000, '💊', 'کاهنده فشار خون'],
      ['آسپرین', 'قلب', 12000, '💊', 'پیشگیری از سکته'],
      ['کتوکونازول', 'ضدقارچ', 45000, '💊', 'کرم ضدقارچ'],
    ];
    const insert = db.prepare('INSERT INTO medicines (name, category, price, emoji, descr) VALUES (?,?,?,?,?)');
    for (const med of sampleMeds) {
      insert.run(...med);
    }
    console.log('✅ داروهای نمونه اضافه شدند');
  }
} catch (err) {
  console.error('⚠️ خطا در اضافه کردن داروها:', err.message);
}

// ============================================================
// 🛠 ابزارهای کمکی
// ============================================================

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const clean = v => typeof v === 'string' ? v.trim().slice(0, 500) : '';

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ ok: false, error: 'ابتدا وارد شوید' });
  }

  try {
    const sess = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
    if (!sess) {
      return res.status(401).json({ ok: false, error: 'نشست منقضی شده' });
    }

    const user = db.prepare(
      'SELECT id, phone, full_name, role, medical_id, specialty, pharmacy_name, created_at FROM users WHERE id=?'
    ).get(sess.user_id);

    if (!user) {
      return res.status(401).json({ ok: false, error: 'کاربر یافت نشد' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('❌ خطا در auth:', err.message);
    return res.status(500).json({ ok: false, error: 'خطای سرور' });
  }
}

function createSession(userId, role) {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, role) VALUES (?,?,?)').run(token, userId, role);
  return token;
}

// ============================================================
// 🔐 احراز هویت
// ============================================================

app.post('/api/auth/register', (req, res) => {
  const { phone, password, full_name, role } = req.body;

  if (!phone || !/^09\d{9}$/.test(String(phone).trim())) {
    return res.json({ ok: false, error: 'شماره موبایل معتبر نیست' });
  }

  if (!password || String(password).length < 6) {
    return res.json({ ok: false, error: 'رمز عبور باید حداقل ۶ کاراکتر باشد' });
  }

  if (!full_name || full_name.trim().length < 3) {
    return res.json({ ok: false, error: 'نام و نام خانوادگی را کامل وارد کنید' });
  }

  const validRoles = ['patient', 'doctor', 'pharmacist'];
  const finalRole = validRoles.includes(role) ? role : 'patient';

  try {
    const info = db.prepare(`
      INSERT INTO users (phone, password, full_name, role, medical_id, specialty, pharmacy_name)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      clean(phone), hash(password), full_name.trim(), finalRole,
      clean(req.body.medical_id), clean(req.body.specialty), clean(req.body.pharmacy_name)
    );

    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(userId);

    const token = createSession(userId, finalRole);
    res.json({ ok: true, token, role: finalRole, name: full_name.trim() });

  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.json({ ok: false, error: 'این شماره قبلاً ثبت شده است' });
    }
    console.error(e);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.json({ ok: false, error: 'شماره و رمز عبور الزامی است' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE phone=? AND password=?')
      .get(clean(phone), hash(password));

    if (!user) {
      return res.json({ ok: false, error: 'شماره موبایل یا رمز عبور اشتباه است' });
    }

    const token = createSession(user.id, user.role);
    res.json({ ok: true, token, role: user.role, name: user.full_name });
  } catch (err) {
    console.error('❌ خطا در لاگین:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/auth/logout', auth, (req, res) => {
  try {
    db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در خروج:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { current_password, new_password } = req.body;

  try {
    const u = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
    if (!u || u.password !== hash(current_password)) {
      return res.json({ ok: false, error: 'رمز فعلی اشتباه است' });
    }

    if (!new_password || String(new_password).length < 8) {
      return res.json({ ok: false, error: 'رمز جدید حداقل ۸ کاراکتر باشد' });
    }

    db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(new_password), req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در تغییر رمز:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 👤 پروفایل
// ============================================================

app.get('/api/profile', auth, (req, res) => {
  try {
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id) || {};
    res.json({ ok: true, user: req.user, profile });
  } catch (err) {
    console.error('❌ خطا در دریافت پروفایل:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.put('/api/profile', auth, (req, res) => {
  try {
    const b = req.body;
    db.prepare(`
      UPDATE profiles SET
        age = ?,
        blood = ?,
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      parseInt(b.age) || null,
      clean(b.blood_type),
      req.user.id
    );
    
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json({ ok: true, user });
  } catch (err) {
    console.error('❌ خطا در ذخیره پروفایل:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 📋 تاریخچه بیماری
// ============================================================

app.get('/api/history', auth, (req, res) => {
  try {
    const history = db.prepare('SELECT * FROM history WHERE user_id=? ORDER BY id DESC').all(req.user.id);
    res.json({ ok: true, history });
  } catch (err) {
    console.error('❌ خطا در دریافت تاریخچه:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/history', auth, (req, res) => {
  const { disease, diagnosed_at, notes } = req.body;
  if (!disease || !disease.trim()) {
    return res.json({ ok: false, error: 'نام بیماری الزامی است' });
  }
  try {
    db.prepare('INSERT INTO history (user_id, disease, diagnosed_at, notes) VALUES (?,?,?,?)')
      .run(req.user.id, clean(disease), clean(diagnosed_at), clean(notes));
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در افزودن تاریخچه:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.delete('/api/history/:id', auth, (req, res) => {
  try {
    db.prepare('DELETE FROM history WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در حذف تاریخچه:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 🛒 داروخانه
// ============================================================

app.get('/api/medicines', auth, (req, res) => {
  try {
    const medicines = db.prepare('SELECT * FROM medicines ORDER BY id').all();
    res.json({ ok: true, medicines });
  } catch (err) {
    console.error('❌ خطا در دریافت داروها:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 📄 نسخه پزشک
// ============================================================

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ext);
  }
});
const upload = multer({ 
  storage, 
  limits: { fileSize: 5 * 1024 * 1024 } 
});

app.post('/api/prescriptions', auth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.json({ ok: false, error: 'فایل نسخه را انتخاب کنید' });
  }

  try {
    db.prepare('INSERT INTO prescriptions (user_id, filename, note) VALUES (?,?,?)')
      .run(req.user.id, req.file.filename, clean(req.body.note));
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در آپلود نسخه:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.get('/api/prescriptions', auth, (req, res) => {
  try {
    const prescriptions = db.prepare('SELECT * FROM prescriptions WHERE user_id=? ORDER BY id DESC').all(req.user.id);
    res.json({ ok: true, prescriptions });
  } catch (err) {
    console.error('❌ خطا در دریافت نسخه‌ها:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.get('/api/prescriptions/:id/download', auth, (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM prescriptions WHERE id=? AND user_id=?')
      .get(req.params.id, req.user.id);
    
    if (!p) {
      return res.status(404).json({ ok: false, error: 'نسخه یافت نشد' });
    }

    const filePath = path.join(uploadDir, p.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'فایل وجود ندارد' });
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('❌ خطا در دانلود نسخه:', err.message);
    res.status(500).json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 🧾 سفارش‌ها
// ============================================================

app.get('/api/orders', auth, (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
    res.json({ ok: true, orders });
  } catch (err) {
    console.error('❌ خطا در دریافت سفارش‌ها:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/orders', auth, (req, res) => {
  const { items } = req.body;
  if (!items || !items.length) {
    return res.json({ ok: false, error: 'سبد خرید خالی است' });
  }

  try {
    let total = 0;
    const itemsPretty = [];
    for (const item of items) {
      const med = db.prepare('SELECT name, price FROM medicines WHERE id=?').get(item.medicine_id);
      if (med) {
        total += med.price * item.qty;
        itemsPretty.push(`${med.name} (×${item.qty})`);
      }
    }

    const info = db.prepare('INSERT INTO orders (user_id, total, items, status) VALUES (?,?,?,?)')
      .run(req.user.id, total, JSON.stringify(itemsPretty), 'در انتظار پرداخت');

    res.json({ ok: true, message: 'سفارش ثبت شد', total, order_id: Number(info.lastInsertRowid) });
  } catch (err) {
    console.error('❌ خطا در ثبت سفارش:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 📅 نوبت‌ها
// ============================================================

app.get('/api/my-appointments', auth, (req, res) => {
  try {
    const appointments = db.prepare('SELECT * FROM appointments WHERE user_id=? ORDER BY id DESC').all(req.user.id);
    res.json({ ok: true, appointments });
  } catch (err) {
    console.error('❌ خطا در دریافت نوبت‌ها:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/appointments', (req, res) => {
  const { patient_name, phone, doctor, appt_date, time_slot, notes } = req.body;

  if (!patient_name || !phone || !doctor || !time_slot) {
    return res.json({ ok: false, error: 'تمامی فیلدهای الزامی را پر کنید' });
  }

  try {
    const user = db.prepare('SELECT id FROM users WHERE phone=?').get(clean(phone));
    const userId = user ? user.id : null;

    db.prepare(`
      INSERT INTO appointments (user_id, patient_name, phone, doctor, appt_date, time_slot, notes)
      VALUES (?,?,?,?,?,?,?)
    `).run(userId, clean(patient_name), clean(phone), clean(doctor), clean(appt_date), clean(time_slot), clean(notes));

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در ثبت نوبت:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// ❓ سوالات پزشکی
// ============================================================

app.get('/api/my-questions', auth, (req, res) => {
  try {
    const questions = db.prepare('SELECT * FROM questions WHERE user_id=? ORDER BY id DESC').all(req.user.id);
    res.json({ ok: true, questions });
  } catch (err) {
    console.error('❌ خطا در دریافت سوالات:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/questions', auth, (req, res) => {
  const { question } = req.body;
  if (!question || question.trim().length < 10) {
    return res.json({ ok: false, error: 'سوال باید حداقل ۱۰ حرف باشد' });
  }
  try {
    db.prepare('INSERT INTO questions (user_id, question) VALUES (?,?)')
      .run(req.user.id, clean(question));
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در ثبت سوال:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 🎥 جلسات
// ============================================================

app.get('/api/meetings', (req, res) => {
  try {
    const meetings = db.prepare('SELECT * FROM meetings ORDER BY id DESC').all();
    res.json({ ok: true, meetings, count: meetings.length });
  } catch (err) {
    console.error('❌ خطا در دریافت جلسات:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

app.post('/api/meetings', (req, res) => {
  const { doctor, patient_email, starts_at, duration_min } = req.body;
  try {
    db.prepare('INSERT INTO meetings (doctor, patient_email, starts_at, duration_min) VALUES (?,?,?,?)')
      .run(clean(doctor), clean(patient_email), clean(starts_at), parseInt(duration_min) || 30);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطا در ثبت جلسه:', err.message);
    res.json({ ok: false, error: 'خطای سرور' });
  }
});

// ============================================================
// 🌐 استاتیک فایل‌ها
// ============================================================

// سرویس فایل‌های استاتیک از پوشه public
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 🌐 روت اصلی
// ============================================================

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.use('/api', (req, res) =>
  res.status(404).json({ ok: false, error: 'مسیر یافت نشد' })
);

app.use((err, req, res, next) => {
  console.error('❌ خطای سرور:', err);
  res.status(500).json({ ok: false, error: 'خطای داخلی سرور' });
});

// ============================================================
// 🚀 شروع سرور
// ============================================================

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   🏥 HeartBox روشن شد!                ║');
  console.log(`  ║   🔗 http://localhost:${PORT}          ║`);
  console.log(`  ║   📁 DB: ${DB_PATH}                    ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});

server.on('error', (err) => {
  console.error('❌ خطای سرور:', err.message);
  process.exit(1);
});
