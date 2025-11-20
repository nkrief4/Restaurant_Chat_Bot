const orderMeta = document.getElementById("order-meta");
const supplierLabel = document.getElementById("order-supplier");
const statusLabel = document.getElementById("order-status");
const expectedDateLabel = document.getElementById("order-expected-date");
const linesBody = document.getElementById("order-lines-body");
const emailTextarea = document.getElementById("order-email");
const copyButton = document.getElementById("copy-email");
const copyStatus = document.getElementById("copy-status");

let supabaseClient = null;
let authToken = null;
let restaurantId = null;

const params = new URLSearchParams(window.location.search);
const pathMatch = window.location.pathname.match(/purchasing\/orders\/(.+)$/);
const orderId = params.get("order_id") || params.get("id") || (pathMatch ? pathMatch[1] : null);

const api = {
  async fetchOrderDetails(targetId) {
    await ensureAuthToken();
    const headers = { Accept: "application/json", Authorization: `Bearer ${authToken}` };
    if (restaurantId) {
      headers["X-Restaurant-Id"] = restaurantId;
    }
    const response = await fetch(`/api/purchasing/purchase-orders/${targetId}`, {
      headers,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail || "Commande introuvable ou inaccessible.");
    }
    return response.json();
  },
};

init();

async function init() {
  restaurantId = resolveRestaurantContext();
  if (!orderId) {
    orderMeta.textContent = "Identifiant de commande manquant.";
    return;
  }
  if (!restaurantId) {
    orderMeta.textContent = "Sélectionnez un restaurant dans le dashboard pour afficher ses commandes.";
    return;
  }
  try {
    await ensureAuthToken();
  } catch (error) {
    orderMeta.textContent = "Session expirée. Merci de vous reconnecter.";
    return;
  }
  orderMeta.textContent = "Chargement…";
  try {
    const order = await api.fetchOrderDetails(orderId);
    renderOrder(order);
  } catch (error) {
    orderMeta.textContent = error.message;
  }
}

function resolveRestaurantContext() {
  const queryId = params.get("restaurant_id");
  if (queryId) {
    persistRestaurantId(queryId);
    return queryId;
  }
  if (document.body?.dataset?.restaurantId) {
    persistRestaurantId(document.body.dataset.restaurantId);
    return document.body.dataset.restaurantId;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    const stored = window.localStorage.getItem("restaurantId");
    if (stored) {
      document.body.dataset.restaurantId = stored;
      return stored;
    }
  }
  return null;
}

function persistRestaurantId(value) {
  if (document.body && value) {
    document.body.dataset.restaurantId = value;
  }
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem("restaurantId", value);
    } else {
      window.localStorage.removeItem("restaurantId");
    }
  } catch (error) {
    console.warn("Impossible de sauvegarder le restaurant actif", error);
  }
}

async function ensureAuthToken() {
  if (!supabaseClient) {
    if (!window.getSupabaseClient) {
      throw new Error("SUPABASE_UNAVAILABLE");
    }
    supabaseClient = await window.getSupabaseClient();
  }
  const { data, error } = await supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) {
    throw new Error("AUTH_REQUIRED");
  }
  authToken = token;
  return authToken;
}

function renderOrder(order) {
  orderMeta.textContent = `Commande #${order.id}`;
  supplierLabel.textContent = order.supplier?.name || order.supplier_id;
  statusLabel.textContent = order.status;
  expectedDateLabel.textContent = order.expected_delivery_date || "—";
  if (order.lines?.length) {
    linesBody.innerHTML = order.lines
      .map(
        (line) => `
        <tr>
          <td>${line.ingredient_name || line.ingredient_id}</td>
          <td>${line.quantity_ordered}</td>
          <td>${line.unit}</td>
        </tr>`,
      )
      .join("\n");
  } else {
    linesBody.innerHTML = `<tr><td colspan="3">Aucune ligne disponible.</td></tr>`;
  }
  emailTextarea.value = order.email_body || "";
}

copyButton?.addEventListener("click", async () => {
  if (!emailTextarea.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(emailTextarea.value);
    copyStatus.textContent = "Email copié dans le presse-papiers.";
  } catch (error) {
    copyStatus.textContent = "Impossible de copier le texte.";
  }
});
