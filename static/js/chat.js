(function () {
  const MAX_HISTORY = 12;
  const state = {
    supabase: null,
    session: null,
    userId: null,
    tenantId: null,
    restaurants: [],
    restaurantId: null,
    restaurantName: '',
    history: [],
    isSending: false,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initialize().catch((error) => {
      console.error('Chat page initialization failed', error);
      showStatus("Impossible de charger le chatbot. Vérifiez votre connexion et réessayez.", true);
      disableChatForm();
    });
  });

  async function initialize() {
    state.supabase = await window.getSupabaseClient();
    bindAuthListener();
    await ensureAuthenticated();
    await loadTenantContext();
    bindLogout();

    await loadRestaurantDirectory();

    const context = getRestaurantContextFromUrl();
    setActiveRestaurant(context.id, context.name, { updateUrl: false });

    if (!state.restaurantId && state.restaurants.length) {
      const first = state.restaurants[0];
      setActiveRestaurant(first.id, first.display_name || first.name || 'Votre restaurant');
    }

    bindRestaurantSelector();
    bindSuggestionChips();
    bindClearChat();

    if (!state.restaurantId) {
      showStatus('Aucun restaurant disponible. Créez-en un depuis le dashboard.', true);
      disableChatForm();
      return;
    }

    let restaurantConfirmed = false;
    try {
      await loadRestaurantDetails();
      restaurantConfirmed = true;
    } catch (error) {
      console.warn('Unable to load restaurant details', error);
    }

    bindChatForm();
    toggleEmptyState(true);
    if (restaurantConfirmed) {
      showStatus(`Vous échangez avec l'assistant de ${state.restaurantName}.`);
    } else {
      showStatus(
        `Impossible de confirmer ${state.restaurantName}. Vous pouvez tout de même tester le chatbot.`
      );
    }
    focusInput();
  }

  function bindAuthListener() {
    state.supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        window.location.href = '/login';
        return;
      }
      state.session = session;
      updateUserEmail(session.user?.email);
    });
  }

  async function ensureAuthenticated() {
    const { data, error } = await state.supabase.auth.getSession();
    if (error || !data?.session) {
      window.location.href = '/login';
      throw error || new Error('AUTH_REQUIRED');
    }
    state.session = data.session;
    state.userId = data.session.user?.id || null;
    updateUserEmail(data.session.user?.email);
  }

  async function loadTenantContext() {
    const userId = state.session?.user?.id;
    if (!userId) {
      return;
    }
    const { data, error } = await state.supabase
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1);

    if (error) {
      console.error('Unable to fetch tenant context', error);
      showStatus("Impossible d'identifier votre espace restaurateur.", true);
      return;
    }

    const tenantId = data?.[0]?.tenant_id;
    if (!tenantId) {
      showStatus('Aucun tenant associé à ce compte. Contactez un administrateur.', true);
      return;
    }
    state.tenantId = tenantId;
  }

  async function loadRestaurantDirectory() {
    let query = state.supabase.from('restaurants').select('id,display_name,name,tenant_id');
    if (state.tenantId) {
      query = query.eq('tenant_id', state.tenantId);
    }
    query = query.order('display_name', { ascending: true });
    const { data, error } = await query;

    if (error) {
      console.error('Unable to fetch restaurants', error);
      showStatus("Impossible de récupérer vos restaurants.", true);
      return;
    }
    state.restaurants = data || [];
    if (state.restaurantId && !getRestaurantFromCache(state.restaurantId)) {
      showStatus('Le restaurant indiqué n’est plus disponible. Sélectionnez-en un autre.', true);
      setActiveRestaurant(null, '', { updateUrl: true });
    }
    populateRestaurantSelector();
  }

  function populateRestaurantSelector() {
    const select = document.getElementById('restaurant-selector');
    if (!select) {
      return;
    }
    select.innerHTML = '';

    if (!state.restaurants.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Aucun restaurant';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    state.restaurants.forEach((restaurant) => {
      const option = document.createElement('option');
      option.value = restaurant.id;
      option.textContent = restaurant.display_name || restaurant.name || 'Sans nom';
      select.appendChild(option);
    });

    select.disabled = false;
    if (state.restaurantId) {
      select.value = state.restaurantId;
    }
  }

  function bindRestaurantSelector() {
    const select = document.getElementById('restaurant-selector');
    if (!select) {
      return;
    }
    select.addEventListener('change', async (event) => {
      const newId = event.target.value;
      if (!newId) {
        setActiveRestaurant(null, '', { updateUrl: true });
        state.history = [];
        clearThread();
        showStatus('Sélectionnez un établissement pour utiliser le chatbot.', true);
        disableChatForm();
        return;
      }

      setActiveRestaurant(newId, getRestaurantNameFromCache(newId));
      state.history = [];
      clearThread();
      showStatus('Chargement du chatbot…');
      enableChatForm();
      try {
        await loadRestaurantDetails();
        showStatus(`Vous échangez avec l'assistant de ${state.restaurantName}.`);
        focusInput();
      } catch (error) {
        console.error('Unable to load restaurant after selection', error);
        showStatus("Impossible de charger cet établissement.", true);
      }
    });
  }

  function bindLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn) {
      return;
    }
    logoutBtn.addEventListener('click', async () => {
      await state.supabase.auth.signOut();
      window.location.href = '/login';
    });
  }

  function bindChatForm() {
    const form = document.getElementById('chat-form');
    if (!form) {
      return;
    }
    form.addEventListener('submit', handleSendMessage);
  }

  function bindSuggestionChips() {
    document.querySelectorAll('[data-suggestion]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const suggestion = chip.dataset.suggestion || '';
        fillInputWithSuggestion(suggestion);
      });
    });
  }

  function bindClearChat() {
    const button = document.getElementById('clear-chat');
    if (!button) {
      return;
    }
    button.addEventListener('click', () => {
      state.history = [];
      clearThread();
      showStatus('Conversation réinitialisée. Posez une nouvelle question.');
      focusInput();
    });
  }

  function fillInputWithSuggestion(text) {
    const input = document.getElementById('chat-input');
    if (!input) {
      return;
    }
    input.value = text;
    focusInput();
  }

  function getRestaurantContextFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = (params.get('restaurant_id') || '').trim();
    const name = (params.get('restaurant_name') || '').trim();
    return {
      id,
      name: name || 'ce restaurant',
    };
  }

  function setActiveRestaurant(id, fallbackName, options = { updateUrl: true }) {
    state.restaurantId = id || null;
    if (!state.restaurantId) {
      state.restaurantName = 'Sélectionnez un établissement';
      state.history = [];
      updateRestaurantName(state.restaurantName);
      const select = document.getElementById('restaurant-selector');
      if (select) {
        select.value = '';
      }
      clearThread();
      disableChatForm();
      return;
    }

    const cachedName = getRestaurantNameFromCache(state.restaurantId);
    const resolvedName = cachedName || fallbackName || 'Votre restaurant';
    state.restaurantName = resolvedName;
    updateRestaurantName(resolvedName);

    const select = document.getElementById('restaurant-selector');
    if (select) {
      select.value = state.restaurantId;
    }

    if (options.updateUrl !== false) {
      const params = new URLSearchParams(window.location.search);
      params.set('restaurant_id', state.restaurantId);
      params.set('restaurant_name', state.restaurantName);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    }
  }

  function getRestaurantNameFromCache(id) {
    const record = getRestaurantFromCache(id);
    if (!record) {
      return null;
    }
    return record.display_name || record.name || null;
  }

  function getRestaurantFromCache(id) {
    if (!id) {
      return null;
    }
    return state.restaurants.find((restaurant) => restaurant.id === id) || null;
  }

  async function loadRestaurantDetails() {
    const cached = getRestaurantFromCache(state.restaurantId);
    if (cached) {
      const resolvedName = cached.display_name || cached.name || state.restaurantName;
      state.restaurantName = resolvedName;
      updateRestaurantName(resolvedName);
      return;
    }

    const { data, error } = await state.supabase
      .from('restaurants')
      .select('id,display_name,name')
      .eq('id', state.restaurantId)
      .single();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error('RESTAURANT_NOT_FOUND');
    }

    const resolvedName = data.display_name || data.name || state.restaurantName;
    state.restaurantName = resolvedName;
    updateRestaurantName(resolvedName);
  }

  async function handleSendMessage(event) {
    event.preventDefault();
    if (state.isSending || !state.restaurantId) {
      if (!state.restaurantId) {
        showStatus('Sélectionnez un établissement avant de discuter avec le chatbot.', true);
      }
      return;
    }

    const input = document.getElementById('chat-input');
    if (!input) {
      return;
    }
    const message = input.value.trim();
    if (!message) {
      return;
    }

    appendMessage(message, 'user');
    input.value = '';
    setSendingState(true);

    const historySnapshot = state.history.slice(-MAX_HISTORY);
    const pendingUserEntry = { role: 'user', content: message };

    try {
      const reply = await requestChatCompletion(message, historySnapshot);
      appendMessage(reply, 'assistant');
      pushToHistory(pendingUserEntry);
      pushToHistory({ role: 'assistant', content: reply });
    } catch (error) {
      console.error('Chat request failed', error);
      appendMessage('Désolé, une erreur est survenue. Réessayez plus tard.', 'assistant');
    } finally {
      setSendingState(false);
    }
  }

  async function requestChatCompletion(message, historySnapshot) {
    const token = state.session?.access_token;
    if (!token) {
      window.location.href = '/login';
      throw new Error('AUTH_REQUIRED');
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        restaurant_id: state.restaurantId,
        message,
        history: historySnapshot,
      }),
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const detail = payload?.detail || `Erreur HTTP ${response.status}`;
      throw new Error(detail);
    }

    const reply = (payload?.reply || 'Réponse indisponible.').toString();
    if (!reply.trim()) {
      return 'Réponse indisponible.';
    }
    return reply.trim();
  }

  function pushToHistory(entry) {
    if (!entry?.content) {
      return;
    }
    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) {
      state.history.splice(0, state.history.length - MAX_HISTORY);
    }
  }

  function appendMessage(text, role) {
    const container = document.getElementById('chat-messages');
    if (!container) {
      return;
    }
    const item = document.createElement('div');
    item.className = `chat-message ${role}`;
    item.setAttribute('data-label', role === 'assistant' ? 'RestauBot' : 'Vous');
    item.innerHTML = formatMessage(text);
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
    toggleEmptyState(false);
  }

  function clearThread() {
    const container = document.getElementById('chat-messages');
    if (container) {
      container.innerHTML = '';
    }
    toggleEmptyState(true);
  }

  function formatMessage(text) {
    const safe = escapeHtml(text);
    const blocks = safe.split(/\n{2,}/g).map((block) => {
      const withBreaks = block.replace(/\n/g, '<br />');
      return `<p>${withBreaks}</p>`;
    });
    return blocks.join('') || `<p>${safe}</p>`;
  }

  function escapeHtml(value) {
    return (value || '')
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setSendingState(isSending) {
    state.isSending = isSending;
    const button = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (button) {
      button.disabled = isSending;
    }
    if (input) {
      input.disabled = isSending;
      if (!isSending) {
        input.focus();
      }
    }
    showTypingIndicator(isSending);
  }

  function disableChatForm() {
    const button = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (button) {
      button.disabled = true;
    }
    if (input) {
      input.disabled = true;
    }
    showTypingIndicator(false);
  }

  function enableChatForm() {
    const button = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (button) {
      button.disabled = false;
    }
    if (input) {
      input.disabled = false;
    }
    showTypingIndicator(false);
  }

  function showStatus(message, isError = false) {
    const target = document.getElementById('chat-status');
    if (!target) {
      return;
    }
    target.textContent = message;
    target.classList.toggle('error', Boolean(isError));
  }

  function showTypingIndicator(isVisible) {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
      indicator.hidden = !isVisible;
    }
  }

  function toggleEmptyState(shouldShow) {
    const empty = document.getElementById('chat-empty-state');
    const thread = document.getElementById('chat-messages');
    if (empty) {
      empty.hidden = !shouldShow;
    }
    if (thread) {
      thread.classList.toggle('is-empty', shouldShow);
    }
  }

  function focusInput() {
    const input = document.getElementById('chat-input');
    if (input) {
      input.focus();
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (error) {
      console.warn('Unable to parse JSON response', error);
      return null;
    }
  }

  function updateUserEmail(email) {
    const target = document.getElementById('user-email');
    if (target) {
      target.textContent = email || '';
    }
  }

  function updateRestaurantName(name) {
    const nameEl = document.getElementById('chat-restaurant-name');
    if (nameEl) {
      nameEl.textContent = name;
    }
  }
})();
