(function () {
  "use strict";

  const STORAGE_CART = "ocp1_foodhub_cart_v1";
  const STORAGE_NOTE = "ocp1_foodhub_note_v1";
  const STORAGE_VOUCHER = "ocp1_foodhub_voucher_v2";
  const STORAGE_PINS = "ocp1_foodhub_pins_v1";

  const PAGE_SIZE = 12;

  // ==================== HELPERS ====================
  const formatMoney = (num) => (Number(num) || 0).toLocaleString("vi-VN") + "đ";

  const removeAccents = (str) =>
    String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();

  const escapeHtml = (str) =>
    String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const slugify = (str) =>
    removeAccents(str)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  function guessDishEmoji(item, rest) {
    const text = removeAccents(`${item.name} ${item.category || ""}`);
    if (text.includes("coca") || text.includes("tra") || text.includes("nuoc") || text.includes("cafe") || text.includes("ep")) return "🥤";
    if (text.includes("sua chua") || text.includes("kem") || text.includes("che")) return "🍨";
    if (text.includes("pizza")) return "🍕";
    if (text.includes("burger")) return "🍔";
    if (text.includes("khoai")) return "🍟";
    if (text.includes("pho") || text.includes("ramen") || text.includes("mi ") || text.includes("mien")) return "🍜";
    if (text.includes("bun") || text.includes("lau")) return "🍲";
    if (text.includes("kimbap") || text.includes("sushi")) return "🍙";
    if (text.includes("com")) return "🍚";
    if (text.includes("ga")) return "🍗";
    if (text.includes("bo") || text.includes("trau") || text.includes("bit tet") || text.includes("suon") || text.includes("thit")) return "🥩";
    if (text.includes("ca")) return "🐟";
    if (text.includes("cuon") || text.includes("nem")) return "🌯";
    if (text.includes("tokbokki")) return "🍢";
    if (text.includes("salad") || text.includes("nam")) return "🥗";
    if (text.includes("combo")) return "🍱";
    return rest?.emoji || "🍽️";
  }

  const svgCache = new Map();
  function createDishPlaceholderSvg(item, rest) {
    const key = `${rest.id}::${item.name}::${item.category || ""}`;
    if (svgCache.has(key)) return svgCache.get(key);

    const [bg1, bg2] = rest.gradient || ["#C8322B", "#7F1D1D"];
    const emoji = guessDishEmoji(item, rest);
    const safeTitle = escapeHtml((item.name || "Món ăn").toUpperCase().slice(0, 26));
    const safeSub = escapeHtml(`${rest.name} · ${item.category || "Thực đơn"}`.slice(0, 36));

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400" viewBox="0 0 500 400">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg1}"/>
          <stop offset="100%" stop-color="${bg2}"/>
        </linearGradient>
      </defs>
      <rect width="500" height="400" fill="url(#g)"/>
      <circle cx="250" cy="154" r="74" fill="rgba(255,255,255,0.16)"/>
      <text x="250" y="180" font-size="78" text-anchor="middle">${emoji}</text>
      <rect x="36" y="270" width="428" height="86" rx="14" fill="rgba(24,24,27,0.72)"/>
      <text x="250" y="305" font-family="sans-serif" font-size="18" font-weight="800" fill="#FFFFFF" text-anchor="middle">${safeTitle}</text>
      <text x="250" y="333" font-family="sans-serif" font-size="13" font-weight="600" fill="#FDE047" text-anchor="middle">${safeSub}</text>
    </svg>`;

    const uri = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
    svgCache.set(key, uri);
    return uri;
  }

  // ==================== DATA ====================
  const RESTAURANTS = (window.RESTAURANTS_DATA || []).map((r) => {
    const normalizedMenu = (r.menu || []).map((item, idx) => {
      const uid = `${r.id}::${item.id !== undefined ? item.id : slugify(item.name) + "-" + idx}`;
      return {
        ...item,
        uid,
        restaurantId: r.id,
        restaurantName: r.name,
        section: item.section || "single",
        category: item.category || "Thực đơn",
        price: Number(item.price) || 0,
        img: item.img || "",
        fallback: createDishPlaceholderSvg(item, r)
      };
    });
    return { ...r, menu: normalizedMenu };
  });

  const REST_MAP = new Map(RESTAURANTS.map((r) => [r.id, r]));
  const ALL_DISHES = RESTAURANTS.flatMap((r) => r.menu);
  const DISH_MAP = new Map(ALL_DISHES.map((d) => [d.uid, d]));

  // ==================== STATE ====================
  let activeRestaurantId = null;
  let globalSearch = "";

  // Directory state
  let activeCuisine = "Tất cả";
  let readyLimit = PAGE_SIZE;
  let showAllPending = false;

  // Quick Switcher Modal state
  let switcherTab = "all"; // all | ready | pinned
  let switcherSearch = "";

  // Restaurant Detail state
  let menuMode = "all";
  let selectedCategory = "Tất cả";
  let localSearch = "";
  let sortOrder = "default";
  let onlyBestSeller = false;

  // Persistent state
  let cart = loadJson(STORAGE_CART, {});
  let pinnedIds = new Set(loadJson(STORAGE_PINS, []));
  let orderNote = localStorage.getItem(STORAGE_NOTE) || "";
  let voucherState = loadJson(STORAGE_VOUCHER, {
    mode: "count",
    qty10: 0,
    qty50: 0,
    manual: 0
  });
  let toastTimer = null;

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveCart() { localStorage.setItem(STORAGE_CART, JSON.stringify(cart)); }
  function savePins() { localStorage.setItem(STORAGE_PINS, JSON.stringify(Array.from(pinnedIds))); }
  function saveVoucher() { localStorage.setItem(STORAGE_VOUCHER, JSON.stringify(voucherState)); }

  function getVoucherAmount() {
    if (voucherState.mode === "manual") {
      return Math.max(0, Math.round(Number(voucherState.manual) || 0));
    }
    return (voucherState.qty10 || 0) * 10000 + (voucherState.qty50 || 0) * 50000;
  }

  function getVoucherDetailLabel() {
    if (voucherState.mode === "manual") return "Giảm Voucher (nhập tay)";
    const parts = [];
    if (voucherState.qty50 > 0) parts.push(`${voucherState.qty50}×50k`);
    if (voucherState.qty10 > 0) parts.push(`${voucherState.qty10}×10k`);
    return parts.length ? `Voucher (${parts.join(" + ")})` : "Giảm Voucher";
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1900);
  }

  function getCartCountByRest(restId) {
    let total = 0;
    Object.values(cart).forEach((it) => {
      if (it.restaurantId === restId) total += it.qty;
    });
    return total;
  }

  function togglePin(restId) {
    const rest = REST_MAP.get(restId);
    if (!rest) return;
    if (pinnedIds.has(restId)) {
      pinnedIds.delete(restId);
      showToast(`Bỏ ghim ${rest.name}`);
    } else {
      pinnedIds.add(restId);
      showToast(`Đã ghim ${rest.name}`);
    }
    savePins();
    renderMain();
    if (!document.getElementById("switcherModal").hidden) renderSwitcherList();
  }

  // ==================== OVERLAYS (CART PANEL/DRAWER & SWITCHER MODAL) ====================
  const isMobileViewport = () => window.innerWidth <= 960;

  function openCartDrawer() {
    if (isMobileViewport()) {
      document.getElementById("cartBackdrop").hidden = false;
      document.getElementById("cartDrawer").classList.add("open");
    } else {
      document.getElementById("workspace").classList.remove("cart-hidden");
    }
  }

  function closeCartDrawer() {
    if (isMobileViewport()) {
      document.getElementById("cartBackdrop").hidden = true;
      document.getElementById("cartDrawer").classList.remove("open");
    } else {
      document.getElementById("workspace").classList.add("cart-hidden");
    }
  }

  function toggleCartDrawer() {
    if (isMobileViewport()) {
      const isOpen = document.getElementById("cartDrawer").classList.contains("open");
      if (isOpen) closeCartDrawer();
      else openCartDrawer();
    } else {
      document.getElementById("workspace").classList.toggle("cart-hidden");
    }
  }

  function openSwitcherModal() {
    if (isMobileViewport()) closeCartDrawer();
    const modal = document.getElementById("switcherModal");
    modal.hidden = false;
    switcherSearch = "";
    const inp = document.getElementById("switcherSearchInput");
    inp.value = "";
    renderSwitcherList();
    setTimeout(() => inp.focus(), 20);
  }

  function closeSwitcherModal() {
    document.getElementById("switcherModal").hidden = true;
  }

  function renderSwitcherList() {
    const listEl = document.getElementById("switcherList");
    const q = removeAccents(switcherSearch.trim());

    let list = RESTAURANTS.filter((r) => {
      if (switcherTab === "ready" && r.menu.length === 0) return false;
      if (switcherTab === "pinned" && !pinnedIds.has(r.id)) return false;
      if (!q) return true;
      return (
        removeAccents(r.name).includes(q) ||
        removeAccents(r.cuisine).includes(q) ||
        removeAccents(r.cuisineDetail).includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      const pDiff = (pinnedIds.has(b.id) ? 1 : 0) - (pinnedIds.has(a.id) ? 1 : 0);
      if (pDiff !== 0) return pDiff;
      const mDiff = (b.menu.length > 0 ? 1 : 0) - (a.menu.length > 0 ? 1 : 0);
      if (mDiff !== 0) return mDiff;
      return (a.stt || 999) - (b.stt || 999);
    });

    if (!list.length) {
      listEl.innerHTML = `<div class="cart-empty">Không có quán phù hợp.</div>`;
      return;
    }

    listEl.innerHTML = list
      .map((r) => {
        const isActive = activeRestaurantId === r.id;
        const isPinned = pinnedIds.has(r.id);
        const qty = getCartCountByRest(r.id);
        return `
          <div class="sw-item ${isActive ? "active" : ""}" data-sw-open="${escapeHtml(r.id)}" role="button" tabindex="0">
            <span>${r.emoji}</span>
            <span class="sw-name">${escapeHtml(r.name)}</span>
            ${qty > 0 ? `<span class="qty-dot">${qty}</span>` : ""}
            <span class="sw-meta ${r.menu.length ? "text-emerald" : ""}">${r.menu.length ? `${r.menu.length} món` : "Chờ menu"}</span>
            <button class="pin-btn ${isPinned ? "pinned" : ""}" data-pin-rest="${escapeHtml(r.id)}" title="Ghim">${isPinned ? "★" : "☆"}</button>
          </div>
        `;
      })
      .join("");
  }

  // ==================== NAVIGATION ====================
  function updateTopbarSwitcherLabel() {
    const labelEl = document.getElementById("switcherLabel");
    if (activeRestaurantId && REST_MAP.has(activeRestaurantId)) {
      const r = REST_MAP.get(activeRestaurantId);
      labelEl.textContent = `${r.emoji} ${r.name}`;
    } else {
      labelEl.textContent = `Chọn quán (${RESTAURANTS.length})`;
    }
  }

  function openRestaurant(restId, pushHash = true) {
    if (!REST_MAP.has(restId)) {
      goHome(pushHash);
      return;
    }
    activeRestaurantId = restId;
    menuMode = "all";
    selectedCategory = "Tất cả";
    localSearch = "";
    sortOrder = "default";
    onlyBestSeller = false;

    closeSwitcherModal();
    if (isMobileViewport()) closeCartDrawer();

    if (pushHash) {
      window.location.hash = `restaurant=${encodeURIComponent(restId)}`;
    }
    updateTopbarSwitcherLabel();
    renderMain();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHome(pushHash = true) {
    activeRestaurantId = null;
    closeSwitcherModal();
    if (pushHash && window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    updateTopbarSwitcherLabel();
    renderMain();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function syncFromHash() {
    const match = (window.location.hash || "").match(/restaurant=([^&]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (REST_MAP.has(id)) {
        openRestaurant(id, false);
        return;
      }
    }
    activeRestaurantId = null;
    updateTopbarSwitcherLabel();
    renderMain();
  }

  // ==================== CART & VOUCHER ====================
  function addDishToCart(uid) {
    const dish = DISH_MAP.get(uid);
    if (!dish) return;
    if (cart[uid]) {
      cart[uid].qty += 1;
    } else {
      cart[uid] = {
        uid: dish.uid,
        restaurantId: dish.restaurantId,
        restaurantName: dish.restaurantName,
        name: dish.name,
        price: dish.price,
        qty: 1
      };
    }
    saveCart();
    renderCart();
    renderMain();
    showToast(`+ ${dish.name}`);
  }

  function addCustomDish(restId, name, price) {
    const rest = REST_MAP.get(restId);
    if (!rest) return;
    const cleanName = name.trim();
    const cleanPrice = Math.max(0, Math.round(Number(price) || 0));
    if (!cleanName) return;

    const uid = `${restId}::custom-${slugify(cleanName)}-${cleanPrice}`;
    if (cart[uid]) cart[uid].qty += 1;
    else {
      cart[uid] = {
        uid,
        restaurantId: rest.id,
        restaurantName: rest.name,
        name: cleanName,
        price: cleanPrice,
        qty: 1,
        custom: true
      };
    }
    saveCart();
    renderCart();
    showToast(`Đã thêm vào ${rest.name}`);
  }

  function updateCartQty(uid, delta) {
    if (!cart[uid]) return;
    cart[uid].qty += delta;
    if (cart[uid].qty <= 0) delete cart[uid];
    saveCart();
    renderCart();
    renderMain();
  }

  function clearCart() {
    if (!Object.keys(cart).length) return;
    cart = {};
    saveCart();
    renderCart();
    renderMain();
    showToast("Đã xóa phiếu order");
  }

  function updateVoucherCount(denom, delta) {
    voucherState.mode = "count";
    voucherState.manual = 0;
    if (denom === 10000) voucherState.qty10 = Math.max(0, (voucherState.qty10 || 0) + delta);
    else if (denom === 50000) voucherState.qty50 = Math.max(0, (voucherState.qty50 || 0) + delta);
    const manualInput = document.getElementById("voucherManualInput");
    if (manualInput) manualInput.value = "";
    saveVoucher();
    renderCart();
  }

  function setManualVoucher(rawValue) {
    const digits = String(rawValue || "").replace(/[^\d]/g, "");
    if (!digits) {
      voucherState.mode = "count";
      voucherState.manual = 0;
    } else {
      voucherState.mode = "manual";
      voucherState.qty10 = 0;
      voucherState.qty50 = 0;
      voucherState.manual = Number(digits);
    }
    saveVoucher();
    renderCart();
  }

  function resetVoucher() {
    voucherState = { mode: "count", qty10: 0, qty50: 0, manual: 0 };
    const manualInput = document.getElementById("voucherManualInput");
    if (manualInput) manualInput.value = "";
    saveVoucher();
    renderCart();
  }

  function copyOrderBill() {
    const items = Object.values(cart);
    if (!items.length) {
      showToast("Phiếu order đang trống!");
      return;
    }

    const grouped = new Map();
    items.forEach((it) => {
      if (!grouped.has(it.restaurantId)) {
        grouped.set(it.restaurantId, { name: it.restaurantName, list: [], subtotal: 0 });
      }
      const g = grouped.get(it.restaurantId);
      g.list.push(it);
      g.subtotal += it.price * it.qty;
    });

    let subtotalAll = 0;
    let totalQty = 0;
    const blocks = [];

    grouped.forEach((g) => {
      subtotalAll += g.subtotal;
      const lines = g.list.map((it) => {
        totalQty += it.qty;
        const p = it.price > 0 ? formatMoney(it.price * it.qty) : "Theo giá quán";
        return `  - ${it.qty}x ${it.name}: ${p}`;
      });
      const sub = g.subtotal > 0 ? ` (${formatMoney(g.subtotal)})` : "";
      blocks.push(`🍽️ ${g.name.toUpperCase()}${sub}\n${lines.join("\n")}`);
    });

    const discountApplied = Math.min(subtotalAll, getVoucherAmount());
    const finalTotal = Math.max(0, subtotalAll - discountApplied);
    const noteLine = orderNote.trim() ? `\n📝 Ghi chú: ${orderNote.trim()}` : "";
    const discountLine =
      discountApplied > 0
        ? `\n💵 Tạm tính: ${formatMoney(subtotalAll)}\n🎟️ ${getVoucherDetailLabel()}: -${formatMoney(discountApplied)}`
        : "";

    const text = `🧾 ORDER NHÓM · VINCOM OCEAN PARK 1\n${blocks.join("\n\n")}${noteLine}${discountLine}\n\n💰 Thanh toán (${totalQty} suất): ${formatMoney(finalTotal)}`;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast("Đã copy bill gửi nhóm!"));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Đã copy bill gửi nhóm!");
    }
  }

  // ==================== RENDER: DISH CARD ====================
  function renderDishCard(item, showRestTag = false) {
    const qty = cart[item.uid]?.qty || 0;
    const hasImg = Boolean(item.img && item.img.trim());
    const imgSrc = hasImg ? item.img : item.fallback;

    return `
      <article class="dish-card ${qty > 0 ? "in-cart" : ""}">
        <div class="dish-media">
          <img
            class="dish-img"
            src="${escapeHtml(imgSrc)}"
            alt="${escapeHtml(item.name)}"
            loading="lazy"
            onerror="this.onerror=null;this.src='${item.fallback}';"
          />
          ${item.bestSeller ? `<span class="dish-hot">★ Hot</span>` : ""}
          ${
            showRestTag
              ? `<button class="dish-rest-tag" data-open-rest="${escapeHtml(item.restaurantId)}">${escapeHtml(item.restaurantName)}</button>`
              : ""
          }
        </div>
        <div class="dish-body">
          <div class="dish-name">${escapeHtml(item.name)}</div>
          ${item.en ? `<div class="dish-desc">${escapeHtml(item.en)}</div>` : ""}
          ${
            item.items?.length
              ? `<ul class="combo-items">${item.items.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
              : ""
          }
          ${item.note ? `<div class="dish-note">${escapeHtml(item.note)}</div>` : ""}
          <div class="dish-foot">
            <span class="dish-price">${item.price > 0 ? formatMoney(item.price) : "Liên hệ"}</span>
            ${
              qty > 0
                ? `<div class="stepper">
                    <button data-qty-uid="${escapeHtml(item.uid)}" data-delta="-1">−</button>
                    <span>${qty}</span>
                    <button data-qty-uid="${escapeHtml(item.uid)}" data-delta="1">+</button>
                  </div>`
                : `<button class="add-btn" data-add-uid="${escapeHtml(item.uid)}">+ Chọn</button>`
            }
          </div>
        </div>
      </article>
    `;
  }

  // ==================== RENDER: DIRECTORY (BUILT FOR 40+ QUÁN) ====================
  function renderReadyCard(r) {
    const [g1, g2] = r.gradient || ["#C8322B", "#7F1D1D"];
    const isPinned = pinnedIds.has(r.id);
    const inCart = getCartCountByRest(r.id);

    return `
      <div class="ready-card" data-open-rest="${escapeHtml(r.id)}" role="button" tabindex="0">
        <div class="ready-icon" style="background: linear-gradient(135deg, ${g1}, ${g2});">${r.emoji}</div>
        <div class="ready-info">
          <div class="ready-name">
            <span>${escapeHtml(r.name)}</span>
            ${inCart > 0 ? `<span class="qty-dot">${inCart}</span>` : ""}
          </div>
          <div class="ready-sub">${escapeHtml(r.cuisineDetail)}</div>
          <div class="ready-meta">
            <span class="text-emerald">${r.menu.length} món</span>
            ${r.voucher ? `<span class="muted">· Voucher #${String(r.stt).padStart(2, "0")}</span>` : ""}
          </div>
        </div>
        <button class="pin-btn ${isPinned ? "pinned" : ""}" data-pin-rest="${escapeHtml(r.id)}" title="Ghim">${isPinned ? "★" : "☆"}</button>
      </div>
    `;
  }

  function renderCompactPending(r) {
    const isPinned = pinnedIds.has(r.id);
    const inCart = getCartCountByRest(r.id);

    return `
      <div class="compact-venue" data-open-rest="${escapeHtml(r.id)}" role="button" tabindex="0">
        <span class="compact-stt">${r.voucher ? `#${String(r.stt).padStart(2, "0")}` : "—"}</span>
        <span>${r.emoji}</span>
        <span class="compact-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        ${inCart > 0 ? `<span class="qty-dot">${inCart}</span>` : ""}
        <button class="pin-btn ${isPinned ? "pinned" : ""}" data-pin-rest="${escapeHtml(r.id)}" title="Ghim">${isPinned ? "★" : "☆"}</button>
      </div>
    `;
  }

  function renderDirectoryView() {
    const q = removeAccents(globalSearch.trim());

    if (q) {
      const matchedRests = RESTAURANTS.filter(
        (r) =>
          removeAccents(r.name).includes(q) ||
          removeAccents(r.cuisine).includes(q) ||
          removeAccents(r.cuisineDetail).includes(q) ||
          (r.tags || []).some((t) => removeAccents(t).includes(q))
      );
      const matchedDishes = ALL_DISHES.filter(
        (d) =>
          removeAccents(d.name).includes(q) ||
          removeAccents(d.en || "").includes(q) ||
          removeAccents(d.category || "").includes(q) ||
          (d.items && d.items.some((s) => removeAccents(s).includes(q)))
      );

      return `
        <div class="search-banner">
          <span>Tìm thấy <strong>${matchedRests.length}</strong> quán · <strong>${matchedDishes.length}</strong> món cho "${escapeHtml(globalSearch.trim())}"</span>
          <button class="link-btn" id="clearGlobalSearchInline">Xóa tìm kiếm</button>
        </div>
        ${
          matchedRests.length
            ? `<div class="section-title"><span>Gian hàng</span><span>${matchedRests.length}</span></div>
               <div class="ready-grid">${matchedRests.map((r) => (r.menu.length ? renderReadyCard(r) : renderCompactPending(r))).join("")}</div>`
            : ""
        }
        ${
          matchedDishes.length
            ? `<div class="section-title"><span>Món ăn</span><span>${matchedDishes.length}</span></div>
               <div class="dish-grid">${matchedDishes.map((d) => renderDishCard(d, true)).join("")}</div>`
            : ""
        }
        ${!matchedRests.length && !matchedDishes.length ? `<div class="empty-box">Không tìm thấy kết quả phù hợp.</div>` : ""}
      `;
    }

    const cuisines = ["Tất cả", ...new Set(RESTAURANTS.map((r) => r.cuisine))];
    const byCuisine = RESTAURANTS.filter((r) => activeCuisine === "Tất cả" || r.cuisine === activeCuisine);

    const sortPinnedFirst = (a, b) => {
      const pDiff = (pinnedIds.has(b.id) ? 1 : 0) - (pinnedIds.has(a.id) ? 1 : 0);
      if (pDiff !== 0) return pDiff;
      return (a.stt || 999) - (b.stt || 999);
    };

    const readyList = byCuisine.filter((r) => r.menu.length > 0).sort(sortPinnedFirst);
    const pendingList = byCuisine.filter((r) => r.menu.length === 0).sort(sortPinnedFirst);

    const visibleReady = readyList.slice(0, readyLimit);
    const remainingReady = readyList.length - visibleReady.length;

    const pendingLimit = showAllPending ? pendingList.length : 12;
    const visiblePending = pendingList.slice(0, pendingLimit);
    const remainingPending = pendingList.length - visiblePending.length;

    const totalVoucher = RESTAURANTS.filter((r) => r.voucher).length;

    return `
      <div class="page-head">
        <div>
          <h1>Vincom Ocean Park 1 · Food Hub</h1>
          <p>${totalVoucher} gian hàng Voucher (Tầng 3 &amp; 4) · ${RESTAURANTS.filter((r) => r.menu.length > 0).length} quán đã có thực đơn</p>
        </div>
      </div>

      <div class="filter-bar">
        <div class="chip-group" role="tablist">
          ${cuisines
            .map(
              (c) => `
            <button class="chip ${activeCuisine === c ? "active" : ""}" data-cuisine="${escapeHtml(c)}">
              ${escapeHtml(c)}
            </button>`
            )
            .join("")}
        </div>
      </div>

      ${
        readyList.length
          ? `
        <div class="section-title">
          <span>Đã có thực đơn</span>
          <span>${readyList.length} quán</span>
        </div>
        <div class="ready-grid">${visibleReady.map(renderReadyCard).join("")}</div>
        ${
          remainingReady > 0
            ? `<div class="load-more-wrap"><button class="btn-sm" id="loadMoreReadyBtn">Xem thêm ${remainingReady} quán</button></div>`
            : ""
        }
      `
          : ""
      }

      ${
        pendingList.length
          ? `
        <div class="section-title">
          <span>Đang cập nhật thực đơn (nhấn để đặt nhanh)</span>
          <span>${pendingList.length} quán</span>
        </div>
        <div class="compact-dir-grid">${visiblePending.map(renderCompactPending).join("")}</div>
        ${
          remainingPending > 0
            ? `<div class="load-more-wrap"><button class="btn-sm" id="togglePendingBtn">Xem tất cả ${pendingList.length} quán chờ menu (+${remainingPending})</button></div>`
            : showAllPending && pendingList.length > 12
              ? `<div class="load-more-wrap"><button class="btn-sm" id="togglePendingBtn">Thu gọn</button></div>`
              : ""
        }
      `
          : ""
      }

      ${!readyList.length && !pendingList.length ? `<div class="empty-box">Không có gian hàng nào trong mục này.</div>` : ""}
    `;
  }

  // ==================== RENDER: RESTAURANT DETAIL ====================
  function renderRestaurantDetailView(rest) {
    const hasMenu = rest.menu.length > 0;
    const isPinned = pinnedIds.has(rest.id);
    const [g1, g2] = rest.gradient || ["#C8322B", "#7F1D1D"];

    const headerHtml = `
      <div class="rest-header">
        <div class="rest-header-left">
          <div class="ready-icon" style="background: linear-gradient(135deg, ${g1}, ${g2});">${rest.emoji}</div>
          <div>
            <div class="rest-header-title">
              <h1>${escapeHtml(rest.name)}</h1>
              ${rest.voucher ? `<span class="voucher-pill">Voucher #${String(rest.stt).padStart(2, "0")}</span>` : ""}
            </div>
            <div class="rest-header-sub">
              ${escapeHtml(rest.location)}${rest.phone ? ` · ${escapeHtml(rest.phone)}` : ""}
            </div>
          </div>
        </div>
        <div class="rest-actions">
          <button class="btn-sm" id="backToDirectoryBtn">← Tất cả quán</button>
          <button class="btn-sm ${isPinned ? "active" : ""}" data-pin-rest="${escapeHtml(rest.id)}">${isPinned ? "★ Đã ghim" : "☆ Ghim"}</button>
          <button class="btn-sm" id="copyRestLinkBtn">Copy link</button>
        </div>
      </div>
    `;

    if (!hasMenu) {
      return `
        ${headerHtml}
        <div class="pending-card">
          <h3>Thực đơn ${escapeHtml(rest.name)} đang chờ cập nhật</h3>
          <p>${escapeHtml(rest.pendingNote || "Bạn vẫn có thể nhập nhanh tên món muốn đặt bên dưới để gom vào phiếu order nhóm.")}</p>
          <form id="customDishForm" class="custom-form">
            <input type="text" id="customDishName" class="field-input" placeholder="Tên món muốn đặt..." required />
            <input type="number" id="customDishPrice" class="field-input" placeholder="Giá (VNĐ, tùy chọn)" min="0" />
            <button type="submit" class="btn-primary">+ Thêm</button>
          </form>
        </div>
      `;
    }

    const hasCombos = rest.menu.some((m) => m.section === "combo");
    const hasSingles = rest.menu.some((m) => m.section === "single");
    const hasBestSeller = rest.menu.some((m) => m.bestSeller);

    const baseByMode = rest.menu.filter((item) => menuMode === "all" || item.section === menuMode);
    const categories = ["Tất cả", ...new Set(baseByMode.map((item) => item.category))];
    if (!categories.includes(selectedCategory)) selectedCategory = "Tất cả";

    const q = removeAccents(localSearch.trim());
    let filtered = baseByMode.filter((item) => {
      const matchCat = selectedCategory === "Tất cả" || item.category === selectedCategory;
      const matchBest = !onlyBestSeller || item.bestSeller;
      const matchSearch =
        !q ||
        removeAccents(item.name).includes(q) ||
        removeAccents(item.en || "").includes(q) ||
        (item.items && item.items.some((s) => removeAccents(s).includes(q)));
      return matchCat && matchBest && matchSearch;
    });

    if (sortOrder === "price-asc") filtered = [...filtered].sort((a, b) => a.price - b.price);
    else if (sortOrder === "price-desc") filtered = [...filtered].sort((a, b) => b.price - a.price);
    else if (sortOrder === "name-asc") filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name, "vi"));

    return `
      ${headerHtml}

      <div class="menu-toolbar">
        ${
          hasCombos && hasSingles
            ? `
          <div class="seg-control">
            <button class="seg-btn ${menuMode === "all" ? "active" : ""}" data-mode="all">Tất cả</button>
            <button class="seg-btn ${menuMode === "combo" ? "active" : ""}" data-mode="combo">Combo</button>
            <button class="seg-btn ${menuMode === "single" ? "active" : ""}" data-mode="single">Món lẻ</button>
          </div>`
            : ""
        }
        <input
          type="text"
          id="localSearchInput"
          class="local-search"
          value="${escapeHtml(localSearch)}"
          placeholder="Tìm món trong ${escapeHtml(rest.name)}..."
        />
        ${hasBestSeller ? `<button id="bestSellerToggle" class="btn-sm ${onlyBestSeller ? "active" : ""}">★ Hot</button>` : ""}
        <select id="sortMenuSelect" class="select-sm">
          <option value="default" ${sortOrder === "default" ? "selected" : ""}>Mặc định</option>
          <option value="price-asc" ${sortOrder === "price-asc" ? "selected" : ""}>Giá tăng dần</option>
          <option value="price-desc" ${sortOrder === "price-desc" ? "selected" : ""}>Giá giảm dần</option>
          <option value="name-asc" ${sortOrder === "name-asc" ? "selected" : ""}>Tên A → Z</option>
        </select>
      </div>

      <div class="chip-group" style="margin-bottom: 16px;">
        ${categories
          .map(
            (cat) => `
          <button class="chip ${selectedCategory === cat ? "active" : ""}" data-cat="${escapeHtml(cat)}">
            ${escapeHtml(cat)}
          </button>`
          )
          .join("")}
      </div>

      <div class="dish-grid">
        ${
          filtered.length
            ? filtered.map((item) => renderDishCard(item, false)).join("")
            : `<div class="empty-box" style="grid-column: 1 / -1;">Không tìm thấy món phù hợp.</div>`
        }
      </div>
    `;
  }

  // ==================== RENDER: MAIN & CART ====================
  function renderMain() {
    const container = document.getElementById("mainContent");
    if (!container) return;

    if (activeRestaurantId && REST_MAP.has(activeRestaurantId)) {
      container.innerHTML = renderRestaurantDetailView(REST_MAP.get(activeRestaurantId));
    } else {
      container.innerHTML = renderDirectoryView();
    }
    bindMainEvents();
  }

  function renderCart() {
    const body = document.getElementById("cartBody");
    const entries = Object.values(cart);

    let totalQty = 0;
    let subtotalAll = 0;
    const grouped = new Map();

    entries.forEach((it) => {
      if (!grouped.has(it.restaurantId)) {
        grouped.set(it.restaurantId, { id: it.restaurantId, name: it.restaurantName, items: [], subtotal: 0 });
      }
      const g = grouped.get(it.restaurantId);
      g.items.push(it);
      g.subtotal += it.price * it.qty;
      totalQty += it.qty;
      subtotalAll += it.price * it.qty;
    });

    if (!entries.length) {
      body.innerHTML = `<div class="cart-empty">Chưa chọn món nào.</div>`;
    } else {
      body.innerHTML = Array.from(grouped.values())
        .map(
          (g) => `
          <div class="cart-group">
            <div class="cart-group-head">
              <button class="cart-group-name" data-open-rest="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>
              <span class="cart-group-sub">${g.subtotal > 0 ? formatMoney(g.subtotal) : ""}</span>
            </div>
            ${g.items
              .map(
                (it) => `
              <div class="cart-item">
                <div class="cart-item-info">
                  <div class="cart-item-title" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
                  <div class="cart-item-meta">${it.price > 0 ? formatMoney(it.price * it.qty) : "Theo giá quán"}</div>
                </div>
                <div class="cart-qty">
                  <button data-qty-uid="${escapeHtml(it.uid)}" data-delta="-1">−</button>
                  <span>${it.qty}</span>
                  <button data-qty-uid="${escapeHtml(it.uid)}" data-delta="1">+</button>
                </div>
              </div>`
              )
              .join("")}
          </div>`
        )
        .join("");
    }

    const rawVoucher = getVoucherAmount();
    const discountApplied = Math.min(subtotalAll, rawVoucher);
    const finalTotal = Math.max(0, subtotalAll - discountApplied);

    document.getElementById("vQty10").textContent = voucherState.mode === "count" ? voucherState.qty10 : 0;
    document.getElementById("vQty50").textContent = voucherState.mode === "count" ? voucherState.qty50 : 0;
    document.getElementById("voucherActiveVal").textContent = rawVoucher > 0 ? `-${formatMoney(rawVoucher)}` : "0đ";
    document.getElementById("resetVoucherBtn").hidden = rawVoucher === 0;

    document.getElementById("cartSubMeta").textContent =
      totalQty > 0 ? `${totalQty} suất · ${grouped.size} quán` : "0 suất";
    document.getElementById("cartSubtotalPrice").textContent = formatMoney(subtotalAll);

    const discRow = document.getElementById("cartDiscountRow");
    discRow.hidden = discountApplied <= 0;
    document.getElementById("cartDiscountLabel").textContent = getVoucherDetailLabel();
    document.getElementById("cartDiscountDisplay").textContent = `-${formatMoney(discountApplied)}`;

    document.getElementById("cartTotalPrice").textContent = formatMoney(finalTotal);
    document.getElementById("topCartCount").textContent = totalQty;
    document.getElementById("topCartTotal").textContent = formatMoney(finalTotal);

    const pill = document.getElementById("floatingCartPill");
    pill.hidden = totalQty === 0;
    document.getElementById("fcCount").textContent = totalQty;
    document.getElementById("fcRests").textContent = grouped.size;
    document.getElementById("fcTotal").textContent = formatMoney(finalTotal);
  }

  // ==================== EVENTS ====================
  function bindMainEvents() {
    const c = document.getElementById("mainContent");

    c.querySelectorAll("[data-pin-rest]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePin(btn.dataset.pinRest);
      });
    });

    c.querySelectorAll("[data-open-rest]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-pin-rest]")) return;
        openRestaurant(el.dataset.openRest);
      });
    });

    document.getElementById("backToDirectoryBtn")?.addEventListener("click", () => goHome());
    document.getElementById("copyRestLinkBtn")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(window.location.href).then(() => showToast("Đã copy link quán!"));
    });

    c.querySelectorAll("[data-cuisine]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCuisine = btn.dataset.cuisine;
        readyLimit = PAGE_SIZE;
        showAllPending = false;
        renderMain();
      });
    });

    document.getElementById("loadMoreReadyBtn")?.addEventListener("click", () => {
      readyLimit += PAGE_SIZE;
      renderMain();
    });

    document.getElementById("togglePendingBtn")?.addEventListener("click", () => {
      showAllPending = !showAllPending;
      renderMain();
    });

    document.getElementById("clearGlobalSearchInline")?.addEventListener("click", () => {
      globalSearch = "";
      document.getElementById("globalSearchInput").value = "";
      document.getElementById("globalSearchClear").classList.remove("visible");
      renderMain();
    });

    c.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        menuMode = btn.dataset.mode;
        selectedCategory = "Tất cả";
        renderMain();
      });
    });

    c.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedCategory = btn.dataset.cat;
        renderMain();
      });
    });

    const localInput = document.getElementById("localSearchInput");
    if (localInput) {
      localInput.addEventListener("input", (e) => {
        const pos = e.target.selectionStart;
        localSearch = e.target.value;
        renderMain();
        const next = document.getElementById("localSearchInput");
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      });
    }

    document.getElementById("bestSellerToggle")?.addEventListener("click", () => {
      onlyBestSeller = !onlyBestSeller;
      renderMain();
    });

    document.getElementById("sortMenuSelect")?.addEventListener("change", (e) => {
      sortOrder = e.target.value;
      renderMain();
    });

    c.querySelectorAll("[data-add-uid]").forEach((btn) => {
      btn.addEventListener("click", () => addDishToCart(btn.dataset.addUid));
    });

    c.querySelectorAll("[data-qty-uid]").forEach((btn) => {
      btn.addEventListener("click", () => updateCartQty(btn.dataset.qtyUid, Number(btn.dataset.delta)));
    });

    const customForm = document.getElementById("customDishForm");
    if (customForm) {
      customForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const nameEl = document.getElementById("customDishName");
        const priceEl = document.getElementById("customDishPrice");
        addCustomDish(activeRestaurantId, nameEl.value, priceEl.value);
        nameEl.value = "";
        priceEl.value = "";
        nameEl.focus();
      });
    }
  }

  function initShellEvents() {
    document.getElementById("brandHomeBtn").addEventListener("click", () => {
      globalSearch = "";
      document.getElementById("globalSearchInput").value = "";
      document.getElementById("globalSearchClear").classList.remove("visible");
      goHome();
    });

    // Quick Switcher modal
    document.getElementById("switcherTriggerBtn").addEventListener("click", openSwitcherModal);
    document.getElementById("closeSwitcherBtn").addEventListener("click", closeSwitcherModal);
    document.getElementById("switcherModal").addEventListener("click", (e) => {
      if (e.target.id === "switcherModal") closeSwitcherModal();
    });

    document.getElementById("switcherSearchInput").addEventListener("input", (e) => {
      switcherSearch = e.target.value;
      renderSwitcherList();
    });

    document.querySelectorAll("[data-sw-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switcherTab = btn.dataset.swTab;
        document.querySelectorAll("[data-sw-tab]").forEach((b) =>
          b.classList.toggle("active", b.dataset.swTab === switcherTab)
        );
        renderSwitcherList();
      });
    });

    document.getElementById("switcherList").addEventListener("click", (e) => {
      const pin = e.target.closest("[data-pin-rest]");
      if (pin) {
        e.stopPropagation();
        togglePin(pin.dataset.pinRest);
        return;
      }
      const item = e.target.closest("[data-sw-open]");
      if (item) openRestaurant(item.dataset.swOpen);
    });

    // Global search
    const globalInput = document.getElementById("globalSearchInput");
    const globalClear = document.getElementById("globalSearchClear");
    globalInput.addEventListener("input", (e) => {
      globalSearch = e.target.value;
      globalClear.classList.toggle("visible", Boolean(globalSearch.trim()));
      if (globalSearch.trim() && activeRestaurantId) {
        activeRestaurantId = null;
        if (window.location.hash) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        updateTopbarSwitcherLabel();
      }
      renderMain();
    });
    globalClear.addEventListener("click", () => {
      globalSearch = "";
      globalInput.value = "";
      globalClear.classList.remove("visible");
      renderMain();
      globalInput.focus();
    });

    // Shortcuts: "/" for search, Ctrl/Cmd+K for quick switcher, Esc to close overlays
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSwitcherModal();
      } else if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        globalInput.focus();
      } else if (e.key === "Escape") {
        closeSwitcherModal();
        if (isMobileViewport()) closeCartDrawer();
      }
    });

    // Cart Panel / Drawer
    document.getElementById("openCartBtn").addEventListener("click", toggleCartDrawer);
    document.getElementById("floatingCartPill").addEventListener("click", openCartDrawer);
    document.getElementById("closeCartBtn").addEventListener("click", closeCartDrawer);
    document.getElementById("cartBackdrop").addEventListener("click", closeCartDrawer);

    document.getElementById("cartBody").addEventListener("click", (e) => {
      const qtyBtn = e.target.closest("[data-qty-uid]");
      if (qtyBtn) {
        updateCartQty(qtyBtn.dataset.qtyUid, Number(qtyBtn.dataset.delta));
        return;
      }
      const openBtn = e.target.closest("[data-open-rest]");
      if (openBtn) openRestaurant(openBtn.dataset.openRest);
    });

    // Voucher 10k & 50k steppers + manual input
    document.querySelectorAll("[data-v-denom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        updateVoucherCount(Number(btn.dataset.vDenom), Number(btn.dataset.vDelta));
      });
    });

    const manualInput = document.getElementById("voucherManualInput");
    if (voucherState.mode === "manual" && voucherState.manual > 0) {
      manualInput.value = voucherState.manual;
    }
    manualInput.addEventListener("input", (e) => setManualVoucher(e.target.value));
    document.getElementById("resetVoucherBtn").addEventListener("click", resetVoucher);

    const noteInput = document.getElementById("cartNoteInput");
    noteInput.value = orderNote;
    noteInput.addEventListener("input", (e) => {
      orderNote = e.target.value;
      localStorage.setItem(STORAGE_NOTE, orderNote);
    });

    document.getElementById("clearCartBtn").addEventListener("click", clearCart);
    document.getElementById("copyBillBtn").addEventListener("click", copyOrderBill);
    window.addEventListener("hashchange", syncFromHash);
  }

  initShellEvents();
  renderCart();
  syncFromHash();
})();
