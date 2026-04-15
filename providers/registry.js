// providers/registry.js
class ProviderRegistry {
  constructor() {
    this._providers = [];
  }

  register(provider) {
    if (this._providers.some(p => p.id === provider.id)) {
      throw new Error(`Provider '${provider.id}' is already registered`);
    }
    this._providers.push(provider);
  }

  getAll() {
    return this._providers;
  }

  getById(id) {
    return this._providers.find(p => p.id === id) || null;
  }

  /**
   * Returns all providers for which isAvailable() resolves true.
   * WARNING: calls isAvailable() on every registered provider (filesystem/CLI
   * checks). Do NOT call this in a hot path — invoke once and cache the result.
   * @returns {Promise<BaseProvider[]>}
   */
  async getActive() {
    const results = await Promise.all(
      this._providers.map(async p => ({ p, available: await p.isAvailable() }))
    );
    return results.filter(r => r.available).map(r => r.p);
  }

  async fetchAllQuotas() {
    return Promise.all(this._providers.map(p => p.fetchQuota().catch(err => ({
      provider: p.id,
      name: p.name,
      available: false,
      quota: { session: null, weekly: null, models: [] },
      error: err.message
    }))));
  }
}

const registry = new ProviderRegistry();
// Singleton: all parts of the app share one registry instance.
module.exports = registry;
