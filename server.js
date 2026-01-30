
const session = require("express-session");
const bcrypt = require("bcrypt");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

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

function allocateStockByLocation(stock, productId, neededQty) {
  const lots = stock
    .filter(s => String(s.productId) === String(productId) && Number(s.qty) > 0)
    .sort((a, b) => {
      // 1) prioritate locație
      const r = locRank(a.location) - locRank(b.location);
      if (r !== 0) return r;

      // 2) tie-breaker: expirare (opțional, ca să fie stabil)
      return new Date(a.expiresAt) - new Date(b.expiresAt);
    });

  let remaining = Number(neededQty);
  const allocated = [];

  for (const lot of lots) {
    if (remaining <= 0) break;

    const takeQty = Math.min(Number(lot.qty), remaining);

    allocated.push({
      stockId: lot.id,
      lot: lot.lot,
      expiresAt: lot.expiresAt,
      location: lot.location || "A",  // ✅ util în UI
      qty: takeQty
    });

    lot.qty = Number(lot.qty) - takeQty;
    remaining -= takeQty;
  }

  if (remaining > 0) throw new Error("Stoc insuficient");
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
app.get("/api/orders", (req, res) => {
  let orders = readJson(ORDERS_FILE, []);
  let changed = false;
  orders.forEach(o => {
  // id
  if (o.id !== undefined && typeof o.id !== "string") {
    o.id = String(o.id);
    changed = true;
  }

  // status default
  if (!o.status) {
    o.status = "in_procesare";
    changed = true;
  }

  // data veche -> createdAt
  if (!o.createdAt && o.data) {
    o.createdAt = o.data;
    delete o.data;
    changed = true;
  }

  // 🔁 CONVERSIE PRODUSE VECHI → ITEMS
  if (!Array.isArray(o.items) && Array.isArray(o.produse)) {
    const counts = {};

    o.produse.forEach(name => {
      counts[name] = (counts[name] || 0) + 1;
    });

    o.items = Object.entries(counts).map(([name, qty]) => ({
      productId: null,
      name,
      qty,
      price: null,
      allocations: []   // nu exista la comenzile vechi
    }));

    delete o.produse;
    changed = true;
  }

  // siguranță finală
  if (!Array.isArray(o.items)) {
    o.items = [];
    changed = true;
  }
});


  orders.forEach(o => {
    // normalize id
    if (o.id !== undefined && typeof o.id !== "string") {
      o.id = String(o.id);
      changed = true;
    }
    orders.forEach(o => {
  if (!Array.isArray(o.items)) {
    o.items = [];
    changed = true;
  }

  o.items = o.items.map(i => {
    if (typeof i !== "object") return null;

    return {
      productId: i.productId || null,
      name: i.name || "Produs necunoscut",
      qty: Number(i.qty) || 0,
      price: i.price ?? null,
      allocations: Array.isArray(i.allocations) ? i.allocations : []
    };
  }).filter(Boolean);
});


    // add id if missing
    if (!o.id) {
      o.id =
        Date.now().toString() +
        Math.random().toString(36).slice(2);
      changed = true;
    }

    // default status
    if (!o.status) {
      o.status = "in_procesare";
      changed = true;
    }
  });

  if (changed) {
    writeJson(ORDERS_FILE, orders);
    console.log("✔️ ORDERS NORMALIZATE (id string + status)");
  }
  if (changed) writeJson(ORDERS_FILE, orders);


  res.json(orders);
});



app.post("/api/orders", (req, res) => {
  const orders = readJson(ORDERS_FILE, []);
  const stock = readJson(STOCK_FILE, []);

  const { client, items } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: "Comandă goală" });
  }

 const itemsMap = {};

for (const item of items) {
  try {
   const allocations = allocateStockByLocation(stock, item.id, item.qty);


   itemsMap[item.gtin] = {
  gtin: item.gtin,           // ✅ CHEIA REALĂ
  name: item.name,
  price: item.price ?? null,
  qty: 0,
  allocations: []
};


    itemsMap[item.id].qty += item.qty;
    itemsMap[item.id].allocations.push(...allocations);

  } catch (e) {
    return res.status(400).json({
      error: `Stoc insuficient pentru ${item.name}`
    });
  }
}

const finalItems = Object.values(itemsMap);


  // ✅ salvăm stocul actualizat
  writeJson(STOCK_FILE, stock);

  const newOrder = {
    id: Date.now().toString(),
    client,
    items: finalItems,
    status: "in_procesare",
    createdAt: new Date().toISOString()
  };

  orders.push(newOrder);
  writeJson(ORDERS_FILE, orders);

  res.json({ ok: true });
});

app.post("/api/orders/:id/status", (req, res) => {
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

 logAudit("STOCK_ADD", "stock", entry.id || "new", {
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

logAudit("STOCK_EDIT", "stock", item.id, {
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

app.listen(PORT, () => {
  console.log("Server pornit pe port", PORT);
});

