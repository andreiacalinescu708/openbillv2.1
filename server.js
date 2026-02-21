
const session = require("express-session");
const bcrypt = require("bcrypt");
const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("./db");


const app = express();
app.set("trust proxy", 1);




// middleware
app.use(express.json());
app.use(express.static("public"));
app.use(session({
  name: "magazin.sid",
  secret: process.env.SESSION_SECRET || "schimba-asta-cu-o-cheie-lunga",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax"
  }
}));


// Cine sunt eu (pentru frontend)
app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.session.user });
});






const DATA_DIR = path.join(__dirname, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const STOCK_FILE = path.join(DATA_DIR, "stock.json");

async function seedClientsFromFileIfEmpty() {
  if (!db.hasDb()) return;

  // există tabelă, dar e goală? -  > seed din clients.json
  const r = await db.q("SELECT COUNT(*)::int AS n FROM clients");
  if ((r.rows?.[0]?.n ?? 0) > 0) return;

  const fileClients = readJson(CLIENTS_FILE, []);
  for (const c of fileClients) {
    const id = String(c.id ?? (Date.now().toString() + Math.random().toString(36).slice(2)));

    const name = String(c.name ?? "").trim();
    if (!name) continue;

    const group = String(c.group ?? "");
    const category = String(c.category ?? "");
    const prices = c.prices && typeof c.prices === "object" ? c.prices : {};

    await db.q(
      `INSERT INTO clients (id, name, group_name, category, prices)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, name, group, category, JSON.stringify(prices)]
    );
  }

  console.log("✅ Clients seeded into DB from clients.json");
}

async function seedProductsFromFileIfEmpty() {
  if (!db.hasDb()) return;

  const r = await db.q("SELECT COUNT(*)::int AS n FROM products");
  if ((r.rows?.[0]?.n ?? 0) > 0) return;

  const list = readProductsAsList();

  for (const p of list) {
    const name = String(p.name || "").trim();
    if (!name) continue;

    const id = (p.id != null && String(p.id).trim() !== "") ? String(p.id) : null;

    const gtinClean = normalizeGTIN(p.gtin || "") || null;

    const gtinsArr = []
      .concat(gtinClean ? [gtinClean] : [])
      .concat(Array.isArray(p.gtins) ? p.gtins : [])
      .map(normalizeGTIN)
      .filter(Boolean);

    const category = String(p.category || "Altele").trim() || "Altele";
    const price = (p.price != null && p.price !== "") ? Number(p.price) : null;

    await db.q(
      `INSERT INTO products (id, name, gtin, gtins, category, price)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT (gtin) DO UPDATE SET
         name = EXCLUDED.name,
         gtins = EXCLUDED.gtins,
         category = EXCLUDED.category,
         price = EXCLUDED.price`,
      [id, name, gtinClean, JSON.stringify(gtinsArr), category, (Number.isFinite(price) ? price : null)]
    );
  }

  console.log("✅ Products seeded into DB from products.json");
}


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

async function logAudit(req, action, entity, entityId, details = {}) {
  const u = req?.session?.user || null;

  const row = {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    action,
    entity,
    entityId: String(entityId || ""),
    user: u ? { id: u.id, username: u.username, role: u.role } : null,
    details,
    createdAt: new Date().toISOString()
  };

  // ✅ dacă avem DB -> scriem în Postgres
  if (db.hasDb()) {
    try {
      await db.q(
        `INSERT INTO audit (id, action, entity, entity_id, user_json, details, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)`,
        [
          row.id,
          row.action,
          row.entity,
          row.entityId,
          JSON.stringify(row.user),
          JSON.stringify(row.details),
          row.createdAt
        ]
      );
      return;
    } catch (e) {
      console.error("AUDIT DB ERROR:", e.message);
      // dacă pică DB-ul, NU blocăm aplicația — continuăm cu fallback
    }
  }

  // ✅ fallback JSON (local)
  const audit = readJson(AUDIT_FILE, []);
  audit.push({
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    user: row.user,
    details: row.details,
    createdAt: row.createdAt
  });
  writeJson(AUDIT_FILE, audit);
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

function sqlLocOrderCase(colName = "location") {
  // ordinea ta: A, B, C, R1, R2, R3, restul la final
  return `
    CASE UPPER(${colName})
      WHEN 'A' THEN 1
      WHEN 'B' THEN 2
      WHEN 'C' THEN 3
      WHEN 'R1' THEN 4
      WHEN 'R2' THEN 5
      WHEN 'R3' THEN 6
      ELSE 999
    END
  `;
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

app.get("/api/clients-flat", async (req, res) => {
  try {
    if (db.hasDb()) {
      const r = await db.q(
        `SELECT id, name, group_name, category, prices
         FROM clients
         ORDER BY name ASC`
      );

      const out = r.rows.map(row => ({
        id: row.id,
        name: row.name,
        group: row.group_name || "",
        category: row.category || "",
        prices: row.prices || {}
      }));

      return res.json(out);
    }

    // fallback local
    const clients = readJson(CLIENTS_FILE, []);
    return res.json(clients);
  } catch (e) {
    console.error("clients-flat error:", e);
    res.status(500).json({ error: "Eroare la clienți" });
  }
});

// === Client details (din DB) ===
app.get("/api/clients/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    const r = await db.q(
      `SELECT id, name, group_name AS "group", category, prices
       FROM clients
       WHERE id = $1`,
      [id]
    );

    if (!r.rows.length) return res.status(404).json({ error: "Client inexistent" });

    const c = r.rows[0];
    c.prices = c.prices || {};
    return res.json(c);
  } catch (e) {
    console.error("GET /api/clients/:id error:", e);
    res.status(500).json({ error: "Eroare server" });
  }
});


// === Save prices (în DB) ===
// body: { prices: { "<productId>": 12.34, ... } }
app.put("/api/clients/:id/prices", async (req, res) => {
  try {
    const id = String(req.params.id);
    const prices = req.body?.prices;

    if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
      return res.status(400).json({ error: "Body invalid. Trimite { prices: {...} }" });
    }

    await db.q(
      `UPDATE clients SET prices = $1::jsonb WHERE id = $2`,
      [JSON.stringify(prices), id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/clients/:id/prices error:", e);
    res.status(500).json({ error: "Eroare server" });
  }
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
app.get("/api/products-tree", async (req, res) => {
  try {
    let list = [];

    if (db.hasDb()) {
      const r = await db.q(`SELECT id, name, category FROM products ORDER BY name ASC`);
      list = r.rows.map(x => ({ id: x.id, name: x.name, category: x.category || "Altele" }));
    } else {
      list = readProductsAsList();
    }

    const CATEGORY_ORDER = ["Seni Active Classic x30","Seni Classic Air x30","Seni Aleze x30","Seni Lady","Manusi","Altele"];
    const treeByCategory = {};

    list.forEach(p => {
      const cat = (p.category || "Altele").trim();
      if (!treeByCategory[cat]) treeByCategory[cat] = [];
      treeByCategory[cat].push({ name: p.name });
    });

    Object.keys(treeByCategory).forEach(cat => {
      treeByCategory[cat].sort((a,b) => a.name.localeCompare(b.name, "ro"));
    });

    const sorted = {};
    CATEGORY_ORDER.forEach(cat => { if (treeByCategory[cat]) sorted[cat] = treeByCategory[cat]; });
    Object.keys(treeByCategory).forEach(cat => { if (!sorted[cat]) sorted[cat] = treeByCategory[cat]; });

    res.json(sorted);
  } catch (e) {
    console.error("products-tree error:", e);
    res.status(500).json({ error: "Eroare la produse" });
  }
});



app.get("/api/products-flat", async (req, res) => {
  try {
    if (db.hasDb()) {
      const r = await db.q(
        `SELECT id, name, gtins, category, price
         FROM products
         ORDER BY name ASC`
      );

      return res.json(r.rows.map(x => ({
        id: String(x.id),
        name: x.name,
        gtin: "",                // păstrăm compatibilitate cu frontend-ul
        gtins: x.gtins || [],
        category: x.category || "Altele",
        price: x.price,
        path: `Produse / ${x.category || "Altele"}`
      })));
    }

    // fallback JSON
    const data = readJson(PRODUCTS_FILE, []);
    if (Array.isArray(data)) return res.json(data);
    return res.json(flattenProductsTree(data));
  } catch (e) {
    console.error("products-flat error:", e);
    res.status(500).json({ error: "Eroare la produse" });
  }
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



app.post("/api/orders/:id/status", async (req, res) => {
  try {
    const allowed = new Set(["in_procesare", "facturata", "gata_de_livrare", "livrata"]);
    if (!allowed.has(req.body.status)) {
      return res.status(400).json({ error: "Status invalid" });
    }

    const id = String(req.params.id);
    const newStatus = req.body.status;

    if (!db.hasDb()) {
      const orders = readJson(ORDERS_FILE, []);
      const order = orders.find(o => String(o.id) === id);
      if (!order) return res.status(404).json({ error: "Comandă inexistentă" });

      order.status = newStatus;
      writeJson(ORDERS_FILE, orders);

      await logAudit(req, "ORDER_STATUS", "order", order.id, {
        clientName: order.client?.name,
        newStatus: order.status
      });

      return res.json({ ok: true });
    }

    const r = await db.q(`UPDATE orders SET status=$1 WHERE id=$2 RETURNING id, client`, [newStatus, id]);
    if (!r.rows.length) return res.status(404).json({ error: "Comandă inexistentă" });

   await logAudit(req, "ORDER_STATUS", "order", id, {
      clientName: r.rows[0].client?.name,
      newStatus
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/orders/:id/status error:", e);
    res.status(500).json({ error: "Eroare DB status" });
  }
});


app.post("/api/orders/:id/replace-lot", async (req, res) => {
  const orderId = String(req.params.id);

  const gtin = normalizeGTIN(req.body.gtin);
  const oldLot = String(req.body.oldLot || "").trim();
  const newLot = String(req.body.newLot || "").trim();
  const qtyReq = Number(req.body.qty);

  if (!gtin || !oldLot || !newLot || !Number.isFinite(qtyReq) || qtyReq <= 0) {
    return res.status(400).json({ error: "Date invalide (gtin/oldLot/newLot/qty)" });
  }

  // ====== FALLBACK JSON (dacă nu există DB) ======
  if (!db.hasDb()) {
    try {
      const orders = readJson(ORDERS_FILE, []);
      const stock = readJson(STOCK_FILE, []);

      const order = orders.find(o => String(o.id) === orderId);
      if (!order) return res.status(404).json({ error: "Comandă inexistentă" });

      const item = (order.items || []).find(i => normalizeGTIN(i.gtin) === gtin);
      if (!item) return res.status(400).json({ error: "Produsul nu există în comandă" });

      item.allocations = Array.isArray(item.allocations) ? item.allocations : [];

      const oldAllocs = item.allocations.filter(a => String(a.lot) === oldLot);
      const oldTotal = oldAllocs.reduce((s, a) => s + Number(a.qty || 0), 0);
      if (oldTotal <= 0) return res.status(400).json({ error: "Old LOT nu există în allocations" });
      if (qtyReq > oldTotal) {
        return res.status(400).json({ error: `Cantitatea cerută (${qtyReq}) depășește alocarea din lot (${oldTotal})` });
      }

      // return în stoc pt oldLot
      let remainingReturn = qtyReq;
      for (const a of oldAllocs) {
        if (remainingReturn <= 0) break;

        const takeBack = Math.min(Number(a.qty || 0), remainingReturn);
        const st = stock.find(s => String(s.id) === String(a.stockId));
        if (st) st.qty = Number(st.qty || 0) + takeBack;

        a.qty = Number(a.qty || 0) - takeBack;
        remainingReturn -= takeBack;
      }

      item.allocations = item.allocations.filter(a => Number(a.qty || 0) > 0);

      // alocare din newLot
      const newAllocs = allocateFromSpecificLot(stock, gtin, newLot, qtyReq);

      newAllocs.forEach(na => {
        const existing = item.allocations.find(a =>
          String(a.lot) === String(na.lot) &&
          String(a.location || "") === String(na.location || "")
        );
        if (existing) existing.qty = Number(existing.qty || 0) + Number(na.qty || 0);
        else item.allocations.push(na);
      });

      writeJson(STOCK_FILE, stock);
      writeJson(ORDERS_FILE, orders);

     await logAudit(req, "ORDER_REPLACE_LOT", "order", order.id, { gtin, oldLot, newLot, qty: qtyReq });

      return res.json({ ok: true, order });
    } catch (e) {
      console.error("replace-lot JSON error:", e);
      return res.status(400).json({ error: e.message || "Eroare" });
    }
  }

  // ====== DB MODE ======
  try {
    await db.q("BEGIN");

    // 1) luăm comanda (lock)
    const rOrder = await db.q(
      `SELECT id, client, items, status, created_at
       FROM orders
       WHERE id=$1
       FOR UPDATE`,
      [orderId]
    );

    if (!rOrder.rows.length) {
      await db.q("ROLLBACK");
      return res.status(404).json({ error: "Comandă inexistentă" });
    }

    const orderRow = rOrder.rows[0];
    const items = Array.isArray(orderRow.items) ? orderRow.items : [];

    const item = items.find(i => normalizeGTIN(i.gtin) === gtin);
    if (!item) {
      await db.q("ROLLBACK");
      return res.status(400).json({ error: "Produsul nu există în comandă" });
    }

    item.allocations = Array.isArray(item.allocations) ? item.allocations : [];

    // 2) validăm oldLot allocations
    const oldAllocs = item.allocations.filter(a => String(a.lot) === oldLot);
    const oldTotal = oldAllocs.reduce((s, a) => s + Number(a.qty || 0), 0);

    if (oldTotal <= 0) {
      await db.q("ROLLBACK");
      return res.status(400).json({ error: "Old LOT nu există în allocations" });
    }
    if (qtyReq > oldTotal) {
      await db.q("ROLLBACK");
      return res.status(400).json({ error: `Cantitatea cerută (${qtyReq}) depășește alocarea din lot (${oldTotal})` });
    }

    // 3) returnăm qty în stoc pe stockId-urile vechi
    let remainingReturn = qtyReq;
    for (const a of oldAllocs) {
      if (remainingReturn <= 0) break;

      const takeBack = Math.min(Number(a.qty || 0), remainingReturn);
      if (a.stockId) {
        await db.q(`UPDATE stock SET qty = qty + $1 WHERE id=$2`, [takeBack, String(a.stockId)]);
      }
      a.qty = Number(a.qty || 0) - takeBack;
      remainingReturn -= takeBack;
    }

    // curățăm allocations cu qty 0
    item.allocations = item.allocations.filter(a => Number(a.qty || 0) > 0);

    // 4) alocăm qtyReq din NEW LOT: luăm rânduri stock din lotul nou (lock)
    const locCase = sqlLocOrderCase("location");
    const rStock = await db.q(
      `SELECT id, gtin, lot, expires_at, qty, location
       FROM stock
       WHERE gtin=$1 AND lot=$2 AND qty > 0
       ORDER BY ${locCase} ASC, expires_at ASC
       FOR UPDATE`,
      [gtin, newLot]
    );

    let remainingNeed = qtyReq;
    const newAllocs = [];

    for (const s of rStock.rows) {
      if (remainingNeed <= 0) break;

      const avail = Number(s.qty || 0);
      if (avail <= 0) continue;

      const take = Math.min(avail, remainingNeed);

      // scădem din stock
      await db.q(`UPDATE stock SET qty = qty - $1 WHERE id=$2`, [take, s.id]);

      newAllocs.push({
        stockId: s.id,
        lot: s.lot,
        expiresAt: String(s.expires_at).slice(0, 10),
        location: s.location || "A",
        qty: take
      });

      remainingNeed -= take;
    }

    if (remainingNeed > 0) {
      await db.q("ROLLBACK");
      return res.status(400).json({ error: "Stoc insuficient pe lotul scanat (DB)" });
    }

    // 5) mergem allocations: cumulăm dacă există deja lot+location
    newAllocs.forEach(na => {
      const existing = item.allocations.find(a =>
        String(a.lot) === String(na.lot) &&
        String(a.location || "") === String(na.location || "")
      );
      if (existing) existing.qty = Number(existing.qty || 0) + Number(na.qty || 0);
      else item.allocations.push(na);
    });

    // 6) salvăm items în DB
    await db.q(`UPDATE orders SET items=$1::jsonb WHERE id=$2`, [JSON.stringify(items), orderId]);

    await db.q("COMMIT");

   await logAudit(req, "ORDER_REPLACE_LOT", "order", orderId, {
      gtin,
      oldLot,
      newLot,
      qty: qtyReq
    });

    // return order “fresh”
    const rFresh = await db.q(
      `SELECT id, client, items, status, created_at
       FROM orders
       WHERE id=$1`,
      [orderId]
    );

    const x = rFresh.rows[0];
    return res.json({
      ok: true,
      order: {
        id: x.id,
        client: x.client,
        items: x.items,
        status: x.status,
        createdAt: x.created_at
      }
    });

  } catch (e) {
    try { await db.q("ROLLBACK"); } catch {}
    console.error("replace-lot DB error:", e);
    return res.status(500).json({ error: e.message || "Eroare DB replace-lot" });
  }
});

app.get("/api/debug-db", async (req, res) => {
  try {
    if (!db.hasDb()) return res.json({ hasDb: false });

    const r = await db.q("select current_database() as db, inet_server_addr() as host");
    const c1 = await db.q("select count(*)::int as n from orders");
    let c2 = { rows: [{ n: null }] };
    try { c2 = await db.q("select count(*)::int as n from stock"); } catch {}

    res.json({
      hasDb: true,
      db: r.rows[0],
      ordersCount: c1.rows[0].n,
      stockCount: c2.rows[0].n
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// GET stock
// ===== STOCK (DB + fallback JSON) =====

// GET stock
app.get("/api/stock", async (req, res) => {
  try {
    if (!db.hasDb()) {
      const stock = readJson(STOCK_FILE, []);
      return res.json(stock);
    }

    const r = await db.q(
      `SELECT id, gtin, product_name, lot, expires_at, qty, location, created_at
       FROM stock
       ORDER BY created_at DESC`
    );

    // map la cheile pe care frontend-ul tău le folosește acum
    const out = r.rows.map(s => ({
      id: s.id,
      gtin: s.gtin,
      productName: s.product_name,
      lot: s.lot,
      expiresAt: s.expires_at,   // ok (front-ul îl afișează)
      qty: Number(s.qty || 0),
      location: s.location || "A",
      createdAt: s.created_at
    }));

    res.json(out);
  } catch (e) {
    console.error("GET /api/stock error:", e);
    res.status(500).json({ error: "Eroare DB stock" });
  }
});

app.get("/api/audit", async (req, res) => {
  try {
    if (!db.hasDb()) return res.json(readJson(AUDIT_FILE, []));
    const r = await db.q(
      `SELECT id, action, entity, entity_id, user_json, details, created_at
       FROM audit
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json(r.rows.map(x => ({
      id: x.id,
      action: x.action,
      entity: x.entity,
      entityId: x.entity_id,
      user: x.user_json,
      details: x.details,
      createdAt: x.created_at
    })));
  } catch (e) {
    res.status(500).json({ error: "Eroare audit" });
  }
});


// ADD stock
app.post("/api/stock", async (req, res) => {
  try {
    const entry = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      gtin: String(req.body.gtin || "").trim(),
      productName: String(req.body.productName || "").trim(),
      lot: String(req.body.lot || "").trim(),
      expiresAt: String(req.body.expiresAt || "").slice(0, 10),
      qty: Number(req.body.qty),
      location: String(req.body.location || "A").trim(),
      createdAt: new Date().toISOString()
    };

    if (!entry.gtin) return res.status(400).json({ error: "Lipsește GTIN" });

    if (!db.hasDb()) {
      const stock = readJson(STOCK_FILE, []);
      stock.push(entry);
      writeJson(STOCK_FILE, stock);

     await logAudit(req, "STOCK_ADD", "stock", entry.id, {
        gtin: entry.gtin,
        productName: entry.productName,
        lot: entry.lot,
        qty: entry.qty
      });

      return res.json({ ok: true, entry });
    }

    if (!entry.expiresAt || entry.expiresAt.length !== 10) {
  return res.status(400).json({ error: "Data expirării invalidă" });
}
if (!Number.isFinite(entry.qty) || entry.qty <= 0) {
  return res.status(400).json({ error: "Cantitate invalidă" });
}


    await db.q(
      `INSERT INTO stock (id, gtin, product_name, lot, expires_at, qty, location, created_at)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8::timestamptz)`,
      [entry.id, entry.gtin, entry.productName, entry.lot, entry.expiresAt, entry.qty, entry.location, entry.createdAt]
    );

   await logAudit(req, "STOCK_ADD", "stock", entry.id, {
      gtin: entry.gtin,
      productName: entry.productName,
      lot: entry.lot,
      qty: entry.qty
    });

    res.json({ ok: true, entry });
  } catch (e) {
    console.error("POST /api/stock error:", e);
    res.status(500).json({ error: "Eroare DB stock add" });
  }
});

// UPDATE stock lot
app.put("/api/stock/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    if (!db.hasDb()) {
      const stock = readJson(STOCK_FILE, []);
      const item = stock.find(s => String(s.id) === id);
      if (!item) return res.status(404).json({ error: "Intrare stoc inexistentă" });

      const beforeQty = item.qty;
      const beforeLoc = item.location || "A";

      if (req.body.qty != null) item.qty = Number(req.body.qty);
      if (req.body.location != null) item.location = String(req.body.location);

      writeJson(STOCK_FILE, stock);

await logAudit(req, "STOCK_EDIT", "stock", item.id, {
        gtin: item.gtin,
        productName: item.productName,
        lot: item.lot,
        beforeQty,
        afterQty: item.qty,
        beforeLoc,
        afterLoc: item.location
      });

      return res.json({ ok: true, item });
    }

    const r0 = await db.q(`SELECT * FROM stock WHERE id=$1`, [id]);
    if (!r0.rows.length) return res.status(404).json({ error: "Intrare stoc inexistentă" });

    const before = r0.rows[0];
    const newQty = req.body.qty != null ? Number(req.body.qty) : Number(before.qty);
    const newLoc = req.body.location != null ? String(req.body.location) : String(before.location || "A");

    await db.q(`UPDATE stock SET qty=$1, location=$2 WHERE id=$3`, [newQty, newLoc, id]);

   await logAudit(req, "STOCK_EDIT", "stock", id, {
      gtin: before.gtin,
      productName: before.product_name,
      lot: before.lot,
      beforeQty: Number(before.qty),
      afterQty: newQty,
      beforeLoc: before.location,
      afterLoc: newLoc
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/stock/:id error:", e);
    res.status(500).json({ error: "Eroare DB stock edit" });
  }
});

// DELETE stock lot
app.delete("/api/stock/:id", async (req, res) => {
  try {
    const id = String(req.params.id);

    if (!db.hasDb()) {
      const stock = readJson(STOCK_FILE, []);
      const index = stock.findIndex(s => String(s.id) === id);
      if (index === -1) return res.status(404).json({ error: "Intrare stoc inexistentă" });

      const item = stock[index];

     await logAudit(req, "STOCK_DELETE", "stock", item.id, {
        productName: item.productName,
        lot: item.lot,
        expiresAt: item.expiresAt,
        qty: item.qty
      });

      stock.splice(index, 1);
      writeJson(STOCK_FILE, stock);
      return res.json({ ok: true });
    }

    const r0 = await db.q(`SELECT * FROM stock WHERE id=$1`, [id]);
    if (!r0.rows.length) return res.status(404).json({ error: "Intrare stoc inexistentă" });

    const item = r0.rows[0];

    await db.q(`DELETE FROM stock WHERE id=$1`, [id]);

   await logAudit(req, "STOCK_DELETE", "stock", id, {
      productName: item.product_name,
      lot: item.lot,
      expiresAt: item.expires_at,
      qty: Number(item.qty || 0)
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/stock/:id error:", e);
    res.status(500).json({ error: "Eroare DB stock delete" });
  }
});


// Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    const r = await db.q(
      `SELECT id, username, password_hash, role, active
       FROM users
       WHERE username=$1
       LIMIT 1`,
      [username]
    );

    const u = r.rows[0];
    if (!u || !u.active) return res.status(401).json({ error: "User sau parolă greșită" });

    const ok = bcrypt.compareSync(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "User sau parolă greșită" });

    req.session.user = { id: u.id, username: u.username, role: u.role };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    console.error("LOGIN error:", e);
    res.status(500).json({ error: "Eroare login" });
  }
});

// Register 
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ error: "Date lipsă" });
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    const passwordHash = bcrypt.hashSync(password, 10);

    const r = await db.q(
      `INSERT INTO users (username, password_hash, role, active)
       VALUES ($1,$2,'user',true)
       RETURNING id, username, role`,
      [username.trim(), passwordHash]
    );

    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    if (String(e.message || "").includes("duplicate key")) {
      return res.status(400).json({ error: "Utilizator existent" });
    }
    console.error("REGISTER error:", e);
    res.status(500).json({ error: "Eroare register" });
  }
});




// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});









app.post("/api/products", async (req, res) => {
  try {
    const { name, gtin, category, price, gtins } = req.body;

    if (!name) return res.status(400).json({ error: "Lipsește numele" });
    if (!db.hasDb()) return res.status(500).json({ error: "DB neconfigurat" });

    const gtinClean = normalizeGTIN(gtin || "") || null;

    // gtins jsonb = listă cu gtin principal + cele extra
    const gtinsArr = []
      .concat(gtinClean ? [gtinClean] : [])
      .concat(Array.isArray(gtins) ? gtins : [])
      .map(normalizeGTIN)
      .filter(Boolean);

    const cat = String(category || "Altele").trim() || "Altele";
    const pr = (price != null && price !== "") ? Number(price) : null;

    // IMPORTANT: returnăm id (și îl folosim la audit)
   const r = await db.q(
  `INSERT INTO products (name, gtins, category, price)
   VALUES ($1,$2::jsonb,$3,$4)
   RETURNING id`,
  [
    String(name).trim(),
    JSON.stringify(gtinsArr),
    cat,
    (Number.isFinite(pr) ? pr : null)
  ]
);

    const id = r.rows[0].id;

    await logAudit(req, "PRODUCT_ADD", "product", id, {
      name: String(name).trim(),
      gtin: gtinClean,
      category: cat,
      price: pr
    });

    return res.json({ ok: true, id });

  } catch (e) {
    // arată exact CE constraint e lovit
    if (String(e.code) === "23505") {
      // e.constraint e foarte util
      const c = String(e.constraint || "");

      if (c.includes("products_gtin") || c.includes("gtin")) {
        return res.status(400).json({ error: "GTIN existent deja" });
      }
      if (c.includes("products_name") || c.includes("name")) {
        return res.status(400).json({ error: "Produs existent deja (nume duplicat)" });
      }
      return res.status(400).json({ error: "Valoare existentă deja (duplicat)" });
    }

    console.error("POST /api/products error:", e);
    return res.status(500).json({ error: e.message || "Eroare DB product add" });
  }
});

app.post("/api/clients", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const group = String(req.body.group || "").trim();
    const category = String(req.body.category || "").trim();
    const prices = (req.body.prices && typeof req.body.prices === "object") ? req.body.prices : {};

    if (!name) return res.status(400).json({ error: "Lipsește numele clientului" });

    // DB
    if (db.hasDb()) {
      const id = Date.now().toString(); // suficient pt acum; mai târziu punem uuid
      await db.q(
        `INSERT INTO clients (id, name, group_name, category, prices)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [id, name, group, category, JSON.stringify(prices)]
      );

      return res.json({ ok: true, id });
    }

    // fallback local file
    const clients = readJson(CLIENTS_FILE, []);
    const id = Date.now().toString();
    clients.push({ id, name, group, category, prices });
    writeJson(CLIENTS_FILE, clients);
    return res.json({ ok: true, id });

  } catch (e) {
    console.error("POST /api/clients error:", e);
    res.status(500).json({ error: "Eroare la salvarea clientului" });
  }
});










const PORT = process.env.PORT || 3000;

// Creează un admin implicit (doar dacă tabela users e goală)
async function ensureDefaultAdmin() {
  if (!db.hasDb()) return;

  const username = String(process.env.ADMIN_USER || "admin").trim();
  const password = String(process.env.ADMIN_PASS || "admin").trim();

  // Nu vrem să creăm user cu parolă goală
  if (!username || !password) {
    console.warn("⚠️ ADMIN_USER/ADMIN_PASS lipsesc -> sar peste crearea adminului implicit.");
    return;
  }

  const r = await db.q("SELECT COUNT(*)::int AS n FROM users");
  const n = r.rows?.[0]?.n ?? 0;
  if (n > 0) return;

  const hash = await bcrypt.hash(password, 10);
  await db.q(
    "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)",
    [username, hash, "admin"]
  );

  console.log(`✅ Admin implicit creat: ${username}`);
}

(async () => {
  // IMPORTANT:
  // - dacă DB e configurat greșit / cade temporar, NU vrem 502 (Railway).
  // - pornim serverul oricum; doar API-urile DB pot da erori până rezolvi DB.
  try {
   await db.ensureTables();
console.log("✅ DB ready");
await seedClientsFromFileIfEmpty();
await seedProductsFromFileIfEmpty();
await ensureDefaultAdmin();
  } catch (e) {
    console.error("❌ DB init error (pornesc fără DB):", e?.message || e);
  }

  app.listen(PORT, () => console.log("Server pornit pe port", PORT));
})();



