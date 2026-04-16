// State
let chart = null;
let gauge5h = null;
let gauge7d = null;
let lastFetchTime = null;
let updateTimer = null;
let historyData = { dataPoints: [] };
let isDarkMode = false;

// Chart colors
const COLORS = {
  '5h':     { color: 'rgb(0, 122, 255)',   fill: 'rgba(0, 122, 255, 0.06)' },
  '7d':     { color: 'rgb(255, 149, 0)',    fill: 'rgba(255, 149, 0, 0.06)' },
  'Opus':   { color: 'rgb(175, 82, 222)',   fill: 'rgba(175, 82, 222, 0.06)' },
  'Sonnet': { color: 'rgb(52, 199, 89)',    fill: 'rgba(52, 199, 89, 0.06)' }
};

// DOM refs
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');

const userEmail = document.getElementById('user-email');
const reset5h = document.getElementById('reset-5h');
const reset7d = document.getElementById('reset-7d');
const extraSection = document.getElementById('extra-section');
const extraValue = document.getElementById('extra-value');
const barExtra = document.getElementById('bar-extra');
const extraDetail = document.getElementById('extra-detail');
const modelSection = document.getElementById('model-section');
const modelBreakdown = document.getElementById('model-breakdown');
const chartLegend = document.getElementById('chart-legend');
const updateInfo = document.getElementById('update-info');
const loading = document.getElementById('loading');
const errorToast = document.getElementById('error-toast');
const launchToggle = document.getElementById('launch-toggle');

// Theme
function applyTheme(dark) {
  isDarkMode = dark;
  document.body.classList.toggle('dark', dark);
  if (chart) {
    chart.setTheme({
      grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      text: dark ? '#666' : '#aaa',
      empty: dark ? '#777' : '#999'
    });
  }
  if (gauge5h) gauge5h.setDark(dark);
  if (gauge7d) gauge7d.setDark(dark);
}

// Init
async function init() {
  chart = new MiniChart(document.getElementById('usage-chart'));
  gauge5h = new GaugeChart(document.getElementById('gauge-5h'));
  gauge7d = new GaugeChart(document.getElementById('gauge-7d'));

  // Apply initial theme
  const dark = await window.electronAPI.getTheme();
  applyTheme(dark);

  // Listen for OS theme changes
  window.electronAPI.onThemeChanged((dark) => {
    applyTheme(dark);
    updateChart();
  });

  const isAuth = await window.electronAPI.checkAuth();
  const launchAtLogin = await window.electronAPI.getLaunchAtLogin();
  launchToggle.checked = launchAtLogin;

  if (isAuth) {
    showDashboard();
    loadAndDisplay();
  } else {
    loginScreen.style.display = 'flex';
    dashboardScreen.style.display = 'none';
  }
}

function showDashboard() {
  loginScreen.style.display = 'none';
  dashboardScreen.style.display = 'flex';
  initProviderTabs();
}

let allProviderQuotas = [];

async function initProviderTabs() {
  // Only show tabs if 2+ providers are available
  let providers;
  try {
    providers = await window.electronAPI.getProvidersList();
  } catch (e) {
    return; // graceful degradation — old API or error
  }

  const available = providers.filter(p => p.available);
  if (available.length <= 1) return;

  const tabsEl = document.getElementById('provider-tabs');
  const summaryEl = document.getElementById('provider-summary-bar');
  if (!tabsEl || !summaryEl) return;

  tabsEl.style.display = 'flex';
  summaryEl.style.display = 'block';

  // Fetch all quota data for summary bar
  try {
    allProviderQuotas = await window.electronAPI.fetchAllProvidersQuota();
  } catch (e) { console.warn('[initProviderTabs] quota fetch failed:', e); }

  // Build summary bar items
  const summaryItemsEl = document.getElementById('provider-summary-items');
  summaryItemsEl.innerHTML = '';
  for (const p of available) {
    const quota = allProviderQuotas.find(q => q.provider === p.id);
    const utilization = quota?.quota?.session?.utilization ?? quota?.quota?.weekly?.utilization;
    const item = document.createElement('div');
    item.className = 'provider-summary-item';

    const dot = document.createElement('span');
    dot.className = 'provider-summary-dot';
    dot.style.background = p.color;

    const label = document.createElement('span');
    label.textContent = `${p.name}${utilization != null ? ` ${utilization}%` : ''}`;

    item.appendChild(dot);
    item.appendChild(label);
    summaryItemsEl.appendChild(item);
  }

  // Build provider tabs (Claude tab first, then others)
  tabsEl.innerHTML = '';
  for (const p of available) {
    const btn = document.createElement('button');
    btn.className = 'provider-tab' + (p.id === 'claude' ? ' active' : '');
    btn.dataset.provider = p.id;
    btn.textContent = `${p.icon} ${p.name}`;
    btn.style.setProperty('--provider-tab-color', p.color);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.provider-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchToProvider(p.id);
    });
    tabsEl.appendChild(btn);
  }
}

async function switchToProvider(providerId) {
  const gaugeRow     = document.getElementById('claude-gauge-row');
  const infoPanel    = document.getElementById('provider-quota-info');
  const extraSection = document.getElementById('extra-section');
  const modelSection = document.getElementById('model-section');
  const chartTitle   = document.getElementById('chart-section-title');

  if (providerId === 'claude') {
    if (gaugeRow)     gaugeRow.style.display = '';
    if (extraSection) extraSection.style.display = extraSection.dataset.savedDisplay || 'none';
    if (modelSection) modelSection.style.display = modelSection.dataset.savedDisplay || 'none';
    if (infoPanel)    infoPanel.style.display = 'none';
    if (chartTitle)   chartTitle.textContent = 'Last 7 Days';
    updateChart();
    return;
  }

  // Non-Claude provider — save and hide Claude-specific sections
  if (gaugeRow) gaugeRow.style.display = 'none';
  if (extraSection) {
    extraSection.dataset.savedDisplay = extraSection.style.display;
    extraSection.style.display = 'none';
  }
  if (modelSection) {
    modelSection.dataset.savedDisplay = modelSection.style.display;
    modelSection.style.display = 'none';
  }

  // Fetch local stats for this provider (last 7 days)
  let dailyRows = [], summary = null;
  try {
    const result = await window.electronAPI.getDetailedStats({ provider: providerId, days: 7 });
    if (result.success) {
      dailyRows = result.data.dailyRows || [];
      summary   = result.data.summary   || null;
    }
  } catch (e) { console.warn('[switchToProvider] stats fetch failed:', e); }

  // Update chart title and draw token chart
  if (chartTitle) chartTitle.textContent = 'Son 7 Gün (Token)';
  renderProviderTokenChart(dailyRows);

  // Build info panel
  if (infoPanel) {
    infoPanel.style.display = 'block';
    infoPanel.innerHTML = '';

    // Quota rows (if this provider has quota API data)
    const quota = allProviderQuotas.find(q => q.provider === providerId);
    if (quota && !quota.error) {
      if (quota.quota?.session) infoPanel.appendChild(buildQuotaRow('Session', quota.quota.session.utilization, quota.quota.session.resetsAt));
      if (quota.quota?.weekly)  infoPanel.appendChild(buildQuotaRow('7-Day',   quota.quota.weekly.utilization,  quota.quota.weekly.resetsAt));
      if (quota.quota?.models?.length) {
        for (const m of quota.quota.models) infoPanel.appendChild(buildQuotaRow(m.name, m.utilization, null));
      }
    }

    // Local scan summary stats
    if (summary && (summary.sessionCount || summary.totalTurns || summary.totalCost)) {
      const statsEl = document.createElement('div');
      statsEl.className = 'provider-local-stats';
      const items = [
        { label: 'Oturumlar', value: String(summary.sessionCount || 0) },
        { label: 'Turnlar',   value: formatStatNum(summary.totalTurns || 0) },
        { label: 'Maliyet',   value: '$' + (summary.totalCost || 0).toFixed(2) },
      ];
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'provider-stat-item';
        const lbl = document.createElement('span');
        lbl.className = 'provider-stat-label';
        lbl.textContent = item.label;
        const val = document.createElement('span');
        val.className = 'provider-stat-value';
        val.textContent = item.value;
        el.appendChild(lbl);
        el.appendChild(val);
        statsEl.appendChild(el);
      }
      infoPanel.appendChild(statsEl);
    }

    if (!infoPanel.children.length) {
      const msg = document.createElement('div');
      msg.className = 'provider-info-msg';
      msg.textContent = 'Bu provider için veri bulunamadı.';
      infoPanel.appendChild(msg);
    }
  }
}

function renderProviderTokenChart(dailyRows) {
  if (!dailyRows.length) {
    chart.setData({ labels: [], datasets: [], yMax: 10 });
    chartLegend.innerHTML = '';
    return;
  }
  const labels     = dailyRows.map(r => r.day ? r.day.slice(5) : '');
  const inputData  = dailyRows.map(r => Math.round((r.input  || 0) / 1000));
  const outputData = dailyRows.map(r => Math.round((r.output || 0) / 1000));
  const yMax = Math.max(...inputData.map((v, i) => v + outputData[i]), 10);
  const datasets = [
    { label: 'Input (K)',  data: inputData,  color: 'rgba(59,130,246,0.9)',  fillColor: 'rgba(59,130,246,0.15)' },
    { label: 'Output (K)', data: outputData, color: 'rgba(34,197,94,0.9)',   fillColor: 'rgba(34,197,94,0.15)'  },
  ];
  chartLegend.innerHTML = datasets.map(ds =>
    `<span class="legend-item"><span class="legend-dot" style="background:${ds.color}"></span>${ds.label}</span>`
  ).join('');
  chart.setData({ labels, datasets, yMax });
}

function formatStatNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function buildQuotaRow(label, utilization, resetsAt) {
  const wrap = document.createElement('div');
  wrap.className = 'provider-quota-row';

  const top = document.createElement('div');
  top.className = 'provider-quota-row-top';

  const lbl = document.createElement('span');
  lbl.className = 'provider-quota-label';
  lbl.textContent = label;

  const pct = document.createElement('span');
  pct.className = 'provider-quota-pct';
  pct.textContent = utilization != null ? `${utilization}%` : '—';

  top.appendChild(lbl);
  top.appendChild(pct);
  wrap.appendChild(top);

  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  fill.style.width = `${Math.min(utilization || 0, 100)}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);

  if (resetsAt) {
    const reset = document.createElement('div');
    reset.className = 'gauge-reset';
    const d = new Date(resetsAt);
    reset.textContent = 'Resets ' + d.toLocaleString();
    wrap.appendChild(reset);
  }

  return wrap;
}

function showLogin() {
  loginScreen.style.display = 'flex';
  dashboardScreen.style.display = 'none';
}

function showError(msg) {
  errorToast.textContent = msg;
  errorToast.style.display = 'block';
  setTimeout(() => { errorToast.style.display = 'none'; }, 4000);
}

function showLoading(show) {
  loading.style.display = show ? 'flex' : 'none';
}

function formatResetTime(resetsAt) {
  if (!resetsAt) return 'Resets --';
  const resetDate = new Date(resetsAt);
  const diff = resetDate - new Date();
  if (diff <= 0) return 'Resets soon';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Resets ${days} day${days > 1 ? 's' : ''}, ${hours % 24} hr`;
  }
  if (hours > 0) return `Resets ${hours} hr, ${minutes} min`;
  return `Resets ${minutes} min`;
}

function getBarColor(pct) {
  if (pct >= 95) return 'red-pulse';
  if (pct >= 85) return 'red';
  if (pct >= 70) return 'orange';
  if (pct >= 50) return 'yellow';
  return 'green';
}

// Load data and display
async function loadAndDisplay() {
  showLoading(true);
  try {
    const [usage, profile, history] = await Promise.all([
      window.electronAPI.fetchUsage(),
      window.electronAPI.fetchProfile().catch(() => null),
      window.electronAPI.loadHistory()
    ]);

    historyData = history || { dataPoints: [] };

    if (profile?.email) userEmail.textContent = profile.email;
    else if (profile?.name) userEmail.textContent = profile.name;

    updateUsageDisplay(usage);

    // Save history data point
    const point = {
      pct5h:    (usage?.five_hour?.utilization || 0),
      pct7d:    (usage?.seven_day?.utilization || 0),
      pctOpus:  (usage?.seven_day_opus?.utilization ?? null),
      pctSonnet:(usage?.seven_day_sonnet?.utilization ?? null)
    };
    await window.electronAPI.saveDataPoint(point);
    historyData.dataPoints.push({ ...point, timestamp: Date.now() });

    updateChart();

    lastFetchTime = new Date();
    updateTimestamp();
    startUpdateTimer();
  } catch (err) {
    if (err.message?.includes('expired') || err.message?.includes('Not signed in')) {
      showLogin();
    }
    showError(err.message || 'Failed to fetch usage data');
  } finally {
    showLoading(false);
  }
}

function updateUsageDisplay(usage) {
  if (!usage) return;

  // 5-Hour Window
  const fiveHour = usage.five_hour;
  if (fiveHour) {
    const pct = fiveHour.utilization || 0;
    gauge5h.setValue(pct);
    reset5h.textContent = formatResetTime(fiveHour.resets_at);
  }

  // 7-Day Window
  const sevenDay = usage.seven_day;
  if (sevenDay) {
    const pct = sevenDay.utilization || 0;
    gauge7d.setValue(pct);
    reset7d.textContent = formatResetTime(sevenDay.resets_at);
  }

  // Extra Usage
  const extra = usage.extra_usage;
  if (extra && extra.is_enabled) {
    extraSection.style.display = 'block';
    const used = (extra.used_credits || 0) / 100;
    const limit = (extra.monthly_limit || 0) / 100;
    extraValue.textContent = `$${used.toFixed(2)}`;
    if (limit > 0) {
      barExtra.style.width = Math.min((used / limit) * 100, 100) + '%';
      extraDetail.textContent = `$${used.toFixed(2)} / $${limit.toFixed(2)} monthly limit`;
    } else {
      barExtra.style.width = (extra.utilization || 0) + '%';
      extraDetail.textContent = '';
    }
  } else {
    extraSection.style.display = 'none';
  }

  updateModelBreakdown(usage);
}

function updateModelBreakdown(usage) {
  const models = [];

  if (usage.seven_day_opus && usage.seven_day_opus.utilization != null) {
    models.push({
      name: 'Opus',
      utilization: usage.seven_day_opus.utilization,
      resetsAt: usage.seven_day_opus.resets_at
    });
  }

  if (usage.seven_day_sonnet && usage.seven_day_sonnet.utilization != null) {
    models.push({
      name: 'Sonnet',
      utilization: usage.seven_day_sonnet.utilization,
      resetsAt: usage.seven_day_sonnet.resets_at
    });
  }

  if (models.length === 0) {
    modelSection.style.display = 'none';
    return;
  }

  modelSection.style.display = 'block';
  modelBreakdown.innerHTML = '';
  for (const m of models) {
    const pct = Math.round(m.utilization);
    const color = getBarColor(pct);

    const row = document.createElement('div');
    row.className = 'model-row';

    const header = document.createElement('div');
    header.className = 'model-row-header';
    const nameEl = document.createElement('span');
    nameEl.className = 'model-name';
    nameEl.textContent = m.name;
    const pctEl = document.createElement('span');
    pctEl.className = 'model-pct';
    pctEl.textContent = `${pct}%`;
    header.appendChild(nameEl);
    header.appendChild(pctEl);

    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.className = `progress-fill ${color}`;
    fill.style.width = `${Math.min(pct, 100)}%`;
    bar.appendChild(fill);

    const detail = document.createElement('div');
    detail.className = 'model-detail';
    detail.textContent = formatResetTime(m.resetsAt);

    row.appendChild(header);
    row.appendChild(bar);
    row.appendChild(detail);
    modelBreakdown.appendChild(row);
  }
}

function updateChart() {
  const cutoff = Date.now() - 7 * 86400 * 1000;
  const points = historyData.dataPoints.filter(p => p.timestamp >= cutoff);

  if (points.length < 2) {
    chart.setData({ labels: [], datasets: [], yMax: 100 });
    return;
  }

  const labels = points.map(p => {
    const d = new Date(p.timestamp);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  // Build datasets for all available series
  const datasets = [
    {
      label: '5h',
      data: points.map(p => p.pct5h || 0),
      color: COLORS['5h'].color,
      fillColor: COLORS['5h'].fill
    },
    {
      label: '7d',
      data: points.map(p => p.pct7d || 0),
      color: COLORS['7d'].color,
      fillColor: COLORS['7d'].fill
    }
  ];

  // Add Opus if any point has it
  if (points.some(p => p.pctOpus != null)) {
    datasets.push({
      label: 'Opus',
      data: points.map(p => p.pctOpus ?? 0),
      color: COLORS['Opus'].color,
      fillColor: COLORS['Opus'].fill
    });
  }

  // Add Sonnet if any point has it
  if (points.some(p => p.pctSonnet != null)) {
    datasets.push({
      label: 'Sonnet',
      data: points.map(p => p.pctSonnet ?? 0),
      color: COLORS['Sonnet'].color,
      fillColor: COLORS['Sonnet'].fill
    });
  }

  // Update legend
  chartLegend.innerHTML = datasets.map(ds =>
    `<span class="legend-item"><span class="legend-dot" style="background:${ds.color}"></span>${ds.label}</span>`
  ).join('');

  chart.setData({ labels, datasets, yMax: 100 });
}

function updateTimestamp() {
  if (!lastFetchTime) return;
  const diff = Math.floor((Date.now() - lastFetchTime.getTime()) / 1000);
  if (diff < 5) updateInfo.textContent = 'Updated just now';
  else if (diff < 60) updateInfo.textContent = `Updated ${diff} sec ago`;
  else {
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    updateInfo.textContent = `Updated ${min} min, ${sec} sec ago`;
  }
}

function startUpdateTimer() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(updateTimestamp, 1000);
}

// Event Listeners

document.getElementById('refresh-btn').addEventListener('click', () => loadAndDisplay());

// Hamburger menu
const hamburgerBtn = document.getElementById('hamburger-btn');
const hamburgerDropdown = document.getElementById('hamburger-dropdown');

hamburgerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  hamburgerDropdown.classList.toggle('open');
});

document.addEventListener('click', () => {
  hamburgerDropdown.classList.remove('open');
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  hamburgerDropdown.classList.remove('open');
  await window.electronAPI.signOut();
  showLogin();
});

document.getElementById('quit-btn').addEventListener('click', () => {
  window.electronAPI.quit();
});

launchToggle.addEventListener('change', () => {
  window.electronAPI.setLaunchAtLogin(launchToggle.checked);
});

// ─── Language Toggle ──────────────────────────────────────────────────────
let currentLang = 'tr';

const TRANSLATIONS = {
  tr: {
    'tab-ozet':            'Özet',
    'tab-detayli':         'Detaylı',
    'summary-title':       'Tüm Provider\'lar',
    'chart-section-title': 'Son 7 Gün',
    'gauge-5h':            '5 Saatlik Pencere',
    'gauge-7d':            '7 Günlük Pencere',
    'per-model-title':     'Model Bazlı (7 gün)',
    'all-providers':       'Tüm Provider\'lar',
    'all-models':          'Tüm Modeller',
    'last-7d':             'Son 7 gün',
    'last-30d':            'Son 30 gün',
    'last-90d':            'Son 90 gün',
    'all-time':            'Tümü',
    'kpi-sessions':        'Oturum',
    'kpi-cost':            'Maliyet',
    'kpi-turns':           'Dönüş',
    'card-daily-tokens':   'Günlük Token Kullanımı',
    'card-model-dist':     'Model Dağılımı',
    'card-top-projects':   'Top Projeler',
    'card-recent-sessions':'Son Oturumlar',
    'card-model-cost':     'Model Bazlı Maliyet',
    'th-project':          'Proje',
    'th-model':            'Model',
    'th-duration':         'Süre',
    'th-turns':            'Dönüş',
    'th-cost':             'Maliyet',
    'th-input':            'Giriş',
    'th-output':           'Çıkış',
    'settings-title':      'Provider Ayarları',
    'launch-at-login':     'Başlangıçta Aç',
    'signout-btn':         'Çıkış Yap',
    'quit-btn':            'Kapat',
    'login-not-found':     'Claude Code oturumu bulunamadı.',
    'login-instructions':  'Terminalde şu komutu çalıştırın:',
    'status-active':       '● Aktif',
    'status-not-found':    '○ Bulunamadı',
    'api-key-placeholder': 'API Key (isteğe bağlı)',
    'save-btn':            'Kaydet',
    'save-success':        '✓ Kaydedildi',
    'save-error':          '✗ Hata',
    'gauge-critical':      'Kritik',
    'gauge-high':          'Yüksek',
    'gauge-warning':       'Uyarı',
    'gauge-moderate':      'Orta',
    'gauge-normal':        'Normal',
    'gauge-low':           'Düşük',
    'collecting-data':     'Veri bekleniyor...',
    'chart-tokens':        'token',
  },
  en: {
    'tab-ozet':            'Overview',
    'tab-detayli':         'Detailed',
    'summary-title':       'All Providers',
    'chart-section-title': 'Last 7 Days',
    'gauge-5h':            '5-Hour Window',
    'gauge-7d':            '7-Day Window',
    'per-model-title':     'Per-Model (7 day)',
    'all-providers':       'All Providers',
    'all-models':          'All Models',
    'last-7d':             'Last 7 days',
    'last-30d':            'Last 30 days',
    'last-90d':            'Last 90 days',
    'all-time':            'All time',
    'kpi-sessions':        'Sessions',
    'kpi-cost':            'Cost',
    'kpi-turns':           'Turns',
    'card-daily-tokens':   'Daily Token Usage',
    'card-model-dist':     'Model Distribution',
    'card-top-projects':   'Top Projects',
    'card-recent-sessions':'Recent Sessions',
    'card-model-cost':     'Cost by Model',
    'th-project':          'Project',
    'th-model':            'Model',
    'th-duration':         'Duration',
    'th-turns':            'Turns',
    'th-cost':             'Cost',
    'th-input':            'Input',
    'th-output':           'Output',
    'settings-title':      'Provider Settings',
    'launch-at-login':     'Launch at Login',
    'signout-btn':         'Sign Out',
    'quit-btn':            'Quit',
    'login-not-found':     'Claude Code session not found.',
    'login-instructions':  'Run the following command in your terminal:',
    'status-active':       '● Active',
    'status-not-found':    '○ Not Found',
    'api-key-placeholder': 'API Key (optional)',
    'save-btn':            'Save',
    'save-success':        '✓ Saved',
    'save-error':          '✗ Error',
    'gauge-critical':      'Critical',
    'gauge-high':          'High',
    'gauge-warning':       'Warning',
    'gauge-moderate':      'Moderate',
    'gauge-normal':        'Normal',
    'gauge-low':           'Low',
    'collecting-data':     'Collecting data...',
    'chart-tokens':        'tokens',
  }
};

// Global translation helper — also used by detailedStats.js and gauge.js
window.t = (key) => TRANSLATIONS[currentLang]?.[key] ?? key;

function applyLanguage(lang) {
  // Update all data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const text = TRANSLATIONS[lang]?.[key];
    if (text) {
      if (el.tagName === 'INPUT' && el.type !== 'hidden') {
        el.placeholder = text;
      } else {
        el.textContent = text;
      }
    }
  });
  // Also update elements targeted by ID that have translations
  ['tab-ozet','tab-detayli','summary-title','chart-section-title','settings-title','signout-btn','quit-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el && TRANSLATIONS[lang][id]) el.textContent = TRANSLATIONS[lang][id];
  });
}

document.getElementById('lang-btn')?.addEventListener('click', () => {
  currentLang = currentLang === 'tr' ? 'en' : 'tr';
  document.getElementById('lang-btn').textContent = currentLang.toUpperCase();
  applyLanguage(currentLang);
});

// Auto-refresh every 5 minutes
setInterval(() => {
  if (dashboardScreen.style.display !== 'none') {
    loadAndDisplay();
  }
}, 5 * 60 * 1000);

async function renderProviderSettings() {
  const list = document.getElementById('provider-settings-list');
  if (!list) return;
  list.innerHTML = '';

  let providers = [];
  try {
    providers = await window.electronAPI.getProvidersList();
  } catch (e) {
    list.textContent = 'Provider listesi alınamadı.';
    return;
  }

  for (const p of providers) {
    const row = document.createElement('div');
    row.className = 'provider-setting-row';

    // Top row: icon + name + status badge
    const top = document.createElement('div');
    top.className = 'provider-setting-top';

    const icon = document.createElement('span');
    icon.className = 'provider-icon';
    icon.textContent = p.icon;

    const label = document.createElement('span');
    label.className = 'provider-label';
    label.textContent = p.name;

    const badge = document.createElement('span');
    badge.className = 'provider-status-badge' + (p.available ? ' available' : '');
    badge.textContent = p.available ? window.t('status-active') : window.t('status-not-found');

    top.appendChild(icon);
    top.appendChild(label);
    top.appendChild(badge);

    // Bottom row: API key input + save button
    const bottom = document.createElement('div');
    bottom.className = 'provider-setting-bottom';

    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.className = 'provider-api-key-input';
    apiKeyInput.placeholder = window.t('api-key-placeholder');
    apiKeyInput.dataset.provider = p.id;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'provider-save-btn';
    saveBtn.textContent = window.t('save-btn');
    saveBtn.addEventListener('click', async () => {
      const apiKey = apiKeyInput.value.trim();
      try {
        await window.electronAPI.saveProviderSettings({ providerId: p.id, apiKey: apiKey || null, enabled: true });
        saveBtn.textContent = window.t('save-success');
        setTimeout(() => { saveBtn.textContent = window.t('save-btn'); }, 1500);
      } catch (e) {
        saveBtn.textContent = window.t('save-error');
        setTimeout(() => { saveBtn.textContent = window.t('save-btn'); }, 1500);
      }
    });

    bottom.appendChild(apiKeyInput);
    bottom.appendChild(saveBtn);

    row.appendChild(top);
    row.appendChild(bottom);
    list.appendChild(row);
  }

}

function initSettingsPanel() {
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-close');
  const panel = document.getElementById('provider-settings-panel');

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (panel) panel.style.display = 'flex';
      renderProviderSettings();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (panel) panel.style.display = 'none';
    });
  }
}

initSettingsPanel();
init();
