const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== دیتابیس =====
const Database = require('better-sqlite3');
const db = new Database('heartbox.db');

// ===== ساخت جدول‌ها با try-catch =====
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'patient',
      pending_role TEXT,
      license_no TEXT,
      specialty TEXT,
      age INTEGER,
      blood_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      disease TEXT NOT NULL,
      diagnosed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT,
      category TEXT,
      descr TEXT,
      price INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      note TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'در حال آماده‌سازی',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      medicine_id INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      patient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      doctor TEXT NOT NULL,
      appt_date TEXT,
      time_slot TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'در انتظار تأیید',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor TEXT NOT NULL,
      patient_email TEXT,
      starts_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      emoji TEXT DEFAULT '🩺',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log('✅ دیتابیس آماده شد');
} catch (err) {
  console.error('❌ خطا در دیتابیس:', err.message);
}

// ===== داروهای پیش‌فرض =====
try {
  const existing = db.prepare('SELECT COUNT(*) as c FROM medicines').get();
  if (existing.c === 0) {
    const defaultMeds = [
      { name: 'آسپرین', emoji: '💊', category: 'مسکن', descr: 'کاهش درد و تب', price: 15000 },
      { name: 'ایبوپروفن', emoji: '💊', category: 'مسکن', descr: 'التهاب و درد عضلانی', price: 18000 },
      { name: 'لووتیروکسین', emoji: '💊', category: 'هورمون', descr: 'درمان کم‌کاری تیروئید', price: 25000 },
      { name: 'آموکسی‌سیلین', emoji: '💊', category: 'آنتی‌بیوتیک', descr: 'عفونت‌های باکتریایی', price: 22000 },
      { name: 'آتورواستاتین', emoji: '💊', category: 'چربی خون', descr: 'کاهش کلسترول', price: 32000 },
      { name: 'امپرازول', emoji: '💊', category: 'گوارش', descr: 'رفع سوزش معده', price: 14000 },
      { name: 'لورازپام', emoji: '💊', category: 'اعصاب', descr: 'کاهش اضطراب', price: 28000 },
      { name: 'کتوکونازول', emoji: '💊', category: 'ضد قارچ', descr: 'درمان قارچ پوستی', price: 19000 },
      { name: 'اسپری تنفسی', emoji: '💨', category: 'تنفسی', descr: 'گشادکننده برونش', price: 45000 },
      { name: 'مولتی‌ویتامین', emoji: '💊', category: 'مکمل', descr: 'تقویت عمومی بدن', price: 35000 },
    ];
    const insert = db.prepare('INSERT INTO medicines (name, emoji, category, descr, price) VALUES (?, ?, ?, ?, ?)');
    for (const m of defaultMeds) {
      insert.run(m.name, m.emoji, m.category, m.descr, m.price);
    }
    console.log('✅ داروهای پیش‌فرض اضافه شدند');
  }
} catch (err) {
  console.error('❌ خطا در افزودن داروها:', err.message);
}

// ===== میدل‌ورها =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'heartbox-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ===== فایل‌های استاتیک =====
app.use(express.static('public'));

// ===== آپلود =====
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(png|jpe?g|webp|pdf)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

// ===== توابع کمکی =====
function authUser(req) {
  return req.session.userId || null;
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function respond(res, ok, data = {}) {
  res.json({ ok, ...data });
}

// ===== AUTH =====
app.post('/api/auth/register', (req, res) => {
  const { full_name, phone, password, role_request, license_no, specialty } = req.body;
  if (!full_name || !phone || !password) {
    return respond(res, false, { error: 'همه فیلدها الزامی هستند' });
  }
  if (password.length < 8) {
    return respond(res, false, { error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return respond(res, false, { error: 'این شماره قبلاً ثبت شده است' });
  }

  const role = 'patient';
  const pending = role_request === 'doctor' || role_request === 'pharmacist' ? role_request : null;

  const stmt = db.prepare(`
    INSERT INTO users (full_name, phone, password, role, pending_role, license_no, specialty)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(full_name, phone, password, role, pending, license_no || null, specialty || null);

  req.session.userId = info.lastInsertRowid;
  const user = getUser(info.lastInsertRowid);

  const msg = pending
    ? `✅ ثبت‌نام انجام شد! درخواست شما برای نقش «${pending}» به ادمین ارسال شد.`
    : '🎉 ثبت‌نام موفق! خوش آمدید.';

  respond(res, true, { user, message: msg });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return respond(res, false, { error: 'شماره و رمز عبور الزامی است' });
  }

  const user = db.prepare('SELECT * FROM users WHERE phone = ? AND password = ?').get(phone, password);
  if (!user) {
    return respond(res, false, { error: 'شماره یا رمز عبور اشتباه است' });
  }

  req.session.userId = user.id;
  respond(res, true, { user, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => respond(res, true));
});

app.get('/api/auth/me', (req, res) => {
  const uid = authUser(req);
  if (!uid) return res.status(401).json({ ok: false, error: 'لطفاً وارد شوید' });

  const user = getUser(uid);
  if (!user) return res.status(401).json({ ok: false, error: 'کاربر پیدا نشد' });

  res.json({ ok: true, user });
});

app.post('/api/auth/change-password', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 8) {
    return respond(res, false, { error: 'رمز جدید باید حداقل ۸ کاراکتر باشد' });
  }

  const user = getUser(uid);
  if (user.password !== current_password) {
    return respond(res, false, { error: 'رمز فعلی اشتباه است' });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(new_password, uid);
  respond(res, true, { message: '✅ رمز با موفقیت تغییر کرد' });
});

// ===== پروفایل =====
app.put('/api/profile', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { age, blood_type } = req.body;
  db.prepare('UPDATE users SET age = ?, blood_type = ? WHERE id = ?').run(age || null, blood_type || null, uid);

  const user = getUser(uid);
  respond(res, true, { user, message: '✅ پروفایل ذخیره شد' });
});

// ===== تاریخچه =====
app.get('/api/history', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const history = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY id DESC').all(uid);
  respond(res, true, { history });
});

app.post('/api/history', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { disease, diagnosed_at, notes } = req.body;
  if (!disease) return respond(res, false, { error: 'نام بیماری الزامی است' });

  const stmt = db.prepare('INSERT INTO history (user_id, disease, diagnosed_at, notes) VALUES (?, ?, ?, ?)');
  stmt.run(uid, disease, diagnosed_at || null, notes || null);

  respond(res, true, { message: '✅ اضافه شد' });
});

app.delete('/api/history/:id', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  respond(res, true, { message: '✅ حذف شد' });
});

// ===== داروخانه =====
app.get('/api/medicines', (req, res) => {
  const meds = db.prepare('SELECT * FROM medicines ORDER BY id').all();
  respond(res, true, { medicines: meds });
});

// ===== نسخه =====
app.post('/api/prescriptions', upload.single('file'), (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  if (!req.file) return respond(res, false, { error: 'فایل انتخاب نشده است' });

  const { note } = req.body;
  const stmt = db.prepare('INSERT INTO prescriptions (user_id, filename, note) VALUES (?, ?, ?)');
  stmt.run(uid, req.file.filename, note || null);

  respond(res, true, { message: '✅ نسخه آپلود شد' });
});

app.get('/api/prescriptions', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const pres = db.prepare('SELECT * FROM prescriptions WHERE user_id = ? ORDER BY id DESC').all(uid);
  respond(res, true, { prescriptions: pres });
});

app.get('/api/prescriptions/:id/download', (req, res) => {
  const uid = authUser(req);
  if (!uid) return res.status(401).send('لطفاً وارد شوید');

  const p = db.prepare('SELECT * FROM prescriptions WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!p) return res.status(404).send('فایل پیدا نشد');

  const filePath = path.join(uploadDir, p.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('فایل روی سرور وجود ندارد');

  const inline = req.query.inline === '1';
  res.download(filePath, p.filename, { headers: { 'Content-Disposition': inline ? 'inline' : 'attachment' } });
});

// ===== سفارش‌ها =====
app.get('/api/orders', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(uid);

  for (const o of orders) {
    const items = db.prepare(`
      SELECT m.name, oi.qty FROM order_items oi
      JOIN medicines m ON m.id = oi.medicine_id
      WHERE oi.order_id = ?
    `).all(o.id);
    o.items_pretty = items.map(i => `${i.name} ×${i.qty}`);
  }

  respond(res, true, { orders });
});

app.post('/api/orders', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { items } = req.body;
  if (!items || !items.length) return respond(res, false, { error: 'سبد خرید خالی است' });

  let total = 0;
  const meds = db.prepare('SELECT * FROM medicines WHERE id = ?').all();
  const medMap = {};
  for (const m of meds) medMap[m.id] = m;

  for (const it of items) {
    const m = medMap[it.medicine_id];
    if (!m) return respond(res, false, { error: `دارو با شناسه ${it.medicine_id} وجود ندارد` });
    total += m.price * it.qty;
  }

  const stmt = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)');
  const info = stmt.run(uid, total);
  const orderId = info.lastInsertRowid;

  const insertItem = db.prepare('INSERT INTO order_items (order_id, medicine_id, qty) VALUES (?, ?, ?)');
  for (const it of items) {
    insertItem.run(orderId, it.medicine_id, it.qty);
  }

  respond(res, true, { message: '✅ سفارش ثبت شد', orderId, total });
});

// ===== نوبت‌ها =====
app.post('/api/appointments', (req, res) => {
  const { patient_name, phone, doctor, appt_date, time_slot, notes } = req.body;
  if (!patient_name || !phone || !doctor || !time_slot) {
    return respond(res, false, { error: 'نام، شماره، پزشک و ساعت الزامی است' });
  }

  const uid = authUser(req) || null;

  const conflict = db.prepare(`
    SELECT id FROM appointments
    WHERE doctor = ? AND time_slot = ? AND appt_date = ? AND status != 'رد شده'
  `).get(doctor, time_slot, appt_date || null);

  if (conflict) {
    return respond(res, false, { error: 'این زمان قبلاً رزرو شده است' });
  }

  const stmt = db.prepare(`
    INSERT INTO appointments (user_id, patient_name, phone, doctor, appt_date, time_slot, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(uid, patient_name, phone, doctor, appt_date || null, time_slot, notes || null);

  respond(res, true, { message: '✅ نوبت ثبت شد' });
});

app.get('/api/my-appointments', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const appts = db.prepare(`
    SELECT * FROM appointments WHERE user_id = ? OR phone IN (SELECT phone FROM users WHERE id = ?)
    ORDER BY id DESC
  `).all(uid, uid);

  respond(res, true, { appointments: appts });
});

// ===== سوالات =====
app.post('/api/questions', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { question } = req.body;
  if (!question || question.length < 10) {
    return respond(res, false, { error: 'سوال باید حداقل ۱۰ حرف باشد' });
  }

  const stmt = db.prepare('INSERT INTO questions (user_id, question) VALUES (?, ?)');
  stmt.run(uid, question);

  respond(res, true, { message: '✅ سوال ارسال شد' });
});

app.get('/api/my-questions', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const questions = db.prepare(`
    SELECT q.*,
      a.answer as answer_text,
      a.created_at as answer_created,
      u.full_name as doctor_name
    FROM questions q
    LEFT JOIN answers a ON a.question_id = q.id
    LEFT JOIN users u ON u.id = a.doctor_id
    WHERE q.user_id = ?
    ORDER BY q.id DESC
  `).all(uid);

  const formatted = questions.map(q => ({
    ...q,
    answer: q.answer_text ? {
      answer: q.answer_text,
      doctor_name: q.doctor_name || 'پزشک',
      created_at: q.answer_created
    } : null
  }));

  respond(res, true, { questions: formatted });
});

// ===== مقالات =====
app.post('/api/articles', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { emoji, title, body } = req.body;
  if (!title || !body || body.length < 50) {
    return respond(res, false, { error: 'عنوان و متن کامل (حداقل ۵۰ حرف) الزامی است' });
  }

  const stmt = db.prepare('INSERT INTO articles (author_id, emoji, title, body) VALUES (?, ?, ?, ?)');
  stmt.run(uid, emoji || '🩺', title, body);

  respond(res, true, { message: '✅ مقاله منتشر شد' });
});

app.get('/api/articles', (req, res) => {
  const articles = db.prepare(`
    SELECT a.*, u.full_name as author_name
    FROM articles a
    JOIN users u ON u.id = a.author_id
    ORDER BY a.id DESC
  `).all();

  respond(res, true, { articles });
});

app.get('/api/my-articles', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const articles = db.prepare('SELECT * FROM articles WHERE author_id = ? ORDER BY id DESC').all(uid);
  respond(res, true, { articles });
});

// ===== جلسات =====
app.post('/api/meetings', (req, res) => {
  const { doctor, patient_email, starts_at, duration_min } = req.body;
  if (!doctor || !starts_at) return respond(res, false, { error: 'اطلاعات ناقص است' });

  const stmt = db.prepare('INSERT INTO meetings (doctor, patient_email, starts_at, duration_min) VALUES (?, ?, ?, ?)');
  stmt.run(doctor, patient_email || null, starts_at, parseInt(duration_min) || 30);

  respond(res, true, { message: '✅ جلسه ثبت شد' });
});

app.get('/api/meetings', (req, res) => {
  const meetings = db.prepare('SELECT * FROM meetings ORDER BY id DESC').all();
  respond(res, true, { meetings, count: meetings.length });
});

// ===== صفحه اصلی =====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== راه‌اندازی =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 هارت‌باکس روی پورت ${PORT} اجرا شد!`);
});const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== دیتابیس =====
const Database = require('better-sqlite3');
const db = new Database('heartbox.db');

// ===== ساخت جدول‌ها =====
try {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'patient',
      pending_role TEXT,
      license_no TEXT,
      specialty TEXT,
      age INTEGER,
      blood_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      disease TEXT NOT NULL,
      diagnosed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT,
      category TEXT,
      descr TEXT,
      price INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      note TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'در حال آماده‌سازی',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      medicine_id INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      patient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      doctor TEXT NOT NULL,
      appt_date TEXT,
      time_slot TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'در انتظار تأیید',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor TEXT NOT NULL,
      patient_email TEXT,
      starts_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL,
      emoji TEXT DEFAULT '🩺',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log('✅ دیتابیس آماده شد');
} catch (err) {
  console.error('❌ خطا در دیتابیس:', err.message);
}

// ===== داروهای پیش‌فرض =====
try {
  const existing = db.prepare('SELECT COUNT(*) as c FROM medicines').get();
  if (existing.c === 0) {
    const defaultMeds = [
      { name: 'آسپرین', emoji: '💊', category: 'مسکن', descr: 'کاهش درد و تب', price: 15000 },
      { name: 'ایبوپروفن', emoji: '💊', category: 'مسکن', descr: 'التهاب و درد عضلانی', price: 18000 },
      { name: 'لووتیروکسین', emoji: '💊', category: 'هورمون', descr: 'درمان کم‌کاری تیروئید', price: 25000 },
      { name: 'آموکسی‌سیلین', emoji: '💊', category: 'آنتی‌بیوتیک', descr: 'عفونت‌های باکتریایی', price: 22000 },
      { name: 'آتورواستاتین', emoji: '💊', category: 'چربی خون', descr: 'کاهش کلسترول', price: 32000 },
      { name: 'امپرازول', emoji: '💊', category: 'گوارش', descr: 'رفع سوزش معده', price: 14000 },
      { name: 'لورازپام', emoji: '💊', category: 'اعصاب', descr: 'کاهش اضطراب', price: 28000 },
      { name: 'کتوکونازول', emoji: '💊', category: 'ضد قارچ', descr: 'درمان قارچ پوستی', price: 19000 },
      { name: 'اسپری تنفسی', emoji: '💨', category: 'تنفسی', descr: 'گشادکننده برونش', price: 45000 },
      { name: 'مولتی‌ویتامین', emoji: '💊', category: 'مکمل', descr: 'تقویت عمومی بدن', price: 35000 },
      { name: 'کلسیم + ویتامین D', emoji: '🦴', category: 'مکمل', descr: 'سلامت استخوان‌ها', price: 29000 },
      { name: 'آهن مکمل', emoji: '💊', category: 'مکمل', descr: 'درمان کم‌خونی', price: 21000 },
    ];
    const insert = db.prepare('INSERT INTO medicines (name, emoji, category, descr, price) VALUES (?, ?, ?, ?, ?)');
    for (const m of defaultMeds) {
      insert.run(m.name, m.emoji, m.category, m.descr, m.price);
    }
    console.log('✅ داروهای پیش‌فرض اضافه شدند');
  }
} catch (err) {
  console.error('❌ خطا در افزودن داروها:', err.message);
}

// ===== میدل‌ورها =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'heartbox-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ===== فایل‌های استاتیک =====
app.use(express.static('public'));

// ===== آپلود =====
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(png|jpe?g|webp|pdf)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

// ===== توابع کمکی =====
function authUser(req) {
  return req.session.userId || null;
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function respond(res, ok, data = {}) {
  res.json({ ok, ...data });
}

// ============================================
// 🛡️ AUTH ROUTES
// ============================================

// ثبت‌نام
app.post('/api/auth/register', (req, res) => {
  const { full_name, phone, password, role_request, license_no, specialty } = req.body;
  
  if (!full_name || !phone || !password) {
    return respond(res, false, { error: 'همه فیلدها الزامی هستند' });
  }
  if (password.length < 8) {
    return respond(res, false, { error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return respond(res, false, { error: 'این شماره قبلاً ثبت شده است' });
  }

  const role = 'patient';
  const pending = role_request === 'doctor' || role_request === 'pharmacist' ? role_request : null;

  const stmt = db.prepare(`
    INSERT INTO users (full_name, phone, password, role, pending_role, license_no, specialty)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(full_name, phone, password, role, pending, license_no || null, specialty || null);

  req.session.userId = info.lastInsertRowid;
  const user = getUser(info.lastInsertRowid);

  const msg = pending
    ? `✅ ثبت‌نام انجام شد! درخواست شما برای نقش «${pending}» به ادمین ارسال شد.`
    : '🎉 ثبت‌نام موفق! خوش آمدید.';

  respond(res, true, { user, message: msg });
});

// ورود
app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return respond(res, false, { error: 'شماره و رمز عبور الزامی است' });
  }

  const user = db.prepare('SELECT * FROM users WHERE phone = ? AND password = ?').get(phone, password);
  if (!user) {
    return respond(res, false, { error: 'شماره یا رمز عبور اشتباه است' });
  }

  req.session.userId = user.id;
  respond(res, true, { user, role: user.role });
});

// خروج
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => respond(res, true));
});

// اطلاعات کاربر جاری
app.get('/api/auth/me', (req, res) => {
  const uid = authUser(req);
  if (!uid) return res.status(401).json({ ok: false, error: 'لطفاً وارد شوید' });

  const user = getUser(uid);
  if (!user) return res.status(401).json({ ok: false, error: 'کاربر پیدا نشد' });

  res.json({ ok: true, user });
});

// تغییر رمز عبور
app.post('/api/auth/change-password', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 8) {
    return respond(res, false, { error: 'رمز جدید باید حداقل ۸ کاراکتر باشد' });
  }

  const user = getUser(uid);
  if (user.password !== current_password) {
    return respond(res, false, { error: 'رمز فعلی اشتباه است' });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(new_password, uid);
  respond(res, true, { message: '✅ رمز با موفقیت تغییر کرد' });
});

// ============================================
// 👤 پروفایل
// ============================================
app.put('/api/profile', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { age, blood_type } = req.body;
  db.prepare('UPDATE users SET age = ?, blood_type = ? WHERE id = ?').run(age || null, blood_type || null, uid);

  const user = getUser(uid);
  respond(res, true, { user, message: '✅ پروفایل ذخیره شد' });
});

// ============================================
// 📋 تاریخچه بیماری
// ============================================
app.get('/api/history', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const history = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY id DESC').all(uid);
  respond(res, true, { history });
});

app.post('/api/history', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { disease, diagnosed_at, notes } = req.body;
  if (!disease) return respond(res, false, { error: 'نام بیماری الزامی است' });

  const stmt = db.prepare('INSERT INTO history (user_id, disease, diagnosed_at, notes) VALUES (?, ?, ?, ?)');
  stmt.run(uid, disease, diagnosed_at || null, notes || null);

  respond(res, true, { message: '✅ اضافه شد' });
});

app.delete('/api/history/:id', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  respond(res, true, { message: '✅ حذف شد' });
});

// ============================================
// 💊 داروخانه
// ============================================
app.get('/api/medicines', (req, res) => {
  const meds = db.prepare('SELECT * FROM medicines ORDER BY id').all();
  respond(res, true, { medicines: meds });
});

// ============================================
// 📄 نسخه
// ============================================
app.post('/api/prescriptions', upload.single('file'), (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  if (!req.file) return respond(res, false, { error: 'فایل انتخاب نشده است' });

  const { note } = req.body;
  const stmt = db.prepare('INSERT INTO prescriptions (user_id, filename, note) VALUES (?, ?, ?)');
  stmt.run(uid, req.file.filename, note || null);

  respond(res, true, { message: '✅ نسخه آپلود شد' });
});

app.get('/api/prescriptions', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const pres = db.prepare('SELECT * FROM prescriptions WHERE user_id = ? ORDER BY id DESC').all(uid);
  respond(res, true, { prescriptions: pres });
});

app.get('/api/prescriptions/:id/download', (req, res) => {
  const uid = authUser(req);
  if (!uid) return res.status(401).send('لطفاً وارد شوید');

  const p = db.prepare('SELECT * FROM prescriptions WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!p) return res.status(404).send('فایل پیدا نشد');

  const filePath = path.join(uploadDir, p.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('فایل روی سرور وجود ندارد');

  const inline = req.query.inline === '1';
  res.download(filePath, p.filename, { headers: { 'Content-Disposition': inline ? 'inline' : 'attachment' } });
});

// ============================================
// 🧾 سفارش‌ها
// ============================================
app.get('/api/orders', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(uid);

  for (const o of orders) {
    const items = db.prepare(`
      SELECT m.name, oi.qty FROM order_items oi
      JOIN medicines m ON m.id = oi.medicine_id
      WHERE oi.order_id = ?
    `).all(o.id);
    o.items_pretty = items.map(i => `${i.name} ×${i.qty}`);
  }

  respond(res, true, { orders });
});

app.post('/api/orders', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { items } = req.body;
  if (!items || !items.length) return respond(res, false, { error: 'سبد خرید خالی است' });

  let total = 0;
  const meds = db.prepare('SELECT * FROM medicines WHERE id = ?').all();
  const medMap = {};
  for (const m of meds) medMap[m.id] = m;

  for (const it of items) {
    const m = medMap[it.medicine_id];
    if (!m) return respond(res, false, { error: `دارو با شناسه ${it.medicine_id} وجود ندارد` });
    total += m.price * it.qty;
  }

  const stmt = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)');
  const info = stmt.run(uid, total);
  const orderId = info.lastInsertRowid;

  const insertItem = db.prepare('INSERT INTO order_items (order_id, medicine_id, qty) VALUES (?, ?, ?)');
  for (const it of items) {
    insertItem.run(orderId, it.medicine_id, it.qty);
  }

  respond(res, true, { message: '✅ سفارش ثبت شد', orderId, total });
});

// ============================================
// 📅 نوبت‌ها
// ============================================
app.post('/api/appointments', (req, res) => {
  const { patient_name, phone, doctor, appt_date, time_slot, notes } = req.body;
  if (!patient_name || !phone || !doctor || !time_slot) {
    return respond(res, false, { error: 'نام، شماره، پزشک و ساعت الزامی است' });
  }

  const uid = authUser(req) || null;

  const conflict = db.prepare(`
    SELECT id FROM appointments
    WHERE doctor = ? AND time_slot = ? AND appt_date = ? AND status != 'رد شده'
  `).get(doctor, time_slot, appt_date || null);

  if (conflict) {
    return respond(res, false, { error: 'این زمان قبلاً رزرو شده است' });
  }

  const stmt = db.prepare(`
    INSERT INTO appointments (user_id, patient_name, phone, doctor, appt_date, time_slot, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(uid, patient_name, phone, doctor, appt_date || null, time_slot, notes || null);

  respond(res, true, { message: '✅ نوبت ثبت شد' });
});

app.get('/api/my-appointments', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const appts = db.prepare(`
    SELECT * FROM appointments WHERE user_id = ? OR phone IN (SELECT phone FROM users WHERE id = ?)
    ORDER BY id DESC
  `).all(uid, uid);

  respond(res, true, { appointments: appts });
});

// ============================================
// ❓ پرسش و پاسخ
// ============================================
app.post('/api/questions', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { question } = req.body;
  if (!question || question.length < 10) {
    return respond(res, false, { error: 'سوال باید حداقل ۱۰ حرف باشد' });
  }

  const stmt = db.prepare('INSERT INTO questions (user_id, question) VALUES (?, ?)');
  stmt.run(uid, question);

  respond(res, true, { message: '✅ سوال ارسال شد' });
});

app.get('/api/my-questions', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const questions = db.prepare(`
    SELECT q.*,
      a.answer as answer_text,
      a.created_at as answer_created,
      u.full_name as doctor_name
    FROM questions q
    LEFT JOIN answers a ON a.question_id = q.id
    LEFT JOIN users u ON u.id = a.doctor_id
    WHERE q.user_id = ?
    ORDER BY q.id DESC
  `).all(uid);

  const formatted = questions.map(q => ({
    ...q,
    answer: q.answer_text ? {
      answer: q.answer_text,
      doctor_name: q.doctor_name || 'پزشک',
      created_at: q.answer_created
    } : null
  }));

  respond(res, true, { questions: formatted });
});

// ============================================
// 📝 مقالات
// ============================================
app.post('/api/articles', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const { emoji, title, body } = req.body;
  if (!title || !body || body.length < 50) {
    return respond(res, false, { error: 'عنوان و متن کامل (حداقل ۵۰ حرف) الزامی است' });
  }

  const stmt = db.prepare('INSERT INTO articles (author_id, emoji, title, body) VALUES (?, ?, ?, ?)');
  stmt.run(uid, emoji || '🩺', title, body);

  respond(res, true, { message: '✅ مقاله منتشر شد' });
});

app.get('/api/articles', (req, res) => {
  const articles = db.prepare(`
    SELECT a.*, u.full_name as author_name
    FROM articles a
    JOIN users u ON u.id = a.author_id
    ORDER BY a.id DESC
  `).all();

  respond(res, true, { articles });
});

app.get('/api/my-articles', (req, res) => {
  const uid = authUser(req);
  if (!uid) return respond(res, false, { error: 'لطفاً وارد شوید' });

  const articles = db.prepare('SELECT * FROM articles WHERE author_id = ? ORDER BY id DESC').all(uid);
  respond(res, true, { articles });
});

// ============================================
// 🎥 جلسات
// ============================================
app.post('/api/meetings', (req, res) => {
  const { doctor, patient_email, starts_at, duration_min } = req.body;
  if (!doctor || !starts_at) return respond(res, false, { error: 'اطلاعات ناقص است' });

  const stmt = db.prepare('INSERT INTO meetings (doctor, patient_email, starts_at, duration_min) VALUES (?, ?, ?, ?)');
  stmt.run(doctor, patient_email || null, starts_at, parseInt(duration_min) || 30);

  respond(res, true, { message: '✅ جلسه ثبت شد' });
});

app.get('/api/meetings', (req, res) => {
  const meetings = db.prepare('SELECT * FROM meetings ORDER BY id DESC').all();
  respond(res, true, { meetings, count: meetings.length });
});

// ============================================
// 🏠 صفحه اصلی
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// 🚀 راه‌اندازی سرور
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 هارت‌باکس روی پورت ${PORT} اجرا شد!`);
  console.log(`📍 http://localhost:${PORT}`);
});
