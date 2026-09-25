(() => {
  const config = window.ADMIN_CONFIG;
  const $ = (id) => document.getElementById(id);
  let session;
  try {
    session = JSON.parse(sessionStorage.getItem("elan-admin-session"));
  } catch {}
  let products = [];
  let orders = [];
  const views = new Set(["overview", "products", "marketing", "orders", "payments", "settings"]);
  const collectionLabels = {work: "Work & everyday", evening: "Evening & occasions", weekend: "Weekend & hands-free", gifts: "Gift ideas"};
  const money = (value) =>
    new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency: "AED",
    }).format(value / 100);
  const text = (tag, value) => {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  };
  const button = (label, action) => {
    const el = text("button", label);
    el.type = "button";
    el.className = "row-action";
    el.addEventListener("click", () =>
      Promise.resolve(action()).catch((e) => {
        $("message").textContent = e.message;
      }),
    );
    return el;
  };
  function logout() {
    session = null;
    sessionStorage.removeItem("elan-admin-session");
    $("workspace").hidden = true;
    $("auth-shell").hidden = false;
    $("login-panel").hidden = false;
  }
  async function auth(grant, body) {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/token?grant_type=${grant}`,
      {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw new Error(
        "Sign-in failed. Check your credentials and account access.",
      );
    session = await response.json();
    session.expires_at = Date.now() + session.expires_in * 1000;
    sessionStorage.setItem("elan-admin-session", JSON.stringify(session));
  }
  $("request-password").addEventListener("click", async () => {
    const email = $("login").elements.email;
    if (!email.reportValidity()) return;
    $("request-password").disabled = true;
    try {
      const response = await fetch(
        `${config.supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(location.origin)}`,
        {
          method: "POST",
          headers: {
            apikey: config.publishableKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: email.value }),
        },
      );
      if (!response.ok)
        throw new Error(
          "The password email could not be sent. Check Auth email delivery and redirect settings.",
        );
      $("message").textContent =
        "If this account exists, check its inbox for a password setup link.";
    } catch (e) {
      $("message").textContent = e.message;
    } finally {
      $("request-password").disabled = false;
    }
  });
  $("set-password").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    if (values.password !== values.confirmation) {
      $("message").textContent = "The passwords must match.";
      return;
    }
    const submit = event.target.querySelector("button");
    submit.disabled = true;
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: values.password }),
      });
      if (!response.ok)
        throw new Error(
          "Password setup failed. Request a fresh link and try again.",
        );
      event.target.reset();
      event.target.hidden = true;
      $("login").hidden = false;
      $("request-password").hidden = false;
      await load();
      $("message").textContent = "Your password has been saved.";
    } catch (e) {
      $("message").textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  });
  async function api(action, data = {}) {
    if (!session) throw new Error("Please sign in.");
    if (Date.now() > session.expires_at - 60000)
      await auth("refresh_token", { refresh_token: session.refresh_token });
    const response = await fetch(`${config.apiBase}/admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, data }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) logout();
      throw new Error(
        result.error === "ADMIN_REQUIRED"
          ? "This account has not been granted store admin access."
          : result.error === "PAID_ORDER_REQUIRED"
            ? "Only paid or cash-on-delivery orders can be fulfilled."
            : result.error === "COD_COLLECTION_MISMATCH"
              ? "Cash collection can only be recorded for a matching, open cash-on-delivery order."
            : result.error === "COD_CANCELLATION_NOT_ALLOWED"
                ? "Only an unfulfilled cash-on-delivery order can be canceled and returned to stock."
            : result.error === "INVALID_FIT_CLAIM"
                ? "Verify the real product photo, measure dimensions, add tested contents in English and Arabic, and upload a fit photo before confirming the fit claim."
            : "The request could not be completed. Check configuration, permissions and reserved stock.",
      );
    }
    return result;
  }
  function editProduct(
    p = {
      id: "",
      name: "",
      description: "",
      category: "face",
      price_minor: 0,
      stock_quantity: 0,
      image: "",
      badge: "",
      swatches: [],
      active: false,
      collections: [],
      gallery: [],
      fits_inside_en: "",
      fits_inside_ar: "",
      styling_en: "",
      styling_ar: "",
      dimensions_cm: "",
      limited_edition: false,
      edition_size: null,
      photo_verified: false,
      fit_visual_url: "",
      fit_verified: false,
      pair_product_id: "",
    },
  ) {
    const f = $("product-form");
    f.reset();
    for (const name of [
      "id",
      "name",
      "description",
      "category",
      "stock_quantity",
      "image",
      "badge",
      "name_ar",
      "description_ar",
      "badge_ar",
      "fits_inside_en",
      "fits_inside_ar",
      "styling_en",
      "styling_ar",
      "dimensions_cm",
      "pair_product_id",
      "fit_visual_url",
    ])
      f.elements[name].value = p[name] ?? "";
    f.elements.id.readOnly = !!p.id;
    f.elements.price.value = (p.price_minor / 100).toFixed(2);
    f.elements.swatches.value = p.swatches.join(", ");
    f.elements.gallery.value = (p.gallery || []).join("\n");
    f.elements.edition_size.value = p.edition_size ?? "";
    f.elements.limited_edition.checked = Boolean(p.limited_edition);
    f.elements.photo_verified.checked = Boolean(p.photo_verified);
    f.elements.fit_verified.checked = Boolean(p.fit_verified);
    updateFitPreview();
    for (const key of Object.keys(collectionLabels)) f.elements[`collection_${key}`].checked = (p.collections || []).includes(key);
    f.elements.active.checked = p.active;
    $("product-dialog-title").textContent = p.id ? "Edit product" : "Add product";
    $("product-message").textContent = "";
    $("product-dialog").showModal();
  }
  function updateFitPreview() {
    const preview = $("fit-preview");
    const value = $("product-form").elements.fit_visual_url.value.trim();
    try {
      const url = new URL(value, `${config.storefrontUrl || "https://shopping-three-kappa.vercel.app"}/`);
      if (value && (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"))) {
        preview.src = url.href;
        preview.hidden = false;
        return;
      }
    } catch {}
    preview.removeAttribute("src");
    preview.hidden = true;
  }
  async function details(id) {
    const o = await api("order", { id });
    const root = $("order-details");
    root.replaceChildren();
    for (const [key, value] of Object.entries(o.customer))
      root.append(text("p", `${key}: ${value}`));
    for (const i of o.items) {
      const line = text(
        "p",
        `${i.quantity} × ${i.name} — ${money(i.unit_price_minor * i.quantity)}`,
      );
      line.className = "order-line";
      root.append(line);
    }
    root.append(text("p", `Total: ${money(o.total_minor)} · ${o.payment_method === 'cod' ? 'cash on delivery' : 'Ziina'} · ${o.status}`));
    $("order-dialog").showModal();
  }
  let currentView = "overview";
  const available = (p) => p.stock_quantity - p.reserved_quantity;
  const badge = (value) => {
    const el = text("span", value === "cod_pending" ? "Cash due" : value);
    el.className = `badge ${["visible", "paid", "fulfilled", "pending", "cod_pending", "review", "failed", "canceled", "expired"].includes(value) ? value : ""}`;
    return el;
  };
  function thumbnail(product) {
    const root = text("div", "É");
    root.className = "thumb";
    try {
      const source = new URL(product.image, `${config.storefrontUrl || "https://shopping-three-kappa.vercel.app"}/`);
      if (source.protocol === "https:" || (source.protocol === "http:" && source.hostname === "localhost")) {
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "eager";
        img.addEventListener("error", () => { root.textContent = "É"; }, { once: true });
        img.src = source.href;
        root.replaceChildren(img);
      }
    } catch {}
    return root;
  }
  function navigate(view) {
    if (!views.has(view)) return;
    currentView = view;
    for (const panel of document.querySelectorAll("[data-view-panel]"))
      panel.hidden = panel.dataset.viewPanel !== view;
    for (const nav of document.querySelectorAll("[data-view]")) {
      const active = nav.dataset.view === view;
      nav.classList.toggle("active", active);
      if (active) nav.setAttribute("aria-current", "page");
      else nav.removeAttribute("aria-current");
    }
    $("view-crumb").textContent = view[0].toUpperCase() + view.slice(1);
    window.scrollTo(0, 0);
  }
  function renderProducts() {
    const query = $("product-search").value.trim().toLowerCase();
    const filter = $("product-filter").value;
    const shown = products.filter((p) => {
      if (!`${p.name} ${p.id} ${p.category}`.toLowerCase().includes(query)) return false;
      return filter === "all" ||
        (filter === "visible" && p.active) ||
        (filter === "hidden" && !p.active) ||
        (filter === "low" && available(p) <= 5);
    });
    $("product-results").textContent = `${shown.length} of ${products.length} products`;
    $("products-empty").hidden = shown.length > 0;
    const rows = shown.map((p) => {
      const row = document.createElement("tr");
      const identity = document.createElement("td");
      const group = document.createElement("div");
      group.className = "product-cell";
      const name = document.createElement("div");
      name.append(text("strong", p.name), text("small", `${p.id} · ${[p.category === 'face' ? 'Everyday' : p.category === 'lips' ? 'Occasion' : 'Shoulder', ...(p.collections || []).map(key => collectionLabels[key])].join(' / ')}`));
      group.append(thumbnail(p), name);
      identity.append(group);
      const stock = text("td", `${available(p)} available · ${p.reserved_quantity} reserved`);
      if (available(p) <= 5) stock.className = "low-stock";
      const visibility = document.createElement("td");
      visibility.append(badge(p.active ? "visible" : "hidden"));
      if (p.fixture) visibility.append(text("small", "Illustrative image"));
      const action = document.createElement("td");
      action.className = "action-cell";
      action.append(button("Edit", () => editProduct(p)));
      row.append(identity, text("td", money(p.price_minor)), stock, visibility, action);
      return row;
    });
    $("products").replaceChildren(...rows);
  }
  function renderOrders() {
    const query = $("order-search").value.trim().toLowerCase();
    const filter = $("order-filter").value;
    const shown = orders.filter((o) => {
      if (!`${o.id} ${o.customer?.name || ""} ${o.customer?.email || ""}`.toLowerCase().includes(query)) return false;
      return filter === "all" || o.status === filter;
    });
    $("order-results").textContent = `${shown.length} of ${orders.length} recent orders`;
    $("orders-empty").hidden = shown.length > 0;
    const rows = shown.map((o) => {
      const row = document.createElement("tr");
      const identity = document.createElement("td");
      const group = document.createElement("div");
      group.className = "order-id";
      group.append(text("strong", `#${o.id.slice(0, 8)}`), text("small", new Date(o.created_at).toLocaleDateString("en-AE", { day: "numeric", month: "short", year: "numeric" })));
      identity.append(group);
      const payment = document.createElement("td");
      payment.append(badge(o.status));
      const fulfillment = document.createElement("td");
      fulfillment.append(badge(o.fulfillment));
      const action = document.createElement("td");
      action.className = "action-cell";
      action.append(button("View", () => details(o.id)));
      if ((o.status === "paid" || o.status === "cod_pending") && o.fulfillment === "unfulfilled")
        action.append(button("Mark fulfilled", async () => {
          await api("fulfill", { id: o.id });
          await load();
        }));
      if (o.payment_method === "cod" && o.status === "cod_pending") {
        action.append(button("Record cash", async () => {
          if (!confirm(`Confirm you received ${money(o.total_minor)} in cash for order #${o.id.slice(0, 8)}?`)) return;
          await api("cod_collect", { id: o.id, amount_minor: o.total_minor });
          await load();
        }));
        if (o.fulfillment === "unfulfilled")
          action.append(button("Cancel order", async () => {
            if (!confirm(`Cancel order #${o.id.slice(0, 8)} and return its items to stock?`)) return;
            await api("cod_cancel", { id: o.id });
            await load();
          }));
      }
      if (o.payment_intent_id && o.status !== "paid")
        action.append(button("Verify payment", async () => {
          await api("reconcile", { payment_intent_id: o.payment_intent_id });
          await load();
        }));
      row.append(identity, text("td", o.customer?.name || "Guest"), text("td", money(o.total_minor)), payment, fulfillment, action);
      return row;
    });
    $("orders").replaceChildren(...rows);
  }
  function renderOverview() {
    const featured = products.filter((p) => p.active).concat(products.filter((p) => !p.active)).slice(0, 4);
    $("featured-products").replaceChildren(...featured.map((p) => {
      const item = document.createElement("div");
      item.className = "featured-item";
      item.append(thumbnail(p), text("strong", p.name), text("small", money(p.price_minor)));
      return item;
    }));
    if (!featured.length) $("featured-products").append(text("p", "No products yet. Add a product to start your collection."));
    $("recent-orders").replaceChildren(...orders.slice(0, 4).map((o) => {
      const item = document.createElement("div");
      item.className = "recent-order";
      const label = document.createElement("div");
      label.append(text("strong", `#${o.id.slice(0, 8)} · ${o.customer?.name || "Guest"}`), text("small", money(o.total_minor)));
      item.append(label, badge(o.status));
      return item;
    }));
    if (!orders.length) {
      const empty = text("p", "No orders yet. Cash on delivery will appear here once customer orders open.");
      empty.className = "empty-state";
      $("recent-orders").append(empty);
    }
  }
  function renderMarketing() {
    const root = $("marketing-collections");
    root.replaceChildren(...Object.entries(collectionLabels).map(([key, label]) => {
      const section = document.createElement("section");
      section.className = "panel";
      const matching = products.filter(p => p.active && (p.collections || []).includes(key));
      section.append(text("h2", label), text("p", `${matching.length} visible products`));
      const list = document.createElement("div");
      list.className = "marketing-product-list";
      for (const product of matching) {
        const row = document.createElement("div");
        row.append(thumbnail(product), text("strong", product.name), text("small", product.photo_verified ? "Photo confirmed" : "Preview image"));
        list.append(row);
      }
      if (!matching.length) list.append(text("p", "Assign a product to this collection in the catalog editor."));
      section.append(list);
      return section;
    }));
  }
  async function load() {
    const data = await api("list");
    products = data.products || [];
    orders = data.orders || [];
    const settings = data.settings || {};
    const review = orders.filter((o) => o.status === "review" || (o.payment_started && !o.payment_intent_id)).length;
    const lowStock = products.filter((p) => available(p) <= 5).length;
    const events = Number(data.unprocessed_events || 0);
    $("auth-shell").hidden = true;
    $("workspace").hidden = false;
    $("product-count").textContent = products.length;
    $("visible-count").textContent = products.filter((p) => p.active).length;
    $("low-stock-count").textContent = lowStock;
    $("order-count").textContent = orders.length;
    $("review-count").textContent = review;
    $("payment-review-count").textContent = review;
    $("event-count").textContent = events;
    $("payment-event-count").textContent = events;
    $("stock-alert-count").textContent = lowStock;
    $("setting-currency").textContent = settings.currency || "AED";
    $("setting-fixtures").textContent = settings.fixture_mode ? "Development fixtures" : "Production catalog";
    const codReady = Boolean(settings.cod_enabled && !settings.fixture_mode);
    const areas = data.delivery_areas || [];
    $("setting-checkout").textContent = codReady ? "Cash on delivery enabled" : settings.checkout_enabled ? "Ziina test enabled in database" : "Orders closed";
    $("setting-shipping").textContent = areas.length ? `${areas.length} delivery areas · ${[...new Set(areas.map((area) => money(area.shipping_minor)))].join(', ')}` : settings.shipping_minor == null ? "Not confirmed" : `${money(settings.shipping_minor)}${settings.fixture_mode ? " · development" : ""}`;
    $("setting-tax").textContent = settings.tax_basis_points == null ? "Not confirmed" : `${(settings.tax_basis_points / 100).toFixed(2)}%${settings.fixture_mode ? " · development" : ""}`;
    $("setting-countries").textContent = settings.allowed_countries?.length ? `${settings.allowed_countries.join(", ")}${settings.fixture_mode ? " · development" : ""}` : "Not confirmed";
    $("checkout-banner-title").textContent = codReady ? "Cash on delivery is open" : "Order readiness";
    $("checkout-banner").querySelector("p").textContent = codReady
      ? "Customer cash on delivery orders are open. Review new orders, fulfillment, cash collection and cancellations here."
      : "Cash on delivery is prepared but remains closed until business, tax and returns settings are confirmed.";
    $("store-mode-label").textContent = codReady ? "Store operations" : "Development store";
    $("store-mode-note").textContent = codReady ? "Cash on delivery active" : "Orders closed";
    $("environment-status").textContent = codReady ? "COD LIVE" : "PRELAUNCH";
    $("orders-empty").textContent = codReady || settings.checkout_enabled ? "No orders match this view." : "No orders match this view. Checkout is currently disabled.";
    renderProducts();
    renderOrders();
    renderOverview();
    renderMarketing();
    navigate(currentView);
  }
  for (const nav of document.querySelectorAll("[data-view]"))
    nav.addEventListener("click", () => navigate(nav.dataset.view));
  for (const link of document.querySelectorAll("[data-open-view]"))
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(link.dataset.openView);
    });
  $("product-search").addEventListener("input", renderProducts);
  $("product-filter").addEventListener("change", renderProducts);
  $("order-search").addEventListener("input", renderOrders);
  $("order-filter").addEventListener("change", renderOrders);
  $("storefront-link").href = config.storefrontUrl || "https://shopping-three-kappa.vercel.app";
  $("marketing-preview-link").href = `${config.storefrontUrl || "https://shopping-three-kappa.vercel.app"}/?marketing-preview=1`;
  $("login").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await auth("password", Object.fromEntries(new FormData(event.target)));
      event.target.reset();
      await load();
      $("message").textContent = "";
    } catch (e) {
      $("message").textContent = e.message;
    }
  });
  $("logout").addEventListener("click", async () => {
    const token = session?.access_token;
    logout();
    if (token)
      await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {});
  });
  $("reload").addEventListener("click", () =>
    load().catch((e) => {
      $("message").textContent = e.message;
    }),
  );
  $("new-product").addEventListener("click", () => editProduct());
  document
    .querySelectorAll("[data-close]")
    .forEach((el) =>
      el.addEventListener("click", () => $(el.dataset.close).close()),
    );
  $("product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = event.target;
    const data = Object.fromEntries(new FormData(f));
    data.price_minor = Math.round(Number(data.price) * 100);
    delete data.price;
    data.stock_quantity = Number(data.stock_quantity);
    data.active = f.elements.active.checked;
    data.swatches = data.swatches
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    data.gallery = data.gallery.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    data.collections = Object.keys(collectionLabels).filter(key => f.elements[`collection_${key}`].checked);
    for (const key of Object.keys(collectionLabels)) delete data[`collection_${key}`];
    data.photo_verified = f.elements.photo_verified.checked;
    data.fit_verified = f.elements.fit_verified.checked;
    data.limited_edition = f.elements.limited_edition.checked;
    data.edition_size = data.limited_edition ? Number(data.edition_size) : null;
    data.pair_product_id = data.pair_product_id.trim() || null;
    try {
      await api("product", data);
      $("product-dialog").close();
      await load();
    } catch (e) {
      $("product-message").textContent = e.message;
    }
  });
  async function uploadImage(file) {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) throw new Error("Choose PNG, JPG or WebP images up to 5 MB each.");
    if (Date.now() > session.expires_at - 60000)
      await auth("refresh_token", { refresh_token: session.refresh_token });
    const response = await fetch(`${config.apiBase}/image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": file.type,
      },
      body: file,
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error("Image upload failed. Check bucket setup and Admin access.");
    return result.url;
  }
  $("image-upload").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("product-message").textContent = "Uploading primary image…";
    try {
      $("product-form").elements.image.value = await uploadImage(file);
      $("product-message").textContent = "Primary image uploaded. Save the product to apply it.";
    } catch (e) { $("product-message").textContent = e.message; }
  });
  $("gallery-upload").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    const field = $("product-form").elements.gallery;
    const current = field.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (current.length + files.length > 8) {
      $("product-message").textContent = "A product can have up to 8 additional photos.";
      return;
    }
    try {
      for (const [index, file] of files.entries()) {
        $("product-message").textContent = `Uploading additional photo ${index + 1} of ${files.length}…`;
        current.push(await uploadImage(file));
        field.value = current.join("\n");
      }
      $("product-message").textContent = "Photos uploaded. Save the product to apply them.";
    } catch (e) { $("product-message").textContent = e.message; }
  });
  $("fit-upload").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("product-message").textContent = "Uploading what-fits visual…";
    try {
      $("product-form").elements.fit_visual_url.value = await uploadImage(file);
      $("product-form").elements.fit_verified.checked = false;
      updateFitPreview();
      $("product-message").textContent = "Visual uploaded. Confirm measured contents before marking the fit claim verified.";
    } catch (e) { $("product-message").textContent = e.message; }
  });
  $("product-form").elements.fit_visual_url.addEventListener("input", updateFitPreview);
  $("reconcile").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("reconcile", Object.fromEntries(new FormData(event.target)));
      $("message").textContent = "Provider status verified.";
      await load();
    } catch (e) {
      $("message").textContent = e.message;
    }
  });
  const callback = new URLSearchParams(location.hash.slice(1));
  const recovery =
    ["recovery", "invite"].includes(callback.get("type")) &&
    callback.has("access_token") &&
    callback.has("refresh_token");
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  if (recovery) {
    session = {
      access_token: callback.get("access_token"),
      refresh_token: callback.get("refresh_token"),
      expires_at:
        Date.now() + Number(callback.get("expires_in") || 3600) * 1000,
    };
    // Auth verifies the token on save. Membership is checked separately by the API.
    sessionStorage.setItem("elan-admin-session", JSON.stringify(session));
    $("login").hidden = true;
    $("request-password").hidden = true;
    $("set-password").hidden = false;
    $("message").textContent = "Choose your store admin password.";
  } else if (!config.publishableKey) {
    $("login").querySelector("button").disabled = true;
    $("request-password").disabled = true;
    $("message").textContent =
      "Admin deployment is awaiting its public Supabase key and account setup.";
  } else if (session)
    load().catch((e) => {
      logout();
      $("message").textContent = e.message;
    });
})();
