class MiniChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = { labels: [], datasets: [] };
    this.padding = { top: 20, right: 16, bottom: 26, left: 36 };
    this.theme = { grid: 'rgba(0,0,0,0.05)', text: '#aaa', empty: '#999' };
  }

  setTheme(t) { this.theme = t; this.render(); }
  setData(d)   { this.data  = d; this.render(); }

  render() {
    const { canvas, ctx, data, padding: p, theme } = this;
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width,  H = rect.height;
    const cW = W - p.left - p.right;
    const cH = H - p.top  - p.bottom;

    ctx.clearRect(0, 0, W, H);

    if (!data.datasets.length || !data.labels.length) {
      ctx.fillStyle = theme.empty;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(window.t ? window.t('collecting-data') : 'Veri bekleniyor...', W / 2, H / 2);
      return;
    }

    const maxVal = data.yMax || 100;

    // Helpers
    const xOf = (i, n) => p.left + (cW / Math.max(n - 1, 1)) * i;
    const yOf = v => p.top + cH - (Math.min(v, maxVal) / maxVal) * cH;

    // Bezier path helper — draws smooth line; if closeFill=true closes to baseline
    const bezierPath = (pts, closeFill) => {
      const n = pts.length;
      ctx.moveTo(xOf(0, n), yOf(pts[0]));
      for (let i = 1; i < n; i++) {
        const x0 = xOf(i - 1, n), y0 = yOf(pts[i - 1]);
        const x1 = xOf(i,     n), y1 = yOf(pts[i]);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
      }
      if (closeFill) {
        const baseline = p.top + cH;
        ctx.lineTo(xOf(n - 1, n), baseline);
        ctx.lineTo(xOf(0,     n), baseline);
        ctx.closePath();
      }
    };

    // Dashed grid + Y labels
    const gridLines = 3;
    for (let i = 0; i <= gridLines; i++) {
      const y   = p.top + (cH / gridLines) * i;
      const val = Math.round(maxVal - (maxVal / gridLines) * i);

      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(W - p.right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = theme.text;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(val + '%', p.left - 5, y);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const step = Math.max(1, Math.floor(data.labels.length / 6));
    data.labels.forEach((lbl, i) => {
      if (i % step === 0 || i === data.labels.length - 1) {
        ctx.fillText(lbl, xOf(i, data.labels.length), H - 2);
      }
    });

    // 1. Gradient area fills (drawn first, behind lines)
    data.datasets.forEach(ds => {
      if (!ds.data.length) return;
      const toRgba = a => ds.color.startsWith('rgb(')
        ? ds.color.replace('rgb(', 'rgba(').replace(')', `, ${a})`)
        : ds.color;

      const grad = ctx.createLinearGradient(0, p.top, 0, p.top + cH);
      grad.addColorStop(0,   toRgba(0.22));
      grad.addColorStop(0.7, toRgba(0.06));
      grad.addColorStop(1,   toRgba(0));

      ctx.beginPath();
      bezierPath(ds.data, true);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // 2. Smooth lines on top (no dots — too noisy with many points)
    data.datasets.forEach(ds => {
      if (!ds.data.length) return;
      ctx.beginPath();
      ctx.strokeStyle = ds.color;
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      bezierPath(ds.data, false);
      ctx.stroke();
    });
  }
}
