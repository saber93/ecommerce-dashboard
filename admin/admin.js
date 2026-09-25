(() => {
  const config = window.ADMIN_CONFIG;
  const $ = (id) => document.getElementById(id);
  let session;
  try {
    session = JSON.parse(sessionStorage.getItem("elan-admin-session"));
  } catch {}
  let products = [];
  let orders = [];
  const views = new Set(["overview", "products", "orders", "payments", "settings"]);
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
            ? "Only paid orders can be fulfilled."
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
    ])
      f.elements[name].value = p[name];
    f.elements.id.readOnly = !!p.id;
    f.elements.price.value = (p.price_minor / 100).toFixed(2);
    f.elements.swatches.value = p.swatches.join(", ");
    f.elements.active.checked = p.active;
    $("product-dialog-title").textContent = p.id ? "Edit product" : "Add product";
    $("product-message").textContent = "";
    $("product-dialog").showModal();
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
    root.append(text("p", `Total: ${money(o.total_minor)} · ${o.status}`));
    $("order-dialog").showModal();
  }
  let currentView = "overview";
  const available = (p) => p.stock_quantity - p.reserved_quantity;
  const badge = (value) => {
    const el = text("span", value);
    el.className = `badge ${["visible", "paid", "fulfilled", "pending", "review", "failed", "canceled", "expired"].includes(value) ? value : ""}`;
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
      name.append(text("strong", p.name), text("small", p.id));
      group.append(thumbnail(p), name);
      identity.append(group);
      const stock = text("td", `${available(p)} available · ${p.reserved_quantity} reserved`);
      if (available(p) <= 5) stock.className = "low-stock";
      const visibility = document.createElement("td");
      visibility.append(badge(p.active ? "visible" : "hidden"));
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
      if (o.status === "paid" && o.fulfillment === "unfulfilled")
        action.append(button("Mark fulfilled", async () => {
          await api("fulfill", { id: o.id });
          await load();
        }));
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
      const empty = text("p", "No orders yet. New orders will appear here after test checkout is configured.");
      empty.className = "empty-state";
      $("recent-orders").append(empty);
    }
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
    $("setting-checkout").textContent = settings.checkout_enabled ? "Enabled in database" : "Disabled";
    $("setting-shipping").textContent = settings.shipping_minor == null ? "Not confirmed" : `${money(settings.shipping_minor)}${settings.fixture_mode ? " · development" : ""}`;
    $("setting-tax").textContent = settings.tax_basis_points == null ? "Not confirmed" : `${(settings.tax_basis_points / 100).toFixed(2)}%${settings.fixture_mode ? " · development" : ""}`;
    $("setting-countries").textContent = settings.allowed_countries?.length ? `${settings.allowed_countries.join(", ")}${settings.fixture_mode ? " · development" : ""}` : "Not confirmed";
    $("checkout-banner").querySelector("p").textContent = settings.checkout_enabled
      ? "Test checkout is enabled in the database. Verify Ziina configuration and the full payment flow before accepting orders."
      : "Products are demo fixtures. Checkout remains unavailable until test payments and business settings are configured.";
    $("orders-empty").textContent = settings.checkout_enabled ? "No orders match this view." : "No orders match this view. Checkout is currently disabled.";
    renderProducts();
    renderOrders();
    renderOverview();
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
    try {
      await api("product", data);
      $("product-dialog").close();
      await load();
    } catch (e) {
      $("product-message").textContent = e.message;
    }
  });
  $("image-upload").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      $("product-message").textContent =
        "Choose a PNG, JPG or WebP image up to 5 MB.";
      return;
    }
    $("product-message").textContent = "Uploading image…";
    try {
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
      if (!response.ok)
        throw new Error(
          "Image upload failed. Check bucket setup and Admin access.",
        );
      $("product-form").elements.image.value = result.url;
      $("product-message").textContent =
        "Image uploaded. Save the product to apply it.";
    } catch (e) {
      $("product-message").textContent = e.message;
    }
  });
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
