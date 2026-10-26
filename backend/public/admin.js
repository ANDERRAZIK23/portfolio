'use strict';

(() => {
  const MAX_FILE_SIZE = 200 * 1024 * 1024;
  const SINGLE_UPLOAD_MAX_SIZE = 20 * 1024 * 1024;
  const numberFormat = new Intl.NumberFormat('fr-FR');
  const countryFormat = new Intl.DisplayNames(['fr'], { type: 'region' });
  const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fullDayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const uploadDateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fileNameCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const $ = (id) => document.getElementById(id);
  const state = { authenticated: false, statsController: null, files: [], cursor: null, filesLoaded: false, filesBusy: false, uploadBusy: false, selectedFile: null, deleteFile: null, deleteBusy: false };

  class ApiError extends Error {
    constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
  }

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (response.status === 401 || response.status === 403 || response.redirected) {
      expireSession();
      throw new ApiError('Votre session a expiré ou cet accès n’est pas autorisé. Reconnectez-vous pour continuer.', response.status);
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new ApiError('Le serveur a renvoyé une réponse inattendue. Vérifiez votre connexion à Cloudflare Access, puis réessayez.', response.status);
    }
    const payload = await response.json();
    if (!response.ok) {
      const detail = typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : `La requête a échoué (HTTP ${response.status}).`;
      throw new ApiError(detail, response.status);
    }
    return payload;
  }

  function showError(id, message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }

  function errorMessage(error) {
    return error instanceof ApiError ? error.message : 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.';
  }

  function announce(message) { $('action-announcement').textContent = message; }

  function expireSession() {
    state.authenticated = false;
    state.statsController?.abort();
    if ($('delete-dialog').open) $('delete-dialog').close();
    $('app').hidden = true;
    $('session-gate').hidden = false;
    $('gate-spinner').hidden = true;
    $('gate-title').textContent = 'Reconnectez-vous à votre espace';
    document.title = 'Connexion · Administration · Achraf Abderrazik';
    $('gate-message').textContent = 'Votre session a expiré ou votre compte n’a pas accès à cette administration.';
    $('session-retry').hidden = false;
    $('session-login').hidden = false;
  }

  async function loadSession() {
    $('session-retry').disabled = true;
    $('gate-spinner').hidden = false;
    $('gate-title').textContent = 'Vérification de votre accès';
    $('gate-message').textContent = 'Connexion à votre espace d’administration…';
    $('session-login').hidden = true;
    try {
      const session = await request('/api/session');
      $('session-email').textContent = session.email;
      state.authenticated = true;
      $('session-gate').hidden = true;
      $('app').hidden = false;
      navigate(false);
      loadStats();
    } catch (error) {
      $('gate-spinner').hidden = true;
      $('gate-title').textContent = 'Accès à l’administration indisponible';
      $('gate-message').textContent = errorMessage(error);
      $('session-retry').hidden = false;
      $('session-login').hidden = false;
    } finally {
      $('session-retry').disabled = false;
    }
  }

  function navigate(moveFocus) {
    if (!state.authenticated) return;
    const view = location.hash === '#files' ? 'files' : 'analytics';
    $('analytics-view').hidden = view !== 'analytics';
    $('files-view').hidden = view !== 'files';
    $('breadcrumb').textContent = view === 'files' ? 'Mes fichiers' : 'Vue d’ensemble';
    document.title = `${view === 'files' ? 'Mes fichiers' : 'Vue d’ensemble'} · Administration · Achraf Abderrazik`;
    document.querySelectorAll('[data-view]').forEach((link) => {
      const active = link.dataset.view === view;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (moveFocus) $(`${view}-title`).focus({ preventScroll: true });
    if (view === 'files' && !state.filesLoaded && !state.filesBusy) loadFiles(false);
  }

  function analyticsDate(day) { return new Date(`${day}T00:00:00Z`); }

  function renderStats(stats) {
    $('total-views').textContent = numberFormat.format(stats.totalViews);
    $('unique-visitors').textContent = numberFormat.format(stats.uniqueVisitors);
    $('daily-average').textContent = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(stats.totalViews / stats.periodDays);
    $('period-description').textContent = `Sur les ${stats.periodDays} derniers jours, aujourd’hui inclus`;
    const maximum = Math.max(0, ...stats.days.map((item) => item.views));
    $('trend-empty').hidden = maximum !== 0;
    $('trend-content').hidden = maximum === 0;
    const bars = document.createDocumentFragment();
    const rows = document.createDocumentFragment();
    for (const day of stats.days) {
      const date = analyticsDate(day.day);
      const label = `${fullDayFormat.format(date)} : ${numberFormat.format(day.views)} pages vues, ${numberFormat.format(day.visitors)} visiteurs`;
      const item = document.createElement('div');
      item.className = 'chart-day';
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-label', label);
      item.tabIndex = 0;
      item.style.setProperty('--bar-height', `${maximum ? (day.views / maximum) * 100 : 0}%`);
      const bar = document.createElement('span');
      bar.className = 'chart-bar';
      bar.setAttribute('aria-hidden', 'true');
      const tooltip = document.createElement('span');
      tooltip.className = 'chart-tooltip';
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.textContent = `${dayFormat.format(date)} · ${numberFormat.format(day.views)} vues`;
      item.append(bar, tooltip);
      bars.append(item);
      const row = document.createElement('tr');
      [fullDayFormat.format(date), numberFormat.format(day.views), numberFormat.format(day.visitors)].forEach((text, index) => {
        const cell = document.createElement('td');
        if (index) cell.className = 'number';
        cell.textContent = text;
        row.append(cell);
      });
      rows.append(row);
    }
    $('trend-chart').replaceChildren(bars);
    $('daily-rows').replaceChildren(rows);
    $('chart-start').textContent = stats.days.length ? dayFormat.format(analyticsDate(stats.days[0].day)) : '';
    $('chart-end').textContent = stats.days.length ? dayFormat.format(analyticsDate(stats.days[stats.days.length - 1].day)) : '';
    renderRanking('countries-list', stats.countries, 'country');
    renderRanking('referrers-list', stats.referrers, 'referrer');
    renderRanking('devices-list', stats.devices, 'device');
    renderRanking('pages-list', stats.pages, 'path');
  }

  function renderRanking(id, items, labelKey) {
    const fragment = document.createDocumentFragment();
    if (!items.length) {
      const message = document.createElement('p');
      message.className = 'empty-state';
      message.textContent = 'Aucune donnée sur cette période.';
      fragment.append(message);
    } else {
      const maximum = Math.max(...items.map((item) => item.views));
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'rank-item';
        row.style.setProperty('--rank-width', `${maximum ? (item.views / maximum) * 100 : 0}%`);
        const label = document.createElement('span');
        label.className = 'rank-name';
        if (labelKey === 'country') {
          label.textContent = countryFormat.of(item.country);
        } else if (labelKey === 'device') {
          label.textContent = { desktop: 'Ordinateur', mobile: 'Mobile', tablet: 'Tablette' }[item.device];
        } else if (labelKey === 'referrer' && item.referrer === 'direct') {
          label.textContent = 'Accès direct / interne';
        } else {
          label.textContent = item[labelKey];
        }
        const value = document.createElement('span');
        value.className = 'rank-value';
        value.textContent = numberFormat.format(item.views);
        row.append(label, value);
        fragment.append(row);
      }
    }
    $(id).replaceChildren(fragment);
  }

  async function loadStats() {
    if (!state.authenticated) return;
    state.statsController?.abort();
    const controller = new AbortController();
    state.statsController = controller;
    $('stats-loading').hidden = false;
    $('stats-content').hidden = true;
    $('refresh-stats').disabled = true;
    showError('stats-error', '');
    try {
      const stats = await request(`/api/stats?days=${encodeURIComponent($('period').value)}`, { signal: controller.signal });
      if (!state.authenticated || controller.signal.aborted) return;
      renderStats(stats);
      $('stats-content').hidden = false;
    } catch (error) {
      if (error.name !== 'AbortError') showError('stats-error', errorMessage(error));
    } finally {
      if (state.statsController === controller) {
        $('stats-loading').hidden = true;
        $('refresh-stats').disabled = false;
      }
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 octet';
    const units = ['octets', 'Kio', 'Mio', 'Gio', 'Tio'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: index === 0 ? 0 : 1 }).format(bytes / (1024 ** index))} ${units[index]}`;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function renderFiles() {
    const query = normalizeFileName($('file-search').value.trim());
    const visibleFiles = state.files.filter((file) => normalizeFileName(file.name).includes(query));
    const comparators = {
      newest: (first, second) => Date.parse(second.uploaded) - Date.parse(first.uploaded),
      oldest: (first, second) => Date.parse(first.uploaded) - Date.parse(second.uploaded),
      name: (first, second) => fileNameCollator.compare(first.name, second.name),
      size: (first, second) => second.size - first.size,
    };
    const compare = comparators[$('file-sort').value];
    visibleFiles.sort((first, second) => compare(first, second) || fileNameCollator.compare(first.name, second.name) || fileNameCollator.compare(first.key, second.key));
    const fragment = document.createDocumentFragment();
    for (const file of visibleFiles) {
      const row = document.createElement('li');
      row.className = 'file-row';
      const symbol = document.createElement('span');
      symbol.className = 'file-symbol';
      symbol.append(icon('file'));
      const info = document.createElement('div');
      info.className = 'file-info';
      const name = document.createElement('p');
      name.className = 'file-name';
      name.textContent = file.name;
      const meta = document.createElement('p');
      meta.className = 'file-meta';
      const size = document.createElement('span');
      size.textContent = formatBytes(file.size);
      const date = document.createElement('span');
      date.textContent = uploadDateFormat.format(new Date(file.uploaded));
      meta.append(size, date);
      info.append(name, meta);
      const actions = document.createElement('div');
      actions.className = 'file-actions';
      const download = document.createElement('a');
      download.className = 'file-action';
      download.href = `/api/files/${encodeURIComponent(file.key)}`;
      download.setAttribute('download', file.name);
      download.setAttribute('aria-label', `Télécharger ${file.name}`);
      download.title = 'Télécharger';
      download.append(icon('download'));
      const remove = document.createElement('button');
      remove.className = 'file-action delete-action';
      remove.type = 'button';
      remove.setAttribute('aria-label', `Supprimer ${file.name}`);
      remove.title = 'Supprimer';
      remove.append(icon('trash'));
      remove.addEventListener('click', () => openDeleteDialog(file));
      actions.append(download, remove);
      row.append(symbol, info, actions);
      fragment.append(row);
    }
    $('file-list').replaceChildren(fragment);
    $('loaded-count').textContent = numberFormat.format(state.files.length);
    $('loaded-size').textContent = formatBytes(state.files.reduce((total, file) => total + file.size, 0));
    $('files-empty').hidden = state.files.length !== 0;
    $('load-more').hidden = !state.cursor;
    if (!state.files.length) {
      $('file-results').textContent = 'Aucun fichier chargé.';
    } else if (!visibleFiles.length) {
      const loadedLabel = state.files.length === 1 ? 'le fichier chargé' : `les ${numberFormat.format(state.files.length)} fichiers chargés`;
      $('file-results').textContent = `Aucun résultat parmi ${loadedLabel}.${state.cursor ? ' Chargez la suite pour étendre la recherche.' : ''}`;
    } else {
      $('file-results').textContent = `${numberFormat.format(visibleFiles.length)} fichier${visibleFiles.length > 1 ? 's' : ''} affiché${visibleFiles.length > 1 ? 's' : ''} sur ${numberFormat.format(state.files.length)} chargé${state.files.length > 1 ? 's' : ''}.${query && state.cursor ? ' La recherche porte sur les fichiers chargés.' : ''}`;
    }
  }

  function normalizeFileName(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
  }

  function updateFileControls() {
    $('file-search').disabled = state.filesBusy;
    $('file-sort').disabled = state.filesBusy;
    $('refresh-files').disabled = state.filesBusy || state.uploadBusy || state.deleteBusy;
    $('load-more').disabled = state.filesBusy || state.uploadBusy || state.deleteBusy;
    $('upload-button').disabled = !state.selectedFile || state.uploadBusy || state.filesBusy || state.deleteBusy;
    $('file-input').disabled = state.uploadBusy;
    $('clear-file').disabled = state.uploadBusy;
    document.querySelectorAll('.delete-action').forEach((button) => {
      button.disabled = state.filesBusy || state.uploadBusy || state.deleteBusy;
    });
  }

  async function loadFiles(append) {
    if (!state.authenticated || state.filesBusy) return;
    state.filesBusy = true;
    updateFileControls();
    $('files-loading').hidden = false;
    $('files-empty').hidden = true;
    showError('files-error', '');
    try {
      const query = append && state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : '';
      const result = await request(`/api/files${query}`);
      if (!state.authenticated) return;
      state.files = append ? [...state.files, ...result.files] : result.files;
      state.cursor = result.hasMore ? result.cursor : null;
      state.filesLoaded = true;
      renderFiles();
      updateFileControls();
    } catch (error) {
      showError('files-error', errorMessage(error));
    } finally {
      state.filesBusy = false;
      $('files-loading').hidden = true;
      updateFileControls();
    }
  }

  function uploadFeedback(message, isError = false) {
    $('upload-feedback').textContent = message;
    $('upload-feedback').classList.toggle('is-error', isError);
  }

  function selectFile(file) {
    if (state.uploadBusy) return;
    uploadFeedback('');
    if (file && file.size > MAX_FILE_SIZE) {
      clearFile();
      uploadFeedback('Ce fichier dépasse la limite de 200 Mio. Choisissez un fichier plus petit.', true);
      return;
    }
    state.selectedFile = file;
    $('selected-file').hidden = !file;
    $('selected-name').textContent = file ? file.name : '';
    $('selected-size').textContent = file ? formatBytes(file.size) : '';
    updateFileControls();
  }

  function clearFile() {
    $('file-input').value = '';
    selectFile(null);
  }

  async function uploadMultipartFile(file) {
    let token = null;
    try {
      const upload = await request('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, size: file.size }),
      });
      if (typeof upload.token === 'string' && upload.token) token = upload.token;
      if (!token || !Number.isSafeInteger(upload.partSize) || upload.partSize <= 0 || upload.partSize > SINGLE_UPLOAD_MAX_SIZE
        || upload.partCount !== Math.ceil(file.size / upload.partSize)) {
        throw new ApiError('Le serveur a renvoyé une configuration de téléversement invalide.', 502);
      }
      const parts = [];
      uploadFeedback(`Téléversement : 0 octet sur ${formatBytes(file.size)} · 0/${upload.partCount} parties. Ne fermez pas cette page.`);
      for (let partNumber = 1; partNumber <= upload.partCount; partNumber += 1) {
        const start = (partNumber - 1) * upload.partSize;
        const end = Math.min(start + upload.partSize, file.size);
        const part = await request(`/api/uploads/parts/${partNumber}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Token': token },
          body: file.slice(start, end),
        });
        if (part.partNumber !== partNumber || typeof part.etag !== 'string' || !part.etag) {
          throw new ApiError('Le serveur n’a pas confirmé la réception d’une partie du fichier.', 502);
        }
        parts.push({ partNumber, etag: part.etag });
        uploadFeedback(`Téléversement : ${formatBytes(end)} sur ${formatBytes(file.size)} · ${partNumber}/${upload.partCount} parties. Ne fermez pas cette page.`);
      }
      uploadFeedback(`${formatBytes(file.size)} transférés · Finalisation du fichier… Ne fermez pas cette page.`);
      return await request('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, parts }),
      });
    } catch (error) {
      if (token) {
        try {
          await request('/api/uploads', { method: 'DELETE', headers: { 'X-Upload-Token': token } });
        } catch (cleanupError) {
          throw new ApiError(`${errorMessage(error)} Le nettoyage du téléversement incomplet a aussi échoué : ${errorMessage(cleanupError)}`, 502);
        }
      }
      throw error;
    }
  }

  async function uploadFile(event) {
    event.preventDefault();
    if (!state.authenticated || !state.selectedFile || state.uploadBusy || state.filesBusy || state.deleteBusy) return;
    const file = state.selectedFile;
    state.uploadBusy = true;
    updateFileControls();
    $('upload-button').setAttribute('aria-busy', 'true');
    uploadFeedback('Enregistrement en cours… Ne fermez pas cette page.');
    try {
      if (file.size <= SINGLE_UPLOAD_MAX_SIZE) {
        await request('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      } else {
        await uploadMultipartFile(file);
      }
      if (!state.authenticated) return;
      state.uploadBusy = false;
      clearFile();
      uploadFeedback(`« ${file.name} » a été enregistré.`);
      await loadFiles(false);
    } catch (error) {
      const message = errorMessage(error);
      uploadFeedback(message, true);
      if (!state.authenticated) $('gate-message').textContent = message;
    } finally {
      state.uploadBusy = false;
      $('upload-button').removeAttribute('aria-busy');
      updateFileControls();
    }
  }

  function openDeleteDialog(file) {
    if (state.uploadBusy || state.filesBusy || state.deleteBusy) return;
    state.deleteFile = file;
    $('delete-description').textContent = `Le fichier « ${file.name} » sera retiré de votre stockage privé.`;
    showError('delete-error', '');
    $('confirm-delete').disabled = false;
    $('cancel-delete').disabled = false;
    $('delete-dialog').showModal();
  }

  async function deleteFile() {
    if (!state.authenticated || !state.deleteFile || state.deleteBusy) return;
    const file = state.deleteFile;
    state.deleteBusy = true;
    $('confirm-delete').disabled = true;
    $('cancel-delete').disabled = true;
    $('confirm-delete').textContent = 'Suppression…';
    updateFileControls();
    showError('delete-error', '');
    try {
      await request(`/api/files/${encodeURIComponent(file.key)}`, { method: 'DELETE' });
      if (!state.authenticated) return;
      state.files = state.files.filter((item) => item.key !== file.key);
      renderFiles();
      $('delete-dialog').close();
      $('file-list-title').focus({ preventScroll: true });
      announce(`Le fichier « ${file.name} » a été supprimé.`);
    } catch (error) {
      showError('delete-error', errorMessage(error));
    } finally {
      state.deleteBusy = false;
      $('confirm-delete').disabled = false;
      $('cancel-delete').disabled = false;
      $('confirm-delete').textContent = 'Supprimer';
      updateFileControls();
    }
  }

  function initializeMotion() {
    const storageKey = 'portfolio-admin-motion';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const button = $('motion-toggle');
    const resetTilts = [];
    let preference = null;
    let motionActive = false;
    try {
      preference = localStorage.getItem(storageKey);
    } catch (error) {
      console.warn('Impossible de lire la préférence d’animation de l’administration.', error);
    }

    function updateMotion() {
      motionActive = !reducedMotion.matches && preference !== 'paused';
      document.body.dataset.motion = motionActive ? 'active' : 'paused';
      button.setAttribute('aria-pressed', String(motionActive));
      button.disabled = reducedMotion.matches;
      button.title = reducedMotion.matches
        ? 'Animations désactivées selon les préférences de votre appareil'
        : motionActive ? 'Mettre les animations en pause' : 'Activer les animations';
      const label = button.querySelector('[data-motion-label]');
      if (label) label.textContent = motionActive ? 'Animations actives' : 'Animations en pause';
      if (!motionActive) resetTilts.forEach((reset) => reset());
    }

    document.querySelectorAll('[data-tilt]').forEach((element) => {
      let frame = 0;
      let pointerX = 0;
      let pointerY = 0;
      function reset() {
        window.cancelAnimationFrame(frame);
        frame = 0;
        element.style.setProperty('--tilt-x', '0deg');
        element.style.setProperty('--tilt-y', '0deg');
        element.style.setProperty('--parallax-x', '0px');
        element.style.setProperty('--parallax-y', '0px');
        element.removeAttribute('data-tilt-active');
      }
      resetTilts.push(reset);
      element.addEventListener('pointermove', (event) => {
        if (!motionActive || !finePointer.matches || event.pointerType === 'touch') return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (!motionActive || !finePointer.matches || document.hidden) return;
          const bounds = element.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          const x = Math.max(-1, Math.min(1, ((pointerX - bounds.left) / bounds.width - 0.5) * 2));
          const y = Math.max(-1, Math.min(1, ((pointerY - bounds.top) / bounds.height - 0.5) * 2));
          element.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
          element.style.setProperty('--tilt-y', `${(x * 7).toFixed(2)}deg`);
          element.style.setProperty('--parallax-x', `${(x * 10).toFixed(2)}px`);
          element.style.setProperty('--parallax-y', `${(y * 10).toFixed(2)}px`);
          element.dataset.tiltActive = 'true';
        });
      });
      element.addEventListener('pointerleave', reset);
      element.addEventListener('pointercancel', reset);
    });

    button.addEventListener('click', () => {
      preference = motionActive ? 'paused' : 'active';
      try {
        localStorage.setItem(storageKey, preference);
      } catch (error) {
        console.warn('Impossible d’enregistrer la préférence d’animation de l’administration.', error);
      }
      updateMotion();
    });
    reducedMotion.addEventListener('change', updateMotion);
    finePointer.addEventListener('change', () => resetTilts.forEach((reset) => reset()));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetTilts.forEach((reset) => reset());
    });
    updateMotion();
  }

  $('session-retry').addEventListener('click', loadSession);
  window.addEventListener('hashchange', () => navigate(true));
  $('period').addEventListener('change', loadStats);
  $('refresh-stats').addEventListener('click', loadStats);
  $('refresh-files').addEventListener('click', () => loadFiles(false));
  $('load-more').addEventListener('click', () => loadFiles(true));
  $('file-search').addEventListener('input', () => { renderFiles(); updateFileControls(); });
  $('file-sort').addEventListener('change', () => { renderFiles(); updateFileControls(); });
  $('file-input').addEventListener('change', (event) => selectFile(event.target.files[0] || null));
  $('clear-file').addEventListener('click', clearFile);
  $('upload-form').addEventListener('submit', uploadFile);
  $('confirm-delete').addEventListener('click', deleteFile);
  $('delete-dialog').addEventListener('cancel', (event) => { if (state.deleteBusy) event.preventDefault(); });
  $('delete-dialog').addEventListener('close', () => { state.deleteFile = null; });
  let dragDepth = 0;
  $('drop-zone').addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (state.uploadBusy) return;
    dragDepth += 1;
    $('drop-zone').classList.add('is-dragging');
  });
  $('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); });
  $('drop-zone').addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('drop-zone').classList.remove('is-dragging');
  });
  $('drop-zone').addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    $('drop-zone').classList.remove('is-dragging');
    if (state.uploadBusy) return;
    if (event.dataTransfer.files.length !== 1) {
      uploadFeedback('Déposez un seul fichier à la fois.', true);
      return;
    }
    $('file-input').value = '';
    selectFile(event.dataTransfer.files[0]);
  });
  initializeMotion();
  loadSession();
})();
