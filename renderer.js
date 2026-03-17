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
const loginBtn = document.getElementById('login-btn');
const codeSection = document.getElementById('code-section');
const codeInput = document.getElementById('code-input');
const submitCodeBtn = document.getElementById('submit-code-btn');
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
}

function showLogin() {
  loginScreen.style.display = 'flex';
  dashboardScreen.style.display = 'none';
  codeSection.style.display = 'none';
  codeInput.value = '';
  loginBtn.style.display = 'block';
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
  modelBreakdown.innerHTML = models.map(m => {
    const pct = Math.round(m.utilization);
    const color = getBarColor(pct);
    const resetText = formatResetTime(m.resetsAt);
    return `
      <div class="model-row">
        <div class="model-row-header">
          <span class="model-name">${m.name}</span>
          <span class="model-pct">${pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${color}" style="width: ${Math.min(pct, 100)}%"></div>
        </div>
        <div class="model-detail">${resetText}</div>
      </div>
    `;
  }).join('');
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
loginBtn.addEventListener('click', async () => {
  await window.electronAPI.startOAuth();
  codeSection.style.display = 'block';
  loginBtn.style.display = 'none';
});

submitCodeBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  if (!code) {
    showError('Please paste the code from your browser');
    return;
  }

  showLoading(true);
  try {
    await window.electronAPI.submitOAuthCode(code);
    showDashboard();
    await loadAndDisplay();
  } catch (err) {
    showError(err.message || 'Failed to sign in');
  } finally {
    showLoading(false);
  }
});

codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCodeBtn.click();
});

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

// Auto-refresh every 5 minutes
setInterval(() => {
  if (dashboardScreen.style.display !== 'none') {
    loadAndDisplay();
  }
}, 5 * 60 * 1000);

init();
