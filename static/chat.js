document.addEventListener("DOMContentLoaded", () => {
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = "💬";

  const chatWindow = document.createElement("div");
  chatWindow.className = "chat-window";

  const header = document.createElement("div");
  header.className = "chat-header";
  const headerInfo = document.createElement("div");
  const headerTitle = document.createElement("h2");
  headerTitle.textContent = "Assistant du restaurant";
  const headerStatus = document.createElement("div");
  headerStatus.className = "chat-status";
  headerStatus.innerHTML = '<span class="status-dot"></span><span>Disponible</span>';
  headerInfo.appendChild(headerTitle);
  headerInfo.appendChild(headerStatus);
  const headerAction = document.createElement("button");
  headerAction.type = "button";
  headerAction.textContent = "–";
  headerAction.setAttribute("aria-label", "Réduire le chat");
  headerAction.style.background = "transparent";
  headerAction.style.border = "none";
  headerAction.style.color = "#cbd5f5";
  headerAction.style.fontSize = "22px";
  headerAction.style.cursor = "pointer";
  headerAction.addEventListener("click", () => chatWindow.classList.remove("open"));
  header.appendChild(headerInfo);
  header.appendChild(headerAction);

  const messagesContainer = document.createElement("div");
  messagesContainer.className = "chat-messages";

  const inputArea = document.createElement("div");
  inputArea.className = "chat-input-area";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Pose ta question...";

  const sendButton = document.createElement("button");
  sendButton.textContent = "Envoyer";

  inputArea.appendChild(input);
  inputArea.appendChild(sendButton);

  chatWindow.appendChild(header);
  chatWindow.appendChild(messagesContainer);
  chatWindow.appendChild(inputArea);

  document.body.appendChild(bubble);
  document.body.appendChild(chatWindow);

  let hasGreeted = false;
  let isSending = false;
  const conversationHistory = [];
  const MAX_HISTORY_ITEMS = 12;

  const recordHistory = (role, content) => {
    if (!content?.trim()) {
      return;
    }
    conversationHistory.push({ role, content });
    if (conversationHistory.length > MAX_HISTORY_ITEMS) {
      conversationHistory.shift();
    }
  };

  const scrollToBottom = () => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  const sanitizeHTML = (value = "") =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const formatMessageText = (text) => {
    const safe = sanitizeHTML(text).trim();
    if (!safe) {
      return "";
    }

    const lines = safe.split(/\n+/);
    const blocks = [];
    let listItems = [];

    const flushList = () => {
      if (!listItems.length) {
        return;
      }
      const itemsHTML = listItems.map((item) => `<li>${item}</li>`).join("");
      blocks.push(`<ul>${itemsHTML}</ul>`);
      listItems = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        continue;
      }

      if (/^(?:[-*•]\s+)/.test(trimmed)) {
        listItems.push(trimmed.replace(/^(?:[-*•]\s+)/, ""));
        continue;
      }

      flushList();

      if (/^section\s*:/i.test(trimmed) || /^(?:conseils?|à savoir)\s*:/i.test(trimmed)) {
        blocks.push(`<p class="section-title">${trimmed}</p>`);
      } else {
        blocks.push(`<p>${trimmed}</p>`);
      }
    }

    flushList();
    return blocks.join("") || `<p>${safe}</p>`;
  };

  const appendMessage = (text, role) => {
    const message = document.createElement("div");
    message.className = `message ${role}`;
    const content = document.createElement("div");
    content.innerHTML = formatMessageText(text);
    const timestamp = document.createElement("small");
    timestamp.textContent = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    });
    message.appendChild(content);
    message.appendChild(timestamp);
    messagesContainer.appendChild(message);
    if (messagesContainer.childNodes.length > 50) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }
    scrollToBottom();
    return message;
  };

  const showTypingIndicator = () => {
    const message = document.createElement("div");
    message.className = "message assistant";
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = "<span></span><span></span><span></span>";
    message.appendChild(indicator);
    messagesContainer.appendChild(message);
    scrollToBottom();
    return message;
  };

  const greetIfNeeded = () => {
    if (hasGreeted) {
      return;
    }
    appendMessage(
      "Bonjour ! Je suis là pour vous guider dans la carte, les régimes alimentaires (casher, halal, végétalien, sans porc, etc.) ou les horaires. Que puis-je faire pour vous ?",
      "assistant"
    );
    hasGreeted = true;
  };

  const setSendingState = (sending) => {
    isSending = sending;
    input.disabled = sending;
    sendButton.disabled = sending;
    if (!sending) {
      input.focus();
    }
  };

  const toggleChat = () => {
    const isOpen = chatWindow.classList.contains("open");
    if (isOpen) {
      chatWindow.classList.remove("open");
      return;
    }
    chatWindow.classList.add("open");
    input.focus();
    greetIfNeeded();
  };

  bubble.addEventListener("click", toggleChat);

  const sendMessage = async () => {
    const userMessage = input.value.trim();
    if (!userMessage || isSending) {
      return;
    }

    appendMessage(userMessage, "user");
    input.value = "";
    setSendingState(true);

    const typingMessage = showTypingIndicator();

    const payload = {
      message: userMessage,
      history: conversationHistory.slice()
    };

    recordHistory("user", userMessage);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}`);
      }

      const data = await response.json();
      messagesContainer.removeChild(typingMessage);
      const reply = data?.reply || "Désolé, une erreur est survenue. Réessayez plus tard.";
      appendMessage(reply, "assistant");
      recordHistory("assistant", reply);
    } catch (error) {
      console.error(error);
      if (messagesContainer.contains(typingMessage)) {
        messagesContainer.removeChild(typingMessage);
      }
      appendMessage("Désolé, une erreur est survenue. Réessayez plus tard.", "assistant");
    } finally {
      setSendingState(false);
    }
  };

  sendButton.addEventListener("click", sendMessage);
  input.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });
});
