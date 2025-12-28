import { formatChatbotMessage, formatChatTimestamp } from "../utils/format.js";

export function createChatSurface(options = {}) {
    const {
        thread,
        empty,
        typing,
        form,
        input,
        sendButton,
        status,
        history = [],
        historyLimit = 12,
        placeholder,
        disabledPlaceholder = "Utilisez le sélecteur global pour commencer.",
        emptyMessage,
        getContext,
        getAuthToken,
        requestPath = "/api/chat",
        requiresAuth = true,
        showMeta = true,
        stream = true,
        authErrorMessage = "Votre session a expiré. Actualisez la page.",
        onUnauthorized,
        onStateChange,
        getSessionId,
        setSessionId,
        resetSessionId,
    } = options;

    let isSending = false;
    let hasInteracted = false;
    let localSessionId = null;

    const resolveContext = () => (typeof getContext === "function" ? getContext() : {});
    const getSession = typeof getSessionId === "function" ? getSessionId : () => localSessionId;
    const setSession = typeof setSessionId === "function" ? setSessionId : (value) => {
        localSessionId = value;
    };
    const resetSession = typeof resetSessionId === "function" ? resetSessionId : () => {
        localSessionId = null;
    };

    const notifyState = () => {
        if (typeof onStateChange === "function") {
            onStateChange({ isSending, hasInteracted });
        }
    };

    const setStatus = (message, isError = false) => {
        if (!status) {
            return;
        }
        const resolved = message || "";
        status.textContent = resolved;
        status.classList.toggle("error", Boolean(isError && resolved));
    };

    const updateAvailability = () => {
        const context = resolveContext();
        const hasRestaurant = Boolean(context.restaurantId);
        const disabled = !hasRestaurant || isSending;

        if (input) {
            const resolvedPlaceholder = typeof placeholder === "function"
                ? placeholder(context)
                : placeholder;
            input.placeholder = hasRestaurant
                ? resolvedPlaceholder || `Message pour ${context.restaurantName || "votre restaurant"}…`
                : disabledPlaceholder;
            input.disabled = disabled;
        }

        if (sendButton) {
            sendButton.disabled = disabled;
        }
    };

    const updateEmptyState = () => {
        if (!empty || !thread) {
            return;
        }
        const hasMessages = thread.children.length > 0;
        empty.hidden = hasMessages;
        if (hasMessages) {
            return;
        }
        const context = resolveContext();
        const resolvedMessage = typeof emptyMessage === "function" ? emptyMessage(context) : emptyMessage;
        if (resolvedMessage) {
            empty.textContent = resolvedMessage;
        }
    };

    const toggleTyping = (shouldShow) => {
        if (!typing) {
            return;
        }
        const visible = Boolean(shouldShow && hasInteracted);
        typing.hidden = !visible;
        typing.setAttribute("aria-hidden", (!visible).toString());
    };

    const appendMessage = (text, role, options = {}) => {
        if (!thread) {
            return null;
        }
        const resolvedRole = role === "assistant" ? "assistant" : "user";
        const context = resolveContext();

        const message = document.createElement("div");
        message.className = `chat-message ${resolvedRole}`;

        const avatar = document.createElement("div");
        avatar.className = "chat-message-avatar";
        avatar.textContent = resolvedRole === "assistant" ? "AI" : "Vous";

        const content = document.createElement("div");
        content.className = "chat-message-content";

        const author = document.createElement("p");
        author.className = "chat-message-author";
        author.textContent = resolvedRole === "assistant"
            ? context.restaurantName || "RestauBot"
            : "Vous";

        const body = document.createElement("div");
        body.className = "chatbot-text";

        const rawText = (text || "").toString();
        if (options.skipFormat) {
            body.textContent = rawText;
        } else if (rawText) {
            body.innerHTML = formatChatbotMessage(rawText);
        }

        content.append(author, body);

        if (showMeta && !options.hideMeta) {
            const meta = document.createElement("small");
            meta.className = "chat-message-meta";
            const metaTime = options.createdAt || new Date().toISOString();
            meta.textContent = formatChatTimestamp(metaTime);
            content.appendChild(meta);
        }

        message.append(avatar, content);
        thread.appendChild(message);
        thread.scrollTop = thread.scrollHeight;
        updateEmptyState();
        if (options.returnElements) {
            return { bubble: message, body };
        }
        return message;
    };

    const streamFormattedContent = (target, text) => new Promise((resolve) => {
        if (!target) {
            resolve();
            return;
        }
        const fullText = (text || "").toString();
        if (!fullText) {
            target.classList.remove("is-streaming");
            target.innerHTML = formatChatbotMessage("");
            resolve();
            return;
        }

        const characters = Array.from(fullText);
        const chunkSize = 4;
        const baseDelay = 18;
        let index = 0;
        let buffer = "";

        target.classList.add("is-streaming");
        target.textContent = "";

        const writeNextChunk = () => {
            const nextChunk = characters.slice(index, index + chunkSize).join("");
            buffer += nextChunk;
            target.textContent = buffer;
            index += chunkSize;
            if (index < characters.length) {
                const jitter = Math.random() * 40;
                window.setTimeout(writeNextChunk, baseDelay + jitter);
            } else {
                target.classList.remove("is-streaming");
                target.innerHTML = formatChatbotMessage(buffer);
                resolve();
            }
        };

        writeNextChunk();
    });

    const ensureSession = () => {
        const current = getSession();
        if (current) {
            return current;
        }
        const next = window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
        setSession(next);
        return next;
    };

    const buildPayloadHistory = () => {
        if (!Array.isArray(history) || !history.length) {
            return [];
        }
        return history.slice(-Math.abs(historyLimit)).map((entry) => ({
            role: entry.role === "assistant" ? "assistant" : "user",
            content: entry.content || "",
        }));
    };

    const trimHistory = () => {
        const maxEntries = historyLimit * 2;
        if (history.length > maxEntries) {
            history.splice(0, history.length - maxEntries);
        }
    };

    const setSending = (value) => {
        isSending = Boolean(value);
        notifyState();
        updateAvailability();
        toggleTyping(isSending);
        if (!isSending && input) {
            input.focus();
        }
    };

    const sendMessage = async (overrideMessage) => {
        if (isSending) {
            return;
        }
        const context = resolveContext();
        if (!context.restaurantId) {
            setStatus("Utilisez le sélecteur global avant de discuter.", true);
            return;
        }
        const message = (overrideMessage ?? input?.value ?? "").toString().trim();
        if (!message) {
            setStatus("Votre message ne peut pas être vide.", true);
            return;
        }

        appendMessage(message, "user");
        if (input) {
            input.value = "";
        }
        history.push({ role: "user", content: message });
        trimHistory();

        setStatus("Envoi en cours…");
        hasInteracted = true;
        setSending(true);

        try {
            const token = typeof getAuthToken === "function" ? await getAuthToken() : null;
            if (requiresAuth && !token) {
                throw new Error("AUTH_REQUIRED");
            }

            const requestBody = JSON.stringify({
                restaurant_id: context.restaurantId,
                message,
                history: buildPayloadHistory(),
                session_id: ensureSession(),
            });

            const sendRequest = (accessToken) => fetch(requestPath, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                },
                body: requestBody,
            });

            let response = await sendRequest(token);
            if (response.status === 401 && requiresAuth && typeof onUnauthorized === "function") {
                const refreshed = await onUnauthorized();
                if (refreshed) {
                    response = await sendRequest(refreshed);
                }
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const detail = payload && payload.detail ? payload.detail : null;
                throw new Error(detail || `Erreur HTTP ${response.status}`);
            }

            const reply = (payload?.reply || "").toString().trim() || "Réponse indisponible.";
            toggleTyping(false);
            const assistantElements = appendMessage("", "assistant", { skipFormat: true, returnElements: true });
            if (stream) {
                await streamFormattedContent(assistantElements?.body, reply);
            } else if (assistantElements?.body) {
                assistantElements.body.innerHTML = formatChatbotMessage(reply);
            }
            history.push({ role: "assistant", content: reply });
            trimHistory();
            setStatus("Réponse générée.");
        } catch (error) {
            console.error("Chat request failed", error);
            const messageText = error?.message === "AUTH_REQUIRED"
                ? authErrorMessage
                : "Impossible de charger la réponse, réessayez.";
            setStatus(messageText, true);
        } finally {
            setSending(false);
        }
    };

    const bind = () => {
        if (form) {
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                sendMessage();
            });
        }
        if (input) {
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                }
            });
        }
    };

    const reset = () => {
        history.splice(0, history.length);
        isSending = false;
        hasInteracted = false;
        resetSession();
        if (thread) {
            thread.innerHTML = "";
        }
        toggleTyping(false);
        updateAvailability();
        updateEmptyState();
        setStatus("");
        notifyState();
    };

    const refresh = () => {
        updateAvailability();
        updateEmptyState();
    };

    return {
        bind,
        refresh,
        reset,
        sendMessage,
        appendMessage,
        setStatus,
    };
}
