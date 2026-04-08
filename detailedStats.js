// detailedStats.js — Detaylı Tab Logic
// Loaded after renderer.js. Assumes window.electronAPI is available.

(function () {
  // ─── State ───────────────────────────────────────────────────────────────
  let chartDaily = null;
  let chartModel = null;
  let chartProject = null;
  let currentFilters = { model: 'all', days: 30 };

  // ─── Tab switching ────────────────────────────────────────────────────────
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        const content = document.getElementById(`tab-content-${tab}`);
        if (content) content.style.display = 'flex';

        if (tab === 'detayli') {
          loadDetailedStats();
        }
      });
    });
  }

  // ─── Filters ─────────────────────────────────────────────────────────────
  function initFilters() {
    const modelFilter = document.getElementById('detail-model-filter');
    const daysFilter  = document.getElementById('detail-days-filter');
    const refreshBtn  = document.getElementById('detail-refresh-btn');

    if (modelFilter) {
      modelFilter.addEventListener('change', () => {
        currentFilters.model = modelFilter.value;
        loadDetailedStats();
      });
    }

    if (daysFilter) {
      daysFilter.addEventListener('change', () => {
        currentFilters.days = parseInt(daysFilter.value) || 0;
        loadDetailedStats();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.style.opacity = '0.4';
        try {
          await window.electronAPI.scanLocalUsage();
          await loadDetailedStats();
        } finally {
          refreshBtn.style.opacity = '1';
        }
      });
    }
  }

  async function populateModelFilter() {
    const select = document.getElementById('detail-model-filter');
    if (!select) return;
    try {
      const models = await window.electronAPI.getAvailableModels();
      select.innerHTML = '<option value="all">Tüm Modeller</option>';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = shortModelName(m);
        select.appendChild(opt);
      }
    } catch (e) {}
  }

  function shortModelName(model) {
    if (!model) return 'Unknown';
    if (model.includes('opus'))   return 'Opus '   + (model.match(/\d[\d-]*/)?.[0] || '');
    if (model.includes('sonnet')) return 'Sonnet ' + (model.match(/\d[\d-]*/)?.[0] || '');
    if (model.includes('haiku'))  return 'Haiku '  + (model.match(/\d[\d-]*/)?.[0] || '');
    return model.split('-').slice(-2).join('-');
  }

  // ─── Data Loading ─────────────────────────────────────────────────────────
  async function loadDetailedStats() {
    try {
      const result = await window.electronAPI.getDetailedStats(currentFilters);
      if (!result.success) { console.error('Stats error:', result.error); return; }
      const { summary, dailyRows, projectRows, modelRows, recentSessions } = result.data;

      updateKPIs(summary);
      renderDailyChart(dailyRows);
      renderModelChart(modelRows);
      renderProjectChart(projectRows);
      renderSessionsTable(recentSessions);
      renderModelCostTable(modelRows);
    } catch (e) {
      console.error('loadDetailedStats error:', e);
    }
  }

  // ─── KPI Cards ────────────────────────────────────────────────────────────
  function updateKPIs(summary) {
    const el = (id) => document.getElementById(id);
    const sessions = el('kpi-sessions');
    const cost     = el('kpi-cost');
    const turns    = el('kpi-turns');
    if (sessions) sessions.textContent = formatNumber(summary.sessionCount || 0);
    if (cost)     cost.textContent     = '$' + (summary.totalCost || 0).toFixed(2);
    if (turns)    turns.textContent    = formatNumber(summary.totalTurns || 0);
  }

  function formatNumber(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  // ─── Chart helpers ────────────────────────────────────────────────────────
  function isDark() {
    return document.body.classList.contains('dark');
  }

  function getChartTextColor() {
    return isDark() ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
  }

  function getChartGridColor() {
    return isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  }

  // ─── Daily Tokens Chart (stacked bar) ────────────────────────────────────
  function renderDailyChart(dailyRows) {
    const canvas = document.getElementById('daily-tokens-chart');
    if (!canvas || !window.Chart) return;

    const textColor = getChartTextColor();
    const gridColor = getChartGridColor();
    const labels = dailyRows.map(r => r.day ? r.day.slice(5) : '');
    const inputData  = dailyRows.map(r => Math.round((r.input || 0) / 1000));
    const outputData = dailyRows.map(r => Math.round((r.output || 0) / 1000));
    const cacheData  = dailyRows.map(r => Math.round((r.cacheRead || 0) / 1000));

    if (chartDaily) chartDaily.destroy();
    chartDaily = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Input (K)',  data: inputData,  backgroundColor: 'rgba(59,130,246,0.7)',  stack: 'tokens' },
          { label: 'Output (K)', data: outputData, backgroundColor: 'rgba(34,197,94,0.7)',   stack: 'tokens' },
          { label: 'Cache (K)',  data: cacheData,  backgroundColor: 'rgba(168,85,247,0.7)',  stack: 'tokens' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: textColor, font: { size: 10 }, boxWidth: 10 } } },
        scales: {
          x: { stacked: true, ticks: { color: textColor, font: { size: 9 }, maxRotation: 0 }, grid: { color: gridColor } },
          y: { stacked: true, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
        }
      }
    });
  }

  // ─── Model Distribution Chart (doughnut) ─────────────────────────────────
  function renderModelChart(modelRows) {
    const canvas = document.getElementById('model-dist-chart');
    if (!canvas || !window.Chart) return;

    const textColor = getChartTextColor();
    const labels = modelRows.map(r => shortModelName(r.model));
    const data   = modelRows.map(r => (r.input || 0) + (r.output || 0));
    const palette = ['rgba(59,130,246,0.8)', 'rgba(34,197,94,0.8)', 'rgba(168,85,247,0.8)', 'rgba(251,146,60,0.8)', 'rgba(239,68,68,0.8)', 'rgba(20,184,166,0.8)'];
    const colors = modelRows.map((_, i) => palette[i % palette.length]);

    if (chartModel) chartModel.destroy();
    chartModel = new window.Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, font: { size: 9 }, boxWidth: 10 } }
        }
      }
    });
  }

  // ─── Top Projects Chart (horizontal bar) ─────────────────────────────────
  function renderProjectChart(projectRows) {
    const canvas = document.getElementById('project-chart');
    if (!canvas || !window.Chart) return;

    const textColor = getChartTextColor();
    const gridColor = getChartGridColor();
    const top5   = projectRows.slice(0, 5);
    const labels = top5.map(r => r.project_name || 'unknown');
    const data   = top5.map(r => Math.round((r.totalTokens || 0) / 1000));

    if (chartProject) chartProject.destroy();
    chartProject = new window.Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: 'rgba(251,146,60,0.7)', borderRadius: 4 }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 9 },
            callback: function(val) {
              const label = this.getLabelForValue(val);
              return label.length > 9 ? label.slice(0, 9) + '…' : label;
            }
          }, grid: { display: false } }
        }
      }
    });
  }

  // ─── Recent Sessions Table ────────────────────────────────────────────────
  function renderSessionsTable(sessions) {
    const tbody = document.getElementById('sessions-tbody');
    if (!tbody) return;
    tbody.innerHTML = sessions.map(s => `
      <tr>
        <td title="${escHtml(s.project_name || '')}">${escHtml(s.project_name || '—')}</td>
        <td>${escHtml(shortModelName(s.model))}</td>
        <td>${escHtml(String(s.durationMinutes > 0 ? s.durationMinutes + 'm' : '—'))}</td>
        <td>${escHtml(String(s.turn_count || 0))}</td>
        <td>$${escHtml(String((s.cost || 0).toFixed(3)))}</td>
      </tr>
    `).join('');
  }

  // ─── Model Cost Table ─────────────────────────────────────────────────────
  function renderModelCostTable(modelRows) {
    const tbody = document.getElementById('model-cost-tbody');
    if (!tbody) return;
    tbody.innerHTML = modelRows.map(r => `
      <tr>
        <td>${escHtml(shortModelName(r.model))}</td>
        <td>${escHtml(String(r.turns || 0))}</td>
        <td>${escHtml(String(formatNumber(r.input || 0)))}</td>
        <td>${escHtml(String(formatNumber(r.output || 0)))}</td>
        <td>$${escHtml(String((r.cost || 0).toFixed(3)))}</td>
      </tr>
    `).join('');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    initTabs();
    initFilters();
    // Populate model filter when dashboard is shown (after login)
    const ds = document.getElementById('dashboard-screen');
    if (ds) {
      const observer = new MutationObserver(() => {
        if (ds.style.display !== 'none') {
          populateModelFilter();
          observer.disconnect();
        }
      });
      observer.observe(ds, { attributes: true, attributeFilter: ['style'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
