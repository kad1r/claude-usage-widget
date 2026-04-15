// providers/codex/index.js
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const BaseProvider = require('../base');
const scanner = require('./scanner');

class CodexProvider extends BaseProvider {
  get id()    { return 'codex'; }
  get name()  { return 'OpenAI Codex'; }
  get icon()  { return '🟢'; }
  get color() { return '#10a37f'; }

  async isAvailable() {
    try {
      await execAsync('codex --version', { timeout: 3000 });
      return true;
    } catch {
      return fs.existsSync(scanner.CODEX_DIR);
    }
  }

  getPricing() { return scanner.PRICING; }

  async fetchQuota() {
    try {
      const { stdout } = await execAsync('codex usage --json', { timeout: 5000 });
      const data = JSON.parse(stdout);
      return {
        provider: this.id, name: this.name, available: true,
        quota: {
          session: data.session ? { utilization: data.session.pct, resetsAt: data.session.reset } : null,
          weekly:  data.weekly  ? { utilization: data.weekly.pct,  resetsAt: data.weekly.reset  } : null,
          models:  []
        },
        error: null
      };
    } catch {
      return {
        provider: this.id, name: this.name, available: true,
        quota: { session: null, weekly: null, models: [] },
        error: 'Quota data not available — local scan only'
      };
    }
  }

  async scanLocal(db) {
    return scanner.scanAndStore(db);
  }
}

module.exports = CodexProvider;
