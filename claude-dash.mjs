#!/usr/bin/env node
// SPDX-License-Identifier: MIT — Copyright (c) 2026 João Claro
// Unofficial. Not affiliated with or endorsed by Anthropic.
// claude-dash — painel só de leitura para a configuração do Claude Code.
// Uso: node claude-dash.mjs [pasta-do-projeto] [--port 4777] [--no-open]
// Lê ~/.claude (global) e <projeto>/.claude (projeto). Não escreve nada.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');

const PROJECT = path.resolve(positional[0] || process.cwd());
const HOME = os.homedir();
const GLOBAL = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, '.claude');
const PROJ_CLAUDE = path.join(PROJECT, '.claude');
let PORT = parseInt(opt('--port', '4777'), 10);

// ---------- leitura de ficheiros ----------
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const mtime = (p) => { try { return fs.statSync(p).mtime.toISOString(); } catch { return null; } };
const readJSON = (p) => { const t = read(p); if (t == null) return null; try { return JSON.parse(t); } catch { return { __erro: 'JSON inválido' }; } };

function walk(dir, filter, depth = 6) {
  const out = [];
  if (!isDir(dir) || depth < 0) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // ignora .trash e afins
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter, depth - 1));
    else if (filter(p)) out.push(p);
  }
  return out;
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || '');
  if (!m) return { meta: {}, body: text || '' };
  const meta = {}; let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]; let v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else if (/^[>|][-+]?$/.test(v)) { meta[key] = ''; continue; } // bloco multi-linha YAML
      else v = v.replace(/^["']|["']$/g, '');
      meta[key] = v === '' ? [] : v;
    } else if (key && /^\s*-\s+/.test(line)) {
      if (!Array.isArray(meta[key])) meta[key] = meta[key] ? [meta[key]] : [];
      meta[key].push(line.replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, ''));
    } else if (key && /^\s+\S/.test(line) && typeof meta[key] === 'string') {
      meta[key] = (meta[key] ? meta[key] + ' ' : '') + line.trim(); // descrições multi-linha (>, |)
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

const firstHeading = (body) => (/^#\s+(.+)$/m.exec(body || '') || [])[1];
const firstPara = (body) => (body || '').split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#')) || '';

// mascara valores que parecem segredos
const SECRET_KEY = /(token|secret|key|password|passwd|auth|credential|cookie|bearer)/i;
function mask(obj, parentKey = '') {
  if (Array.isArray(obj)) return obj.map((v) => mask(v, parentKey));
  if (obj && typeof obj === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(obj)) {
      if ((parentKey === 'env' || parentKey === 'headers' || SECRET_KEY.test(k)) && typeof v === 'string' && !/^\$\{.*\}$/.test(v)) o[k] = v ? '••••••' : v;
      else o[k] = mask(v, k);
    }
    return o;
  }
  if (typeof obj === 'string' && /^(sk-|ghp_|xox|eyJ)/.test(obj)) return '••••••';
  return obj;
}

const scopes = [
  { scope: 'global', base: GLOBAL },
  { scope: 'projeto', base: PROJ_CLAUDE },
];
const rel = (p) => p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;

function item(kind, scope, file, extra = {}) {
  const text = read(file) ?? '';
  const { meta, body } = parseFrontmatter(text);
  return {
    kind, scope, path: rel(file), updated: mtime(file),
    name: meta.name || extra.name || path.basename(file).replace(/\.(md|js|json)$/, ''),
    description: meta.description || extra.description || firstPara(body).slice(0, 220),
    meta, body: extra.body ?? body, lang: extra.lang || 'md',
  };
}

function collect() {
  const data = { skills: [], commands: [], agents: [], plans: [], instructions: [], rules: [], hooks: [], settings: [], mcp: [], workflows: [], styles: [] };

  for (const { scope, base } of scopes) {
    // skills/<nome>/SKILL.md
    const sd = path.join(base, 'skills');
    if (isDir(sd)) for (const e of fs.readdirSync(sd, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const f = path.join(sd, e.name, 'SKILL.md');
      if (!exists(f)) continue;
      const it = item('skill', scope, f, { name: e.name });
      it.files = walk(path.join(sd, e.name), () => true, 3).map((p) => path.relative(path.join(sd, e.name), p)).filter((p) => p !== 'SKILL.md');
      data.skills.push(it);
    }
    for (const f of walk(path.join(base, 'commands'), (p) => p.endsWith('.md'))) {
      const it = item('command', scope, f);
      it.name = '/' + path.relative(path.join(base, 'commands'), f).replace(/\.md$/, '').split(path.sep).join(':');
      data.commands.push(it);
    }
    for (const f of walk(path.join(base, 'agents'), (p) => p.endsWith('.md'))) data.agents.push(item('agent', scope, f));
    for (const f of walk(path.join(base, 'rules'), (p) => p.endsWith('.md'))) data.rules.push(item('rule', scope, f));
    for (const f of walk(path.join(base, 'workflows'), (p) => p.endsWith('.js'))) data.workflows.push(item('workflow', scope, f, { lang: 'js', body: '```js\n' + (read(f) || '') + '\n```', description: 'Workflow dinâmico' }));
    for (const f of walk(path.join(base, 'output-styles'), (p) => p.endsWith('.md'))) data.styles.push(item('style', scope, f));

    // settings + hooks
    for (const name of ['settings.json', 'settings.local.json']) {
      const f = path.join(base, name);
      if (!exists(f)) continue;
      const json = readJSON(f) || {};
      data.settings.push({ kind: 'settings', scope, name, path: rel(f), updated: mtime(f), description: Object.keys(json).join(', ') || 'vazio', meta: {}, body: '```json\n' + JSON.stringify(mask(json), null, 2) + '\n```' });
      const hooks = json.hooks || {};
      for (const [event, groups] of Object.entries(hooks)) {
        for (const g of [].concat(groups)) {
          for (const h of [].concat(g?.hooks || [])) {
            data.hooks.push({ kind: 'hook', scope, name: event + (g.matcher ? ` · ${g.matcher}` : ''), path: rel(f), updated: mtime(f),
              description: h.command || h.url || h.prompt || h.type || '', meta: { event, matcher: g.matcher || '(todos)', type: h.type || 'command' },
              body: '```json\n' + JSON.stringify(mask(h), null, 2) + '\n```' });
          }
        }
      }
    }
  }

  // CLAUDE.md / AGENTS.md
  const instr = [
    ['global', path.join(GLOBAL, 'CLAUDE.md')],
    ['projeto', path.join(PROJECT, 'CLAUDE.md')],
    ['projeto', path.join(PROJ_CLAUDE, 'CLAUDE.md')],
    ['projeto', path.join(PROJECT, 'CLAUDE.local.md')],
    ['projeto', path.join(PROJECT, 'AGENTS.md')],
  ];
  for (const [scope, f] of instr) if (exists(f)) {
    const it = item('instruction', scope, f, { name: path.basename(f) });
    it.description = `${(read(f) || '').split('\n').length} linhas`;
    data.instructions.push(it);
  }

  // MCP: .mcp.json do projeto + ~/.claude.json (só mcpServers, mascarados)
  const pushMcp = (scope, file, servers) => {
    for (const [name, cfg] of Object.entries(servers || {})) {
      data.mcp.push({ kind: 'mcp', scope, name, path: rel(file), updated: mtime(file),
        description: cfg.url || [cfg.command, ...(cfg.args || [])].filter(Boolean).join(' '),
        meta: { tipo: cfg.type || (cfg.url ? 'http' : 'stdio') }, body: '```json\n' + JSON.stringify(mask(cfg), null, 2) + '\n```' });
    }
  };
  const mcpFile = path.join(PROJECT, '.mcp.json');
  pushMcp('projeto', mcpFile, readJSON(mcpFile)?.mcpServers);
  const cj = path.join(HOME, '.claude.json');
  const claudeJson = readJSON(cj);
  if (claudeJson) {
    pushMcp('global', cj, claudeJson.mcpServers);
    pushMcp('local', cj, claudeJson.projects?.[PROJECT]?.mcpServers);
  }

  // Plans: ~/.claude/plans + plansDirectory (se definido nas settings)
  const planDirs = new Set([path.join(GLOBAL, 'plans')]);
  for (const f of [path.join(GLOBAL, 'settings.json'), path.join(PROJ_CLAUDE, 'settings.json'), path.join(PROJ_CLAUDE, 'settings.local.json')]) {
    const pd = readJSON(f)?.plansDirectory;
    if (typeof pd === 'string') planDirs.add(path.resolve(path.dirname(path.dirname(f)) === HOME ? HOME : PROJECT, pd.replace(/^~/, HOME)));
  }
  for (const d of planDirs) for (const f of walk(d, (p) => p.endsWith('.md'), 2)) {
    const it = item('plan', d.startsWith(GLOBAL) ? 'global' : 'projeto', f);
    it.name = firstHeading(it.body) || it.name;
    data.plans.push(it);
  }
  data.plans.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  return { project: rel(PROJECT), global: rel(GLOBAL), generated: new Date().toISOString(), data };
}

// ---------- servidor ----------
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (req.url.startsWith('/api/data')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(collect()));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

function listen() {
  server.once('error', (e) => { if (e.code === 'EADDRINUSE') { PORT++; listen(); } else throw e; });
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  claude-dash  →  ${url}\n  projeto: ${rel(PROJECT)}\n  global:  ${rel(GLOBAL)}\n  (Ctrl+C para sair)\n`);
    if (!flag('--no-open')) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
      exec(`${cmd} ${url}`, () => {});
    }
  });
}

// ---------- página ----------
const PAGE = /* html */ `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Dash</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<style>
:root{
  --bg:#f7f6f2;--panel:#ffffff;--side:#efede6;--line:#e4e1d7;--text:#1d1c1a;--muted:#6f6d66;--faint:#9b988f;
  --accent:#c9653f;--accent-bg:rgba(201,101,63,.09);--code:#f1efe8;
  --global:#4f7cc4;--projeto:#4c8b53;--local:#9a6bb5;
  --mono:'JetBrains Mono',ui-monospace,monospace;--sans:Inter,system-ui,-apple-system,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#171615;--panel:#1f1e1c;--side:#141312;--line:#2e2c29;--text:#ece9e1;--muted:#a3a097;--faint:#6f6c65;
  --accent:#e08a62;--accent-bg:rgba(224,138,98,.12);--code:#272522;
  --global:#7ba3e0;--projeto:#7cbf83;--local:#c39ad9;}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--text);font:14px/1.55 var(--sans);display:grid;grid-template-columns:240px 1fr;}
aside{background:var(--side);border-right:1px solid var(--line);padding:20px 12px;overflow:auto;height:100vh;position:sticky;top:0}
.brand{font-weight:700;font-size:16px;padding:0 10px 4px;display:flex;align-items:center;gap:8px}
.brand i{width:10px;height:10px;border-radius:3px;background:var(--accent);display:inline-block}
.where{font:11px var(--mono);color:var(--faint);padding:0 10px 18px;word-break:break-all}
nav button{all:unset;cursor:pointer;display:flex;justify-content:space-between;align-items:center;width:100%;box-sizing:border-box;padding:7px 10px;border-radius:7px;color:var(--muted);font-weight:500}
nav button:hover{background:var(--accent-bg);color:var(--text)}
nav button.on{background:var(--accent-bg);color:var(--accent)}
nav .n{font:11px var(--mono);color:var(--faint)}
nav .grp{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);padding:14px 10px 4px;font-weight:600}
main{height:100vh;overflow:auto;padding:28px 36px 60px}
.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
h1{font-size:22px;margin:0;letter-spacing:-.01em;flex:1}
.hint{color:var(--muted);margin:-10px 0 18px;font-size:13px}
input[type=search]{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--text);font:inherit;width:260px}
.chips{display:flex;gap:6px}
.chip{all:unset;cursor:pointer;font-size:12px;padding:5px 10px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.chip.on{border-color:var(--accent);color:var(--accent);background:var(--accent-bg)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;cursor:pointer;transition:border-color .12s,transform .12s;display:flex;flex-direction:column;gap:6px}
.card:hover{border-color:var(--accent);transform:translateY(-1px)}
.card .t{display:flex;gap:8px;align-items:center;justify-content:space-between}
.card .name{font-weight:600;font-family:var(--mono);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .d{color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card .f{font:11px var(--mono);color:var(--faint);display:flex;justify-content:space-between;gap:8px;margin-top:auto}
.badge{font:600 10px var(--sans);text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:5px;flex-shrink:0}
.b-global{color:var(--global);background:color-mix(in srgb,var(--global) 12%,transparent)}
.b-projeto{color:var(--projeto);background:color-mix(in srgb,var(--projeto) 12%,transparent)}
.b-local{color:var(--local);background:color-mix(in srgb,var(--local) 12%,transparent)}
.empty{color:var(--muted);background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:28px;text-align:center}
.overview{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;cursor:pointer}
.stat:hover{border-color:var(--accent)}
.stat b{font-size:26px;display:block;letter-spacing:-.02em}.stat span{color:var(--muted);font-size:13px}
.stat small{display:block;color:var(--faint);font:11px var(--mono);margin-top:4px}
/* detalhe */
.shade{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none}
.shade.on{display:block}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(760px,100%);background:var(--panel);border-left:1px solid var(--line);transform:translateX(100%);transition:transform .2s;overflow:auto;padding:26px 30px 60px}
.drawer.on{transform:none}
.drawer h2{margin:6px 0 4px;font:600 19px var(--mono);word-break:break-word}
.drawer .p{font:12px var(--mono);color:var(--faint);word-break:break-all}
.x{all:unset;cursor:pointer;float:right;font-size:20px;color:var(--muted);padding:2px 8px;border-radius:6px}.x:hover{background:var(--accent-bg)}
table.meta{border-collapse:collapse;margin:16px 0;width:100%;font-size:13px}
table.meta td{border-top:1px solid var(--line);padding:6px 8px;vertical-align:top}
table.meta td:first-child{font-family:var(--mono);color:var(--muted);width:150px}
.files{font:12px var(--mono);color:var(--muted);margin:8px 0 0}
.md{border-top:1px solid var(--line);margin-top:16px;padding-top:6px}
.md pre{background:var(--code);padding:12px 14px;border-radius:8px;overflow:auto;font:12.5px/1.55 var(--mono)}
.md code{font-family:var(--mono);font-size:.92em;background:var(--code);padding:1px 4px;border-radius:4px}
.md pre code{background:none;padding:0}
.md table{border-collapse:collapse}.md td,.md th{border:1px solid var(--line);padding:4px 8px}
.md h1,.md h2,.md h3{letter-spacing:-.01em}
@media (max-width:760px){body{grid-template-columns:1fr}aside{position:static;height:auto}main{height:auto;padding:20px 16px}input[type=search]{width:100%}}
</style>
</head>
<body>
<aside>
  <div class="brand"><i></i>Claude Dash</div>
  <div class="where" id="where"></div>
  <nav id="nav"></nav>
</aside>
<main id="main"></main>
<div class="shade" id="shade"></div>
<div class="drawer" id="drawer"></div>
<script>
const SECTIONS = [
  ['overview','Visão geral',null],
  ['skills','Skills','Capacidades','Pastas com SKILL.md. Invocam-se com /nome ou o Claude usa-as sozinho.'],
  ['commands','Commands','Capacidades','Ficheiros .md únicos invocados com /nome (mecanismo antigo das skills).'],
  ['agents','Agents','Capacidades','Subagents com prompt, ferramentas e modelo próprios.'],
  ['workflows','Workflows','Capacidades','Scripts que orquestram muitos subagents.'],
  ['plans','Plans','Trabalho','Planos escritos em plan mode. Em ~/.claude/plans são apagados após cleanupPeriodDays (30 dias por defeito).'],
  ['instructions','CLAUDE.md','Contexto','Instruções carregadas em todas as sessões.'],
  ['rules','Rules','Contexto','Instruções por tema, opcionalmente limitadas a caminhos (paths:).'],
  ['styles','Output styles','Contexto','Estilos que ajustam a forma como o Claude responde.'],
  ['hooks','Hooks','Configuração','Scripts que correm em eventos (antes/depois de ferramentas, etc.).'],
  ['mcp','MCP servers','Configuração','Servidores MCP. Valores sensíveis estão mascarados.'],
  ['settings','Settings','Configuração','settings.json e settings.local.json. Valores sensíveis estão mascarados.'],
];
let STATE = { tab: location.hash.slice(1) || 'overview', q: '', scope: 'todos', payload: null };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const when = (iso) => { if (!iso) return ''; const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s/60)) + ' min'; if (s < 86400) return Math.round(s/3600) + ' h';
  if (s < 86400*30) return Math.round(s/86400) + ' d'; return d.toLocaleDateString('pt-PT'); };
const md = (t) => window.marked ? marked.parse(t || '') : '<pre>' + esc(t) + '</pre>';

async function load() {
  STATE.payload = await (await fetch('/api/data')).json();
  $('#where').innerHTML = 'projeto ' + esc(STATE.payload.project) + '<br>global ' + esc(STATE.payload.global);
  render();
}

function renderNav() {
  const d = STATE.payload.data; let html = '', grp = null;
  for (const [id, label, g] of SECTIONS) {
    if (g && g !== grp) { html += '<div class="grp">' + g + '</div>'; grp = g; }
    const n = id === 'overview' ? '' : d[id].length;
    html += '<button data-t="' + id + '" class="' + (STATE.tab === id ? 'on' : '') + '"><span>' + label + '</span><span class="n">' + n + '</span></button>';
  }
  $('#nav').innerHTML = html;
  $('#nav').querySelectorAll('button').forEach((b) => b.onclick = () => go(b.dataset.t));
}
function go(t) { STATE.tab = t; STATE.q = ''; location.hash = t; render(); $('#main').scrollTop = 0; }

function render() {
  renderNav();
  const d = STATE.payload.data;
  if (STATE.tab === 'overview') {
    const cards = SECTIONS.slice(1).map(([id, label]) => {
      const list = d[id]; const g = list.filter((x) => x.scope === 'global').length;
      return '<div class="stat" data-t="' + id + '"><b>' + list.length + '</b><span>' + label + '</span><small>' + g + ' global · ' + (list.length - g) + ' projeto</small></div>';
    }).join('');
    $('#main').innerHTML = '<div class="top"><h1>Visão geral</h1></div><div class="overview">' + cards + '</div>';
    $('#main').querySelectorAll('.stat').forEach((s) => s.onclick = () => go(s.dataset.t));
    return;
  }
  const sec = SECTIONS.find((s) => s[0] === STATE.tab);
  const q = STATE.q.toLowerCase();
  const list = d[STATE.tab].filter((x) => (STATE.scope === 'todos' || x.scope === STATE.scope) &&
    (!q || (x.name + ' ' + x.description + ' ' + x.body).toLowerCase().includes(q)));
  const chips = ['todos','global','projeto','local'].map((s) => '<button class="chip ' + (STATE.scope === s ? 'on' : '') + '" data-s="' + s + '">' + s + '</button>').join('');
  const cards = list.map((x, i) => '<div class="card" data-i="' + d[STATE.tab].indexOf(x) + '"><div class="t"><span class="name">' + esc(x.name) +
    '</span><span class="badge b-' + x.scope + '">' + x.scope + '</span></div><div class="d">' + esc(x.description) +
    '</div><div class="f"><span>' + esc(x.path.split('/').slice(-2).join('/')) + '</span><span>' + when(x.updated) + '</span></div></div>').join('');
  $('#main').innerHTML = '<div class="top"><h1>' + sec[1] + '</h1><div class="chips">' + chips + '</div><input type="search" placeholder="Procurar…" value="' + esc(STATE.q) + '"></div>' +
    '<p class="hint">' + sec[3] + '</p>' + (list.length ? '<div class="grid">' + cards + '</div>' : '<div class="empty">Nada aqui' + (q ? ' para esta pesquisa' : '') + '.</div>');
  const inp = $('#main input'); inp.oninput = () => { STATE.q = inp.value; const pos = inp.selectionStart; render(); const n = $('#main input'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#main').querySelectorAll('.chip').forEach((c) => c.onclick = () => { STATE.scope = c.dataset.s; render(); });
  $('#main').querySelectorAll('.card').forEach((c) => c.onclick = () => open(d[STATE.tab][c.dataset.i]));
}

function open(x) {
  const rows = Object.entries(x.meta || {}).filter(([k]) => k !== 'description' && k !== 'name')
    .map(([k, v]) => '<tr><td>' + esc(k) + '</td><td>' + esc(Array.isArray(v) ? v.join(', ') : v) + '</td></tr>').join('');
  $('#drawer').innerHTML = '<button class="x" id="x">×</button><span class="badge b-' + x.scope + '">' + x.scope + '</span><h2>' + esc(x.name) + '</h2>' +
    '<div class="p">' + esc(x.path) + (x.updated ? ' · ' + new Date(x.updated).toLocaleString('pt-PT') : '') + '</div>' +
    (x.description ? '<p>' + esc(x.description) + '</p>' : '') + (rows ? '<table class="meta">' + rows + '</table>' : '') +
    (x.files && x.files.length ? '<div class="files">Ficheiros de apoio: ' + x.files.map(esc).join(' · ') + '</div>' : '') +
    '<div class="md">' + md(x.body) + '</div>';
  $('#drawer').classList.add('on'); $('#shade').classList.add('on'); $('#drawer').scrollTop = 0;
  $('#x').onclick = close;
}
function close() { $('#drawer').classList.remove('on'); $('#shade').classList.remove('on'); }
$('#shade').onclick = close;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { const i = $('#main input'); if (i) { e.preventDefault(); i.focus(); } } });
window.addEventListener('focus', load); // atualiza ao voltar à janela
load();
</script>
</body>
</html>`;

listen();
