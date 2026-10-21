"use strict";

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const state = {
    clients: [],
    orders: [],
    payments: [],
    settings: { id: "main", businessName: "Mi negocio", currency: "USD" },
    view: "dashboard",
    selectedClientId: null,
    selectedOrderId: null
  };

  const currencies = ["USD", "VES", "USDT"];
  let toastTimer;

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function money(value, currency = state.settings.currency) {
    const number = Number(value) || 0;

    try {
      if (currency === "USDT") {
        return number.toLocaleString("es-VE", {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        }) + " USDT";
      }

      return new Intl.NumberFormat("es-VE", {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(number);
    } catch {
      return number.toFixed(2) + " " + currency;
    }
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
  }

  function dateText(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value + (value.length === 10 ? "T12:00:00" : ""));
    return Number.isNaN(date.getTime())
      ? escapeHTML(value)
      : date.toLocaleDateString("es-VE", {
          day: "numeric", month: "short", year: "numeric"
        });
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function clientById(id) {
    return state.clients.find(client => client.id === id);
  }

  function orderById(id) {
    return state.orders.find(order => order.id === id);
  }

  function ordersForClient(clientId) {
    return state.orders
      .filter(order => order.clientId === clientId)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  function paymentsForOrder(orderId) {
    return state.payments.filter(payment => payment.orderId === orderId);
  }

  function orderTotal(order) {
    return (order.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  }

  function orderPaid(order) {
    return paymentsForOrder(order.id)
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  }

  function orderBalance(order) {
    return Math.max(0, orderTotal(order) - orderPaid(order));
  }

  function clientTotal(clientId) {
    return ordersForClient(clientId).reduce((sum, order) => sum + orderTotal(order), 0);
  }

  function clientPaid(clientId) {
    return state.payments
      .filter(payment => payment.clientId === clientId)
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  }

  function clientBalance(clientId) {
    return Math.max(0, clientTotal(clientId) - clientPaid(clientId));
  }

  function statusFor(order) {
    const balance = orderBalance(order);
    if (balance <= 0.001) return { label: "Pagado", cls: "green" };
    if (orderPaid(order) > 0) return { label: "Abono parcial", cls: "" };
    return { label: "Pendiente", cls: "red" };
  }

  async function refreshData() {
    await OrderDB.openDB();

    const [clients, orders, payments, settings] = await Promise.all([
      OrderDB.getAll("clients"),
      OrderDB.getAll("orders"),
      OrderDB.getAll("payments"),
      OrderDB.getAll("settings")
    ]);

    state.clients = clients || [];
    state.orders = orders || [];
    state.payments = payments || [];
    state.settings = settings.find(item => item.id === "main") ||
      { id: "main", businessName: "Mi negocio", currency: "USD" };

    renderAll();
  }

  function showView(view) {
    state.view = view;

    $$(".view").forEach(element => element.classList.add("hidden"));
    const target = $("#view-" + view);
    if (target) target.classList.remove("hidden");

    $$(".nav-button").forEach(button => {
      button.classList.toggle("active", button.dataset.go === view);
    });

    if (view === "client-detail") renderClientDetail();
    if (view === "order-detail") renderOrderDetail();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function emptyState(title, description) {
    return `<div class="empty-state"><strong>${escapeHTML(title)}</strong>${escapeHTML(description)}</div>`;
  }

  function renderDashboard() {
    $("#statClients").textContent = state.clients.length;
    $("#statOrders").textContent = state.orders.length;

    const pending = state.orders.reduce((sum, order) => sum + orderBalance(order), 0);
    const paid = state.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

    $("#statPending").textContent = money(pending);
    $("#statPaid").textContent = money(paid);

    const recent = [...state.orders]
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 4);

    $("#recentOrders").innerHTML = recent.length
      ? recent.map(orderCard).join("")
      : emptyState("Todavía no hay pedidos", "Crea el primer pedido para comenzar.");
  }

  function renderClients() {
    const query = ($("#clientSearch").value || "").trim().toLowerCase();
    const clients = state.clients
      .filter(client => `${client.name} ${client.phone || ""}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    $("#clientsList").innerHTML = clients.length
      ? clients.map(client => {
          const orders = ordersForClient(client.id);
          const pieces = orders.reduce((sum, order) => sum + (order.items || []).length, 0);

          return `
            <button class="client-card" data-client="${escapeHTML(client.id)}">
              <span class="avatar">${escapeHTML((client.name || "?").trim().charAt(0).toUpperCase())}</span>
              <span class="card-main">
                <span class="card-title">${escapeHTML(client.name)}</span>
                <span class="card-subtitle">${orders.length} pedidos · ${pieces} piezas${client.phone ? " · " + escapeHTML(client.phone) : ""}</span>
              </span>
              <span class="card-end">
                <span class="card-amount">${money(clientBalance(client.id))}</span>
                <span class="card-subtitle">Pendiente</span>
              </span>
              <span class="card-arrow">›</span>
            </button>`;
        }).join("")
      : emptyState("No hay clientes", query ? "Prueba con otra búsqueda." : "Añade un cliente para comenzar.");
  }

  function orderCard(order) {
    const client = clientById(order.clientId);
    const status = statusFor(order);
    const items = order.items || [];
    const previews = items.filter(item => item.photo).slice(0, 4)
      .map(item => `<img src="${item.photo}" alt="${escapeHTML(item.name || "Pieza")}" loading="lazy">`)
      .join("");

    return `
      <button class="order-card" data-order="${escapeHTML(order.id)}">
        <span class="order-card-top">
          <span>
            <span class="card-title">${escapeHTML(client?.name || "Cliente eliminado")}</span>
            <span class="card-subtitle">${items.length} piezas · ${dateText(order.createdAt)}</span>
          </span>
          <span class="pill ${status.cls}">${status.label}</span>
        </span>
        ${previews ? `<span class="order-thumbnails">${previews}</span>` : ""}
        <span class="order-card-bottom">
          <span class="card-subtitle">${order.estimatedDate ? "Entrega estimada: " + dateText(order.estimatedDate) : "Sin fecha de entrega"}</span>
          <span class="card-amount">${money(orderTotal(order), order.currency)}</span>
        </span>
      </button>`;
  }

  function renderOrders() {
    const query = ($("#orderSearch").value || "").trim().toLowerCase();

    const orders = [...state.orders]
      .filter(order => {
        const client = clientById(order.clientId);
        const productNames = (order.items || []).map(item => item.name || "").join(" ");
        return `${client?.name || ""} ${productNames}`.toLowerCase().includes(query);
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    $("#ordersList").innerHTML = orders.length
      ? orders.map(orderCard).join("")
      : emptyState("No hay pedidos", query ? "Prueba otra búsqueda." : "Crea un pedido con todas sus piezas de una vez.");
  }

  function renderPayments() {
    const payments = [...state.payments]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    $("#paymentsList").innerHTML = payments.length
      ? payments.map(payment => {
          const client = clientById(payment.clientId);
          const order = orderById(payment.orderId);

          return `
            <article class="payment-card">
              <div class="order-card-top">
                <div>
                  <strong>${escapeHTML(client?.name || "Cliente")}</strong>
                  <div class="card-subtitle">${dateText(payment.date)}${order ? " · Pedido del " + dateText(order.createdAt) : ""}</div>
                  ${payment.note ? `<div class="card-subtitle">${escapeHTML(payment.note)}</div>` : ""}
                </div>
                <strong class="card-amount">${money(payment.amount, payment.currency)}</strong>
              </div>
              <div class="detail-actions">
                <button class="secondary-button" data-delete-payment="${escapeHTML(payment.id)}">Eliminar registro</button>
              </div>
            </article>`;
        }).join("")
      : emptyState("Sin pagos registrados", "Los abonos que registres aparecerán aquí.");
  }

  function renderClientDetail() {
    const client = clientById(state.selectedClientId);
    if (!client) {
      showView("clients");
      return;
    }

    const orders = ordersForClient(client.id);

    $("#clientDetail").innerHTML = `
      <div class="detail-hero">
        <div class="avatar">${escapeHTML((client.name || "?").charAt(0).toUpperCase())}</div>
        <h1>${escapeHTML(client.name)}</h1>
        ${client.phone ? `<p class="muted">${escapeHTML(client.phone)}</p>` : ""}
        ${client.notes ? `<p>${escapeHTML(client.notes)}</p>` : ""}
        <div class="detail-total">${money(clientBalance(client.id))}</div>
        <div class="muted small">Saldo pendiente · Total comprado: ${money(clientTotal(client.id))}</div>
        <div class="detail-actions">
          <button class="primary-button" data-action="new-order" data-client-id="${escapeHTML(client.id)}">＋ Nuevo pedido</button>
          <button class="secondary-button" data-action="new-payment" data-client-id="${escapeHTML(client.id)}">Registrar pago</button>
          <button class="secondary-button" data-edit-client="${escapeHTML(client.id)}">Editar cliente</button>
          <button class="secondary-button" data-delete-client="${escapeHTML(client.id)}">Eliminar cliente</button>
        </div>
      </div>
      <div class="section-heading"><h2>Todos sus pedidos (${orders.length})</h2></div>
      <div class="stack">
        ${orders.length ? orders.map(orderCard).join("") : emptyState("Aún no hay pedidos", "Crea el primer pedido de este cliente.")}
      </div>`;
  }

  function renderOrderDetail() {
    const order = orderById(state.selectedOrderId);
    if (!order) {
      showView("orders");
      return;
    }

    const client = clientById(order.clientId);
    const items = order.items || [];
    const payments = paymentsForOrder(order.id);
    const status = statusFor(order);

    $("#orderDetail").innerHTML = `
      <div class="detail-hero">
        <p class="eyebrow">PEDIDO</p>
        <h1>${escapeHTML(client?.name || "Cliente")}</h1>
        <p class="muted">Creado: ${dateText(order.createdAt)}</p>
        ${order.estimatedDate ? `<p class="muted">Entrega estimada: ${dateText(order.estimatedDate)}</p>` : ""}
        ${order.notes ? `<p>${escapeHTML(order.notes)}</p>` : ""}
        <span class="pill ${status.cls}">${status.label}</span>
        <div class="detail-total">${money(orderTotal(order), order.currency)}</div>
        <p class="muted small">Abonado: ${money(orderPaid(order), order.currency)} · Pendiente: ${money(orderBalance(order), order.currency)}</p>
        <div class="detail-actions">
          <button class="primary-button" data-action="new-payment" data-order-id="${escapeHTML(order.id)}">＋ Registrar pago</button>
          <button class="secondary-button" data-edit-order="${escapeHTML(order.id)}">Editar pedido</button>
          <button class="secondary-button" data-delete-order="${escapeHTML(order.id)}">Eliminar pedido</button>
        </div>
      </div>
      <div class="panel">
        <h2>Piezas (${items.length})</h2>
        ${items.map(item => `
          <div class="detail-piece">
            ${item.photo ? `<img src="${item.photo}" alt="${escapeHTML(item.name || "Pieza")}">` : `<div class="avatar">▧</div>`}
            <div>
              <strong>${escapeHTML(item.name || "Pieza sin nombre")}</strong>
              ${item.description ? `<p class="muted small">${escapeHTML(item.description)}</p>` : ""}
              <strong>${money(item.price, order.currency)}</strong>
            </div>
          </div>`).join("")}
      </div>
      <div class="panel" style="margin-top:14px">
        <h2>Pagos de este pedido (${payments.length})</h2>
        ${payments.length ? payments.map(payment => `
          <div class="order-card-bottom">
            <span class="card-subtitle">${dateText(payment.date)}${payment.note ? " · " + escapeHTML(payment.note) : ""}</span>
            <strong>${money(payment.amount, payment.currency)}</strong>
          </div>`).join("") : `<p class="muted">Todavía no hay pagos.</p>`}
      </div>`;
  }

  function renderSettings() {
    const form = $("#settingsForm");
    form.elements.businessName.value = state.settings.businessName || "";
    form.elements.currency.value = currencies.includes(state.settings.currency)
      ? state.settings.currency : "USD";
  }

  function renderAll() {
    renderDashboard();
    renderClients();
    renderOrders();
    renderPayments();
    renderSettings();

    if (state.view === "client-detail") renderClientDetail();
    if (state.view === "order-detail") renderOrderDetail();
  }

  function openModal(title, html) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = html;
    $("#modal").showModal();
  }

  function closeModal() {
    $("#modal").close();
    $("#modalBody").innerHTML = "";
  }

  function clientForm(client = {}) {
    return `
      <form id="clientForm" class="form-stack">
        <label>Nombre del cliente *
          <input name="name" required maxlength="100" value="${escapeHTML(client.name || "")}" placeholder="Nombre y apellido">
        </label>
        <label>Teléfono
          <input name="phone" type="tel" maxlength="40" value="${escapeHTML(client.phone || "")}" placeholder="Número de contacto">
        </label>
        <label>Notas (opcional)
          <textarea name="notes" maxlength="1000" placeholder="Dirección u otra información">${escapeHTML(client.notes || "")}</textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-close-modal>Cancelar</button>
          <button type="submit" class="primary-button">Guardar cliente</button>
        </div>
      </form>`;
  }

  function openClientForm(clientId = null) {
    const client = clientId ? clientById(clientId) : {};
    openModal(clientId ? "Editar cliente" : "Nuevo cliente", clientForm(client || {}));

    $("#clientForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const name = String(form.get("name") || "").trim();

      if (!name) return toast("Escribe el nombre del cliente.");

      const record = {
        id: clientId || uid(),
        name,
        phone: String(form.get("phone") || "").trim(),
        notes: String(form.get("notes") || "").trim(),
        createdAt: client?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await OrderDB.save("clients", record);
      closeModal();
      await refreshData();
      toast("Cliente guardado.");
    });
  }

  function pieceForm(index, item = {}) {
    return `
      <section class="piece-form" data-piece="${index}">
        <div class="piece-title"><strong>Pieza ${index + 1}</strong></div>
        <label>Foto de la pieza
          <input type="file" accept="image/*" data-photo="${index}">
        </label>
        <div data-preview="${index}">
          ${item.photo ? `<img class="image-preview" src="${item.photo}" alt="Foto de la pieza">` : ""}
        </div>
        <label>Nombre del producto *
          <input data-name="${index}" required maxlength="120" value="${escapeHTML(item.name || "")}" placeholder="Ej. Camisa azul">
        </label>
        <label>Precio (${escapeHTML(state.settings.currency)})
          <input data-price="${index}" type="number" min="0" step="0.01" required value="${Number(item.price) || ""}" placeholder="0.00">
        </label>
        <label>Descripción (opcional)
          <textarea data-description="${index}" maxlength="1000" placeholder="Talla, color, detalles…">${escapeHTML(item.description || "")}</textarea>
        </label>
      </section>`;
  }

  function orderForm(order = {}, preselectedClientId = null) {
    const items = Array.isArray(order.items) && order.items.length ? order.items : [{ name: "", price: "", description: "", photo: "" }];
    const selectedClient = preselectedClientId || order.clientId || "";

    return `
      <form id="orderForm" class="form-stack">
        <label>Cliente *
          <select name="clientId" required>
            <option value="">Selecciona un cliente</option>
            ${state.clients.map(client => `
              <option value="${escapeHTML(client.id)}" ${client.id === selectedClient ? "selected" : ""}>${escapeHTML(client.name)}</option>
            `).join("")}
          </select>
        </label>
        ${!state.clients.length ? `<p class="muted small">Primero debes crear un cliente.</p>` : ""}
        <label>Cantidad de piezas
          <input id="pieceCount" type="number" min="1" max="30" value="${items.length}" required>
        </label>
        <div id="pieceForms">${items.map((item, index) => pieceForm(index, item)).join("")}</div>
        <label>Fecha de entrega estimada (opcional)
          <input name="estimatedDate" type="date" value="${escapeHTML(order.estimatedDate || "")}">
        </label>
        <label>Notas del pedido (opcional)
          <textarea name="notes" maxlength="1000" placeholder="Detalles generales del pedido">${escapeHTML(order.notes || "")}</textarea>
        </label>
        <div class="panel">
          <span class="muted small">Total del pedido</span>
          <div id="liveTotal" class="detail-total">${money(items.reduce((sum, item) => sum + (Number(item.price) || 0), 0))}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-close-modal>Cancelar</button>
          <button type="submit" class="primary-button">Guardar pedido</button>
        </div>
      </form>`;
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    if (!file || !file.type.startsWith("image/")) {
      throw new Error("Selecciona un archivo de imagen válido.");
    }

    if (file.size > 12 * 1024 * 1024) {
      throw new Error("La imagen supera los 12 MB. Elige una más pequeña.");
    }

    if (file.type === "image/gif" || file.type === "image/svg+xml") {
      return readFileAsDataURL(file);
    }

    const source = await readFileAsDataURL(file);

    return new Promise(resolve => {
      const image = new Image();

      image.onload = () => {
        const maxSide = 1000;
        const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        try {
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        } catch {
          resolve(source);
        }
      };

      image.onerror = () => resolve(source);
      image.src = source;
    });
  }

  function openOrderForm(orderId = null, preselectedClientId = null) {
    if (!state.clients.length) {
      closeModal();
      showView("clients");
      openClientForm();
      toast("Crea primero el cliente.");
      return;
    }

    const existing = orderId ? orderById(orderId) : null;
    const items = (existing?.items?.length ? existing.items : [{ name: "", price: "", description: "", photo: "" }])
      .map(item => ({ ...item }));

    openModal(orderId ? "Editar pedido" : "Nuevo pedido", orderForm(existing || {}, preselectedClientId));

    const photoState = items.map(item => item.photo || "");

    function updateTotal() {
      const total = $$("#pieceForms [data-price]")
        .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      $("#liveTotal").textContent = money(total);
    }

    function resizePieceForms(count) {
      const container = $("#pieceForms");
      const current = [...container.querySelectorAll(".piece-form")].map(section => {
        const index = Number(section.dataset.piece);
        return {
          name: section.querySelector(`[data-name="${index}"]`).value,
          price: section.querySelector(`[data-price="${index}"]`).value,
          description: section.querySelector(`[data-description="${index}"]`).value,
          photo: photoState[index] || ""
        };
      });

      const safeCount = Math.max(1, Math.min(30, Number(count) || 1));
      while (current.length < safeCount) current.push({ name: "", price: "", description: "", photo: "" });
      current.length = safeCount;
      photoState.length = safeCount;

      container.innerHTML = current.map((item, index) => pieceForm(index, item)).join("");
      current.forEach((item, index) => photoState[index] = item.photo || "");
      updateTotal();
    }

    $("#pieceCount").addEventListener("change", event => {
      resizePieceForms(event.target.value);
    });

    $("#pieceForms").addEventListener("input", event => {
      if (event.target.matches("[data-price]")) updateTotal();
    });

    $("#pieceForms").addEventListener("change", async event => {
      const input = event.target;
      if (!input.matches("[data-photo]") || !input.files?.[0]) return;

      const index = Number(input.dataset.photo);
      const preview = $(`[data-preview="${index}"]`);

      try {
        preview.innerHTML = `<p class="muted small">Procesando imagen…</p>`;
        const dataURL = await compressImage(input.files[0]);
        photoState[index] = dataURL;
        preview.innerHTML = `<img class="image-preview" src="${dataURL}" alt="Vista previa de la pieza">`;
      } catch (error) {
        preview.innerHTML = "";
        toast(error.message || "No se pudo cargar la imagen.");
      }
    });

    $("#orderForm").addEventListener("submit", async event => {
      event.preventDefault();

      const form = new FormData(event.currentTarget);
      const clientId = String(form.get("clientId") || "");
      if (!clientById(clientId)) return toast("Selecciona un cliente válido.");

      const sections = $$("#pieceForms .piece-form");
      if (!sections.length) return toast("Añade al menos una pieza.");

      const newItems = sections.map((section, index) => ({
        id: items[index]?.id || uid(),
        name: section.querySelector(`[data-name="${index}"]`).value.trim(),
        price: Number(section.querySelector(`[data-price="${index}"]`).value),
        description: section.querySelector(`[data-description="${index}"]`).value.trim(),
        photo: photoState[index] || ""
      }));

      if (newItems.some(item => !item.name || !Number.isFinite(item.price) || item.price < 0)) {
        return toast("Revisa el nombre y el precio de cada pieza.");
      }

      const record = {
        id: orderId || uid(),
        clientId,
        items: newItems,
        currency: existing?.currency || state.settings.currency,
        estimatedDate: String(form.get("estimatedDate") || ""),
        notes: String(form.get("notes") || "").trim(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await OrderDB.save("orders", record);
      closeModal();
      await refreshData();
      toast("Pedido guardado correctamente.");
      state.selectedOrderId = record.id;
      showView("order-detail");
    });
  }

  function paymentForm(clientId = null, orderId = null) {
    const chosenOrder = orderId ? orderById(orderId) : null;
    const chosenClient = clientId || chosenOrder?.clientId || "";

    return `
      <form id="paymentForm" class="form-stack">
        <label>Cliente *
          <select name="clientId" required>
            <option value="">Selecciona un cliente</option>
            ${state.clients.map(client => `<option value="${escapeHTML(client.id)}" ${client.id === chosenClient ? "selected" : ""}>${escapeHTML(client.name)}</option>`).join("")}
          </select>
        </label>
        <label>Pedido (opcional)
          <select name="orderId">
            <option value="">Pago general del cliente</option>
            ${state.orders.filter(order => !chosenClient || order.clientId === chosenClient).map(order => {
              const client = clientById(order.clientId);
              return `<option value="${escapeHTML(order.id)}" ${order.id === orderId ? "selected" : ""}>${escapeHTML(client?.name || "Cliente")} · ${dateText(order.createdAt)} · ${money(orderBalance(order), order.currency)} pendiente</option>`;
            }).join("")}
          </select>
        </label>
        <label>Importe del pago *
          <input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00">
        </label>
        <label>Moneda
          <select name="currency">
            ${currencies.map(currency => `<option value="${currency}" ${currency === state.settings.currency ? "selected" : ""}>${currency}</option>`).join("")}
          </select>
        </label>
        <label>Fecha del pago *
          <input name="date" type="date" value="${today()}" required>
        </label>
        <label>Nota (opcional)
          <input name="note" maxlength="300" placeholder="Efectivo, transferencia…">
        </label>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-close-modal>Cancelar</button>
          <button type="submit" class="primary-button">Guardar pago</button>
        </div>
      </form>`;
  }

  function openPaymentForm(clientId = null, orderId = null) {
    if (!state.clients.length) return toast("Primero crea un cliente.");

    openModal("Registrar pago", paymentForm(clientId, orderId));
    const form = $("#paymentForm");

    form.elements.clientId.addEventListener("change", () => {
      const currentClient = form.elements.clientId.value;
      const currentOrder = form.elements.orderId.value;
      const orderSelect = form.elements.orderId;

      orderSelect.innerHTML = `<option value="">Pago general del cliente</option>` +
        state.orders.filter(order => order.clientId === currentClient).map(order =>
          `<option value="${escapeHTML(order.id)}" ${order.id === currentOrder ? "selected" : ""}>${dateText(order.createdAt)} · ${money(orderBalance(order), order.currency)} pendiente</option>`
        ).join("");
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const data = new FormData(form);
      const chosenClientId = String(data.get("clientId") || "");
      const chosenOrderId = String(data.get("orderId") || "");
      const amount = Number(data.get("amount"));
      const currency = String(data.get("currency") || state.settings.currency);

      if (!clientById(chosenClientId)) return toast("Selecciona un cliente.");
      if (chosenOrderId && orderById(chosenOrderId)?.clientId !== chosenClientId) {
        return toast("El pedido no pertenece a ese cliente.");
      }
      if (!Number.isFinite(amount) || amount <= 0) return toast("Introduce un importe válido.");

      const record = {
        id: uid(),
        clientId: chosenClientId,
        orderId: chosenOrderId,
        amount,
        currency,
        date: String(data.get("date") || today()),
        note: String(data.get("note") || "").trim(),
        createdAt: new Date().toISOString()
      };

      await OrderDB.save("payments", record);
      closeModal();
      await refreshData();
      toast("Pago registrado.");
    });
  }

  async function deleteRecord(store, id, message) {
    if (!confirm(message)) return;
    await OrderDB.remove(store, id);
    await refreshData();
    toast("Registro eliminado.");
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function bindEvents() {
    document.addEventListener("click", async event => {
      const target = event.target.closest("button");
      if (!target) return;

      if (target.dataset.go) {
        showView(target.dataset.go);
        return;
      }

      if (target.hasAttribute("data-close-modal")) {
        closeModal();
        return;
      }

      if (target.dataset.action === "new-client") {
        openClientForm();
        return;
      }

      if (target.dataset.action === "new-order") {
        openOrderForm(null, target.dataset.clientId || null);
        return;
      }

      if (target.dataset.action === "new-payment") {
        openPaymentForm(target.dataset.clientId || null, target.dataset.orderId || null);
        return;
      }

      if (target.dataset.client) {
        state.selectedClientId = target.dataset.client;
        showView("client-detail");
        return;
      }

      if (target.dataset.order) {
        state.selectedOrderId = target.dataset.order;
        showView("order-detail");
        return;
      }

      if (target.dataset.editClient) {
        openClientForm(target.dataset.editClient);
        return;
      }

      if (target.dataset.editOrder) {
        openOrderForm(target.dataset.editOrder);
        return;
      }

      if (target.dataset.deleteClient) {
        const id = target.dataset.deleteClient;
        if (state.orders.some(order => order.clientId === id)) {
          return toast("Este cliente tiene pedidos. Elimina primero sus pedidos.");
        }
        if (state.payments.some(payment => payment.clientId === id)) {
          return toast("Este cliente tiene pagos registrados. Conserva el historial o elimina los pagos primero.");
        }
        await deleteRecord("clients", id, "¿Eliminar este cliente?");
        showView("clients");
        return;
      }

      if (target.dataset.deleteOrder) {
        const id = target.dataset.deleteOrder;
        if (state.payments.some(payment => payment.orderId === id)) {
          return toast("Este pedido tiene pagos asociados. No se puede eliminar hasta resolver esos pagos.");
        }
        await deleteRecord("orders", id, "¿Eliminar este pedido y todas sus piezas?");
        showView("orders");
        return;
      }

      if (target.dataset.deletePayment) {
        await deleteRecord("payments", target.dataset.deletePayment, "¿Eliminar este registro de pago?");
        return;
      }
    });

    $("#headerAdd").addEventListener("click", () => openOrderForm());
    $("#closeModal").addEventListener("click", closeModal);

    $("#clientSearch").addEventListener("input", renderClients);
    $("#orderSearch").addEventListener("input", renderOrders);

    $("#settingsForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      state.settings = {
        id: "main",
        businessName: String(form.get("businessName") || "").trim() || "Mi negocio",
        currency: currencies.includes(form.get("currency")) ? form.get("currency") : "USD"
      };

      await OrderDB.save("settings", state.settings);
      renderAll();
      toast("Configuración guardada.");
    });

    $("#exportBackup").addEventListener("click", async () => {
      try {
        const data = await OrderDB.exportAll();
        downloadJSON(data, `OrderOrganizer_respaldo_${today()}.json`);
        toast("Respaldo preparado.");
      } catch (error) {
        toast(error.message || "No se pudo exportar.");
      }
    });

    $("#importBackup").addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!confirm("La importación reemplazará todos los datos actuales. ¿Continuar?")) {
        event.target.value = "";
        return;
      }

      try {
        const data = JSON.parse(await file.text());
        await OrderDB.importAll(data);
        await refreshData();
        toast("Respaldo importado.");
      } catch (error) {
        toast(error.message || "No se pudo importar el archivo.");
      } finally {
        event.target.value = "";
      }
    });
  }

  async function init() {
    try {
      await OrderDB.openDB();
      bindEvents();
      await refreshData();
      showView("dashboard");

      if ("serviceWorker" in navigator && location.protocol !== "file:") {
        navigator.serviceWorker.register("./service-worker.js").catch(error => {
          console.warn("No se pudo registrar el modo sin conexión:", error);
        });
      }
    } catch (error) {
      console.error(error);
      alert("No se pudo iniciar OrderOrganizer. Comprueba que el navegador permita almacenamiento local y recarga la aplicación.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
