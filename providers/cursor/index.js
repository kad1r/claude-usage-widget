// providers/cursor/index.js
const fs = require('fs');
const BaseProvider = require('../base');
const scanner = require('./scanner');

class CursorProvider extends BaseProvider {
  get id()    { return 'cursor'; }
  get name()  { return 'Cursor'; }
  get icon()  { return '🔷'; }
  get color() { return '#7c83fd'; }

  async isAvailable() {
    return fs.existsSync(scanner.CURSOR_DATA_DIR);
  }

  getPricing() { return scanner.PRICING; }

  async fetchQuota() {
    // Cursor doesn't expose quota via CLI — file-based only
    return {
      provider: this.id,
      name: this.name,
      available: await this.isAvailable(),
      quota: { session: null, weekly: null, models: [] },
      error: 'Quota data not available for Cursor — local scan only'
    };
  }

  async scanLocal(db) {
    return scanner.scanAndStore(db);
  }
}

module.exports = CursorProvider;
