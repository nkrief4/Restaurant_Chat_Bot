(function () {
  'use strict';

  const state = {
    token: null,
    restaurantId: null,
    menuItems: [],
    rows: [],
    analyzing: false,
    activeUploadId: null,
    uploadCanceled: false,
    charts: {
      trend: null,
      top: null,
    },
  };

  const dom = {};

  document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('sales-analytics');
    if (!section) {
      return;
    }
    cacheDom();
    bindEvents();
    state.token = window.supabaseToken || localStorage.getItem('supabase_token') || null;
    const active = window.activeRestaurant;
    if (active && active.id) {
      state.restaurantId = active.id;
      updateActiveRestaurantName(active.name || '');
      initializeData();
    } else {
      setUploadStatus('Sélectionnez un restaurant pour importer des ventes.');
    }
  });

  function cacheDom() {
    dom.dropzone = document.getElementById('sales-dropzone');
    dom.fileInput = document.getElementById('sales-file-input');
    dom.browseBtn = document.getElementById('sales-browse-btn');
    dom.feedback = document.getElementById('sales-upload-feedback');
    dom.status = document.getElementById('sales-upload-status');
    dom.analysisStatus = document.getElementById('sales-analysis-status');
    dom.fileChip = document.getElementById('sales-file-chip');
    dom.recognizedCount = document.getElementById('sales-recognized-count');
    dom.recognizedPercentage = document.getElementById('sales-recognized-percentage');
    dom.unmatchedCount = document.getElementById('sales-unmatched-count');
    dom.unmatchedPercentage = document.getElementById('sales-unmatched-percentage');
    dom.totalRows = document.getElementById('sales-total-rows');
    dom.previewBody = document.getElementById('sales-preview-body');
    dom.confirmBtn = document.getElementById('sales-confirm-btn');
    dom.clearBtn = document.getElementById('sales-clear-btn');
    dom.refreshBtn = document.getElementById('sales-refresh-btn');
    dom.weeklyTotal = document.getElementById('sales-weekly-total');
    dom.updatedLabel = document.getElementById('sales-insights-updated');
    dom.tableBody = document.getElementById('sales-table-body');
    dom.manualForm = document.getElementById('sales-manual-form');
    dom.manualItemSelect = document.getElementById('sales-manual-item');
    dom.manualQty = document.getElementById('sales-manual-qty');
    dom.manualDate = document.getElementById('sales-manual-date');
    dom.manualStatus = document.getElementById('sales-manual-status');
    dom.analysisPane = document.getElementById('sales-analysis-pane');
    dom.analysisClose = document.getElementById('sales-analysis-close');
    dom.dropProgress = document.getElementById('sales-drop-progress');
    dom.dropCard = document.querySelector('.sales-import-card');
    if (dom.manualDate && !dom.manualDate.value) {
      dom.manualDate.value = formatInputDate(new Date());
    }
  }

  function bindEvents() {
    if (dom.dropzone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        dom.dropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          dom.dropzone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
        dom.dropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          if (eventName === 'drop' && event.dataTransfer && event.dataTransfer.files.length) {
            handleFile(event.dataTransfer.files[0]);
          }
          dom.dropzone.classList.remove('is-dragover');
        });
      });
      dom.dropzone.addEventListener('click', () => dom.fileInput && dom.fileInput.click());
      dom.dropzone.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && dom.fileInput) {
          event.preventDefault();
          dom.fileInput.click();
        }
      });
    }

    if (dom.fileInput) {
      dom.fileInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) {
          handleFile(file);
        }
        event.target.value = '';
      });
    }

    if (dom.browseBtn) {
      dom.browseBtn.addEventListener('click', () => dom.fileInput && dom.fileInput.click());
    }

    if (dom.confirmBtn) {
      dom.confirmBtn.addEventListener('click', confirmImport);
    }
    if (dom.clearBtn) {
      dom.clearBtn.addEventListener('click', resetPreview);
    }
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener('click', initializeData);
    }

    if (dom.previewBody) {
      dom.previewBody.addEventListener('input', handlePreviewChange);
      dom.previewBody.addEventListener('change', handlePreviewChange);
    }

    if (dom.manualForm) {
      dom.manualForm.addEventListener('submit', handleManualSaleSubmit);
    }

    if (dom.analysisClose) {
      dom.analysisClose.addEventListener('click', handleAnalysisClose);
    }

    document.addEventListener('activeRestaurantChange', (event) => {
      const detail = event.detail || {};
      state.restaurantId = detail.id || null;
      updateActiveRestaurantName(detail.name || '');
      resetPreview();
      if (state.restaurantId && state.token) {
        initializeData();
      } else {
        setUploadStatus('Sélectionnez un restaurant pour importer des ventes.');
      }
    });

    document.addEventListener('tokenReady', (event) => {
      state.token = event.detail && event.detail.token ? event.detail.token : null;
      if (state.restaurantId && state.token) {
        initializeData();
      }
    });
  }

  async function initializeData() {
    if (!state.restaurantId || !state.token) {
      return;
    }
    await Promise.allSettled([loadMenuItems(), fetchInsights()]);
  }

  async function loadMenuItems() {
    try {
      const response = await authorizedFetch('/api/purchasing/menu-items');
      state.menuItems = Array.isArray(response) ? response : [];
      populateManualMenuOptions();
    } catch (error) {
      console.error('sales::menu-items', error);
      showToast(error.message || 'Impossible de charger les plats.');
    }
  }

  async function fetchInsights() {
    try {
      const data = await authorizedFetch('/api/sales/insights');
      renderInsights(data);
    } catch (error) {
      console.error('sales::insights', error);
      showToast(error.message || 'Impossible de récupérer les ventes.');
    }
  }

  function renderInsights(data) {
    if (!data) {
      return;
    }
    const formattedTotal = formatNumber(data.weekly_total || 0);
    if (dom.weeklyTotal) {
      dom.weeklyTotal.textContent = formattedTotal;
    }
    if (dom.updatedLabel) {
      try {
        const updated = new Date(data.generated_at);
        dom.updatedLabel.textContent = updated.toLocaleString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        dom.updatedLabel.textContent = '-';
      }
    }
    renderTrendChart(data.trend || []);
    renderTopChart(data.top_items || []);
    renderTable(data.table || []);
  }

  function renderTrendChart(points) {
    const canvas = document.getElementById('sales-trend-chart');
    if (!canvas || typeof window.Chart === 'undefined') {
      return;
    }
    const labels = [];
    const values = [];
    points.forEach((point) => {
      labels.push(point.label || point.date_iso || '');
      values.push(point.quantity || 0);
    });
    if (state.charts.trend) {
      state.charts.trend.destroy();
    }
    state.charts.trend = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ventes',
            data: values,
            fill: true,
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96, 165, 250, 0.18)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#cbd5f5',
            },
            grid: {
              color: 'rgba(255,255,255,0.08)',
            },
          },
          x: {
            ticks: { color: '#cbd5f5' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
  }

  function renderTopChart(rows) {
    const canvas = document.getElementById('sales-top-chart');
    if (!canvas || typeof window.Chart === 'undefined') {
      return;
    }
    const topRows = rows.slice(0, 5);
    const labels = topRows.map((row) => row.menu_item_name || 'Plat');
    const values = topRows.map((row) => row.quantity || 0);
    if (state.charts.top) {
      state.charts.top.destroy();
    }
    state.charts.top = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Quantité',
            data: values,
            backgroundColor: ['#38bdf8', '#34d399', '#fbbf24', '#818cf8', '#f472b6'],
            borderRadius: 12,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        indexAxis: 'y',
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#cbd5f5' },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            ticks: { color: '#cbd5f5' },
            grid: { display: false },
          },
        },
      },
    });
  }

  function renderTable(rows) {
    if (!dom.tableBody) {
      return;
    }
    if (!rows.length) {
      dom.tableBody.innerHTML = `<tr><td colspan="3" class="text-center muted">Aucune donnée disponible. Importez ou confirmez des ventes pour afficher les tendances.</td></tr>`;
      return;
    }
    dom.tableBody.innerHTML = rows
      .map((row) => {
        const deltaClass = row.delta >= 0 ? 'is-positive' : 'is-negative';
        const deltaLabel = `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(1)}%`;
        return `<tr>
          <td>${row.menu_item_name || 'Plat'}</td>
          <td>${formatNumber(row.quantity || 0)}</td>
          <td class="sales-delta ${deltaClass}">${deltaLabel}</td>
        </tr>`;
      })
      .join('');
  }

  function handleFile(file) {
    if (!file) {
      return;
    }
    if (!state.restaurantId || !state.token) {
      showToast('Sélectionnez un restaurant avant d’importer.');
      return;
    }
    analyzeFile(file);
  }

  async function analyzeFile(file) {
    if (state.analyzing) {
      return;
    }
    state.analyzing = true;
    const uploadId = Date.now();
    state.activeUploadId = uploadId;
    state.uploadCanceled = false;
    if (dom.analysisStatus) {
      dom.analysisStatus.textContent = 'Analyse en cours...';
    }
    if (dom.feedback) {
      dom.feedback.textContent = `Analyse de ${file.name}...`;
    }
    setUploadStatus('Analyse IA en cours...');
    setDropProgress(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await authorizedFetch('/api/sales/analyze', {
        method: 'POST',
        body: formData,
        isForm: true,
      });
      if (!state.uploadCanceled && state.activeUploadId === uploadId) {
        hydrateRows(response);
        showStatusPane();
        if (dom.analysisStatus) {
          dom.analysisStatus.textContent = 'Analyse terminée';
        }
        if (dom.feedback) {
          dom.feedback.textContent = `Fichier ${file.name} prêt à être confirmé.`;
        }
        if (dom.fileChip) {
          dom.fileChip.textContent = file.name;
          dom.fileChip.hidden = false;
        }
      }
    } catch (error) {
      console.error('sales::analyze', error);
      if (!state.uploadCanceled && state.activeUploadId === uploadId) {
        showDropPane();
        if (dom.analysisStatus) {
          dom.analysisStatus.textContent = 'Analyse indisponible';
        }
        if (dom.feedback) {
          dom.feedback.textContent = error.message || 'Impossible d’analyser ce fichier.';
        }
        showToast(error.message || 'Analyse impossible.');
      }
    } finally {
      state.analyzing = false;
      setDropProgress(false);
      if (state.activeUploadId === uploadId) {
        state.activeUploadId = null;
        state.uploadCanceled = false;
      }
    }
  }

  function hydrateRows(payload) {
    const recognized = payload.recognized || [];
    const unmatched = payload.unmatched || [];
    const total = payload.total_rows || recognized.length + unmatched.length;
    state.rows = [...recognized, ...unmatched].map((row) => ({
      lineId: row.line_id,
      rawName: row.raw_name || '',
      quantity: row.quantity || 0,
      servedAt: row.served_at ? toDateInputValue(row.served_at) : '',
      menuItemId: row.menu_item_id || '',
      menuItemName: row.menu_item_name || '',
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
      status: row.status || 'unmatched',
      suggestions: row.suggestions || [],
    }));
    updateSummary(total, recognized.length, unmatched.length);
    renderPreviewTable();
    setUploadStatus('Analyse terminée. Vérifiez les correspondances.');
  }

  function renderPreviewTable() {
    if (!dom.previewBody) {
      return;
    }
    if (!state.rows.length) {
      dom.previewBody.innerHTML = `<tr><td colspan="5" class="text-center muted">Importez un fichier pour afficher la prévisualisation.</td></tr>`;
      dom.confirmBtn.disabled = true;
      return;
    }
    const optionsMarkup = buildMenuOptions();
    dom.previewBody.innerHTML = state.rows
      .map((row) => {
        const selectOptions = buildSelectOptions(row, optionsMarkup);
        const confidence =
          typeof row.confidence === 'number' ? `${Math.round(row.confidence)}%` : '—';
        const confidenceClass =
          typeof row.confidence === 'number' && row.confidence < 60 ? 'sales-confidence-chip is-low' : 'sales-confidence-chip';
        return `<tr data-line-id="${row.lineId}">
          <td>
            <input type="text" data-field="rawName" value="${escapeHtml(row.rawName)}" aria-label="Nom du plat">
          </td>
          <td>
            <select data-field="menuItemId" aria-label="Associer un plat">
              ${selectOptions}
            </select>
          </td>
          <td>
            <input type="number" min="0" step="1" data-field="quantity" value="${row.quantity}">
          </td>
          <td>
            <input type="date" data-field="servedAt" value="${row.servedAt}">
          </td>
          <td>
            <span class="${confidenceClass}">${confidence}</span>
          </td>
        </tr>`;
      })
      .join('');
    updateConfirmButtonState();
  }

  function buildMenuOptions() {
    if (!state.menuItems.length) {
      return [];
    }
    return state.menuItems
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        label: item.name,
      }));
  }

  function populateManualMenuOptions() {
    if (!dom.manualItemSelect) {
      return;
    }
    const options = buildMenuOptions();
    dom.manualItemSelect.innerHTML = [
      '<option value="">Sélectionnez un plat…</option>',
      ...options.map(
        (item) => `<option value="${item.id}">${escapeHtml(item.label || '')}</option>`
      ),
    ].join('');
  }

  function resetManualForm() {
    if (dom.manualItemSelect) {
      dom.manualItemSelect.value = '';
    }
    if (dom.manualQty) {
      dom.manualQty.value = '1';
    }
    if (dom.manualDate) {
      dom.manualDate.value = formatInputDate(new Date());
    }
    if (dom.manualStatus) {
      dom.manualStatus.textContent = '';
    }
  }

  function buildSelectOptions(row, options) {
    const suggestionOptions = (row.suggestions || [])
      .map((suggestion) => {
        const selected = String(row.menuItemId || '') === String(suggestion.menu_item_id);
        return `<option value="${suggestion.menu_item_id}" ${selected ? 'selected' : ''}>⭐ ${escapeHtml(
          suggestion.menu_item_name || ''
        )} (${Math.round(suggestion.confidence || 0)}%)</option>`;
      })
      .join('');

    const defaultOptions = [
      `<option value="" ${row.menuItemId ? '' : 'selected'}>Sélectionner un plat…</option>`,
      suggestionOptions,
      options
        .map(
          (item) =>
            `<option value="${item.id}" ${
              String(row.menuItemId || '') === String(item.id) ? 'selected' : ''
            }>${escapeHtml(item.label || '')}</option>`
        )
        .join(''),
    ];
    return defaultOptions.join('');
  }

  function handlePreviewChange(event) {
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }
    const rowElement = target.closest('tr[data-line-id]');
    if (!rowElement) {
      return;
    }
    const lineId = rowElement.getAttribute('data-line-id');
    const field = target.getAttribute('data-field');
    if (!lineId || !field) {
      return;
    }
    const row = state.rows.find((entry) => String(entry.lineId) === String(lineId));
    if (!row) {
      return;
    }
    if (field === 'rawName') {
      row.rawName = target.value || '';
    } else if (field === 'quantity') {
      row.quantity = Number(target.value) || 0;
    } else if (field === 'servedAt') {
      row.servedAt = target.value || '';
    } else if (field === 'menuItemId') {
      row.menuItemId = target.value || '';
    }
    updateConfirmButtonState();
  }

  async function confirmImport() {
    if (!state.rows.length || !state.restaurantId || !state.token) {
      return;
    }
    const lines = state.rows
      .filter((row) => row.menuItemId)
      .map((row) => ({
        line_id: row.lineId,
        menu_item_id: row.menuItemId,
        raw_name: row.rawName,
        quantity: row.quantity || 0,
        served_at: row.servedAt ? new Date(row.servedAt).toISOString() : null,
      }));
    if (!lines.length) {
      showToast('Aucun plat à confirmer. Assignez vos plats.');
      return;
    }
    dom.confirmBtn.disabled = true;
    setUploadStatus('Sauvegarde en cours...');
    try {
      const insights = await authorizedFetch('/api/sales/confirm', {
        method: 'POST',
        body: JSON.stringify({ lines }),
      });
      showToast('Import confirmé et synchronisé.');
      resetPreview();
      renderInsights(insights);
    } catch (error) {
      console.error('sales::confirm', error);
      showToast(error.message || 'Impossible de sauvegarder ces ventes.');
    } finally {
      dom.confirmBtn.disabled = false;
      setUploadStatus('Import terminé.');
    }
  }

  function resetPreview() {
    state.rows = [];
    if (dom.previewBody) {
      dom.previewBody.innerHTML = `<tr><td colspan="5" class="text-center muted">Importez un fichier pour afficher la prévisualisation.</td></tr>`;
    }
    dom.confirmBtn && (dom.confirmBtn.disabled = true);
    updateSummary(0, 0, 0);
    if (dom.fileChip) {
      dom.fileChip.hidden = true;
      dom.fileChip.textContent = '';
    }
    if (dom.analysisStatus) {
      dom.analysisStatus.textContent = 'En attente d\'un import';
    }
    showDropPane();
  }

  function updateSummary(total, recognized, unmatched) {
    if (dom.totalRows) {
      dom.totalRows.textContent = String(total);
    }
    if (dom.recognizedCount) {
      dom.recognizedCount.textContent = String(recognized);
    }
    if (dom.unmatchedCount) {
      dom.unmatchedCount.textContent = String(unmatched);
    }
    const recognizedPercent = total ? `${Math.round((recognized / total) * 100)}%` : '-';
    const unmatchedPercent = total ? `${Math.round((unmatched / total) * 100)}%` : '-';
    if (dom.recognizedPercentage) {
      dom.recognizedPercentage.textContent = recognizedPercent;
    }
    if (dom.unmatchedPercentage) {
      dom.unmatchedPercentage.textContent = unmatchedPercent;
    }
  }

  function updateConfirmButtonState() {
    if (!dom.confirmBtn) {
      return;
    }
    const hasAssignableRows = state.rows.some((row) => row.menuItemId);
    dom.confirmBtn.disabled = !hasAssignableRows;
  }

  function setUploadStatus(message) {
    if (dom.status) {
      dom.status.textContent = message;
    }
  }

  async function handleManualSaleSubmit(event) {
    event.preventDefault();
    if (!dom.manualItemSelect || !dom.manualQty || !dom.manualDate) {
      return;
    }
    const menuItemId = dom.manualItemSelect.value;
    const quantity = Number(dom.manualQty.value || 0);
    const orderedDate = dom.manualDate.value;
    if (!menuItemId) {
      if (dom.manualStatus) dom.manualStatus.textContent = 'Choisissez un plat.';
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      if (dom.manualStatus) dom.manualStatus.textContent = 'La quantité doit être supérieure à 0.';
      return;
    }
    if (!orderedDate) {
      if (dom.manualStatus) dom.manualStatus.textContent = 'Sélectionnez une date.';
      return;
    }
    if (dom.manualStatus) dom.manualStatus.textContent = 'Enregistrement…';
    const submitBtn = document.getElementById('sales-manual-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    const payload = {
      menu_item_id: menuItemId,
      quantity: Math.round(quantity),
      ordered_at: new Date(orderedDate).toISOString(),
    };

    try {
      await authorizedFetch('/api/purchasing/sales', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (dom.manualStatus) dom.manualStatus.textContent = '';
      resetManualForm();
      showToast('Vente enregistrée.');
      await fetchInsights();
    } catch (error) {
      console.error('sales::manual-sale', error);
      if (dom.manualStatus) {
        dom.manualStatus.textContent = error.message || 'Impossible de sauvegarder.';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  function showDropPane() {
    if (dom.dropzone) {
      dom.dropzone.hidden = false;
    }
    if (dom.analysisPane) {
      dom.analysisPane.hidden = true;
    }
    if (!state.analyzing) {
      setDropProgress(false);
    }
  }

  function showStatusPane() {
    if (dom.dropzone) {
      dom.dropzone.hidden = true;
    }
    if (dom.analysisPane) {
      dom.analysisPane.hidden = false;
    }
  }

  function setDropProgress(isActive) {
    if (!dom.dropProgress) {
      return;
    }
    if (isActive) {
      dom.dropProgress.hidden = false;
    } else {
      dom.dropProgress.hidden = true;
    }
  }

  function handleAnalysisClose(event) {
    event.preventDefault();
    state.uploadCanceled = true;
    state.activeUploadId = null;
    if (state.analyzing) {
      state.analyzing = false;
      showToast('Analyse annulée.');
    }
    showDropPane();
    setDropProgress(false);
    resetPreview();
    if (dom.feedback) {
      dom.feedback.textContent = 'Prêt à analyser vos ventes.';
    }
    setUploadStatus('Import prêt.');
  }

  function handleErrorResponse(response) {
    if (!response) {
      return 'Erreur inattendue';
    }
    return response.detail || response.message || response.error || 'Erreur serveur inattendue';
  }

  async function authorizedFetch(url, options = {}) {
    if (!state.restaurantId || !state.token) {
      throw new Error('Restaurant ou authentification manquante.');
    }
    const headers = options.headers ? { ...options.headers } : {};
    headers['X-Restaurant-Id'] = state.restaurantId;
    headers.Accept = 'application/json';
    if (!options.isForm) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });
    if (!response.ok) {
      let detail = null;
      try {
        detail = await response.json();
      } catch {
        // ignore
      }
      throw new Error(handleErrorResponse(detail) || response.statusText);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0);
  }

  function escapeHtml(value) {
    if (value == null) {
      return '';
    }
    return String(value).replace(/[&<>"']/g, (char) => {
      const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[char] || char;
    });
  }

  function toDateInputValue(value) {
    if (!value) {
      return '';
    }
    try {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return '';
      }
      const year = parsed.getUTCFullYear();
      const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
      const day = String(parsed.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return '';
    }
  }

  function updateActiveRestaurantName(name) {
    const target = document.getElementById('sales-active-restaurant');
    if (target) {
      target.textContent = name || 'Aucun';
    }
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) {
      return;
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function formatInputDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
})();
