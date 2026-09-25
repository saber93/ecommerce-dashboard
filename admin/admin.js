(() => {
  const config = window.ADMIN_CONFIG;
  const $ = (id) => document.getElementById(id);
  let session;
  try {
    session = JSON.parse(sessionStorage.getItem("elan-admin-session"));
  } catch {}
  let products = [];
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
    $("logout").hidden = true;
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
        `${config.supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(location.origin + "/")}`,
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
  async function load() {
    const data = await api("list");
    products = data.products;
    $("login-panel").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    $("product-count").textContent = products.length;
    $("order-count").textContent = data.orders.length;
    $("review-count").textContent = data.orders.filter(
      (o) =>
        o.status === "review" || (o.payment_started && !o.payment_intent_id),
    ).length;
    $("products").replaceChildren();
    for (const p of products) {
      const row = document.createElement("tr");
      for (const value of [
        p.name,
        money(p.price_minor),
        `${p.stock_quantity} / ${p.reserved_quantity}`,
        p.active ? "Visible" : "Hidden",
      ])
        row.append(text("td", value));
      const td = document.createElement("td");
      td.append(button("Edit", () => editProduct(p)));
      row.append(td);
      $("products").append(row);
    }
    $("orders").replaceChildren();
    for (const o of data.orders) {
      const row = document.createElement("tr");
      for (const value of [
        o.id.slice(0, 8),
        o.customer.name,
        money(o.total_minor),
        o.status,
        o.fulfillment,
      ])
        row.append(text("td", value));
      const td = document.createElement("td");
      td.append(button("View", () => details(o.id)));
      if (o.status === "paid" && o.fulfillment === "unfulfilled")
        td.append(
          button("Mark fulfilled", async () => {
            await api("fulfill", { id: o.id });
            await load();
          }),
        );
      if (o.payment_intent_id && o.status !== "paid")
        td.append(
          button("Verify payment", async () => {
            await api("reconcile", { payment_intent_id: o.payment_intent_id });
            await load();
          }),
        );
      row.append(td);
      $("orders").append(row);
    }
  }
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
