export function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "—";
    }
    return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatFileSize(bytes) {
    if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes <= 0) {
        return "";
    }
    const units = ["octets", "Ko", "Mo", "Go"];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    const decimals = index === 0 ? 0 : size < 10 ? 1 : 0;
    return `${size.toFixed(decimals)} ${units[index]}`;
}

export function formatDate(value) {
    if (!value) {
        return "—";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleDateString("fr-FR");
}

export function formatCurrency(amount, currency = "EUR") {
    if (typeof amount !== "number") {
        return amount || "—";
    }
    return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
    }).format(amount);
}

export function formatRangeText(range) {
    if (!range || !range.start || !range.end) {
        return "Période non définie";
    }
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return "Période non définie";
    }
    const startLabel = start.toLocaleDateString("fr-FR");
    const endLabel = end.toLocaleDateString("fr-FR");
    if (startLabel === endLabel) {
        return `Le ${startLabel}`;
    }
    return `Du ${startLabel} au ${endLabel}`;
}

export function escapeHtml(value) {
    return (value || "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function formatChatTimestamp(value) {
    if (!value) {
        return "À l'instant";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "À l'instant";
    }
    return parsed.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
    });
}
export function formatChatbotMessage(text) {
    if (!text) {
        return "";
    }
    // Simple formatting: newlines to <br>
    // Also bolding **text** -> <b>text</b>
    let formatted = escapeHtml(text);
    formatted = formatted.replace(/\n/g, "<br>");
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
    return formatted;
}
