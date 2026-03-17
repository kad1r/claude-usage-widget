class GaugeChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.value = 0;
    this.targetValue = 0;
    this.animationId = null;
    this.dark = false;
  }

  setDark(dark) {
    this.dark = dark;
    this.draw(this.value);
  }

  setValue(pct) {
    this.targetValue = Math.min(Math.max(pct, 0), 100);
    this.animate();
  }

  animate() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    const start = this.value;
    const end = this.targetValue;
    const duration = 800;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      this.value = start + (end - start) * eased;
      this.draw(this.value);
      if (progress < 1) {
        this.animationId = requestAnimationFrame(step);
      }
    };
    this.animationId = requestAnimationFrame(step);
  }

  getStatusLabel(pct) {
    if (pct >= 95) return 'Critical';
    if (pct >= 85) return 'High';
    if (pct >= 70) return 'Warning';
    if (pct >= 50) return 'Moderate';
    if (pct >= 25) return 'Normal';
    return 'Low';
  }

  getStatusColor(pct) {
    if (pct >= 85) return '#ff3b30';
    if (pct >= 70) return '#ff9500';
    if (pct >= 50) return '#ffcc00';
    return '#34c759';
  }

  draw(pct) {
    const { canvas, ctx, dark } = this;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const centerX = w / 2;
    const centerY = h * 0.62;
    const radius = Math.min(w, h) * 0.38;
    const lineWidth = radius * 0.22;

    const startAngle = Math.PI;
    const endAngle = 2 * Math.PI;

    // Background track
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Gradient arc
    if (pct > 0) {
      const valueAngle = startAngle + (pct / 100) * Math.PI;

      // Create gradient along the arc
      const gradient = ctx.createLinearGradient(
        centerX - radius, centerY,
        centerX + radius, centerY
      );
      gradient.addColorStop(0, '#34c759');
      gradient.addColorStop(0.35, '#ffcc00');
      gradient.addColorStop(0.6, '#ff9500');
      gradient.addColorStop(0.85, '#ff3b30');

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Percentage text
    const pctText = Math.round(pct) + '%';
    ctx.fillStyle = dark ? '#e8e8e8' : '#1a1a1a';
    ctx.font = `bold ${radius * 0.48}px -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pctText, centerX, centerY - radius * 0.08);

    // Status label
    const label = this.getStatusLabel(pct);
    const labelColor = this.getStatusColor(pct);

    // Label pill
    const labelFont = `600 ${radius * 0.18}px -apple-system, 'Segoe UI', sans-serif`;
    ctx.font = labelFont;
    const labelWidth = ctx.measureText(label).width + radius * 0.28;
    const labelHeight = radius * 0.28;
    const labelY = centerY + radius * 0.22;

    ctx.fillStyle = labelColor + '1A'; // 10% opacity
    ctx.beginPath();
    const pillRadius = labelHeight / 2;
    ctx.roundRect(
      centerX - labelWidth / 2, labelY - labelHeight / 2,
      labelWidth, labelHeight, pillRadius
    );
    ctx.fill();

    ctx.fillStyle = labelColor;
    ctx.font = labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, centerX, labelY);
  }
}
