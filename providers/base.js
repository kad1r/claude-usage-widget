// providers/base.js
class BaseProvider {
  /** Unique machine-readable ID, e.g. 'claude' */
  get id()    { throw new Error(`${this.constructor.name} must implement id`); }
  /** Human-readable name, e.g. 'Claude' */
  get name()  { throw new Error(`${this.constructor.name} must implement name`); }
  /** Emoji or short string used in UI */
  get icon()  { return '🤖'; }
  /** CSS hex color for charts/UI */
  get color() { return '#888888'; }

  /**
   * Returns true if this provider can be used (CLI found, files exist, etc.)
   * @returns {Promise<boolean>}
   */
  async isAvailable() { return false; }

  /**
   * Fetches current quota/utilization data.
   * @returns {Promise<QuotaResult>}
   *
   * QuotaResult shape:
   * {
   *   provider: string,
   *   name: string,
   *   available: boolean,
   *   quota: {
   *     session:  { utilization: number, resetsAt: string|null } | null,
   *     weekly:   { utilization: number, resetsAt: string|null } | null,
   *     models:   [{ name: string, utilization: number }]
   *   },
   *   error: string|null
   * }
   */
  async fetchQuota() {
    throw new Error(`${this.constructor.name} must implement fetchQuota`);
  }

  /**
   * Scans local files and writes sessions/turns into the shared SQLite db.
   * @param {import('better-sqlite3').Database} db
   * @returns {Promise<{ newSessions: number, newTurns: number }>}
   */
  async scanLocal(db) {
    return { newSessions: 0, newTurns: 0 };
  }

  /**
   * Returns pricing table per model (USD per million tokens).
   * @returns {Object} { modelName: { input, output, cacheRead, cacheWrite } }
   */
  getPricing() { return {}; }
}

module.exports = BaseProvider;
