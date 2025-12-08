import { state } from "../core/state.js";

const buildHeaders = (headers = {}, options = {}) => {
    const finalHeaders = {
        Accept: "application/json",
        ...headers,
    };
    const includeRestaurantId = options.includeRestaurantId !== false;

    // Use the globally selected restaurant ID
    const restaurantId = state.overview?.restaurantId ? String(state.overview.restaurantId) : null;

    if (includeRestaurantId && restaurantId) {
        finalHeaders["X-Restaurant-Id"] = restaurantId;
    }
    if (state.token) {
        finalHeaders.Authorization = `Bearer ${state.token}`;
    }
    return finalHeaders;
};

const request = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
        // Try to read JSON error, fallback to status text
        try {
            const detail = await response.json();
            const message = detail?.detail || detail?.message || response.statusText;
            throw new Error(message);
        } catch (e) {
            throw new Error(response.statusText || "Erreur réseau inattendue");
        }
    }
    if (response.status === 204) {
        return null;
    }
    return response.json();
};

export const purchasingApi = {
    async fetchRecommendations(params) {
        const query = new URLSearchParams(params).toString();
        return request(`/api/purchasing/ingredients?${query}`, {
            headers: buildHeaders(),
        });
    },
    async fetchPurchaseOrders(limit = 10) {
        return request(`/api/purchasing/orders?limit=${limit}`, {
            headers: buildHeaders(),
        });
    },
    async fetchSummary(params = {}) {
        const query = new URLSearchParams(params).toString();
        const suffix = query ? `?${query}` : "";
        return request(`/api/purchasing/summary${suffix}`, {
            headers: buildHeaders(),
        });
    },
    async fetchSalesInsights(params = {}) {
        const query = new URLSearchParams(params).toString();
        const suffix = query ? `?${query}` : "";
        return request(`/api/sales/insights${suffix}`, {
            headers: buildHeaders(),
        });
    },
    async updateSafetyStock(ingredientId, safetyStock) {
        return request(`/api/purchasing/ingredients/${ingredientId}/stock`, {
            method: "PUT",
            headers: buildHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify({ safety_stock: safetyStock })
        });
    },
    async deleteIngredient(ingredientId) {
        return request(`/api/purchasing/ingredients/${ingredientId}`, {
            method: "DELETE",
            headers: buildHeaders()
        });
    },
    async createIngredient(data) {
        return request(`/api/purchasing/ingredients`, {
            method: "POST",
            headers: buildHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(data)
        });
    },
    async updateIngredient(ingredientId, data) {
        return request(`/api/purchasing/ingredients/${ingredientId}`, {
            method: "PUT",
            headers: buildHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify(data)
        });
    }
};
