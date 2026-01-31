
const session = require("express-session");
const bcrypt = require("bcrypt");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const db = require("./db");


// middleware
app.use(express.json());
app.use(express.static("public"));
app.use(session({
  name: "magazin.sid",
  secret: "schimba-asta-cu-o-cheie-lunga",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax"
  }
}));





const DATA_DIR = path.join(__dirname, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STOCK_FILE = path.join(DATA_DIR, "stock.json");



function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const txt = fs.readFileSync(filePath, "utf8");
    if (!txt.trim()) return fallback;
    return JSON.parse(txt);
  } catch (e) {
    console.error("Eroare citire JSON:", filePath, e.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

const AUDIT_FILE = path.join(DATA_DIR, "audit.json");

function logAudit(req, action, entity, entityId, details = {}) {
  console.log("📁 AUDIT FILE:", AUDIT_FILE);

  const audit = readJson(AUDIT_FILE, []);

  const u = req?.session?.user;

  audit.push({
    id: Date.now().toString(),
    action,
    entity,
    entityId,
    user: u ? { id: u.id, username: u.username, role: u.role } : null,
    details,
    createdAt: new Date().toISOString()
  });

  writeJson(AUDIT_FILE, audit);

  console.log("📝 AUDIT:", action, entityId);
}





// ----- FLATTEN HELPERS (tree -> list) -----
function flattenClientsTree(tree) {
  // tree: { "Exterior": { "Valcea": [..] }, "Craiova": [..] }
  const out = [];
  let id = 1;

  function addClient(name, pathArr) {
    if (!name) return; // skip null/empty
    out.push({
      id: id++,
      name,
      path: pathArr.join(" / "),
      group: pathArr[0] || "",
      area: pathArr[1] || "",
    });
  }

  for (const top of Object.keys(tree || {})) {
    const node = tree[top];
    if (Array.isArray(node)) {
      // Craiova: [clients]
      node.forEach((c) => addClient(c, [top]));
    } else if (node && typeof node === "object") {
      // Exterior: { "Valcea": [clients], ... }
      for (const sub of Object.keys(node)) {
        const arr = node[sub];
        if (Array.isArray(arr)) {
          arr.forEach((c) => addClient(c, [top, sub]));
        }
      }
    }
  }
  return out;
}

function flattenProductsTree(tree) {
  const out = [];

  function walk(node, pathArr) {
    if (Array.isArray(node)) {
      node.forEach(item => {
        if (!item || !item.name) return;

        // IMPORTANT: luăm id-ul din products.json
        if (!item.id) {
          console.warn("Produs fără id:", item.name);
          return; // sau throw, dacă vrei să fie obligatoriu
        }

        const pathStr = pathArr.join(" / ");

out.push({
  id: String(item.id),
  name: item.name,
  gtin: item.gtin || "",
  price: item.price ?? null,

  // dacă nu ai path în tree, fă path din category
  path: pathStr || `Produse / ${item.category || "Altele"}`,

  // ✅ PRIORITAR: category din produs (listă)
  category: item.category || pathArr[0] || "",
  subcategory: item.subcategory || pathArr[1] || "",
  subsubcategory: item.subsubcategory || pathArr[2] || ""
});

      });
      return;
    }

    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        walk(node[key], [...pathArr, key]);
      }
    }
  }

  walk(tree, []);
  return out;
}


const LOCATION_ORDER = ["A", "B", "C", "R1", "R2", "R3"];

function locRank(loc) {
  const i = LOCATION_ORDER.indexOf(String(loc || "").toUpperCase());
  return i === -1 ? 999 : i;
}
function normalizeGTIN(gtin) {
  let g = String(gtin || "").replace(/\D/g, "");
  if (g.length === 14 && g.startsWith("0")) g = g.slice(1);
  return g;
}


function allocateStockByLocation(stock, gtin, neededQty) {
  const g = normalizeGTIN(gtin);

  const lots = stock
    .filter(s =>
      normalizeGTIN(s.gtin) === g && Number(s.qty) > 0
    )
    .sort((a, b) => {
      const r = locRank(a.location) - locRank(b.location);
      if (r !== 0) return r;
      return new Date(a.expiresAt) - new Date(b.expiresAt);
    });

  let remaining = Number(neededQty);
  const allocated = [];

  for (const lot of lots) {
    if (remaining <= 0) break;

    const take = Math.min(Number(lot.qty), remaining);

    allocated.push({
      stockId: lot.id,
      lot: lot.lot,
      expiresAt: lot.expiresAt,
      location: lot.location,
      qty: take
    });

    lot.qty -= take;
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error("Stoc insuficient");
  }

  return allocated;
}

function allocateFromSpecificLot(stock, gtin, lot, neededQty) {
  const g = normalizeGTIN(gtin);
  const lotStr = String(lot || "").trim();

  const lots = stock
    .filter(s =>
      normalizeGTIN(s.gtin) === g &&
      String(s.lot || "").trim() === lotStr &&
      Number(s.qty) > 0
    )
    .sort((a, b) => {
      const r = locRank(a.location) - locRank(b.location);
      if (r !== 0) return r;
      return new Date(a.expiresAt) - new Date(b.expiresAt);
    });

  let remaining = Number(neededQty);
  const allocated = [];

  for (const entry of lots) {
    if (remaining <= 0) break;

    const take = Math.min(Number(entry.qty), remaining);

    allocated.push({
      stockId: entry.id,
      lot: entry.lot,
      expiresAt: entry.expiresAt,
      location: entry.location || "A",
      qty: take
    });

    entry.qty = Number(entry.qty) - take;
    remaining -= take;
  }

  if (remaining > 0) throw new Error("Stoc insuficient pe lotul scanat");

  return allocated;
}









// ----- API CLIENTS -----
app.get("/api/clients-tree", (req, res) => {
  const flat = readJson(CLIENTS_FILE, []);
  res.json(buildClientsTreeFromFlat(Array.isArray(flat) ? flat : []));
});

app.get("/api/clients-flat", (req, res) => {
  const flat = readJson(CLIENTS_FILE, []);
  res.json(buildClientsFlatFromFlat(Array.isArray(flat) ? flat : []));
});

// ===== CLIENTS ADAPTERS (for new flat clients.json) =====
function buildClientsTreeFromFlat(flat) {
  const tree = {};

  flat.forEach(c => {
    if (!c || !c.group || !c.category || !c.name) return;

    if (!tree[c.group]) tree[c.group] = {};
    if (!tree[c.group][c.category]) tree[c.group][c.category] = [];

    // IMPORTANT: frontend expects strings in arrays
    tree[c.group][c.category].push(c.name);
  });

  return tree;
}

function buildClientsFlatFromFlat(flat) {
  return flat
    .filter(Boolean)
    .map(c => ({
      id: c.id,
      name: c.name,
      group: c.group,
      path: `${c.group} / ${c.category}`,
      prices: c.prices || {} // ✅ IMPORTANT
    }));
}



function readProductsAsList() {
  const data = readJson(PRODUCTS_FILE, []);

  // ✅ dacă e deja listă (cum ai tu acum)
  if (Array.isArray(data)) return data;

  // ✅ dacă e vechiul format tree
  if (data && typeof data === "object") {
    return flattenProductsTree(data);
  }

  return [];
}


// ----- API PRODUCTS -----
app.get("/api/products-tree", (req, res) => {
  const list = readProductsAsList();
  const CATEGORY_ORDER = [
  "Seni Active Classic x30",
  "Seni Classic Air x30",
  "Seni Aleze x30",
  "Seni Lady",
  "Manusi",
  "Altele"
];


  const treeByCategory = {};

  list.forEach(p => {
    const cat = (p.category || "Altele").trim();
    if (!treeByCategory[cat]) treeByCategory[cat] = [];

    // renderTree din frontend folosește item.name
    treeByCategory[cat].push({ name: p.name });
  });
function sizeRank(name) {
  const n = String(name || "").toLowerCase();

  if (n.includes("small") || n.includes(" s ")) return 1;
  if (n.includes("medium") || n.includes(" m ")) return 2;
  if (n.includes("large") || n.includes(" l ")) return 3;
  if (n.includes("xl") || n.includes("x-large") || n.includes("extra large")) return 4;

  return 999; // fără mărime → la final
}

  // sortare produse în fiecare categorie
  Object.keys(treeByCategory).forEach(cat => {
    treeByCategory[cat].sort((a, b) => a.name.localeCompare(b.name, "ro"));
  });

  // sortare categorii
 const sorted = {};

CATEGORY_ORDER.forEach(cat => {
  if (treeByCategory[cat]) {
    sorted[cat] = treeByCategory[cat];
  }
});

// 🔁 adăugăm orice categorie care NU e în listă
Object.keys(treeByCategory).forEach(cat => {
  if (!sorted[cat]) {
    sorted[cat] = treeByCategory[cat];
  }
});



res.json(sorted);
});



app.get("/api/products-flat", (req, res) => {
  const data = readJson(PRODUCTS_FILE, []);

  // dacă e listă, returneaz-o direct (cu path fallback)
  if (Array.isArray(data)) {
    return res.json(
      data.map(p => ({
        ...p,
        id: String(p.id),
        path: p.path && String(p.path).trim()
          ? p.path
          : `Produse / ${p.category || "Altele"}`
      }))
    );
  }

  // altfel, e vechiul tree
  const flat = flattenProductsTree(data);
  res.json(flat);
});




// ----- API ORDERS -----
app.get("/api/orders", async (req, res) => {
  try {
    const dbOn = db.hasDb();

    if (!dbOn) {
      // fallback JSON (local)
      const orders = readJson(ORDERS_FILE, []);
      return res.json(orders);
    }

    const r = await db.q(
      `SELECT id, client, items, status, created_at
       FROM orders
       ORDER BY created_at DESC`
    );

    const orders = r.rows.map(x => ({
      id: x.id,
      client: x.client,
      items: x.items,
      status: x.status,
      createdAt: x.created_at
    }));

    res.json(orders);
  } catch (e) {
    console.error("GET /api/orders error:", e);
    res.status(500).json({ error: "Eroare DB la încărcare comenzi" });
  }
});







app.post("/api/orders", async (req, res) => {
  try {
    const { client, items } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ error: "Comandă goală" });
    }

    // păstrăm exact structura existentă (cu allocations deja făcute în frontend sau server)
    // momentan NU atingem stocul aici (îl mutăm în DB imediat după ce confirmi că orders persistă)

    const newOrder = {
      id: Date.now().toString(),
      client,
      items,
      status: "in_procesare",
      createdAt: new Date().toISOString()
    };

    if (!db.hasDb()) {
      // fallback JSON (local)
      const orders = readJson(ORDERS_FILE, []);
      orders.push(newOrder);
      writeJson(ORDERS_FILE, orders);
      return res.json({ ok: true });
    }

    await db.q(
      `INSERT INTO orders (id, client, items, status, created_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::timestamptz)`,
      [newOrder.id, JSON.stringify(client), JSON.stringify(items), newOrder.status, newOrder.createdAt]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/orders error:", e);
    res.status(500).json({ error: "Eroare DB la salvare comandă" });
  }
});



app.post("/api/orders/:id/status", (req, res) => {
  const allowed = new Set(["in_procesare", "facturata", "gata_de_livrare", "livrata"]);
if (!allowed.has(req.body.status)) {
  return res.status(400).json({ error: "Status invalid" });
}

  console.log("=== STATUS UPDATE ROUTE HIT ===");
  console.log("ID primit:", req.params.id);
  console.log("Status primit:", req.body.status);

  const orders = readJson(ORDERS_FILE, []);
  console.log("Comenzi existente:", orders.map(o => o.id));

  const order = orders.find(o => String(o.id) === String(req.params.id));


  if (!order) {
    console.log("❌ COMANDA NU A FOST GASITA");
    return res.status(404).json({ error: "Comandă inexistentă" });
  }

  order.status = req.body.status;
  writeJson(ORDERS_FILE, orders);

  logAudit(req, "ORDER_STATUS", "order", order.id, {
  clientName: order.client?.name,
  newStatus: order.status
});


  console.log("✅ STATUS SALVAT IN FILE");

  res.json({ ok: true });
});

app.post("/api/orders/:id/replace-lot", (req, res) => {
  try {
    const orders = readJson(ORDERS_FILE, []);
    const stock = readJson(STOCK_FILE, []);

    const order = orders.find(o => String(o.id) === String(req.params.id));
    if (!order) return res.status(404).json({ error: "Comandă inexistentă" });

    const gtin = normalizeGTIN(req.body.gtin);
    const oldLot = String(req.body.oldLot || "").trim();
    const newLot = String(req.body.newLot || "").trim();
    const qty = Number(req.body.qty);

    if (!gtin || !oldLot || !newLot || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "Date invalide (gtin/oldLot/newLot/qty)" });
    }

    const item = (order.items || []).find(i => normalizeGTIN(i.gtin) === gtin);
    if (!item) return res.status(400).json({ error: "Produsul nu există în comandă" });

    item.allocations = Array.isArray(item.allocations) ? item.allocations : [];

    // 1) verificăm că există oldLot în allocations și că avem qty suficient acolo
    const oldAllocs = item.allocations.filter(a => String(a.lot) === oldLot);
    const oldTotal = oldAllocs.reduce((s, a) => s + Number(a.qty || 0), 0);

    if (oldTotal <= 0) {
      return res.status(400).json({ error: "Old LOT nu există în allocations" });
    }
    if (qty > oldTotal) {
      return res.status(400).json({ error: `Cantitatea cerută (${qty}) depășește alocarea din lot (${oldTotal})` });
    }

    // 2) Returnăm qty înapoi în stoc pentru oldLot (pe stockId-urile alocate)
    let remainingReturn = qty;
    for (const a of oldAllocs) {
      if (remainingReturn <= 0) break;

      const takeBack = Math.min(Number(a.qty || 0), remainingReturn);

      // punem înapoi în stock entry-ul original
      const st = stock.find(s => String(s.id) === String(a.stockId));
      if (st) st.qty = Number(st.qty || 0) + takeBack;

      // scădem din allocation
      a.qty = Number(a.qty || 0) - takeBack;
      remainingReturn -= takeBack;
    }

    // curățăm allocations cu qty 0
    item.allocations = item.allocations.filter(a => Number(a.qty || 0) > 0);

    // 3) Alocăm qty din NEW LOT (scanat) și scădem din stoc
    const newAllocs = allocateFromSpecificLot(stock, gtin, newLot, qty);

    // 4) le adăugăm în comandă (dacă există deja același lot, îl cumulăm)
    newAllocs.forEach(na => {
      const existing = item.allocations.find(a =>
        String(a.lot) === String(na.lot) &&
        String(a.location || "") === String(na.location || "")
      );

      if (existing) {
        existing.qty = Number(existing.qty || 0) + Number(na.qty || 0);
      } else {
        item.allocations.push(na);
      }
    });

    // 5) salvăm fișierele
    writeJson(STOCK_FILE, stock);
    writeJson(ORDERS_FILE, orders);

    // audit
    logAudit(req, "ORDER_REPLACE_LOT", "order", order.id, {
      gtin,
      oldLot,
      newLot,
      qty
    });

    res.json({ ok: true, order });

  } catch (e) {
    console.error("replace-lot error:", e);
    res.status(400).json({ error: e.message || "Eroare" });
  }
});


// GET stock
app.get("/api/stock", (req, res) => {
  const stock = readJson(STOCK_FILE, []);
  res.json(stock);
});

// ADD stock
app.post("/api/stock", (req, res) => {
  const stock = readJson(STOCK_FILE, []);

const entry = {
  id: Date.now().toString() + Math.random().toString(36).slice(2),

  gtin: String(req.body.gtin || "").trim(),          // ✅ CHEIA
  productName: String(req.body.productName || ""),   // pt UI

  lot: String(req.body.lot || "").trim(),
  expiresAt: req.body.expiresAt,
  qty: Number(req.body.qty),
  location: req.body.location || "A",
  createdAt: new Date().toISOString()
};

if (!entry.gtin) {
  return res.status(400).json({ error: "Lipsește GTIN" });
}



  stock.push(entry);
  writeJson(STOCK_FILE, stock);

logAudit(req, "STOCK_ADD", "stock", entry.id || "new", {
  gtin: entry.gtin,
  productName: entry.productName,
  lot: entry.lot,
  qty: entry.qty
});






  res.json({ ok: true, entry });
});

// UPDATE cantitate stoc (pe LOT)
app.put("/api/stock/:id", (req, res) => {
  const stock = readJson(STOCK_FILE, []);
  const item = stock.find(s => s.id === req.params.id);

  if (!item) {
    return res.status(404).json({ error: "Intrare stoc inexistentă" });
  }

 const beforeQty = item.qty;
const beforeLoc = item.location || "A";

if (req.body.qty != null) item.qty = Number(req.body.qty);
if (req.body.location != null) item.location = String(req.body.location);

logAudit(req, "STOCK_EDIT", "stock", item.id, {
  gtin: item.gtin,
  productName: item.productName,
  lot: item.lot,
  beforeQty,
  afterQty: item.qty,
  beforeLoc,
  afterLoc: item.location
});






  writeJson(STOCK_FILE, stock);

  res.json({ ok: true, item });
});

// DELETE intrare stoc (LOT)
app.delete("/api/stock/:id", (req, res) => {
  const stock = readJson(STOCK_FILE, []);
  const index = stock.findIndex(s => s.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Intrare stoc inexistentă" });
  }

  const item = stock[index];

  // 🔍 AUDIT (ÎNAINTE de ștergere)
 logAudit(req, "STOCK_DELETE", "stock", item.id, {
  productName: item.productName,
  lot: item.lot,
  expiresAt: item.expiresAt,
  qty: item.qty
});


  stock.splice(index, 1);
  writeJson(STOCK_FILE, stock);

  res.json({ ok: true });
});

// Cine sunt eu (pentru frontend)
app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.session.user });
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const users = readJson(USERS_FILE, []);
  const user = users.find(u => u.username === username && u.active);

  if (!user) return res.status(401).json({ error: "User sau parolă greșită" });

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "User sau parolă greșită" });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ ok: true, user: req.session.user });
});
// Register 
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Date lipsă" });
  }

  const users = readJson(USERS_FILE, []);

  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: "Utilizator existent" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  const user = {
    id: Date.now().toString(),
    username,
    passwordHash,   // 🔑 IMPORTANT
    role: "user",
    active: true
  };

  users.push(user);
  writeJson(USERS_FILE, users);

  res.json({ ok: true });
});



// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});








const PORT = process.env.PORT || 3000;
db.ensureTables()
  .then(() => console.log("✅ DB ready"))
  .catch(e => console.error("❌ DB init error:", e.message));


app.listen(PORT, () => {
  console.log("Server pornit pe port", PORT);
});

