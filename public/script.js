// ⏰ ساعت زنده
setInterval(() => {
  const now = new Date().toLocaleTimeString("fa-IR");
  document.getElementById("liveClock").textContent = "🕐 " + now;
}, 1000);
// 📅 ساخت منوی ۶ روز آینده با تقویم شمسی
(function fillDateSelect() {
  const sel = document.getElementById("dateSelect");
  if (!sel) return;

  const fmt = new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const todayFmt = new Intl.DateTimeFormat("fa-IR", {
    day: "numeric",
    month: "long",
  });

  const today = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    // مقدار ذخیره‌شده: میلادی استاندارد برای دیتابیس
    const iso =
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0");

    // برچسب نمایشی: شمسی
    let label = fmt.format(d);
    if (i === 0) label += " (امروز)";
    if (i === 1) label = "فردا — " + label;

    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${iso}">${label}</option>`,
    );
  }
})();

// 📜 اسکرول نرم به بخش رزرو
function scrollToBooking() {
  document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
}

// 👨‍⚕️ انتخاب پزشک از روی کارت + کانفتی
// 👨‍⚕️ رفتن به پنل اختصاصی پزشک
function openPanel(id) {
  location.href = "doctor.html?doc=" + id;
}

// 🎉 افکت کانفتی ساده
function confetti() {
  const colors = ["#ff4757", "#ffa502", "#2ed573", "#1e90ff", "#a55eea"];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.style.cssText = `
      position:fixed; z-index:999; pointer-events:none;
      width:12px; height:12px; top:-15px;
      left:${Math.random() * 100}vw;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      border-radius:${Math.random() > 0.5 ? "50%" : "3px"};
      transition:transform 3s linear, opacity 3s;
    `;
    document.body.appendChild(piece);
    requestAnimationFrame(() => {
      piece.style.transform = `translateY(${window.innerHeight + 40}px) rotate(${Math.random() * 720}deg)`;
      piece.style.opacity = "0";
    });
    setTimeout(() => piece.remove(), 3200);
  }
}

// 🔢 شمارنده آمار
document.querySelectorAll(".stat-card b").forEach((el) => {
  const target = +el.dataset.count;
  let current = 0;
  const step = Math.ceil(target / 60);
  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }
    el.textContent = current.toLocaleString("fa-IR") + "+";
  }, 30);
});

// 📋 ارسال فرم به سرور پایتون
document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = {
    patient_name: document.getElementById("patientName").value,
    phone: document.getElementById("phone").value,
    doctor: document.getElementById("doctorSelect").value,
    time_slot: document.getElementById("timeSlot").value,
    appt_date: document.getElementById("dateSelect").value,
    notes: document.getElementById("notes").value,
  };

  try {
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!result.ok) {
      // ⛔ مثلاً ساعت قبلاً رزرو شده
      alert("⚠️ " + result.error);
      return;
    }
    if (!result.ok) {
      // ⛔ مثلاً ساعت قبلاً رزرو شده
      alert("⚠️ " + result.error);
      return;
    }
    console.log("✅ پاسخ سرور:", result);

    // نمایش پیام موفقیت + کانفتی
    document.getElementById("successMsg").classList.remove("hidden");
    confetti();
    e.target.reset();

    setTimeout(
      () => document.getElementById("successMsg").classList.add("hidden"),
      5000,
    );
  } catch (err) {
    alert("⚠️ خطا در ارتباط با سرور! مطمئن شوید app.py اجرا است.");
    console.error(err);
  }
});
// 👤 بررسی وضعیت لاگین + پیش‌پر کردن فرم رزرو
(async () => {
  try {
    const r = await fetch("/api/auth/me");
    if (!r.ok) return;
    const u = (await r.json()).user;
    document.getElementById("authBox").classList.add("hidden");
    document.getElementById("userChip").classList.remove("hidden");
    document.getElementById("userGreet").textContent =
      "سلام " + u.full_name + " 👋";

    // 🆕 پیش‌پر کردن فرم رزرو با اطلاعات حساب
    const pn = document.getElementById("patientName");
    const ph = document.getElementById("phone");
    if (pn && !pn.value) pn.value = u.full_name;
    if (ph && !ph.value) ph.value = u.phone;
  } catch (e) {}
})();
