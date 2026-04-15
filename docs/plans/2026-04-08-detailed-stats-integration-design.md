# Design: Detaylı İstatistik Ekranı Entegrasyonu

**Date:** 2026-04-08  
**Status:** Approved  
**Author:** kadir.avci

---

## Özet

Mevcut Claude Usage App'e (Electron, Windows tray) yerel JSONL tarayıcısı ve "Detaylı" sekmesi eklenerek phuryn/claude-usage'ın sunduğu session-level istatistikler entegre edilecek. Mevcut OAuth API tabanlı gauge ekranına dokunulmayacak.

---

## Mimari

### Veri Kaynakları (Hybrid)

| Veri | Kaynak |
|------|--------|
| 5h/7d gauge, per-model API breakdown | Anthropic OAuth API (mevcut, değişmez) |
| Session detayı, proje breakdown, turn/süre | Yerel JSONL (`~/.claude/projects/**/*.jsonl`) |
| Token maliyet hesabı | PRICING tablosu (phuryn'dan adapte edilecek) |

### Yeni Bileşenler

```
main.js
 ├── scanner.js (yeni)  ← JSONL tarayıcı + SQLite upsert
 └── ipc handlers (yeni) ← detaylı stats sorgular

renderer.js
 └── detailedStats.js (yeni) ← Detaylı sekme UI mantığı

index.html
 └── Tab bar + Detaylı sekme markup (yeni)

~/.claude/usage.db (SQLite, yeni)
```

---

## Veri Katmanı

### JSONL Tarayıcı (`scanner.js`)

- `~/.claude/projects/**/*.jsonl` glob ile tüm dosyaları bulur
- Her `assistant` tipi kayıttan şunları çıkarır:
  - `model`, `timestamp`
  - `usage.input_tokens`, `usage.output_tokens`
  - `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`
- `session_id`: JSONL dosya yolundan türetilir
- `project_name`: klasör adından türetilir
- `turn_count`: dosyadaki assistant kayıt sayısı
- `duration`: ilk ve son timestamp farkı (dakika)
- Incremental tarama: `processed_files` tablosuyla sadece yeni/değişen dosyalar işlenir

**Tetikleyiciler:**
1. Uygulama açılışında otomatik
2. Her 5 dakikada bir arka planda
3. Kullanıcı "Yenile" butonuna basınca

### SQLite Şeması (`~/.claude/usage.db`)

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_name TEXT,
  first_timestamp TEXT,
  last_timestamp TEXT,
  model TEXT,
  turn_count INTEGER,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cache_read INTEGER,
  total_cache_creation INTEGER
);

CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  timestamp TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER
);

CREATE TABLE processed_files (
  path TEXT PRIMARY KEY,
  mtime INTEGER,
  lines INTEGER
);
```

**Dependency:** `better-sqlite3` (Electron uyumlu, senkron API)

---

## UI Tasarımı

### Tab Bar

`index.html` üstüne iki sekme:
- **Özet** — mevcut gauge dashboard (değişmez)
- **Detaylı** — yeni ekran

### Detaylı Sekme Layout

```
┌─────────────────────────────────────────────────┐
│  [Model ▼]  [Son 7 gün ▼]          [⟳ Yenile]  │
├─────────────────────────────────────────────────┤
│  Sessions: 42 │ Maliyet: $1.23 │ Input: 1.2M   │
├─────────────────────────────────────────────────┤
│         Günlük Token Kullanımı                  │
│         (stacked bar — input/output/cache)      │
├────────────────────┬────────────────────────────┤
│  Model Dağılımı    │  Top Projeler              │
│  (doughnut chart)  │  (horizontal bar chart)    │
├────────────────────┴────────────────────────────┤
│  Recent Sessions                                │
│  Proje │ Model │ Süre │ Turns │ Input │ Cost    │
├─────────────────────────────────────────────────┤
│  Maliyet by Model                               │
│  Model │ Turns │ Input │ Output │ Cache │ Cost  │
└─────────────────────────────────────────────────┘
```

**Chart kütüphanesi:** Chart.js (CDN üzerinden, mevcut chart.js ile çakışmayacak şekilde)

### Filtreler

- **Model filtresi:** Tüm modeller / belirli model seçimi
- **Zaman aralığı:** Son 7 gün / 30 gün / 90 gün / Tümü
- Filtreler değişince charts ve tablolar anında güncellenir

---

## IPC Yeni Handler'lar

| Handler | Açıklama |
|---------|----------|
| `scan-local-usage` | JSONL taramasını tetikler |
| `get-detailed-stats` | KPI kartları için özet veri |
| `get-daily-tokens` | Günlük stacked bar için veri |
| `get-sessions` | Recent sessions tablosu |
| `get-model-costs` | Cost by model tablosu |
| `get-project-breakdown` | Top projeler chart için |

---

## Maliyet Hesaplama

phuryn/claude-usage'dan adapte edilecek PRICING tablosu:

```js
const PRICING = {
  'claude-opus-4-6':    { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-4-6':  { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75  },
  'claude-haiku-4-5':   { input: 0.8,output: 4,  cacheRead: 0.08, cacheWrite: 1.0   },
};
// fiyatlar per million token, USD
```

---

## Kapsam Dışı

- Mevcut gauge ekranında herhangi bir değişiklik
- Cowork session'ları (server-side, yerel JSONL yok)
- Cloud sync veya export özellikleri

---

## Bağımlılıklar

| Paket | Sebep |
|-------|-------|
| `better-sqlite3` | Electron-uyumlu senkron SQLite |
| Chart.js (CDN) | Stacked bar, doughnut, bar chart'lar |

---

## Başarı Kriterleri

1. Uygulama açılışında JSONL taraması otomatik çalışır
2. "Detaylı" sekmesi session listesi, proje breakdown ve maliyet tablolarını doğru gösterir
3. "Özet" sekmesi mevcut haliyle tam çalışmaya devam eder
4. Yenile butonu çalışır ve verileri günceller
5. Model ve zaman aralığı filtreleri tüm chart/tabloları etkiler
