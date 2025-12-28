import { createChatSurface } from "./modules/components/chat_surface.js";

document.addEventListener("DOMContentLoaded", () => {
  const isStandalone = document.body.classList.contains("chat-experience");
  const requiresDashboardAuth = isStandalone;

  let restaurantId = null;
  let restaurantName = "Restaurant";
  let supabaseClientPromise = null;
  let authToken = null;
  let chatSurface = null;
  let hasGreeted = false;

  const conversationHistory = [];
  const MAX_HISTORY_ITEMS = 12;

  const urlParams = new URLSearchParams(window.location.search);
  restaurantId = urlParams.get("restaurant_id");
  const nameParam = urlParams.get("restaurant_name");
  if (nameParam) {
    restaurantName = nameParam;
  }

  const resolveContext = () => ({
    restaurantId,
    restaurantName,
  });

  const getSupabaseInstance = async () => {
    if (!requiresDashboardAuth) {
      return null;
    }
    if (supabaseClientPromise) {
      return supabaseClientPromise;
    }
    if (typeof window.getSupabaseClient !== "function") {
      supabaseClientPromise = Promise.resolve(null);
      return supabaseClientPromise;
    }
    supabaseClientPromise = window.getSupabaseClient().catch((error) => {
      console.warn("[Chat] Supabase client unavailable:", error);
      return null;
    });
    return supabaseClientPromise;
  };

  const resolveAuthToken = async () => {
    if (!requiresDashboardAuth) {
      return null;
    }
    if (authToken) {
      return authToken;
    }
    const supabaseClient = await getSupabaseInstance();
    if (!supabaseClient) {
      return null;
    }
    try {
      const { data } = await supabaseClient.auth.getSession();
      authToken = data?.session?.access_token || null;
      return authToken;
    } catch (error) {
      console.warn("[Chat] Unable to fetch Supabase session:", error);
      return null;
    }
  };

  const refreshAuthToken = async () => {
    authToken = null;
    return resolveAuthToken();
  };

  const greetIfNeeded = () => {
    if (hasGreeted || !chatSurface) {
      return;
    }
    chatSurface.appendMessage(
      `Bonjour ! Bienvenue chez ${restaurantName}. Je suis là pour vous guider dans la carte. Que puis-je faire pour vous ?`,
      "assistant",
      { hideMeta: true }
    );
    hasGreeted = true;
  };

  const initStandalone = () => {
    const titleEl = document.getElementById("chat-restaurant-name");
    if (titleEl) titleEl.textContent = restaurantName;

    const statusEl = document.getElementById("chat-status");
    if (statusEl) statusEl.innerHTML = '<span class="status-dot"></span><span>En ligne</span>';

    const menuSection = document.getElementById("menu-sections");
    const menuEmpty = document.getElementById("menu-empty-state");
    if (restaurantId) {
      loadOptimizedMenu(restaurantId, menuSection, menuEmpty);
    }

    const loadingOverlay = document.getElementById("chat-loading-overlay");
    if (loadingOverlay) {
      setTimeout(() => {
        loadingOverlay.style.opacity = "0";
        setTimeout(() => {
          loadingOverlay.style.display = "none";
        }, 300);
      }, 500);
    }
  };

  const initWidget = () => {
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
    headerAction.className = "chat-toggle-btn";
    headerAction.addEventListener("click", () => chatWindow.classList.remove("open"));
    header.appendChild(headerInfo);
    header.appendChild(headerAction);

    const body = document.createElement("div");
    body.className = "chat-body chatbot-surface";

    const messages = document.createElement("div");
    messages.className = "chatbot-thread chat-messages";
    messages.setAttribute("aria-live", "polite");
    messages.setAttribute("aria-label", "Historique des messages");

    const empty = document.createElement("div");
    empty.className = "chatbot-empty chat-empty";
    empty.innerHTML = "<p>Dites bonjour à votre assistant.</p>";

    const typing = document.createElement("div");
    typing.className = "chatbot-typing typing-indicator";
    typing.setAttribute("role", "status");
    typing.setAttribute("aria-live", "polite");
    typing.hidden = true;
    typing.innerHTML = "<span class=\"typing-dot\"></span><span class=\"typing-dot\"></span><span class=\"typing-dot\"></span>";

    body.append(messages, empty, typing);

    const form = document.createElement("form");
    form.className = "chatbot-form chat-input-area";
    form.setAttribute("autocomplete", "off");
    const input = document.createElement("textarea");
    input.id = "chat-widget-input";
    input.name = "message";
    input.placeholder = "Posez votre question…";
    input.rows = 1;
    input.required = true;
    const actions = document.createElement("div");
    actions.className = "chat-input-actions";
    const sendButton = document.createElement("button");
    sendButton.type = "submit";
    sendButton.className = "chat-btn primary";
    sendButton.textContent = "Envoyer";
    actions.appendChild(sendButton);
    form.append(input, actions);

    const feedback = document.createElement("p");
    feedback.className = "chatbot-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");

    chatWindow.append(header, body, form, feedback);
    document.body.append(bubble, chatWindow);

    bubble.addEventListener("click", () => {
      const isOpen = chatWindow.classList.contains("open");
      if (isOpen) {
        chatWindow.classList.remove("open");
        return;
      }
      chatWindow.classList.add("open");
      greetIfNeeded();
      input.focus();
    });

    return { messages, empty, typing, form, input, sendButton, feedback };
  };

  const initSurface = () => {
    let elements = null;
    if (isStandalone) {
      elements = {
        messages: document.getElementById("chat-messages"),
        empty: document.getElementById("chat-empty-state"),
        typing: document.getElementById("typing-indicator"),
        form: document.getElementById("chat-form"),
        input: document.getElementById("chat-input"),
        sendButton: document.getElementById("chat-send"),
        feedback: document.getElementById("chat-feedback"),
      };
    } else {
      elements = initWidget();
    }

    chatSurface = createChatSurface({
      thread: elements.messages,
      empty: elements.empty,
      typing: elements.typing,
      form: elements.form,
      input: elements.input,
      sendButton: elements.sendButton,
      status: elements.feedback,
      history: conversationHistory,
      historyLimit: MAX_HISTORY_ITEMS,
      getContext: resolveContext,
      getAuthToken: resolveAuthToken,
      onUnauthorized: refreshAuthToken,
      requiresAuth: requiresDashboardAuth,
      showMeta: !isStandalone,
      placeholder: () => "Demandez une recommandation, une allergie ou un service personnalisé",
      emptyMessage: () => (isStandalone ? null : "Dites bonjour à votre assistant pour démarrer la conversation."),
      authErrorMessage: "Votre session a expiré. Actualisez la page pour relancer le chatbot.",
    });

    chatSurface.bind();
    chatSurface.refresh();
  };

  if (isStandalone) {
    initStandalone();
  }

  initSurface();

  if (isStandalone) {
    greetIfNeeded();
  }

  async function loadOptimizedMenu(targetRestaurantId, menuSection, menuEmpty) {
    if (!menuSection) return;

    try {
      const response = await fetch(`/api/menu/optimized/${targetRestaurantId}`);
      if (!response.ok) {
        if (menuEmpty) menuEmpty.hidden = false;
        if (menuSection) menuSection.hidden = true;
        return;
      }

      const data = await response.json();
      displayOptimizedMenu(data.categories, menuSection, menuEmpty);
    } catch (error) {
      console.error("Error loading optimized menu:", error);
      if (menuEmpty) menuEmpty.hidden = false;
      if (menuSection) menuSection.hidden = true;
    }
  }

  function displayOptimizedMenu(categories, menuSection, menuEmpty) {
    if (!menuSection || !categories || categories.length === 0) {
      if (menuEmpty) menuEmpty.hidden = false;
      return;
    }

    if (menuEmpty) menuEmpty.hidden = true;
    menuSection.hidden = false;
    menuSection.innerHTML = "";

    categories.forEach((category) => {
      if (!category.items || category.items.length === 0) return;

      const section = document.createElement("div");
      section.className = "menu-category";

      const title = document.createElement("h3");
      title.className = "menu-category-title";
      title.textContent = category.name || "Sans nom";
      section.appendChild(title);

      const itemsList = document.createElement("div");
      itemsList.className = "menu-items";

      category.items.forEach((item, index) => {
        const itemEl = document.createElement("div");
        itemEl.className = "menu-item";

        if (index < 2 && item.availability_score >= 75) {
          itemEl.classList.add("high-stock-item");
          const badge = document.createElement("span");
          badge.className = "stock-badge";
          badge.textContent = "⭐ Disponible";
          badge.title = "Plat avec ingrédients en stock optimal";
          itemEl.appendChild(badge);
        }

        const itemHeader = document.createElement("div");
        itemHeader.className = "menu-item-header";

        const itemName = document.createElement("h4");
        itemName.className = "menu-item-name";
        itemName.textContent = item.name || "Sans nom";
        itemHeader.appendChild(itemName);

        if (item.menu_price) {
          const itemPrice = document.createElement("span");
          itemPrice.className = "menu-item-price";
          itemPrice.textContent = `${item.menu_price.toFixed(2)}€`;
          itemHeader.appendChild(itemPrice);
        }

        itemEl.appendChild(itemHeader);

        if (item.description) {
          const itemDesc = document.createElement("p");
          itemDesc.className = "menu-item-description";
          itemDesc.textContent = item.description;
          itemEl.appendChild(itemDesc);
        }

        itemsList.appendChild(itemEl);
      });

      section.appendChild(itemsList);
      menuSection.appendChild(section);
    });
  }
});
