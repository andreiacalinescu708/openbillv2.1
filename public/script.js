

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      ...options
    });

    if (res.status === 401) {
      // DOAR dacă NU suntem deja pe login
      if (!location.pathname.endsWith("login.html")) {
        location.href = "login.html";
      }
      throw new Error("Neautentificat");
    }

    return res;
  }


  async function initLoginPage() {
    if (!location.pathname.endsWith("login.html")) return;

    const form = document.getElementById("loginForm");
    const msg = document.getElementById("loginMsg");
    if (!form) return;

    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = "";

      const username = document.getElementById("loginUser").value.trim();
      const password = document.getElementById("loginPass").value;

      const res = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || "Eroare la login";
        return;
      }

      location.href = "index.html";
    };
  }

  async function initRegister() {
    if (!location.pathname.endsWith("register.html")) return;

    const form = document.getElementById("registerForm");
    const msg = document.getElementById("registerMsg");
    if (!form) return;

    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = "";

      const username = document.getElementById("regUser").value.trim();
      const password = document.getElementById("regPass").value;

      if (!username || !password) {
        msg.textContent = "Completează toate câmpurile";
        return;
      }

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || "Eroare";
        return;
      }

      alert("Cont creat. Te poți loga.");
      location.href = "login.html";
    };
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }




  async function protectPage() {
    if (location.pathname.endsWith("login.html")) return;

    let me;
    try {
      const res = await apiFetch("/api/me");
      me = await res.json();
    } catch {
      return; // apiFetch deja redirecționează
    }

    if (!me.loggedIn) {
      location.href = "login.html";
    }
  }

  async function renderUserBar() {
    const bar = document.getElementById("userBar");
    if (!bar) return;

    const res = await apiFetch("/api/me");
    const me = await res.json();

    if (!me.loggedIn) {
      bar.innerHTML = "";
      return;
    }

    bar.innerHTML = `
      <div class="userbar-inner">
        <div class="user-pill">
          <span class="user-ico">👤</span>
          <span class="user-txt">${escapeHtml(me.user.username)} (${escapeHtml(me.user.role)})</span>
        </div>

        <button id="btnLogout" class="logout-btn" type="button">Logout</button>
      </div>
    `;

    document.getElementById("btnLogout").onclick = async () => {
      await apiFetch("/api/logout", { method: "POST" });
      location.href = "login.html";
    };
  }



  let stockMap = {};
  const LOW_STOCK_LIMIT = 30;


  const CATEGORY_ORDER = [
  "Seni Active Classic x30",
  "Seni Active Classic x10",
  "Seni Classic Air x30",
  "Seni Classic Air x10",
  "Seni Aleze x30",
  "Seni Lady",
  "Manusi",
  "Absorbante Bella",
  "Altele"
];

function sortCategories(keys) {
  const orderIndex = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return [...keys].sort((a, b) => {
    const ia = orderIndex.has(a) ? orderIndex.get(a) : 9999;
    const ib = orderIndex.has(b) ? orderIndex.get(b) : 9999;
    if (ia !== ib) return ia - ib;
    return String(a).localeCompare(String(b), "ro");
  });
}


  // ================= STORAGE =================
  function getSelectedClient() {
    try {
      return JSON.parse(localStorage.getItem("clientSelectat"));
    } catch {
      return null;
    }
  }

  function setSelectedClient(client) {
    const cart = getCart();
    if (cart.length > 0) {
      alert("Nu poți schimba clientul cât timp există produse în coș.");
      return false;
    }
    localStorage.setItem("clientSelectat", JSON.stringify(client));
    return true;
  }

  function getCart() {
    try {
      const cart = JSON.parse(localStorage.getItem("cart"));
      return Array.isArray(cart) ? cart : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem("cart", JSON.stringify(cart));
  }

  function clearCart() {
    localStorage.setItem("cart", JSON.stringify([]));
  }


  // ================= CART =================


  function incQtyByGTIN(gtin) {
    const cart = getCart();
    const g = normalizeGTIN(gtin);
    const p = cart.find(x => normalizeGTIN(x.gtin) === g);
    if (p) p.qty++;
    saveCart(cart);
    renderCart();
  }

  function decQtyByGTIN(gtin) {
    const cart = getCart();
    const g = normalizeGTIN(gtin);
    const p = cart.find(x => normalizeGTIN(x.gtin) === g);
    if (!p) return;

    p.qty--;
    if (p.qty <= 0) cart.splice(cart.indexOf(p), 1);

    saveCart(cart);
    renderCart();
  }
  function setQty(id, value) {
    const cart = getCart();
    const p = cart.find(x => x.id === id);
    if (!p) return;

    const qty = parseInt(value, 10);

    if (isNaN(qty) || qty <= 0) {
      removeItem(id);
      return;
    }

    p.qty = qty;
    saveCart(cart);
    renderCart();
  }


  function removeItemByGTIN(gtin) {
    const g = normalizeGTIN(gtin);
    saveCart(getCart().filter(x => normalizeGTIN(x.gtin) !== g));
    renderCart();
  }

  function renderCart() {
    const box = document.getElementById("cartBox");
    const totalBox = document.getElementById("cartTotal");

    if (!box) return;

    const cart = getCart();

    box.innerHTML = "";

    if (!cart.length) {
      box.innerHTML = "<p class='hint'>Coș gol</p>";
      if (totalBox) totalBox.innerHTML = "";
      return;
    }

    let total = 0;

    cart.forEach(i => {
      const row = document.createElement("div");

    const available = stockMap[normalizeGTIN(i.gtin)] || 0;

      const insufficient = i.qty > available;

      row.className = "cartItem" + (insufficient ? " out-of-stock" : "");

      const left = document.createElement("div");
      left.className = "cartLeft";

      const price = Number(i.price) || 0;
      const lineTotal = price * i.qty;
      total += lineTotal;

      left.innerHTML = `
        <strong>${i.name}</strong>
        <div class="price">
          Preț: ${price.toFixed(2)} RON × ${i.qty}
          = <strong>${lineTotal.toFixed(2)} RON</strong>
        </div>
        ${
          insufficient
            ? `<div class="stock-warning">❌ Stoc insuficient (disponibil: ${available})</div>`
            : `<div class="stock-ok">✔️ Stoc OK (${available})</div>`
        }
      `;

      const right = document.createElement("div");
      right.className = "cartRight";

      const btnDec = document.createElement("button");
      btnDec.textContent = "−";
      btnDec.onclick = () => decQtyByGTIN(i.gtin);

      const qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.min = "1";
      qtyInput.value = i.qty;
      qtyInput.style.width = "70px";

      qtyInput.onchange = () => {
        const val = parseInt(qtyInput.value, 10);
        if (isNaN(val) || val <= 0) return;
        i.qty = val;
        saveCart(cart);
        renderCart(); // IMPORTANT: actualizează totalul
      };

      const btnInc = document.createElement("button");
      btnInc.textContent = "+";
    btnInc.onclick = () => incQtyByGTIN(i.gtin);

      const btnDel = document.createElement("button");
      btnDel.textContent = "🗑";
      btnDel.onclick = () => removeItemByGTIN(i.gtin);

      right.append(btnDec, qtyInput, btnInc, btnDel);
      row.append(left, right);
      box.appendChild(row);
    });

    if (totalBox) {
      totalBox.innerHTML = `
        <strong>Total comandă:</strong>
        <span>${total.toFixed(2)} RON</span>
      `;
    }
    console.log("TOTAL COS:", total);

  }

  function initViewCurrentOrderButton() {
    const btn = document.getElementById("btnViewCurrentOrder");
    if (!btn) return;

    btn.onclick = () => {
      const cart = getCart();

      if (!cart || cart.length === 0) {
        alert("Nu există produse în coș.");
        return;
      }

      location.href = "comanda.html";
    };
    

  }

  // ================= CLIENT HOME (client.html) =================
  async function initClientHomePage() {
    if (!location.pathname.endsWith("client.html")) return;

    const client = getSelectedClient();
    if (!client) {
      alert("Nu este selectat niciun client.");
      location.href = "adauga_comanda.html";
      return;
    }

    const nameEl = document.getElementById("clientName");
    const metaEl = document.getElementById("clientMeta");

    if (nameEl) nameEl.textContent = `Client: ${client.name}`;
    if (metaEl) metaEl.textContent = `Grup: ${client.group || "-"} • Categorie: ${client.category || "-"}`;

    const btnNewOrder = document.getElementById("btnNewOrder");
    const btnPrices = document.getElementById("btnPrices");
    const btnClientOrders = document.getElementById("btnClientOrders");
    const btnClientSold = document.getElementById("btnClientSold");
    const btnClientInvoices = document.getElementById("btnClientInvoices");

    if (btnNewOrder) btnNewOrder.onclick = () => (location.href = "comanda.html");

    // ✅ Prețuri speciale = pagină separată
  if (btnPrices) btnPrices.onclick = () => {
    location.href = "client_prices.html";
  };

    // ✅ Comenzi doar pentru client
    if (btnClientOrders) btnClientOrders.onclick = () => {
      localStorage.setItem("ordersClientFilter", client.name);
      location.href = "orders.html";
    };

    // placeholders
    if (btnClientSold) btnClientSold.onclick = () => {
      alert("Sold client: placeholder. Mai târziu îl legăm la programul de facturare.");
    };

    if (btnClientInvoices) btnClientInvoices.onclick = () => {
      alert("Facturi client: placeholder. Mai târziu îl legăm la programul de facturare.");
    };
  }


  async function initClientPricesPage() {
    if (!location.pathname.endsWith("client_prices.html")) return;

    const elName = document.getElementById("pricesClientName");
    const elMeta = document.getElementById("pricesClientMeta");
    const list = document.getElementById("clientPricesList");

    const inpSearch = document.getElementById("priceProductSearch");
    const boxResults = document.getElementById("priceProductResults");

    const selBox = document.getElementById("selectedProductBox");
    const inpNewPrice = document.getElementById("newSpecialPrice");
    const btnAdd = document.getElementById("btnAddSpecialPriceNow");

    const btnReload = document.getElementById("btnReloadPrices");

    if (!list || !inpSearch || !boxResults || !selBox || !btnAdd) return;

    const clientLocal = getSelectedClient();
    if (!clientLocal || !clientLocal.id) {
      alert("Nu este selectat niciun client. Selectează clientul din lista de clienți.");
      location.href = "adauga_comanda.html";
      return;
    }

    // 1) încărcăm clientul real din DB (ca să avem mereu prices actual)
    async function loadClient() {
      const r = await apiFetch(`/api/clients/${encodeURIComponent(clientLocal.id)}`);
      const c = await r.json();
      return c;
    }

    // 2) încărcăm catalog produse (pt nume + preț listă)
    async function loadProducts() {
      const r = await apiFetch("/api/products-flat");
      return await r.json();
    }

    const esc = (s) =>
      String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    let selectedProduct = null;
    let currentClient = null; // ✅ ținem clientul încărcat (cu prices actuale)
    let products = [];
    let productById = new Map();

  function renderSelected() {
    if (!selectedProduct) {
      selBox.innerHTML = "<i>(nimic)</i>";
      return;
    }

    const p = selectedProduct;
    const base = Number(p.price || 0);

    const prices = currentClient?.prices || {};
    const spRaw = prices[String(p.id)];
    const hasSpecial = spRaw != null && spRaw !== "";
    const special = Number(spRaw || 0);

    selBox.innerHTML = `
      <div><b>${esc(p.name)}</b></div>
      <div class="hint">${esc(p.path || "")}</div>
      <div class="hint">Preț listă: <b>${base.toFixed(2)} RON</b></div>
      <div class="hint">Preț special: <b>${hasSpecial ? special.toFixed(2) : "—"}</b> ${hasSpecial ? "RON" : ""}</div>
      <div class="hint">ID produs: <b>${esc(p.id)}</b></div>
    `;

    // ✅ dacă există deja preț special, îl pun direct în input ca să-l poți edita ușor
    inpNewPrice.value = hasSpecial ? String(special) : "";
  }

    function renderProductsSearch(q) {
      boxResults.innerHTML = "";
      const query = String(q || "").toLowerCase().trim();
      if (!query) return;

      const matches = products
        .filter(p => {
          const name = String(p.name || "").toLowerCase();
          const path = String(p.path || "").toLowerCase();
          const gtin = String(p.gtin || "").toLowerCase();
          const gtins = Array.isArray(p.gtins) ? p.gtins.join(" ").toLowerCase() : "";
          return name.includes(query) || path.includes(query) || gtin.includes(query) || gtins.includes(query);
        })
        .slice(0, 25);

      matches.forEach(p => {
        const b = document.createElement("button");
        b.className = "itembtn";
        b.innerHTML = `<b>${esc(p.name)}</b> <span class="hint">(${esc(p.path || "")})</span>`;
      b.onclick = () => {
    selectedProduct = p;

    // ✅ golește search + închide sugestiile
    inpSearch.value = "";
    boxResults.innerHTML = "";

    renderSelected();
  };
        boxResults.appendChild(b);
      });
    }

    async function saveClientPrices(clientId, pricesObj) {
      const r = await apiFetch(`/api/clients/${encodeURIComponent(clientId)}/prices`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices: pricesObj })
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Eroare la salvare prețuri");
      return out;
    }

    function renderPrices(client) {
      list.innerHTML = "";

      const prices = client.prices || {};
      const entries = Object.entries(prices);

      if (!entries.length) {
        list.innerHTML = `<p class="hint">Clientul nu are prețuri speciale.</p>`;
        return;
      }

      // sort după nume produs
      entries.sort(([a], [b]) => {
        const pa = productById.get(String(a));
        const pb = productById.get(String(b));
        const na = String(pa?.name || `Produs ${a}`);
        const nb = String(pb?.name || `Produs ${b}`);
        return na.localeCompare(nb, "ro");
      });

      entries.forEach(([pid, sp]) => {
        const p = productById.get(String(pid));
        const pname = p?.name || `Produs ID ${pid}`;
        const ppath = p?.path || "";
        const base = Number(p?.price || 0);
        const special = Number(sp || 0);

        const row = document.createElement("div");
        row.className = "cartItem"; // reuse style frumos

        row.innerHTML = `
          <div class="cartLeft">
            <strong>${esc(pname)}</strong>
            <div class="hint">${esc(ppath)}</div>
            <div class="hint">Preț listă: <b>${base.toFixed(2)} RON</b></div>
            <div class="hint">ID produs: <b>${esc(pid)}</b></div>
          </div>

          <div class="cartRight" style="gap:8px;">
            <input type="number" step="0.01" value="${Number.isFinite(special) ? special : 0}"
                  style="width:120px;" />
            <button class="btnSave">💾</button>
            <button class="btnDel">🗑</button>
          </div>
        `;

        const inp = row.querySelector("input");
        const btnSave = row.querySelector(".btnSave");
        const btnDel = row.querySelector(".btnDel");

        btnSave.onclick = async () => {
          try {
            const v = Number(inp.value);
            if (!Number.isFinite(v) || v <= 0) {
              alert("Preț invalid. Pune un număr > 0.");
              return;
            }

            // actualizăm local + salvăm în DB
            client.prices = client.prices || {};
            client.prices[String(pid)] = v;

            await saveClientPrices(client.id, client.prices);
            alert("Salvat ✅");
          } catch (e) {
            alert(e.message || "Eroare");
          }
        };

        btnDel.onclick = async () => {
          if (!confirm("Ștergi prețul special pentru acest produs?")) return;
          try {
            client.prices = client.prices || {};
            delete client.prices[String(pid)];

            await saveClientPrices(client.id, client.prices);
            row.remove();

            if (!Object.keys(client.prices).length) {
              renderPrices(client);
            }
          } catch (e) {
            alert(e.message || "Eroare");
          }
        };

        list.appendChild(row);
      });
    }

    async function refreshAll() {
      const [client, prods] = await Promise.all([loadClient(), loadProducts()]);
      currentClient = client;
      products = Array.isArray(prods) ? prods : [];
      productById = new Map();
      products.forEach(p => productById.set(String(p.id), p));

      if (elName) elName.textContent = `Prețuri speciale – ${client.name}`;
      if (elMeta) elMeta.textContent = `Grup: ${client.group || "-"} • Categorie: ${client.category || "-"}`;

      renderSelected();
      renderPrices(client);

      // ținem clientul actualizat și în localStorage (ca să fie consistent)
      localStorage.setItem("clientSelectat", JSON.stringify(client));
    }

    inpSearch.addEventListener("input", () => renderProductsSearch(inpSearch.value));

    btnAdd.onclick = async () => {
      try {
        if (!selectedProduct) {
          alert("Selectează un produs din rezultate.");
          return;
        }

        const v = Number(inpNewPrice.value);
        if (!Number.isFinite(v) || v <= 0) {
          alert("Preț invalid. Pune un număr > 0.");
          return;
        }

        // luăm client curent din localStorage (după refreshAll e sincron)
        const c = getSelectedClient();
        if (!c || !c.id) return alert("Client invalid.");

        c.prices = c.prices || {};
        c.prices[String(selectedProduct.id)] = v;

        await saveClientPrices(c.id, c.prices);

        // refresh ca să vedem lista actualizată + sort
        await refreshAll();

        inpNewPrice.value = "";
        inpSearch.value = "";
        boxResults.innerHTML = "";
        selectedProduct = null;
        renderSelected();

        alert("Preț special adăugat ✅");
      } catch (e) {
        alert(e.message || "Eroare");
      }
    };

    if (btnReload) btnReload.onclick = refreshAll;

    await refreshAll();
  }





  // ================= TREE =================
  function isObject(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  function renderTree(obj, onClick, opts = {}) {
    const { accordion = true } = opts;

    const box = document.createElement("div");

    if (Array.isArray(obj)) {
      obj.forEach(item => {
        let label = "";
        let value = null;

        if (typeof item === "string") {
          label = item;
          value = item;
        } else if (typeof item === "object") {
  label = item.name;
  value = item.id; // ✅ folosim ID ca legătură
} else {
          return;
        }

      const b = document.createElement("button");
  b.className = "itembtn";

  const lower = String(label || "").toLowerCase();

  // 🎨 doar pentru Aleze
  if (lower.includes("aleze")) {
    if (lower.includes("soft super")) b.classList.add("aleze-super");
    else if (lower.includes("soft normal")) b.classList.add("aleze-normal");
    else if (lower.includes("soft basic")) b.classList.add("aleze-basic");
  }

  b.textContent = label;
  b.onclick = () => onClick(value);
  box.appendChild(b);

      });
      return box;
    }

  if (obj && typeof obj === "object") {
  sortCategories(Object.keys(obj)).forEach(k => {

      // ✅ dacă accordion e dezactivat: afișare simplă cu <h4>
      if (!accordion) {
        const h = document.createElement("h4");
        h.textContent = k;
        box.appendChild(h);
        box.appendChild(renderTree(obj[k], onClick, opts));
        return;
      }

      // ✅ accordion ON (produse)
      const head = document.createElement("button");
      head.type = "button";
      head.className = "accHead";
      head.textContent = k;

      const body = document.createElement("div");
      body.className = "accBody";
      body.style.display = "none";

      body.appendChild(renderTree(obj[k], onClick, opts));

      head.onclick = () => {
        const open = body.style.display !== "none";
        body.style.display = open ? "none" : "block";
        head.classList.toggle("open", !open);
      };

      box.appendChild(head);
      box.appendChild(body);
    });
  }



    return box;
  }

async function initCheckPricePage() {
  const box = document.getElementById("productsList");
  const search = document.getElementById("productsSearch");
  const btnClear = document.getElementById("btnClearSearch");
  const countEl = document.getElementById("cpCount");

  if (!box) return;

  // ---- modal refs
  const modal = document.getElementById("editProductModal");
  const btnClose = document.getElementById("btnCloseEditModal");
  const btnCancel = document.getElementById("btnCancelEdit");
  const btnSave = document.getElementById("btnSaveEdit");
  const btnArchive = document.getElementById("btnArchiveProduct");
  const msg = document.getElementById("editModalMsg");

  const fId = document.getElementById("editProdId");
  const fName = document.getElementById("editProdName");
  const fCat = document.getElementById("editProdCategory");
  const fPrice = document.getElementById("editProdPrice");
  const fGtin = document.getElementById("editProdGtin");
  const fGtins = document.getElementById("editProdGtins");

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  let products = [];

  async function load() {
    const res = await apiFetch("/api/products-flat");
    const data = await res.json().catch(() => []);
    products = Array.isArray(data) ? data : [];
    render();
  }

  function showModal(on) {
    if (!modal) return;
    modal.classList.toggle("hidden", !on);
    modal.setAttribute("aria-hidden", on ? "false" : "true");
    if (!on) {
      if (msg) msg.style.display = "none";
    }
  }

  function setMsg(text) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.display = text ? "" : "none";
  }

  function openEdit(p) {
    fId.value = String(p.id);
    fName.value = p.name || "";
    fCat.value = p.category || "";
    fPrice.value = (p.price == null ? "" : String(p.price));
    fGtin.value = p.gtin || "";

    const arr = Array.isArray(p.gtins) ? p.gtins : [];
    fGtins.value = arr.join("\n");

    setMsg("");
    showModal(true);
    setTimeout(() => fName.focus(), 50);
  }

  async function doArchive(id, name) {
    if (!confirm(`Arhivezi produsul?\n\n${name}\n\nVa dispărea din listă, dar rămâne în comenzile vechi.`)) return;

    const r = await apiFetch(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return alert(out.error || "Eroare la arhivare");

    await load();
  }

  async function doSave() {
    const id = String(fId.value || "").trim();
    if (!id) return;

    const name = String(fName.value || "").trim();
    const category = String(fCat.value || "").trim() || "Altele";
    const priceRaw = String(fPrice.value || "").trim();
    const gtin = String(fGtin.value || "").trim();

    if (!name) return setMsg("Completează numele produsului.");

    const gtins = String(fGtins.value || "")
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean);

    const payload = {
      name,
      category,
      price: priceRaw === "" ? null : Number(priceRaw),
      gtin,
      gtins
    };

    const r = await apiFetch(`/api/products/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const out = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(out.error || "Eroare la salvare");

    showModal(false);
    await load();
  }

  function render() {
    const q = String(search?.value || "").toLowerCase().trim();

    const filtered = !q ? products : products.filter(p => {
      const name = String(p.name || "").toLowerCase();
      const cat = String(p.category || "").toLowerCase();
      const gtin = String(p.gtin || "").toLowerCase();
      const gtins = Array.isArray(p.gtins) ? p.gtins.join(" ").toLowerCase() : "";
      return name.includes(q) || cat.includes(q) || gtin.includes(q) || gtins.includes(q);
    });

    if (countEl) countEl.textContent = String(filtered.length);

    // sort nume
    const sorted = [...filtered].sort((a,b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ro")
    );

    if (!sorted.length) {
      box.innerHTML = `<p class="hint" style="padding:14px; color:rgba(231,238,247,.7)">Nu există produse.</p>`;
      return;
    }

    const table = document.createElement("table");
    table.className = "cp-table";

    table.innerHTML = `
      <thead>
        <tr>
          <th>Produs</th>
          <th style="text-align:right;">Preț listă</th>
          <th style="text-align:right;">Acțiuni</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    sorted.forEach(p => {
      const tr = document.createElement("tr");

      const price = Number(p.price || 0);

      tr.innerHTML = `
        <td>
          <div class="cp-name">${esc(p.name || "")}</div>
          <div class="cp-meta">
            <span class="cp-pill">Categorie: ${esc(p.category || "Altele")}</span>
            ${p.gtin ? `<span class="cp-pill">GTIN: ${esc(p.gtin)}</span>` : ``}
          </div>
        </td>

        <td class="cp-price">${price.toFixed(2)} RON</td>

        <td>
          <div class="cp-actionsCell">
            <button class="cp-btn cp-rowbtn" data-act="edit" data-id="${esc(p.id)}">Edit</button>
            <button class="cp-btn cp-rowbtn danger" data-act="del" data-id="${esc(p.id)}">Șterge</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    box.innerHTML = "";
    box.appendChild(table);

    // handlers
    table.querySelectorAll("button[data-act]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;

        const prod = products.find(x => String(x.id) === String(id));
        if (!prod) return;

        if (act === "del") return doArchive(prod.id, prod.name);
        if (act === "edit") return openEdit(prod);
      };
    });
  }

  // ---- modal close behaviors
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target && e.target.dataset && e.target.dataset.close === "1") showModal(false);
    });
  }
  if (btnClose) btnClose.onclick = () => showModal(false);
  if (btnCancel) btnCancel.onclick = () => showModal(false);

  if (btnSave) btnSave.onclick = doSave;

  if (btnArchive) btnArchive.onclick = async () => {
    const id = String(fId.value || "").trim();
    const name = String(fName.value || "").trim() || "(fără nume)";
    showModal(false);
    await doArchive(id, name);
  };

  // search
  if (search) search.addEventListener("input", render);
  if (btnClear) btnClear.onclick = () => { search.value = ""; render(); };

  // init
  await load();
} 



  // ================= ADAUGA_COMANDA.HTML =================
  async function initAddClientPage() {
    const treeBox = document.getElementById("clientsTree");
    const searchInput = document.getElementById("searchClient");
    const resultsBox = document.getElementById("clientSearchResults");

    if (!treeBox || !searchInput || !resultsBox) return;

    const tree = await fetch("/api/clients-tree").then(r => r.json());
    const flat = await fetch("/api/clients-flat").then(r => r.json());

    // 🌳 afișăm arborele de clienți
  treeBox.appendChild(
    renderTree(
      tree,
      name => {
        const client = flat.find(c => c.name === name);
        if (client && setSelectedClient(client)) {
          location.href = "client.html";
        }
      },
      { accordion: false } // ✅ aici e locul
    )
  );


    // 🔎 SEARCH LIVE CLIENTI
    searchInput.addEventListener("input", () => {
      const q = searchInput ? searchInput.value.toLowerCase().trim() : "";

      resultsBox.innerHTML = "";

      if (!q) return;

      flat
        .filter(c => c.name.toLowerCase().includes(q))
        .slice(0, 20)
        .forEach(c => {
          const b = document.createElement("button");
          b.className = "itembtn";
          b.textContent = c.name;

          b.onclick = () => {
            if (setSelectedClient(c)) {
              location.href = "client.html";
            }
          };

          resultsBox.appendChild(b);
        });
    });
  }
  // ================= COMANDA.HTML =================
  async function initOrderPage() {
    stockMap = {}; // reset global

  const stock = await fetch("/api/stock").then(r => r.json());

  stock.forEach(s => {
  stockMap[normalizeGTIN(s.gtin)] =
    (stockMap[normalizeGTIN(s.gtin)] || 0) + Number(s.qty);

  });

    const treeBox = document.getElementById("productsTree");
    const sendBtn = document.getElementById("btnSendOrder");
    const clearBtn = document.getElementById("btnClearCart");
    const title = document.getElementById("clientTitle");

    console.log("initOrderPage pornit", treeBox);

    if (!treeBox ) return;
    if (sendBtn) {
    sendBtn.onclick = async () => {
      const client = getSelectedClient();
      const items = getCart();

      if (!client) {
        alert("Client nesetat");
        return;
      }

      if (!items.length) {
        alert("Coșul este gol");
        return;
      }

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, items })
      });

      let data = {};
      try {
        data = await res.json();
      } catch {}

      // ❌ STOC INSUFICIENT → NU ȘTERGEM COȘUL
      if (!res.ok || data.error) {
        alert("Stoc insuficient pentru cel puțin un produs.\n\nVerifică cantitățile din coș.");
        return;
      }

      // ✅ SUCCES
      clearCart();
      alert("Comandă trimisă!");
      location.href = "index.html";
    };
  }
  const tree = await fetch("/api/products-tree").then(r => r.json());
   const flatRaw = await fetch("/api/products-flat").then(r => r.json());
const flat = Array.isArray(flatRaw) ? flatRaw : [];



  // 🔎 SEARCH PRODUSE
  const searchInput = document.getElementById("searchProduct");
  const resultsBox = document.getElementById("productSearchResults");

  if (searchInput && resultsBox) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      resultsBox.innerHTML = "";
      if (!q) return;

      flat
        .filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q)
        )
        .slice(0, 20)
        .forEach(p => {
          const b = document.createElement("button");
          b.className = "itembtn";
          b.textContent = `${p.name} (${p.path})`;
          b.onclick = () => addToCart(p);
          resultsBox.appendChild(b);
        });
    });
  }



    const client = getSelectedClient();
    if (client && title) {
      title.textContent = `Client: ${client.name}`;
    }

    
    treeBox.innerHTML = "";
    treeBox.appendChild(
  renderTree(tree, productId => {
    const p = flat.find(x => String(x.id) === String(productId));
    if (p) addToCart(p);
  })
);

    renderCart();

  }


  async function loadClientsAdmin() {
    const res = await apiFetch("/api/clients-flat");
    const clients = await res.json();

    const prodRes = await apiFetch("/api/products-flat");
    const products = await prodRes.json();
    // map prețuri din catalog
  const priceById = new Map();
  const priceByGtin = new Map();

  products.forEach(p => {
    const price = Number(p.price || 0);

    // by id
    if (p.id != null) priceById.set(String(p.id), price);

    // by gtin(s)
    const all = []
      .concat(p.gtin ? [p.gtin] : [])
      .concat(Array.isArray(p.gtins) ? p.gtins : [])
      .filter(Boolean);

    all.forEach(g => priceByGtin.set(normalizeGTIN(g), price));
  });

  // helper: găsește prețul corect
  function resolvePrice(it) {
    const pid = (it.id != null) ? String(it.id) : "";
    if (pid && priceById.has(pid)) return priceById.get(pid);

    const g = normalizeGTIN(it.gtin);
    if (g && priceByGtin.has(g)) return priceByGtin.get(g);

    return Number(it.price || 0); // fallback
  }


    const tree = await apiFetch("/api/clients-tree").then(r => r.json());

    // map id -> nume produs
    const productNameById = new Map();
    products.forEach(p => productNameById.set(String(p.id), String(p.name || "")));

    const box = document.getElementById("clientsList");
    const details = document.getElementById("clientDetails");
    if (!box || !details) return;

    // === găsim inputul de search din ADMIN (foarte robust) ===
    // 1) încearcă ID-uri comune
    let searchInput =
      document.getElementById("searchClientAdmin") ||
      document.getElementById("searchClient") ||
      document.getElementById("clientSearch") ||
      document.getElementById("orderSearch"); // uneori copiat

    // 2) dacă tot nu, ia primul input din zona paginii de admin
    if (!searchInput) {
      // caută un input care are placeholder cu “client”
      searchInput = [...document.querySelectorAll("input")]
        .find(i => String(i.placeholder || "").toLowerCase().includes("client"));
    }

    // 3) container rezultate (opțional)
    let resultsBox =
      document.getElementById("clientSearchResultsAdmin") ||
      document.getElementById("clientSearchResults");

    // dacă nu există, creăm noi unul fix sub input
    if (!resultsBox && searchInput) {
      resultsBox = document.createElement("div");
      resultsBox.id = "clientSearchResultsAdminAuto";
      resultsBox.style.marginTop = "10px";
      searchInput.parentElement?.appendChild(resultsBox);
    }

    // debug: să vezi dacă a găsit inputul
    console.log("[ADMIN] searchInput found:", !!searchInput, searchInput);
    console.log("[ADMIN] resultsBox found:", !!resultsBox, resultsBox);

    function escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function renderClientDetails(c) {
      const prices = c.prices || {};
      const lines = Object.entries(prices);

      lines.sort(([a], [b]) => {
        const na = (productNameById.get(String(a)) || `Produs ID ${a}`).toLowerCase();
        const nb = (productNameById.get(String(b)) || `Produs ID ${b}`).toLowerCase();
        return na.localeCompare(nb, "ro");
      });

      const listHtml = lines.length
        ? `
          <details class="pricesBox">
            <summary><b>Prețuri speciale</b> (${lines.length})</summary>
            <ul>
              ${lines.map(([pid, pr]) => {
                const name = productNameById.get(String(pid)) || `Produs ID ${pid}`;
                const price = Number(pr);
                return `<li><b>${escapeHtml(name)}</b>: <b>${price.toFixed(2)}</b></li>`;
              }).join("")}
            </ul>
          </details>
        `
        : `<div><i>(Nu are prețuri speciale)</i></div>`;

      details.innerHTML = `
        <h3>${escapeHtml(c.name)}</h3>
        <div><b>Grup:</b> ${escapeHtml(c.group || "-")}</div>
        <div><b>Categorie:</b> ${escapeHtml(c.category || "-")}</div>
        <hr/>
        ${listHtml}
      `;
    }

    function renderTreeAdmin() {
      box.innerHTML = "";
      box.appendChild(
        renderTree(
          tree,
          (name) => {
            const client = clients.find(c => c.name === name);
            if (client) renderClientDetails(client);
          },
          { accordion: true } // ✅ collapse/expand
        )
      );
    }

    function renderSearchResults(list) {
    // ✅ întotdeauna afișăm rezultatele în box (lista de clienți)
    box.innerHTML = "";

    if (!list.length) {
      box.innerHTML = "<p class='hint'>Niciun client găsit.</p>";
      return;
    }

    list.slice(0, 50).forEach(c => {
      const b = document.createElement("button");
      b.className = "itembtn";
      b.textContent = c.name;
      b.onclick = () => renderClientDetails(c);
      box.appendChild(b);
    });
  }


    // render default (tree)
    renderTreeAdmin();

    // === legăm SEARCH ===
    if (!searchInput) {
      console.warn("[ADMIN] Nu am găsit inputul de search. Pune-i un id (ex: searchClientAdmin).");
      return;
    }

    // IMPORTANT: nu lăsa pagina să aibă două handlers suprapuse vechi
    searchInput.oninput = null;

    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();

    

      if (!q) {
        renderTreeAdmin();
        return;
      }

      const filtered = clients.filter(c =>
        String(c.name || "").toLowerCase().includes(q)
      );

      renderSearchResults(filtered);
    });
  }


  async function initAddClientForm() {
    const form = document.getElementById("addClientForm");
    if (!form) return;

    const addPriceBtn = document.getElementById("btnAddSpecialPrice");
    const pricesBox = document.getElementById("specialPricesBox");

    addPriceBtn.onclick = () => {
      const row = document.createElement("div");
      row.className = "spRow";
      row.innerHTML = `
        <input class="spGtin" placeholder="GTIN" />
        <input class="spPrice" placeholder="Preț" type="number" step="0.01" />
        <button type="button" class="spRemove">X</button>
      `;
      row.querySelector(".spRemove").onclick = () => row.remove();
      pricesBox.appendChild(row);
    };

    form.onsubmit = async (e) => {
      e.preventDefault();

      const name = document.getElementById("newClientName").value.trim();
      const group = document.getElementById("newClientGroup").value;
      const category = document.getElementById("newClientCategory").value;

      if (!name) return alert("Completează numele.");

      // luam produse ca să mapăm GTIN->id
      const prodRes = await apiFetch("/api/products-flat");
      const products = await prodRes.json();

  const gtinToId = new Map();

  products.forEach(p => {
    const all = []
      .concat(p.gtin ? [p.gtin] : [])
      .concat(Array.isArray(p.gtins) ? p.gtins : [])
      .filter(Boolean);

    all.forEach(g => gtinToId.set(normalizeGTIN(g), String(p.id)));
  });

      const prices = {};
      [...pricesBox.querySelectorAll(".spRow")].forEach(r => {
  const gtin = normalizeGTIN(r.querySelector(".spGtin").value.trim());
        const pr = r.querySelector(".spPrice").value.trim();
        if (!gtin || !pr) return;

        const pid = gtinToId.get(gtin);
        if (!pid) return; // GTIN necunoscut

        prices[pid] = Number(pr);
      });

      const res = await apiFetch("/api/clients", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ name, group, category, prices })
      });

      const out = await res.json();
      if (!res.ok) return alert(out.error || "Eroare");

      alert("Client adăugat!");
      form.reset();
      pricesBox.innerHTML = "";
      await loadClientsAdmin();
    };
  }


  function getProductClass(name) {
    const n = name.toLowerCase();

    if (n.includes("active") || n.includes("chilot")) return "active";
    if (n.includes("air") || n.includes("scai")) return "air";
    if (n.includes("lady")) return "lady";
    if (n.includes("bella")) return "bella";

    return "altele";
  }

  async function initProductsPage() {
  const btnShow = document.getElementById("btnShowAddProduct");
  const modal = document.getElementById("addProductModal");
  const btnCancel = document.getElementById("btnCancelProduct");
  const btnSave = document.getElementById("btnSaveProduct");

  // nu suntem pe pagina produse
  if (!btnShow) return;

  if (!modal || !btnCancel || !btnSave) {
    console.warn("Lipsesc elemente modal produse (addProductModal/btnCancelProduct/btnSaveProduct).");
    return;
  }

  btnShow.onclick = () => modal.classList.remove("hidden");
  btnCancel.onclick = () => modal.classList.add("hidden");

  btnSave.onclick = async () => {
    const name = document.getElementById("newProdName")?.value.trim();
    const gtin = document.getElementById("newProdGtin")?.value.trim();
    const priceRaw = document.getElementById("newProdPrice")?.value.trim();
    const category = document.getElementById("newProdCategory")?.value.trim();

    if (!name) return alert("Completează numele produsului.");

    const res = await apiFetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        gtin,
        category,
        price: priceRaw ? Number(priceRaw) : null
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || "Eroare la salvare");

    modal.classList.add("hidden");

    // reset
    ["newProdName","newProdGtin","newProdPrice","newProdCategory"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    // refresh simplu
    location.reload();
  };
}

  // ================= ORDERS.HTML =================
  // ================= ORDERS.HTML =================
  async function initOrdersPage() {
    const list = document.getElementById("ordersList");
    if (!list) return;

    const selGroup = document.getElementById("filterGroup");
    const selCategory = document.getElementById("filterCategory");
    const selStatus = document.getElementById("filterStatus"); // poate fi ascuns, dar îl păstrăm pt state
    const tabsBox = document.getElementById("statusTabs");

    const searchInput = document.getElementById("orderSearch");
    const searchResults = document.getElementById("orderSearchResults");
    const btnReset = document.getElementById("btnResetFilters");

    const statusLabels = {
      "": "Toate",
      gata_de_livrare: "Gata de livrare",
      in_procesare: "În procesare",
      facturata: "Facturată",
      livrata: "Livrată"
    };

    // ordinea din poză (poți schimba cum vrei)
    const TAB_ORDER = ["gata_de_livrare", "in_procesare", "facturata", "livrata", ""];

    function getSafeStatus(o) {
      return o.status || "in_procesare";
    }

    function getFilterState() {
      return {
        gFilter: selGroup ? (selGroup.value || "") : "",
        cFilter: selCategory ? (selCategory.value || "") : "",
        sFilter: selStatus ? (selStatus.value || "") : "",
        q: searchInput ? (searchInput.value || "").toLowerCase().trim() : ""
      };
    }

    function setStatusFilter(v) {
      const val = v || "";
      if (selStatus) selStatus.value = val;

      if (tabsBox) {
        [...tabsBox.querySelectorAll(".mTab")].forEach(b => {
          b.classList.toggle("active", (b.dataset.status || "") === val);
        });
      }
    }

    // 1) LOAD ORDERS
    const res = await apiFetch("/api/orders");
    if (!res.ok) {
      const txt = await res.text();
      console.error("API /orders error:", txt);
      alert("Eroare server la încărcare comenzi (vezi consola server).");
      return;
    }
    const orders = await res.json();

    // 2) LOAD CLIENTS (pt group/category corecte)
    const clients = await apiFetch("/api/clients-flat").then(r => r.json());

    // map clientName -> group / category (din DB/clients)
    const clientGroupMap = {};
    const clientCategoryMap = {};
    clients.forEach(c => {
      const name = String(c.name || "").trim();
      if (!name) return;
      clientGroupMap[name] = String(c.group || "").trim();
      clientCategoryMap[name] = String(c.category || "").trim();
    });
    const forcedClient = localStorage.getItem("ordersClientFilter") || "";


    // helper: group-ul real pt o comandă
    function getOrderGroup(o) {
      const name = o?.client?.name;
      return clientGroupMap[name] || o?.client?.group || "";
    }

    // helper: categoria reală pt o comandă
    function getOrderCategory(o) {
      const name = o?.client?.name;
      return clientCategoryMap[name] || "";
    }

    // 3) BUILD GROUP OPTIONS (Traseu)
    function buildGroupOptions() {
      if (!selGroup) return;

      const groups = new Set();
      orders.forEach(o => {
        const g = getOrderGroup(o);
        if (g) groups.add(g);
      });

      selGroup.innerHTML = `<option value="">Toate</option>`;
      [...groups].sort((a, b) => a.localeCompare(b, "ro")).forEach(g => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        selGroup.appendChild(opt);
      });
    }

    // 4) CATEGORY OPTIONS REBUILT by group
  function rebuildCategoryOptions() {
  if (!selCategory) return;

  const gFilter = selGroup ? (selGroup.value || "") : "";

  // strângem categoriile existente (din comenzi)
  const catsSet = new Set();
  orders.forEach(o => {
    const g = getOrderGroup(o);
    if (gFilter && g !== gFilter) return;

    const cat = getOrderCategory(o);
    if (cat) catsSet.add(cat);
  });

  const prev = selCategory.value || "";
  selCategory.innerHTML = `<option value="">Toate</option>`;

  // ✅ ordinea fixă (poți modifica cum vrei)
  const CATEGORY_ORDER = [
    "Seni Active Classic x30",
    "Seni Active Classic x10",
    "Seni Classic Air x30",
    "Seni Classic Air x10",
    "Seni Aleze x30",
    "Seni Lady",
    "Manusi",
    "Absorbante Bella",
    "Altele"
  ];

  const cats = [...catsSet];

  // întâi cele din CATEGORY_ORDER, apoi restul (în ordine alfabetică)
  const ordered = [];
  CATEGORY_ORDER.forEach(c => { if (catsSet.has(c)) ordered.push(c); });

  const rest = cats
    .filter(c => !CATEGORY_ORDER.includes(c))
    .sort((a, b) => a.localeCompare(b, "ro"));

  [...ordered, ...rest].forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    selCategory.appendChild(opt);
  });

  selCategory.value = catsSet.has(prev) ? prev : "";
}

    

    // 5) COUNTS + TABS
    function getCounts() {
      const counts = { "": 0, gata_de_livrare: 0, in_procesare: 0, facturata: 0, livrata: 0 };
      orders.forEach(o => {
        const s = getSafeStatus(o);
        if (counts[s] == null) counts[s] = 0;
        counts[s]++;
        counts[""]++;
      });
      return counts;
    }

    function renderTabs() {
      if (!tabsBox) return;

      const counts = getCounts();
      tabsBox.innerHTML = "";

      TAB_ORDER.forEach(st => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mTab";
        btn.dataset.status = st;

        btn.innerHTML = `
          <span>${statusLabels[st] || st}</span>
          <span class="badge">${counts[st] || 0}</span>
        `;

        btn.onclick = () => {
          setStatusFilter(st);
          render();
        };

        tabsBox.appendChild(btn);
      });

      // default = Toate
      const current = selStatus ? (selStatus.value || "") : "";
      setStatusFilter(current);
    }

    // 6) RENDER LIST
    function render() {
      const { gFilter, cFilter, sFilter, q } = getFilterState();
      list.innerHTML = "";

      const filtered = orders.filter(o => {
        const g = getOrderGroup(o);
        if (gFilter && g !== gFilter) return false;

        const cat = getOrderCategory(o);
        if (cFilter && cat !== cFilter) return false;

        const st = getSafeStatus(o);
        if (sFilter && st !== sFilter) return false;

        const clientName = String(o?.client?.name || "").toLowerCase();
        if (q && !clientName.includes(q)) return false;
        if (forcedClient) {
    const cn = String(o?.client?.name || "");
    if (cn !== forcedClient) return false;
  }


        return true;
      });

      if (!filtered.length) {
        list.innerHTML = "<p class='hint'>Nu există comenzi.</p>";
        return;
      }

      filtered
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .forEach(o => {
          if (!o || !Array.isArray(o.items)) {
            console.warn("Comandă invalidă ignorată:", o);
            return;
          }

          const card = document.createElement("div");
          card.className = "orderCard";

          const head = document.createElement("div");
          head.className = "orderHeader";

          head.innerHTML = `
            <span>
              ${o.client.name} (${getOrderGroup(o)}) –
              ${new Date(o.createdAt).toLocaleDateString("ro-RO")}
            </span>
          `;

          const status = getSafeStatus(o);

          const nextStatusMap = {
            in_procesare: "facturata",
            facturata: "gata_de_livrare",
            gata_de_livrare: "livrata",
            livrata: "in_procesare"
          };

          const statusBtn = document.createElement("button");
          statusBtn.className = `order-status ${status}`;
          statusBtn.textContent = statusLabels[status] || status;

          statusBtn.onclick = async (e) => {
            e.stopPropagation();

            const newStatus = nextStatusMap[status] || "in_procesare";

            const r = await fetch(`/api/orders/${o.id}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: newStatus })
            });

            if (!r.ok) {
              alert("Eroare la schimbare status");
              return;
            }

            o.status = newStatus;

            // IMPORTANT: nu schimbăm tab-ul (rămâne filtrul curent)
            renderTabs();
            render();
          };

          head.appendChild(statusBtn);

          // buton modifică doar în procesare
          if (status === "in_procesare") {
            const editBtn = document.createElement("button");
            editBtn.textContent = "✏️ Modifică";
            editBtn.className = "btnEdit";
            editBtn.onclick = (e) => {
              e.stopPropagation();
              localStorage.setItem("editOrder", JSON.stringify(o));
              location.href = "editorder.html";
            };
            head.appendChild(editBtn);
          }

          const pickBtn = document.createElement("button");
          pickBtn.textContent = "📦 Pregătește comanda";
          pickBtn.className = "btnPick";
          pickBtn.onclick = (e) => {
            e.stopPropagation();
            localStorage.setItem("pickingOrder", JSON.stringify(o));
            localStorage.removeItem("pickState");
            location.href = "pickingorder.html";
          };
          head.appendChild(pickBtn);

          const body = document.createElement("div");
          body.className = "orderBody";
          body.style.display = "none";

          o.items.forEach(i => {
            const row = document.createElement("div");
            row.className = `orderItem ${getProductClass(i.name)}`;

        const gtin = i.gtin || "-";

  // vrem prețul salvat în comandă (snapshot)
  const unitPrice = (i.unitPrice != null) ? Number(i.unitPrice) : null;

  // dacă nu există (comenzi vechi), afișăm 0 și marcăm ca lipsă
  const p = Number.isFinite(unitPrice) ? unitPrice : 0;

  const qty = Number(i.qty || 0);
  const subtotal = (i.lineTotal != null && Number.isFinite(Number(i.lineTotal)))
    ? Number(i.lineTotal)
    : (p * qty);


  let html = `
    <strong>${i.name}</strong> × ${i.qty}
    <div class="muted small">GTIN: ${gtin}</div>
  <div class="muted small">
    Preț client: <b>${p.toFixed(2)} RON</b>
    ${unitPrice == null ? "<span class='muted'>(nesalvat)</span>" : ""}
  </div>
    <div class="muted small">Subtotal: <b>${subtotal.toFixed(2)} RON</b></div>
  `;




            if (Array.isArray(i.allocations) && i.allocations.length > 0) {
              html += `<div class="lots">`;
              i.allocations.forEach(a => {
                html += `
                  <div class="lot">
                    LOC: <strong>${a.location || "-"}</strong>
                    | LOT: ${a.lot}
                    | EXP: ${a.expiresAt}
                    | Qty: ${a.qty}
                  </div>
                `;
              });
              html += `</div>`;
            }

            row.innerHTML = html;
            body.appendChild(row);
          });

          head.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    body.style.display = (body.style.display === "none") ? "block" : "none";
  });


          card.appendChild(head);
          card.appendChild(body);
          list.appendChild(card);
        });
    }

    // 7) SEARCH LIVE
    if (searchInput && searchResults) {
      searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase().trim();
        searchResults.innerHTML = "";
        if (!q) return;

        const matches = orders
          .map(o => o.client?.name)
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .filter(name => name.toLowerCase().includes(q))
          .slice(0, 10);

        matches.forEach(name => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = name;
          b.onclick = () => {
            searchInput.value = name;
            searchResults.innerHTML = "";
            render();
          };
          searchResults.appendChild(b);
        });
      };
    }

    // 8) EVENTS
    if (selGroup) {
      selGroup.onchange = () => {
        rebuildCategoryOptions();
        render();
      };
    }
    if (selCategory) selCategory.onchange = render;
    if (selStatus) selStatus.onchange = render;

    if (btnReset) {
      btnReset.onclick = () => {
        if (selGroup) selGroup.value = "";
        if (selCategory) selCategory.value = "";
        if (searchInput) searchInput.value = "";
        if (searchResults) searchResults.innerHTML = "";

            localStorage.removeItem("ordersClientFilter");

        setStatusFilter("");       // ✅ Tabs = Toate
        rebuildCategoryOptions();  // ✅ refă categorii pt toate traseele
        renderTabs();              // ✅ refă badges
        render();
      };

    }

    // 9) INIT
    buildGroupOptions();
    rebuildCategoryOptions();
    if (selStatus && !selStatus.value) selStatus.value = ""; // default Toate
    renderTabs();
    render();
  }



  function yymmddToISO(v) {
    v = String(v || "").trim();
    if (v.length !== 6) return "";
    return `20${v.slice(0,2)}-${v.slice(2,4)}-${v.slice(4,6)}`;
  }

  function parseGS1(qr) {
    const out = {};
    const s0 = sanitizeGS1(qr);
    if (!s0) return out;

    // dacă are paranteze
    if (s0.includes("(")) {
      const regex = /\((\d{2})\)([^()]*)/g;
      let m;
      while ((m = regex.exec(s0)) !== null) {
        const ai = m[1];
        const val = (m[2] || "").trim();
        if (ai === "01") out.gtin = val;
        else if (ai === "17") out.expiresAt = yymmddToISO(val);
        else if (ai === "10") out.lot = val;
        // 11 ignorăm
      }
      return out;
    }

    // fără paranteze: 01 + 14, 17 + 6, 11 + 6 optional, 10 + LOT (rest)
    let i = 0;
    const s = s0;

    const take = (n) => {
      const part = s.slice(i, i + n);
      i += n;
      return part;
    };

    while (i + 2 <= s.length) {
      const ai = take(2);

      if (ai === "01") { out.gtin = take(14); continue; }
      if (ai === "17") { out.expiresAt = yymmddToISO(take(6)); continue; }
      if (ai === "11") { take(6); continue; } // ignoră fabricație
      if (ai === "10") { out.lot = s.slice(i).trim(); break; }

      break;
    }

    return out;
  }

  function applyParsedGS1(qr) {
    const clean = sanitizeGS1(qr);
    const data = parseGS1(clean);

    console.log("RAW:", qr);
    console.log("CLEAN:", clean);
    console.log("PARSED:", data);

    if (data.lot) {
      const lotEl = document.getElementById("stockLot");
      if (lotEl) lotEl.value = data.lot;
    }

    if (data.expiresAt) {
      const expEl = document.getElementById("stockExpire");
      if (expEl) expEl.value = data.expiresAt;
    }

    if (data.gtin) {
      selectProductByGTIN(data.gtin);
    }
  }

  function sanitizeGS1(raw) {
    const GS = String.fromCharCode(29); // FNC1 / Group Separator
    return String(raw || "")
      .replace(/\u0000/g, "")          // NULL
      .replace(/\u200B/g, "")          // zero-width space
      .replace(new RegExp(GS, "g"), "")// scoate GS (sau îl poți păstra dacă vrei)
      .replace(/[\r\n\t ]+/g, "")      // whitespace
      .trim();
  }





  function normalizeGTIN(gtin) {
    let g = String(gtin || "").replace(/\D/g, ""); // doar cifre
    // dacă ai GTIN-14 cu 0 în față, îl faci GTIN-13
    if (g.length === 14 && g.startsWith("0")) g = g.slice(1);
    return g;
  }

  function selectProductByGTIN(gtin) {
    const sel = document.getElementById("stockProduct");
    if (!sel) return;

    const scanned = normalizeGTIN(gtin);
    let found = false;

    const okEl = document.getElementById("stockAutoOk");
    if (okEl) okEl.style.display = "none";

    [...sel.options].forEach(o => {
      let arr = [];
      try {
        arr = JSON.parse(o.dataset.gtins || "[]");
      } catch {
        arr = [];
      }

      const match = arr.map(normalizeGTIN).includes(scanned);

      if (match && !found) {
        sel.value = o.value;
        found = true;
        if (okEl) okEl.style.display = "flex";
      }
    });

    if (found) {
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }




  async function initEditOrderPage() {
    const meta = document.getElementById("editOrderMeta");
    const hint = document.getElementById("editOrderHint");
    const list = document.getElementById("editItemsList");
    const countEl = document.getElementById("editItemsCount");
    const totalEl = document.getElementById("editOrderTotal");


    const search = document.getElementById("editProductSearch");
    const results = document.getElementById("editProductResults");

    const btnBack = document.getElementById("btnBackOrders");
    const btnDiscard = document.getElementById("btnDiscardEdit");
    const btnSave = document.getElementById("btnSaveEdit");

    if (!list || !search || !results || !btnSave) return;

    btnBack.onclick = () => (location.href = "orders.html");
    btnDiscard.onclick = () => {
      localStorage.removeItem("editOrder");
      location.href = "orders.html";
    };

    // 1) încărcăm comanda selectată din localStorage
    let order;
    try {
      order = JSON.parse(localStorage.getItem("editOrder") || "null");
    } catch {
      order = null;
    }

    if (!order) {
      alert("Nu există comandă de modificat.");
      location.href = "orders.html";
      return;
    }

    // protecție: doar în procesare
    const statusNow = order.status || "in_procesare";
    if (statusNow !== "in_procesare") {
      alert("Poți modifica doar comenzi în procesare.");
      location.href = "orders.html";
      return;
    }

    // 2) luăm lista de produse ca să putem adăuga din catalog
    const prodRes = await apiFetch("/api/products-flat");
    const products = await prodRes.json();
    // ===== PRICE MAPS (pentru total) =====
  const priceById = new Map();
  const priceByGtin = new Map();

  products.forEach(p => {
    const price = Number(p.price || 0);

    if (p.id != null) priceById.set(String(p.id), price);

    const all = []
      .concat(p.gtin ? [p.gtin] : [])
      .concat(Array.isArray(p.gtins) ? p.gtins : [])
      .filter(Boolean);

    all.forEach(g => priceByGtin.set(normalizeGTIN(g), price));
  });

  function resolvePrice(it) {
    const pid = (it.id != null) ? String(it.id) : "";
    if (pid && priceById.has(pid)) return priceById.get(pid);

    const g = normalizeGTIN(it.gtin);
    if (g && priceByGtin.has(g)) return priceByGtin.get(g);

    return Number(it.price || 0);
  }


    // state local: items editabile (fără allocations; server le va recalcula)
    let editItems = Array.isArray(order.items) ? order.items.map(it => ({
    id: it.id,
    name: it.name,
    gtin: it.gtin,
    qty: Number(it.qty || 1),
    price: resolvePrice(it) // ✅ ia preț din catalog
  })) : [];


    function calcTotal() {
    let total = 0;
    for (const it of editItems) {
      const price = Number(it.price || 0);
      const qty = Number(it.qty || 0);
      total += price * qty;
    }
    return total;
  }

  function renderTotal() {
    if (!totalEl) return;
    const t = calcTotal();
    totalEl.textContent = `${t.toFixed(2)} RON`;
  }


    function renderMeta() {
      if (!meta) return;
      meta.innerHTML = `
        <div><b>Client:</b> ${order.client?.name || "-"}</div>
        <div><b>Data:</b> ${order.createdAt ? new Date(order.createdAt).toLocaleString("ro-RO") : "-"}</div>
        <div><b>Status:</b> În procesare</div>
      `;
    }

  function renderItems() {
    list.innerHTML = "";

    if (!editItems.length) {
      list.innerHTML = `<div class="empty">Nu ai produse. Adaugă din dreapta.</div>`;
      if (countEl) countEl.textContent = "0";
      if (hint) hint.textContent = "Modifici cantități, ștergi sau adaugi produse. La salvare se refac alocările.";
      renderTotal();
      return;
    }

    editItems.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "row";

      const left = document.createElement("div");
      left.className = "rowLeft";

      const price = Number(it.price || 0);
      const qtyNum = Number(it.qty || 0);
      const line = price * qtyNum;

      left.innerHTML = `
        <div class="rowTitle">${it.name || "Produs"}</div>
        <div class="muted small">GTIN: ${it.gtin || "-"}</div>
        <div class="muted small">Preț: ${price.toFixed(2)} RON</div>
        <div class="muted small">Subtotal: <b>${line.toFixed(2)} RON</b></div>
      `;

      const right = document.createElement("div");
      right.className = "rowRight";

      const btnMinus = document.createElement("button");
      btnMinus.className = "iconBtn";
      btnMinus.textContent = "−";
      btnMinus.onclick = () => {
        it.qty = Math.max(1, Number(it.qty || 1) - 1);
        renderItems();
      };

      const qty = document.createElement("input");
      qty.type = "number";
      qty.min = "1";
      qty.value = String(it.qty || 1);
      qty.className = "qtyInput";
      qty.onchange = () => {
        const v = parseInt(qty.value, 10);
        if (!Number.isFinite(v) || v <= 0) return;
        it.qty = v;
        renderItems();
      };

      const btnPlus = document.createElement("button");
      btnPlus.className = "iconBtn";
      btnPlus.textContent = "+";
      btnPlus.onclick = () => {
        it.qty = Number(it.qty || 1) + 1;
        renderItems();
      };

      const btnDel = document.createElement("button");
      btnDel.className = "iconBtn danger";
      btnDel.textContent = "🗑";
      btnDel.onclick = () => {
        editItems.splice(idx, 1);
        renderItems();
      };

      right.append(btnMinus, qty, btnPlus, btnDel);
      row.append(left, right);
      list.appendChild(row);
    });

    if (countEl) countEl.textContent = String(editItems.length);
    if (hint) hint.textContent = "Modifici cantități, ștergi sau adaugi produse. La salvare se refac alocările.";
    renderTotal(); // ✅ o singură dată, la final
  }


  // ================================
// PRODUSE & PRETURI - ADD PRODUCT
// ================================



    function addProduct(p) {
      // GTIN principal = primul din gtins sau fallback
      const primaryGTIN =
        (Array.isArray(p.gtins) && p.gtins.length) ? p.gtins[0] : (p.gtin || "");

      const g = normalizeGTIN(primaryGTIN);

      // dacă produsul e deja în listă (după GTIN), creștem qty
      const found = editItems.find(x => normalizeGTIN(x.gtin) === g);
      if (found) {
        found.qty = Number(found.qty || 1) + 1;
      } else {
        editItems.push({
          id: p.id,
          name: p.name,
          gtin: primaryGTIN,
          qty: 1,
  price: Number(p.price || 0)
        });
      }

      renderItems();
    }

    function renderProductResults(q) {
      results.innerHTML = "";
      const query = String(q || "").toLowerCase().trim();
      if (!query) {
        results.innerHTML = `<div class="empty">Scrie ceva ca să cauți produse…</div>`;
        return;
      }

      const matches = products
        .filter(p =>
          String(p.name || "").toLowerCase().includes(query) ||
          String(p.path || "").toLowerCase().includes(query)
        )
        .slice(0, 30);

      if (!matches.length) {
        results.innerHTML = `<div class="empty">Niciun produs găsit.</div>`;
        return;
      }

      matches.forEach(p => {
        const b = document.createElement("button");
        b.className = "resultBtn";
        b.innerHTML = `
          <div class="resultTitle">${p.name}</div>
          <div class="muted small">${p.path || ""}</div>
        `;
        b.onclick = () => addProduct(p);
        results.appendChild(b);
      });
    }

    search.addEventListener("input", () => renderProductResults(search.value));

    btnSave.onclick = async () => {
      if (!editItems.length) {
        alert("Comanda nu poate fi goală.");
        return;
      }

      // trimitem doar ce are nevoie serverul să refacă allocations
      const payloadItems = editItems.map(it => ({
        id: it.id,
        name: it.name,
        gtin: it.gtin,
        qty: Number(it.qty || 1),
        price: it.price
      }));

      const res = await apiFetch(`/api/orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems })
      });

      const out = await res.json().catch(() => ({}));

      if (!res.ok || out.error) {
        alert(out.error || "Eroare la salvare.");
        return;
      }

      alert("Comanda a fost modificată ✅");
      localStorage.removeItem("editOrder");
      location.href = "orders.html";
    };

    // init
    renderMeta();
    renderItems();
    renderProductResults("");
  }




  let scanStream = null;
  let scanTimer = null;

  function dbg(msg) {
    const box = document.getElementById("debugBox");
    if (!box) return;
    box.style.display = "block";
    box.innerHTML += `<div>${new Date().toLocaleTimeString()} • ${msg}</div>`;
    box.scrollTop = box.scrollHeight;
  }


  function closeScanner() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (scanStream) {
      scanStream.getTracks().forEach(t => t.stop());
      scanStream = null;
    }

    const modal = document.getElementById("scannerModal");
    if (modal) modal.style.display = "none";

    const video = document.getElementById("scanVideo");
    if (video) video.srcObject = null;
  }

  async function startScanIntoInput(qrInputEl) {
    if (!window.isSecureContext) {
      alert("Camera merge doar pe HTTPS.");
      return;
    }

    const modal = document.getElementById("scannerModal");
    const video = document.getElementById("scanVideo");
    if (!modal || !video) return;

    // oprește sesiune veche
    closeScanner();

    // deschide modal
    modal.style.display = "block";

    video.muted = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.autoplay = true;

    // 1) pornește camera
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (e) {
      console.warn("getUserMedia failed:", e);
      closeScanner();
      alert("Nu pot porni camera. Verifică permisiunile.");
      return;
    }

    video.srcObject = scanStream;

    await new Promise(resolve => {
      video.onloadedmetadata = () => resolve();
    });

    try { await video.play(); } catch (e) { console.warn("play failed", e); }

    // 2) detector: încearcă să includă DataMatrix + QR
    if (!("BarcodeDetector" in window)) {
      alert("BarcodeDetector nu e suportat pe acest browser.");
      return;
    }

    let formats = ["qr_code", "data_matrix"];

    // dacă browserul știe să ne spună ce suportă, filtrăm
    try {
      const supported = await BarcodeDetector.getSupportedFormats?.();
      if (Array.isArray(supported) && supported.length) {
        console.log("Supported formats:", supported);
        formats = formats.filter(f => supported.includes(f));
      }
    } catch {}

    if (!formats.length) {
      formats = ["qr_code"]; // fallback minim
    }

    let detector;
    try {
      detector = new BarcodeDetector({ formats });
    } catch (e) {
      console.warn("BarcodeDetector init failed:", e);
      detector = new BarcodeDetector();
    }

    // 3) loop detect
    scanTimer = setInterval(async () => {
    try {
      if (!video.videoWidth || !video.videoHeight) return;

      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const raw = codes[0].rawValue || "";
        console.log("SCANNED RAW:", raw);

        if (!raw) return;

        const clean = sanitizeGS1(raw);
        console.log("SCANNED CLEAN:", clean);

        // 1️⃣ punem valoarea în input
        qrInputEl.value = clean;

        // 2️⃣ aplicăm parsing DIRECT (fără events)
        applyParsedGS1(clean);

        // 3️⃣ închidem scannerul
        closeScanner();
      }
    } catch (e) {
      console.warn("SCAN ERROR:", e);
    }
  }, 250);

  }

  async function startScanWithCallback(onScan) {
    if (!window.isSecureContext) {
      alert("Camera merge doar pe HTTPS.");
      return;
    }

    const modal = document.getElementById("scannerModal");
    const video = document.getElementById("scanVideo");
    if (!modal || !video) {
      alert("Lipsește scannerModal sau scanVideo din HTML.");
      return;
    }

    // oprește sesiune veche și deschide modalul
    closeScanner();
    modal.style.display = "block";

    video.muted = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.autoplay = true;

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (e) {
      closeScanner();
      alert("Nu pot porni camera. Verifică permisiunile.");
      return;
    }

    video.srcObject = scanStream;

    await new Promise(resolve => {
      video.onloadedmetadata = () => resolve();
    });

    try { await video.play(); } catch {}

    if (!("BarcodeDetector" in window)) {
      alert("BarcodeDetector nu e suportat pe acest browser.");
      return;
    }

    let formats = ["qr_code", "data_matrix"];
    try {
      const supported = await BarcodeDetector.getSupportedFormats?.();
      if (Array.isArray(supported) && supported.length) {
        formats = formats.filter(f => supported.includes(f));
      }
    } catch {}

    if (!formats.length) formats = ["qr_code"];

    let detector;
    try { detector = new BarcodeDetector({ formats }); }
    catch { detector = new BarcodeDetector(); }

    scanTimer = setInterval(async () => {
      try {
        if (!video.videoWidth || !video.videoHeight) return;

        const codes = await detector.detect(video);
        if (!codes || !codes.length) return;

        const raw = codes[0].rawValue || "";
        if (!raw) return;

        const clean = sanitizeGS1(raw);
        const parsed = parseGS1(clean);

        // ✅ DEBUG AICI (acum parsed există)
        dbg("SCAN OK: gtin=" + (parsed.gtin || "-") + " lot=" + (parsed.lot || "-"));

        if (!parsed.gtin || !parsed.lot) return; // obligatoriu

        closeScanner();
        onScan(parsed);
      } catch (e) {
        dbg("SCAN ERROR: " + (e?.message || e));
        console.warn("SCAN ERROR:", e);
      }
    }, 250);
  }







  async function initStockPage() {
    const prodSel = document.getElementById("stockProduct");
    const list = document.getElementById("stockList");
    const qrInput = document.getElementById("qrInput");
    const btnScan = document.getElementById("btnScanQR");
  const btnClose = document.getElementById("btnCloseScan");

  if (btnClose) btnClose.onclick = closeScanner;

  if (btnScan && qrInput) {
    btnScan.onclick = async () => {
      try {
        await startScanIntoInput(qrInput);
      } catch (e) {
        closeScanner();
        alert("Nu pot porni camera. Verifică permisiunile.");
      }
    };
  }

  


    if (!prodSel || !list) return;

    const products = await fetch("/api/products-flat").then(r => r.json());
    const stock = await fetch("/api/stock").then(r => r.json());

    // populate produse
    products.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      opt.dataset.name = p.name;
      opt.dataset.gtins = JSON.stringify(p.gtins || []);

      prodSel.appendChild(opt);
    });

    renderStock(stock);



  // ✅ manual: când user apasă Enter sau iese din câmp
  if (qrInput) {
  qrInput.addEventListener("input", () => {
    const clean = sanitizeGS1(qrInput.value);
    if (!clean) return;
    applyParsedGS1(clean);
  });

  }




    document.getElementById("btnAddStock").onclick = async () => {
      const productId = prodSel.value;
      const productName = prodSel.selectedOptions[0].dataset.name;
      const lot = document.getElementById("stockLot").value.trim();
      const expiresAt = document.getElementById("stockExpire").value;
      const qty = document.getElementById("stockQty").value;
  const stockLocation = document.getElementById("stockLocation").value;


      if (!productId || !lot || !expiresAt || !qty) {
        alert("Completează toate câmpurile");
        return;
      }
  const gtins = JSON.parse(prodSel.selectedOptions[0].dataset.gtins || "[]");
  const gtin = gtins[0] || "";

      await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
  

  body: JSON.stringify({
    gtin,
    productName,
    lot,
    expiresAt,
    qty,
    location: stockLocation
  })



      });

  window.location.reload();
    };
  }
  const grouped = {};
  async function initInventoryPage() {
    const list = document.getElementById("inventoryList");
    const btnRefresh = document.getElementById("btnRefreshStock");

    if (!list) return;

    async function loadStock() {
      list.innerHTML = "<p class='hint'>Se încarcă stocul...</p>";

      const stock = await apiFetch("/api/stock").then(r => r.json());

      if (!stock.length) {
        list.innerHTML = "<p class='hint'>Nu există stoc.</p>";
        return;
      }

      // 🔥 GRUPARE CORECTĂ PE PRODUS
      

    // 🔥 GRUPARE CORECTĂ PE GTIN
  const grouped = {};

  stock.forEach(s => {
    const key = normalizeGTIN(s.gtin);
    if (!key) return;

    if (!grouped[key]) {
      grouped[key] = {
        gtin: key,
        productName: s.productName,
        totalQty: 0,
        lots: []
      };
    }

    grouped[key].totalQty += Number(s.qty) || 0;
    grouped[key].lots.push(s);
  });


      list.innerHTML = "";
      // 🔔 ALERTĂ STOC MIC (GLOBAL)
  const lowProducts = Object.values(grouped)
    .filter(p => p.totalQty < LOW_STOCK_LIMIT);

  if (lowProducts.length) {
    const alert = document.createElement("div");
    alert.className = "alert-low-stock";
    alert.innerHTML = `
      ⚠️ <strong>Atenție!</strong>
      ${lowProducts.length} produse au stoc sub ${LOW_STOCK_LIMIT} buc.
    `;
    list.appendChild(alert);
  }


      Object.values(grouped).forEach(prod => {
        const header = document.createElement("div");
        header.className = "inventory-row";

      const isLow = prod.totalQty < LOW_STOCK_LIMIT;

  header.innerHTML = `
    <strong>${prod.productName}</strong>
    <span class="${isLow ? "low-stock" : ""}">
      TOTAL: ${prod.totalQty} buc
      ${isLow ? "⚠️ STOC MIC" : ""}
    </span>
    <button class="btnToggle">✏️</button>
  `;


        list.appendChild(header);

        const details = document.createElement("div");
        details.style.display = "none";
        details.style.marginLeft = "20px";

        prod.lots.forEach(lot => {
          const row = document.createElement("div");
          row.className = "inventory-lot";

        row.innerHTML = `
    LOT: ${lot.lot} | EXP: ${lot.expiresAt}
    <br/>
    Locație:
    <select id="loc-${lot.id}">
      ${["A","B","C","R1","R2","R3"].map(x =>
        `<option value="${x}" ${String(lot.location||"A")===x ? "selected":""}>${x}</option>`
      ).join("")}
    </select>
    Qty:
    <input type="number" value="${lot.qty}" id="qty-${lot.id}">
    <button class="btnSave" data-id="${lot.id}">💾</button>
    <button class="btnDelete" data-id="${lot.id}">🗑</button>
  `;


          details.appendChild(row);
        });

        list.appendChild(details);

        header.querySelector(".btnToggle").onclick = () => {
          details.style.display =
            details.style.display === "none" ? "block" : "none";
        };
      });

      // 💾 SAVE
      document.querySelectorAll(".btnSave").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const qty = document.getElementById(`qty-${id}`).value;
  const location = document.getElementById(`loc-${id}`).value;

  await apiFetch(`/api/stock/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qty, location })
  });


          loadStock();
        };
      });

      // 🗑 DELETE
      document.querySelectorAll(".btnDelete").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;

          if (!confirm("Ștergi acest lot?")) return;

          await apiFetch(`/api/stock/${id}`, {
            method: "DELETE"
          });

          loadStock();
        };
      });
    }

    if (btnRefresh) btnRefresh.onclick = loadStock;
    loadStock();
  }





  function renderStock(stock) {
    const list = document.getElementById("stockList");
    if (!list) return;

    list.innerHTML = "";

    if (!Array.isArray(stock) || !stock.length) {
      list.innerHTML = `<div class="stock-meta">Nu există stoc.</div>`;
      return;
    }

    stock.forEach(s => {
      const item = document.createElement("div");
      item.className = "stock-item";

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const name = document.createElement("div");
      name.className = "stock-name";
      name.textContent = s.productName || "Produs";

      const meta = document.createElement("div");
      meta.className = "stock-meta";
      meta.innerHTML = `
        LOT: <b>${s.lot || "-"}</b><br>
        Expiră: <b>${(s.expiresAt || "-").slice(0,10)}</b><br>
        Locație: <b>${s.location || "-"}</b>
      `;

      left.appendChild(name);
      left.appendChild(meta);

      const qty = Number(s.qty || 0);
      const badge = document.createElement("div");
      badge.className = "badge " + (qty >= 50 ? "ok" : "warn");
      badge.textContent = `${qty} buc`;

      item.appendChild(left);
      item.appendChild(badge);

      list.appendChild(item);
    });
  }


  function getProductPrice(product, client) {
    const base = Number(product.price || 0);

    if (!client || !client.prices) return base;

    const key = String(product.id);        // ✅ important: cheie string
    const sp = client.prices[key];

    if (sp === undefined || sp === null || sp === "") return base;

    return Number(sp);
  }


  function addToCart(product) {
    const cart = getCart();
    const client = getSelectedClient();

    const price = getProductPrice(product, client);
    const isSpecial = client?.prices && client.prices[String(product.id)] != null;


    // GTIN principal (primul din gtins sau fallback pe gtin vechi)
    const primaryGTIN =
      (Array.isArray(product.gtins) && product.gtins.length)
        ? product.gtins[0]
        : (product.gtin || "");

    const g = normalizeGTIN(primaryGTIN);
    const found = cart.find(p => normalizeGTIN(p.gtin) === g);

    if (found) {
      found.qty++;
    } else {
      cart.push({
    id: product.id,
    gtin: primaryGTIN,
    name: product.name,
    qty: 1,
    price,
    isSpecial: client?.prices?.[String(product.id)] != null
  });

    }

    saveCart(cart);
    renderCart();
  }

  const orderItemsMap = {};



  // ================= THEME =================
  function applyTheme(theme) {
    if (theme === "dark") {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }
  // ================= PICKING ORDER =================
  let pickState = null; // persist între rerender-uri

  function loadPickState() {
    try { return JSON.parse(localStorage.getItem("pickState")) || {}; }
    catch { return {}; }
  }
  function savePickState() {
    localStorage.setItem("pickState", JSON.stringify(pickState || {}));
  }

  // ===== PICK MODAL STATE =====
  let pickModalState = null;

  function openPickModal(state) {
    pickModalState = state;

    const modal = document.getElementById("pickModal");
    const btnClose = document.getElementById("pickModalClose");
    const btnCancel = document.getElementById("pickModalBtnCancel");
    const btnAdd = document.getElementById("pickModalBtnAdd");
    const btnReplace = document.getElementById("pickModalBtnReplaceLot");

    const elProd = document.getElementById("pickModalProduct");
    const elGtin = document.getElementById("pickModalGtin");
    const elScannedLot = document.getElementById("pickModalScannedLot");
    const elPlannedRow = document.getElementById("pickModalPlannedRow");
    const elPlannedLot = document.getElementById("pickModalPlannedLot");
    const elQty = document.getElementById("pickModalQty");
    const elHint = document.getElementById("pickModalHint");
    const elTitle = document.getElementById("pickModalTitle");
    const elLoc = document.getElementById("pickModalLocation");
  const elRemOrder = document.getElementById("pickModalRemainingOrder");


    if (!modal) return;

    elTitle.textContent = state.mode === "replace" ? "LOT diferit" : "Picking";
    elProd.textContent = state.item?.name || "—";
    elGtin.textContent = state.item?.gtin || "—";
    elScannedLot.textContent = state.scannedLot || "—";
    elLoc.textContent = state.location || "—";
  elRemOrder.textContent =
    Number.isFinite(state.remainingOrder)
      ? `${state.remainingOrder} buc`
      : "—";


    elQty.value = String(state.defaultQty || 1);

    if (state.mode === "replace") {
      elPlannedRow.style.display = "";
      elPlannedLot.textContent = state.oldLot || "—";
      btnReplace.style.display = "";
      btnAdd.style.display = "none";
      elHint.textContent = "Ai scanat un lot diferit. Poți actualiza lotul din comandă pe cantitatea introdusă.";
    } else {
      elPlannedRow.style.display = "none";
      btnReplace.style.display = "none";
      btnAdd.style.display = "";
      elHint.textContent = state.hint || "";
    }

    // handlers
    const close = () => closePickModal();

    btnClose.onclick = close;
    btnCancel.onclick = close;

    // click pe fundal -> închide
    modal.onclick = (e) => {
      if (e.target === modal) close();
    };

    modal.style.display = "flex";

    setTimeout(() => elQty.focus(), 50);
  }

  function closePickModal() {
    const modal = document.getElementById("pickModal");
    if (modal) modal.style.display = "none";
    pickModalState = null;
  }

  function getPickModalQty() {
    const elQty = document.getElementById("pickModalQty");
    const v = parseInt(elQty?.value || "0", 10);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return v;
  }


  // ✅ FULL + CORECT
  async function initPickingOrderPage() {
    const list = document.getElementById("pickingList");
    const info = document.getElementById("pickingInfo");
    const btnScan = document.getElementById("btnScanPick");
    const btnFinish = document.getElementById("btnFinishPick");
    const btnClose = document.getElementById("btnCloseScan");

    if (!list || !info) return;

    if (btnClose) btnClose.onclick = closeScanner;

    // încarcă progresul
    if (!pickState) pickState = loadPickState();

    // 1) ia comanda
    const order = JSON.parse(localStorage.getItem("pickingOrder"));
    if (!order) {
      alert("Nu există comandă selectată.");
      location.href = "orders.html";
      return;
    }

    // 2) ia produsele ca să facem map GTIN secundar -> GTIN principal
    const products = await apiFetch("/api/products-flat").then(r => r.json());
    // 3) luăm stocul ca să știm locația lotului scanat (A/B/C/R1...)
  const stock = await apiFetch("/api/stock").then(r => r.json());

  // map: "primaryGtin|lot" -> { bestLoc, totalQty }
  const stockLotInfo = {};
  stock.forEach(s => {
    const g = normalizeGTIN(s.gtin);
    const lot = String(s.lot || "").trim();
    if (!g || !lot) return;

    const key = `${g}|${lot}`;
    const qty = Number(s.qty || 0);
    const loc = String(s.location || "A");

    if (!stockLotInfo[key]) {
      stockLotInfo[key] = { bestLoc: loc, totalQty: 0 };
    }

    stockLotInfo[key].totalQty += qty;

    // alegem "bestLoc" (cel mai bun raft)
    const order = ["A","B","C","R1","R2","R3"];
    const rank = (x) => {
      const i = order.indexOf(String(x || "").toUpperCase());
      return i === -1 ? 999 : i;
    };

    if (rank(loc) < rank(stockLotInfo[key].bestLoc)) {
      stockLotInfo[key].bestLoc = loc;
    }
  });


    // map: normalized_gtin (oricare) -> normalized_primary_gtin (primul din gtins)
  // map: normalized_gtin (oricare) -> normalized_primary_gtin
  const gtinToPrimary = {};

  products.forEach(p => {
    const primaryRaw =
      (Array.isArray(p.gtins) && p.gtins.length) ? p.gtins[0] : (p.gtin || "");

    const primary = normalizeGTIN(primaryRaw);

    // IMPORTANT: includem și gtin-ul vechi + toate gtins
  const all = []
    .concat(p.gtin ? [p.gtin] : [])
    .concat(Array.isArray(p.gtins) ? p.gtins : [])
    .filter(Boolean);


    all.forEach(g => {
      const ng = normalizeGTIN(g);
      if (ng && primary) gtinToPrimary[ng] = primary;
    });
  });


    // info sus
    info.innerHTML = `
      <strong>${order.client?.name || ""}</strong><br>
      ${new Date(order.createdAt).toLocaleString()}
    `;

    // 3) render listă
    list.innerHTML = "";

    (order.items || []).forEach(item => {
      const row = document.createElement("div");
      row.className = "pick-row";

      // item.gtin = GTIN principal salvat pe comandă
      const primaryGtin = normalizeGTIN(item.gtin);
      pickState[primaryGtin] = pickState[primaryGtin] || {};

      const totalPicked = Object.values(pickState[primaryGtin])
        .reduce((s, n) => s + Number(n || 0), 0);

      if (totalPicked >= Number(item.qty || 0)) row.classList.add("ok");

      const allocationsHtml = Array.isArray(item.allocations)
        ? item.allocations.map(a => `
            <div class="pick-lot">
              LOT ${a.lot} (${a.location || "-"}) → ${a.qty}
            </div>
          `).join("")
        : `<div class="pick-lot">Fără allocations pe comandă</div>`;

      row.innerHTML = `
    <div class="pick-title">${item.name} × ${item.qty}</div>

    <div class="pick-hint">
      GTIN comandă: <small>${item.gtin || "—"}</small>
    </div>

    ${allocationsHtml}
  `;


      list.appendChild(row);
    });

    // 4) Scan button (acceptă GTIN secundar!)
    if (btnScan) {
    btnScan.onclick = async () => {
    await startScanWithCallback((parsed) => {
      // NU rerandăm aici!
      // handlePickingScan deschide modalul și butoanele din modal fac update + rerender.
      handlePickingScan(order, parsed, gtinToPrimary, stockLotInfo);
    });
  };

    }

    // 5) Finish button
  if (btnFinish) {
    btnFinish.onclick = async () => {
      const missing = [];

      (order.items || []).forEach(item => {
        const primaryGtin = normalizeGTIN(item.gtin);
        const picked = Object.values(pickState?.[primaryGtin] || {})
          .reduce((s, n) => s + Number(n || 0), 0);

        const need = Number(item.qty || 0);
        if (picked < need) missing.push(`${item.name}: lipsă ${need - picked}`);
      });

      if (missing.length) {
        alert("Comanda nu este completă:\n\n" + missing.join("\n"));
        return;
      }

      // ✅ SCHIMBĂ STATUSUL ÎN "gata_de_livrare"
      const res = await apiFetch(`/api/orders/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "gata_de_livrare" })
      });

      if (!res.ok) {
        alert("Eroare la schimbarea statusului comenzii.");
        return;
      }

      alert("Comanda este pregătită și gata de livrare 🚚");

      // curățăm picking state
      localStorage.removeItem("pickState");

      // ne întoarcem la lista de comenzi
      location.href = "orders.html";
    };
  }
  }


  // ✅ MODIFICAT: folosește map-ul gtinToPrimary ca să accepte ambele GTIN-uri
  async function handlePickingScan(order, parsed, gtinToPrimary, stockLotInfo) {
    dbg("handlePickingScan start");
  dbg("gtin raw=" + parsed.gtin + " lot=" + parsed.lot);

    const scannedGtin = normalizeGTIN(parsed.gtin);
    const scannedLot = String(parsed.lot || "").trim();

    if (!scannedGtin || !scannedLot) {
      alert("Cod invalid: lipsește GTIN sau LOT.");
      return;
    }

    // map GTIN scanat -> GTIN principal (primul din gtins)
    const primaryGtin = gtinToPrimary?.[scannedGtin] || scannedGtin;

    const item = (order.items || []).find(i => normalizeGTIN(i.gtin) === primaryGtin);
    if (!item) {
      alert("Produsul scanat nu există în această comandă.");
      return;
    }
    dbg("found item: " + item.name);


    // calcul rămas TOTAL pe produs în comandă
    pickState[primaryGtin] = pickState[primaryGtin] || {};
    const pickedTotal = Object.values(pickState[primaryGtin]).reduce((s, n) => s + Number(n || 0), 0);
    const needTotal = Number(item.qty || 0);
    const remainingOrder = Math.max(0, needTotal - pickedTotal);

    // locație lot scanat (din allocations dacă există, altfel din stoc)
    const allocSameLot = (item.allocations || []).find(a => String(a.lot) === scannedLot);
    const locationFromAlloc = allocSameLot?.location || "";
    const stockKey = `${primaryGtin}|${scannedLot}`;
    const locationFromStock = stockLotInfo?.[stockKey]?.bestLoc || "";
    const scannedLocation = locationFromAlloc || locationFromStock || "—";

    // dacă LOT există în allocations -> modal "Adaugă"
    if (allocSameLot) {
      const already = Number(pickState[primaryGtin][scannedLot] || 0);
      const planned = Number(allocSameLot.qty || 0);
      const remainingLot = Math.max(0, planned - already);

      openPickModal({
        mode: "add",
        order,
        item,
        primaryGtin,
        scannedLot,
        location: scannedLocation,
        remainingOrder,
        defaultQty: Math.max(1, Math.min(remainingLot || 1, remainingOrder || 1)),
        hint: `Rămas pe LOT ${scannedLot}: ${remainingLot} buc`
      });

      const btnAdd = document.getElementById("pickModalBtnAdd");
      btnAdd.onclick = () => {
        const qty = getPickModalQty();
        if (!qty) return;

        const remainingLot2 = Math.max(0, planned - already);
        const remainingOrder2 = Math.max(0, needTotal - pickedTotal);

        if (remainingLot2 <= 0) {
          alert("Lotul acesta este deja complet pentru această comandă.");
          closePickModal();
          return;
        }
        if (remainingOrder2 <= 0) {
          alert("Produsul este deja complet pe comandă.");
          closePickModal();
          return;
        }

        const toAdd = Math.min(qty, remainingLot2, remainingOrder2);
        pickState[primaryGtin][scannedLot] = already + toAdd;

        savePickState();
        closePickModal();
        initPickingOrderPage();
      };

      return;
    }

    // LOT diferit -> modal "Actualizează LOT"
    const oldLot = String(item.allocations?.[0]?.lot || "").trim();

    openPickModal({
      mode: "replace",
      order,
      item,
      primaryGtin,
      scannedLot,
      oldLot,
      location: scannedLocation,
      remainingOrder,
      defaultQty: Math.max(1, remainingOrder || 1)
    });

    const btnReplace = document.getElementById("pickModalBtnReplaceLot");
    btnReplace.onclick = async () => {
      const qty = getPickModalQty();
      if (!qty) return;

      // nu permite peste rămas total pe produs
      if (remainingOrder <= 0) {
        alert("Produsul este deja complet pe comandă.");
        return;
      }

      const qtyFinal = Math.min(qty, remainingOrder);

      closePickModal();

      const res = await apiFetch(`/api/orders/${order.id}/replace-lot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gtin: item.gtin,
          oldLot,
          newLot: scannedLot,
          qty: qtyFinal
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        alert(data.error || "Eroare la actualizare LOT");
        return;
      }

  localStorage.setItem("pickingOrder", JSON.stringify(data.order));

  /* ✅ FOARTE IMPORTANT
    Marcam cantitatea ca PICK-uita,
    altfel produsul nu se înverzește
    și Finalizează zice că lipsește
  */
  pickState[primaryGtin] = pickState[primaryGtin] || {};
  pickState[primaryGtin][scannedLot] =
    Number(pickState[primaryGtin][scannedLot] || 0) + qtyFinal;

  savePickState();

  alert("LOT actualizat ✅ și cantitatea a fost marcată ca pregătită");

  await initPickingOrderPage();
    }
  }

  async function initCheckStockPage() {
    if (!location.pathname.endsWith("checkstock.html")) return;

    const list = document.getElementById("stockList");
    const inp = document.getElementById("stockSearch");
    const btn = document.getElementById("btnRefresh");
    const totalBox = document.getElementById("inventoryTotal");

    if (!list) return;

    // ===== utils =====
    const esc = (s) =>
      String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const toISODate = (v) => {
      const s = String(v || "").trim();
      if (!s) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      return "";
    };

    const qtyBadgeClass = (qty) => {
      const n = Number(qty || 0);
      if (n <= 0) return "qty-red";
      if (n < 500) return "qty-amber";     // praguri “de aspect”
      if (n < 2000) return "qty-yellow";
      return "qty-green";
    };

    let stock = [];

    async function load() {
      list.innerHTML = `<p class="hint">Se încarcă stocul...</p>`;

      const r = await apiFetch("/api/stock");
      stock = await r.json().catch(() => []);

      // sort stabil: productName, apoi loc, apoi lot
      stock.sort((a, b) => {
        const pn = String(a.productName || "").localeCompare(String(b.productName || ""), "ro");
        if (pn !== 0) return pn;
        const lc = String(a.location || "").localeCompare(String(b.location || ""), "ro");
        if (lc !== 0) return lc;
        return String(a.lot || "").localeCompare(String(b.lot || ""), "ro");
      });

      render();
    }

    function groupStock(arr) {
      // grupare pe productName + gtin (dacă există) ca să nu unești produse diferite cu același nume
      const map = new Map();

      (arr || []).forEach((s) => {
        const name = String(s.productName || "").trim() || "Produs";
        const gtin = String(s.gtin || "").trim();
        const key = `${name}|||${gtin}`;

        if (!map.has(key)) {
          map.set(key, {
            key,
            productName: name,
            gtin,
            totalQty: 0,
            lots: []
          });
        }
        const g = map.get(key);
        g.totalQty += Number(s.qty || 0);
        g.lots.push(s);
      });

      return [...map.values()];
    }

    function render() {
      const q = String(inp?.value || "").toLowerCase().trim();

      const filteredStock = !q
        ? stock
        : stock.filter((x) =>
            String(x.productName || "").toLowerCase().includes(q) ||
            String(x.lot || "").toLowerCase().includes(q) ||
            String(x.location || "").toLowerCase().includes(q) ||
            String(x.gtin || "").toLowerCase().includes(q)
          );

      const groups = groupStock(filteredStock);

      list.innerHTML = "";

      if (!groups.length) {
        list.innerHTML = `<p class="hint">Nu există stoc.</p>`;
        if (totalBox) totalBox.textContent = "0 buc";
        return;
      }

      // total general
      const grandTotal = groups.reduce((s, g) => s + Number(g.totalQty || 0), 0);
      if (totalBox) totalBox.textContent = `${grandTotal} buc`;

      groups.forEach((g) => {
        const card = document.createElement("div");
        card.className = "csProdCard";

        const top = document.createElement("div");
        top.className = "csProdTop";

        top.innerHTML = `
          <div class="csProdLeft">
            <div class="csIcon">🗂️</div>
            <div class="csName">${esc(g.productName)}</div>
          </div>
          <div class="csQtyBadge ${qtyBadgeClass(g.totalQty)}">
            ${Number(g.totalQty || 0)} buc
          </div>
        `;

        const details = document.createElement("div");
        details.className = "csLots";
        details.style.display = "none";

        // lot rows
        (g.lots || []).forEach((s) => {
          const row = document.createElement("div");
          row.className = "csLotRow";

          const expISO = toISODate(s.expiresAt);

          row.innerHTML = `
            <div class="csLotGrid">
              <div class="csField">
                <div class="csLbl">LOT</div>
                <input class="csInp lot" value="${esc(s.lot || "")}" disabled>
              </div>

              <div class="csField">
                <div class="csLbl">EXP</div>
                <input class="csInp exp" type="date" value="${esc(expISO)}" disabled>
              </div>

              <div class="csField">
                <div class="csLbl">CANTITATE</div>
                <input class="csInp qty" type="number" min="0" value="${Number(s.qty || 0)}" disabled>
              </div>

              <div class="csField">
                <div class="csLbl">LOC</div>
                <input class="csInp loc" value="${esc(s.location || "A")}" disabled>
              </div>
            </div>

            <div class="csRowActions">
              <button class="btnEdit" type="button">Editează</button>
              <button class="btnSave" type="button" style="display:none;">Salvează</button>
              <button class="btnCancel" type="button" style="display:none;">Renunță</button>
              <div class="status"></div>
            </div>
          `;

          const lotEl = row.querySelector(".lot");
          const expEl = row.querySelector(".exp");
          const qtyEl = row.querySelector(".qty");
          const locEl = row.querySelector(".loc");

          const btnEdit = row.querySelector(".btnEdit");
          const btnSave = row.querySelector(".btnSave");
          const btnCancel = row.querySelector(".btnCancel");
          const statusEl = row.querySelector(".status");

          const orig = {
            lot: lotEl.value,
            exp: expEl.value,
            qty: qtyEl.value,
            loc: locEl.value
          };

          const setEditMode = (on) => {
            lotEl.disabled = !on;
            expEl.disabled = !on;
            qtyEl.disabled = !on;
            locEl.disabled = !on;

            btnEdit.style.display = on ? "none" : "";
            btnSave.style.display = on ? "" : "none";
            btnCancel.style.display = on ? "" : "none";

            if (!on) statusEl.textContent = "";
          };

          btnEdit.onclick = () => setEditMode(true);

          btnCancel.onclick = () => {
            lotEl.value = orig.lot;
            expEl.value = orig.exp;
            qtyEl.value = orig.qty;
            locEl.value = orig.loc;
            setEditMode(false);
          };

          btnSave.onclick = async () => {
            statusEl.textContent = "Salvez...";
            try {
              const payload = {
                lot: String(lotEl.value || "").trim(),
                expiresAt: String(expEl.value || "").slice(0, 10),
                qty: Number(qtyEl.value),
                location: String(locEl.value || "").trim()
              };

              const resp = await apiFetch(`/api/stock/${encodeURIComponent(s.id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });

              const out = await resp.json().catch(() => ({}));
              if (!resp.ok) throw new Error(out.error || "Eroare la salvare");

              // actualizăm local
              s.lot = payload.lot;
              s.expiresAt = payload.expiresAt;
              s.qty = payload.qty;
              s.location = payload.location;

              statusEl.textContent = "Salvat ✅";
              setTimeout(() => (statusEl.textContent = ""), 900);

              setEditMode(false);

              // refresh UI (totaluri / badge)
              render();
            } catch (e) {
              statusEl.textContent = "Eroare ❌";
              alert(e.message || "Eroare");
            }
          };

          setEditMode(false);
          details.appendChild(row);
        });

        // toggle expand
        top.style.cursor = "pointer";
        top.onclick = () => {
          const open = details.style.display !== "none";
          details.style.display = open ? "none" : "block";
          card.classList.toggle("open", !open);
        };

        card.appendChild(top);
        card.appendChild(details);
        list.appendChild(card);
      });
    }

    if (inp) inp.addEventListener("input", render);
    if (btn) btn.onclick = load;

    await load();
  }





  // ================= BOOT =================
  document.addEventListener("DOMContentLoaded", async () => {

  const isLoginPage = location.pathname.endsWith("login.html");
  const isRegisterPage = location.pathname.endsWith("register.html");

  if (isLoginPage) { initLoginPage(); return; }
  if (isRegisterPage) { initRegister(); return; }


    await protectPage();
    await renderUserBar();
    

    if (document.getElementById("inventoryList")) initInventoryPage();
    if (document.getElementById("stockProduct")) initStockPage();
    if (document.getElementById("clientsTree")) initAddClientPage();
    if (document.getElementById("productsTree")) initOrderPage();
    if (document.getElementById("ordersList")) initOrdersPage();
    if (document.getElementById("productsList")) initCheckPricePage();
    if (document.getElementById("pickingList")) await initPickingOrderPage();
    if (location.pathname.endsWith("client.html")) initClientHomePage();
    if (document.getElementById("productsList")) initCheckPricePage();
initProductsPage();
    await initClientPricesPage();

  if (document.getElementById("clientsList")) {
    await loadClientsAdmin();
    await initAddClientForm();
  }
  if (document.getElementById("editItemsList")) await initEditOrderPage();


  if (document.getElementById("stockList")) await initCheckStockPage();




    initViewCurrentOrderButton();
  });



