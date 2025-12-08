import { formatCurrency, formatDate } from "../utils/format.js";

// --- Billing Logic ---

export function renderBilling(billing) {
    if (!billing) {
        return;
    }
    const plan = billing.plan || {};
    setTextContent("billing-plan-name", plan.name || "Plan Pro");
    setTextContent("billing-plan-description", plan.description || "");
    const nextPayment = billing.next_payment ? `Prochain prélèvement le ${formatDate(billing.next_payment)}` : "";
    setTextContent("billing-next-payment", nextPayment || "Prochain prélèvement non programmé");
    renderBillingHistory(billing.history);
}

function renderBillingHistory(history) {
    const tbody = document.getElementById("billing-history-body");
    if (!tbody) {
        return;
    }
    tbody.innerHTML = "";
    const entries = Array.isArray(history) && history.length ? history : null;
    if (!entries) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.textContent = "Aucun paiement enregistré.";
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
    }
    entries.forEach((entry) => {
        const tr = document.createElement("tr");
        const dateCell = document.createElement("td");
        dateCell.textContent = formatDate(entry.date);
        const descCell = document.createElement("td");
        descCell.textContent = entry.description || "—";
        const amountCell = document.createElement("td");
        amountCell.textContent = formatCurrency(entry.amount, entry.currency);
        const statusCell = document.createElement("td");
        const badge = document.createElement("span");
        const statusRaw = (entry.status || "paid").toString().toLowerCase();
        badge.className = `status ${statusRaw}`;
        badge.textContent = statusRaw === "paid" ? "Payé" : statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
        statusCell.appendChild(badge);
        tr.append(dateCell, descCell, amountCell, statusCell);
        tbody.appendChild(tr);
    });
}

function setTextContent(id, value) {
    const target = document.getElementById(id);
    if (!target) {
        return;
    }
    if (value === null || value === undefined || value === "") {
        target.textContent = "—";
        return;
    }
    target.textContent = value;
}
