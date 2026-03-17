class MiniChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = { labels: [], datasets: [] };
    this.padding = { top: 16, right: 12, bottom: 28, left: 40 };
    this.theme = {
      grid: 'rgba(0,0,0,0.06)',
      text: '#aaa',
      empty: '#999'
    };
  }

  setTheme(theme) {
    this.theme = theme;
    this.render();
  }

  setData(data) {
    this.data = data;
    this.render();
  }

  render() {
    const { canvas, ctx, data, padding, theme } = this;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    if (!data.datasets.length || !data.labels.length) {
      ctx.fillStyle = theme.empty;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Collecting data...', w / 2, h / 2);
      return;
    }

    const maxVal = data.yMax || 100;

    // Grid & Y labels
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.text;
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'right';

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartH / gridLines) * i;
      const val = maxVal - (maxVal / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.fillText(Math.round(val) + '%', padding.left - 4, y + 3);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    const maxLabels = 7;
    const step = Math.max(1, Math.floor(data.labels.length / maxLabels));
    data.labels.forEach((label, i) => {
      if (i % step === 0 || i === data.labels.length - 1) {
        const x = padding.left + (chartW / Math.max(data.labels.length - 1, 1)) * i;
        ctx.fillText(label, x, h - padding.bottom + 14);
      }
    });

    // Draw each dataset line
    data.datasets.forEach(ds => {
      if (!ds.data.length) return;

      const points = ds.data.length;
      ctx.beginPath();
      ctx.strokeStyle = ds.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ds.data.forEach((val, i) => {
        const x = padding.left + (chartW / Math.max(points - 1, 1)) * i;
        const y = padding.top + chartH - (val / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Area fill
      const lastX = padding.left + chartW;
      const baseY = padding.top + chartH;
      ctx.lineTo(lastX, baseY);
      ctx.lineTo(padding.left, baseY);
      ctx.closePath();
      ctx.fillStyle = ds.fillColor || ds.color.replace('rgb(', 'rgba(').replace(')', ', 0.06)');
      ctx.fill();
    });
  }
}
