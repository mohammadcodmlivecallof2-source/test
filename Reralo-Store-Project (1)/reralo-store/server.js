require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcryptjs");
const db = require("./src/db");

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";
const dataDir = path.resolve("./data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn("WARNING: Set SESSION_SECRET to a random string of at least 32 characters before deployment.");
}
if (isProd) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://plus.unsplash.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(session({
  name: "reralo.sid",
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir, table: "sessions" }),
  secret: process.env.SESSION_SECRET || "development-only-change-me-please-0000000000",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/api/orders", rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false }));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v, max = 250) => String(v ?? "").trim().slice(0, max);
const toman = n => new Intl.NumberFormat("fa-IR").format(Number(n) || 0);
const validPhone = s => /^09\d{9}$/.test(s);
const validPostal = s => /^\d{10}$/.test(s);

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ error: "برای ادامه وارد پنل مدیریت شوید." });
  next();
}
function safeProduct(p) {
  return {
    id: p.id, name: p.name, category: p.category, description: p.description,
    price: p.price, oldPrice: p.old_price, image: p.image, images: JSON.parse(p.images || "[]"),
    colors: JSON.parse(p.colors || "[]"), sizes: JSON.parse(p.sizes || "[]"),
    stock: p.stock, isNew: !!p.is_new, isBestSeller: !!p.is_best_seller
  };
}
function orderCode() {
  return "RR-" + new Date().getFullYear() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}
function insertSeedProducts() {
  if (db.prepare("SELECT COUNT(*) n FROM products").get().n) return;
  const seed = [
    ["تی‌شرت Essential مشکی","تی‌شرت","تی‌شرت مینیمال با برش استاندارد و پارچه نرم روزمره.",890000,1090000,"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=85",["مشکی","سفید","طوسی"],["S","M","L","XL","XXL"],28,1,1],
    ["پیراهن Oxford آبی","پیراهن","پیراهن آکسفورد خوش‌فرم برای استایل روزمره و نیمه‌رسمی.",1490000,1690000,"https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=85",["آبی تیره","سفید"],["M","L","XL","XXL"],16,1,1],
    ["شلوار کژوال ذغالی","شلوار","فرم مدرن با پارچه راحت و مناسب استفاده روزانه.",1790000,0,"https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=85",["ذغالی","مشکی"],["30","32","34","36","38"],12,0,1],
    ["هودی Core سرمه‌ای","هودی","هودی گرم و مینیمال با جزئیات ساده و کاربردی.",2190000,2490000,"https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=85",["سرمه‌ای","طوسی"],["M","L","XL","XXL"],20,1,0],
    ["کت روزمره مشکی","کت","لایه‌ای شیک برای استایل شهری و موقعیت‌های خاص.",3290000,0,"https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=85",["مشکی"],["M","L","XL"],7,0,1],
    ["اکسسوری چرمی","اکسسوری","جزئیات ساده برای کامل کردن استایل روزانه.",590000,690000,"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85",["مشکی","قهوه‌ای"],["Free"],32,1,0]
  ];
  const stmt = db.prepare(`INSERT INTO products(name,category,description,price,old_price,image,images,colors,sizes,stock,is_new,is_best_seller,active,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`);
  for (const p of seed) {
    const [name,cat,desc,price,old,image,colors,sizes,stock,isNew,best] = p;
    stmt.run(name,cat,desc,price,old,image,JSON.stringify([image]),JSON.stringify(colors),JSON.stringify(sizes),stock,isNew,best);
  }
}
insertSeedProducts();

app.get("/api/health", (req, res) => res.json({ ok: true, service: "Reralo Store" }));
app.get("/api/products", (req, res) => {
  const rows = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY is_best_seller DESC, is_new DESC, id DESC").all();
  res.json(rows.map(safeProduct));
});
app.get("/api/products/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "محصول پیدا نشد." });
  res.json(safeProduct(row));
});

app.post("/api/orders", asyncRoute(async (req, res) => {
  const b = req.body || {};
  const customer = {
    name: clean(b.name, 100), phone: clean(b.phone, 11),
    province: clean(b.province, 80), city: clean(b.city, 80),
    address: clean(b.address, 600), postalCode: clean(b.postalCode, 10),
    notes: clean(b.notes, 800)
  };
  if (customer.name.length < 3 || !validPhone(customer.phone) || !customer.province || !customer.city ||
      customer.address.length < 10 || !validPostal(customer.postalCode)) {
    return res.status(400).json({ error: "لطفاً نام، شماره موبایل، استان، شهر، آدرس کامل و کد پستی ۱۰ رقمی را درست وارد کنید." });
  }
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) {
    return res.status(400).json({ error: "سبد خرید خالی یا نامعتبر است." });
  }
  const items = [];
  let subtotal = 0;
  const getProduct = db.prepare("SELECT * FROM products WHERE id=? AND active=1");
  for (const item of b.items) {
    const id = Number(item.productId), qty = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 10) return res.status(400).json({ error: "تعداد محصول نامعتبر است." });
    const p = getProduct.get(id);
    if (!p || p.stock < qty) return res.status(409).json({ error: `موجودی «${p?.name || "محصول"}» کافی نیست.` });
    const colors = JSON.parse(p.colors || "[]"), sizes = JSON.parse(p.sizes || "[]");
    const color = clean(item.color, 40), size = clean(item.size, 20);
    if (!colors.includes(color) || !sizes.includes(size)) return res.status(400).json({ error: "رنگ یا سایز انتخاب‌شده معتبر نیست." });
    const lineTotal = p.price * qty;
    subtotal += lineTotal;
    items.push({ productId: p.id, name: p.name, price: p.price, quantity: qty, color, size, lineTotal });
  }
  const shipping = Number(process.env.SHIPPING_FEE_TOMAN || 75000);
  const total = subtotal + shipping;
  const code = orderCode();
  const now = new Date().toISOString();
  const createOrder = db.transaction(() => {
    const result = db.prepare(`INSERT INTO orders(code,customer_name,phone,province,city,address,postal_code,notes,subtotal,shipping,total,status,created_at,telegram_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'new',?,'pending')`)
      .run(code,customer.name,customer.phone,customer.province,customer.city,customer.address,customer.postalCode,customer.notes,subtotal,shipping,total,now);
    const orderId = result.lastInsertRowid;
    const insertItem = db.prepare("INSERT INTO order_items(order_id,product_id,product_name,price,quantity,color,size,line_total) VALUES(?,?,?,?,?,?,?,?)");
    const decrement = db.prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?");
    for (const item of items) {
      insertItem.run(orderId,item.productId,item.name,item.price,item.quantity,item.color,item.size,item.lineTotal);
      const changed = decrement.run(item.quantity,item.productId,item.quantity);
      if (!changed.changes) throw new Error("موجودی محصول در همین لحظه تغییر کرده است؛ دوباره تلاش کنید.");
    }
    return orderId;
  });
  let orderId;
  try { orderId = createOrder(); }
  catch (e) { return res.status(409).json({ error: e.message || "ثبت سفارش انجام نشد." }); }

  const order = { id: orderId, code, ...customer, items, subtotal, shipping, total, status: "new", createdAt: now };
  let telegramSent = false;
  try {
    await sendTelegram(order);
    db.prepare("UPDATE orders SET telegram_status='sent',telegram_error=NULL WHERE id=?").run(orderId);
    telegramSent = true;
  } catch (e) {
    db.prepare("UPDATE orders SET telegram_status='failed',telegram_error=? WHERE id=?").run(clean(e.message,500),orderId);
  }
  res.status(201).json({ ok: true, code, createdAt: now, total, telegramSent, message: "سفارش شما ثبت شد. کد پیگیری را نگه دارید." });
}));

async function sendTelegram(o) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error("TELEGRAM_BOT_TOKEN یا TELEGRAM_CHAT_ID تنظیم نشده است.");
  const lines = [
    "🛍 سفارش جدید Reralo",
    `کد پیگیری: ${o.code}`,
    `نام: ${o.customer_name || o.name}`,
    `موبایل: ${o.phone}`,
    `استان/شهر: ${(o.province || "")} / ${(o.city || "")}`,
    `آدرس: ${o.address}`,
    `کد پستی: ${o.postal_code || o.postalCode}`,
    "",
    "محصولات:",
    ...o.items.map(i => `• ${i.name} | سایز ${i.size} | رنگ ${i.color} | تعداد ${i.quantity} | ${toman(i.lineTotal)} تومان`),
    "",
    `مبلغ کالاها: ${toman(o.subtotal)} تومان`,
    `هزینه ارسال: ${toman(o.shipping)} تومان`,
    `مبلغ کل: ${toman(o.total)} تومان`,
    `توضیحات: ${o.notes || "ندارد"}`,
    `تاریخ سفارش: ${new Date(o.created_at || o.createdAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}`
  ];
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: lines.join("\n"), disable_web_page_preview: true })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram HTTP ${response.status}`);
}

app.get("/api/orders/track/:code", (req, res) => {
  const code = clean(req.params.code, 40).toUpperCase();
  const order = db.prepare("SELECT code,status,created_at,postal_tracking FROM orders WHERE code=?").get(code);
  if (!order) return res.status(404).json({ error: "سفارشی با این کد پیدا نشد." });
  const items = db.prepare("SELECT product_name,quantity,color,size FROM order_items WHERE order_id=(SELECT id FROM orders WHERE code=?)").all(code);
  res.json({ ...order, items });
});

app.post("/api/admin/login", rateLimit({ windowMs: 15*60*1000, limit: 8 }), asyncRoute(async (req,res) => {
  const username = clean(req.body?.username,100);
  const password = String(req.body?.password || "");
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  const expectedPlain = process.env.ADMIN_PASSWORD;
  const passOk = expectedHash ? await bcrypt.compare(password, expectedHash) : (expectedPlain && password === expectedPlain && !isProd);
  if (username !== expectedUser || !passOk) return res.status(401).json({ error: "نام کاربری یا رمز عبور اشتباه است." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "ورود ناموفق بود." });
    req.session.admin = { username };
    res.json({ ok: true, username });
  });
}));
app.post("/api/admin/logout", (req,res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/me", (req,res) => res.json({ authenticated: !!req.session.admin, username: req.session.admin?.username || null }));

app.get("/api/admin/orders", requireAdmin, (req,res) => {
  const q = `%${clean(req.query.q,100)}%`;
  const rows = db.prepare(`SELECT id,code,customer_name,phone,total,status,created_at,telegram_status,postal_tracking
    FROM orders WHERE code LIKE ? OR customer_name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 500`).all(q,q,q);
  res.json(rows);
});
app.get("/api/admin/orders/:id", requireAdmin, (req,res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: "سفارش پیدا نشد." });
  o.items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(o.id);
  res.json(o);
});
app.patch("/api/admin/orders/:id", requireAdmin, (req,res) => {
  const statuses = ["new","confirmed","preparing","shipped","delivered","cancelled"];
  const status = clean(req.body?.status,30);
  const tracking = clean(req.body?.postalTracking,80);
  if (!statuses.includes(status)) return res.status(400).json({ error: "وضعیت نامعتبر است." });
  const result = db.prepare("UPDATE orders SET status=?,postal_tracking=? WHERE id=?").run(status,tracking,Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "سفارش پیدا نشد." });
  res.json({ ok: true });
});
app.post("/api/admin/orders/:id/resend-telegram", requireAdmin, asyncRoute(async (req,res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: "سفارش پیدا نشد." });
  o.items = db.prepare("SELECT product_name name,price,quantity,color,size,line_total lineTotal FROM order_items WHERE order_id=?").all(o.id);
  try {
    await sendTelegram(o);
    db.prepare("UPDATE orders SET telegram_status='sent',telegram_error=NULL WHERE id=?").run(o.id);
    res.json({ ok: true });
  } catch(e) {
    db.prepare("UPDATE orders SET telegram_status='failed',telegram_error=? WHERE id=?").run(clean(e.message,500),o.id);
    res.status(502).json({ error: "ارسال تلگرام ناموفق بود: " + clean(e.message,200) });
  }
}));
app.get("/api/admin/stats", requireAdmin, (req,res) => {
  const count = db.prepare("SELECT COUNT(*) n FROM orders").get().n;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='cancelled'").get().n;
  const pending = db.prepare("SELECT COUNT(*) n FROM orders WHERE status='new'").get().n;
  const products = db.prepare("SELECT COUNT(*) n FROM products WHERE active=1").get().n;
  res.json({ count, revenue, pending, products });
});
app.get("/api/admin/products", requireAdmin, (req,res) => res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all().map(safeProduct)));
app.post("/api/admin/products", requireAdmin, (req,res) => {
  const b = req.body || {};
  const name=clean(b.name,150), category=clean(b.category,60), description=clean(b.description,1000), image=clean(b.image,1000);
  const price=Number(b.price), stock=Number(b.stock);
  if (!name || !category || !image.startsWith("https://") || !Number.isInteger(price) || price<1 || !Number.isInteger(stock) || stock<0) return res.status(400).json({error:"اطلاعات محصول نامعتبر است."});
  const id = db.prepare(`INSERT INTO products(name,category,description,price,old_price,image,images,colors,sizes,stock,is_new,is_best_seller,active,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,1,datetime('now'))`).run(name,category,description,price,Number(b.oldPrice)||0,image,JSON.stringify([image]),JSON.stringify(Array.isArray(b.colors)?b.colors:[]),JSON.stringify(Array.isArray(b.sizes)?b.sizes:[]),stock,b.isNew?1:0,b.isBestSeller?1:0).lastInsertRowid;
  res.status(201).json({ ok:true, id });
});
app.put("/api/admin/products/:id", requireAdmin, (req,res) => {
  const b=req.body||{}, id=Number(req.params.id);
  const name=clean(b.name,150), category=clean(b.category,60), description=clean(b.description,1000), image=clean(b.image,1000);
  const price=Number(b.price), stock=Number(b.stock);
  if (!name || !category || !image.startsWith("https://") || !Number.isInteger(price) || price<1 || !Number.isInteger(stock) || stock<0) return res.status(400).json({error:"اطلاعات محصول نامعتبر است."});
  const result=db.prepare(`UPDATE products SET name=?,category=?,description=?,price=?,old_price=?,image=?,images=?,colors=?,sizes=?,stock=?,is_new=?,is_best_seller=?,active=? WHERE id=?`)
    .run(name,category,description,price,Number(b.oldPrice)||0,image,JSON.stringify([image]),JSON.stringify(Array.isArray(b.colors)?b.colors:[]),JSON.stringify(Array.isArray(b.sizes)?b.sizes:[]),stock,b.isNew?1:0,b.isBestSeller?1:0,b.active===false?0:1,id);
  if(!result.changes) return res.status(404).json({error:"محصول پیدا نشد."});
  res.json({ok:true});
});
app.delete("/api/admin/products/:id", requireAdmin, (req,res) => {
  const r=db.prepare("UPDATE products SET active=0 WHERE id=?").run(Number(req.params.id));
  if(!r.changes) return res.status(404).json({error:"محصول پیدا نشد."});
  res.json({ok:true});
});
app.get("/api/admin/export.csv", requireAdmin, (req,res) => {
  const rows=db.prepare("SELECT code,customer_name,phone,province,city,address,postal_code,subtotal,shipping,total,status,created_at,postal_tracking FROM orders ORDER BY id DESC").all();
  const keys=Object.keys(rows[0]||{code:""});
  const csv=[keys.join(","),...rows.map(r=>keys.map(k=>`"${String(r[k]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition",'attachment; filename="reralo-orders.csv"');
  res.send("\uFEFF"+csv);
});

app.use(express.static(path.join(__dirname,"public")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({error:"خطای داخلی سرور رخ داد. دوباره تلاش کنید."});
});
app.listen(PORT, () => console.log(`Reralo Store running at http://localhost:${PORT}`));
