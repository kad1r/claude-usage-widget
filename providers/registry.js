// providers/registry.js
class ProviderRegistry {
  constructor() {
    this._providers = [];
  }

  register(provider) {
    this._providers.push(provider);
  }

  getAll() {
    return this._providers;
  }

  getById(id) {
    return this._providers.find(p => p.id === id) || null;
  }

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
module.exports = registry;
