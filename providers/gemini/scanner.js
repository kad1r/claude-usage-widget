// providers/gemini/scanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_DIR = path.join(os.homedir(), '.gemini');

// Token pricing per million tokens (USD) — Google Gemini models
const PRICING = {
  'gemini-2.5-pro':   { input: 1.25, output: 10,   cacheRead: 0.31, cacheWrite: 0 },
  'gemini-2.0-flash': { input: 0.1,  output: 0.4,  cacheRead: 0.025, cacheWrite: 0 },
  'gemini-1.5-pro':   { input: 1.25, output: 5,    cacheRead: 0.31, cacheWrite: 0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
};
function findLogFiles() {
  if (!fs.existsSync(GEMINI_DIR)) return [];
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json')) results.push(full);
    }
  }
  walk(GEMINI_DIR);
  return results;
}

function scanAndStore(db) {
  const files = findLogFiles();
  let newSessions = 0, newTurns = 0;

  for (const filePath of files) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const existing = db.prepare('SELECT mtime FROM processed_files WHERE path = ?').get(filePath);
    if (existing && existing.mtime === stat.mtimeMs) continue;

    let rawLines;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      rawLines = filePath.endsWith('.jsonl')
        ? content.split('\n').filter(Boolean)
        : [content];
    } catch { continue; }

    const sessionId = 'gemini:' + path.basename(filePath, path.extname(filePath));

    // Delete stale turns before re-processing
    db.prepare('DELETE FROM turns WHERE session_id = ? AND provider = ?').run(sessionId, 'gemini');

    let sessionData = { model: 'gemini-2.5-pro', turns: 0, inputT: 0, outputT: 0, first: null, last: null };

    for (const line of rawLines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;

      // Gemini API response format uses usageMetadata
      const usage = msg.usageMetadata || msg.usage;
      if (!usage) continue;

      const model = msg.modelVersion || msg.model || 'gemini-2.5-pro';
      const inputTokens  = usage.promptTokenCount     || usage.input_tokens  || 0;
      const outputTokens = usage.candidatesTokenCount || usage.output_tokens || 0;
      const ts = msg.timestamp || msg.createTime || new Date().toISOString();

      db.prepare(`
        INSERT INTO turns (session_id, timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, provider)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'gemini')
      `).run(sessionId, ts, model, inputTokens, outputTokens);
      newTurns++;

      sessionData.turns++;
      sessionData.inputT  += inputTokens;
      sessionData.outputT += outputTokens;
      sessionData.model = model;
      if (!sessionData.first || ts < sessionData.first) sessionData.first = ts;
      if (!sessionData.last  || ts > sessionData.last)  sessionData.last  = ts;
    }

    if (sessionData.turns > 0) {
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        (session_id, project_name, first_timestamp, last_timestamp, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'gemini')
      `).run(sessionId, 'gemini', sessionData.first, sessionData.last, sessionData.model,
             sessionData.turns, sessionData.inputT, sessionData.outputT);
      newSessions++;
    }

    db.prepare('INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)')
      .run(filePath, stat.mtimeMs, rawLines.length);
  }

  return { newSessions, newTurns };
}

module.exports = { scanAndStore, PRICING, GEMINI_DIR };
