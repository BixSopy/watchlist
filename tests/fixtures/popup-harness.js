'use strict';
/*
 * Fenêtre de l'extension (0.7.3) dans node:vm, sur le vrai extension/options.html :
 * mini-DOM (analyse du HTML, sélecteurs simples : tag, #id, .classe, [attr], [attr="v"], descendants)
 * et chrome.* simulé (stockage avec onChanged, permissions, i18n à partir des vrais _locales).
 * Pas de dépendance : les tests unitaires tournent avec `node --test tests/`.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr']);

class Node {
  constructor(tag, attrs, doc) {
    this.tagName = tag ? tag.toUpperCase() : '#text'; this.attrs = attrs || {}; this.childNodes = []; this.parentNode = null;
    this.doc = doc; this.handlers = {}; this.style = {}; this.offsetWidth = 0; this.value = this.attrs.value || ''; this.checked = 'checked' in this.attrs; this.files = null;
    this._disabled = 'disabled' in this.attrs; this.data = '';
    const self = this;
    this.classList = {
      contains: c => self.className.split(/\s+/).includes(c),
      add: (...cs) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); cs.forEach(c => s.add(c)); self.className = [...s].join(' '); },
      remove: (...cs) => { self.className = self.className.split(/\s+/).filter(c => c && !cs.includes(c)).join(' '); },
      toggle: (c, force) => { const on = force === undefined ? !self.classList.contains(c) : !!force; on ? self.classList.add(c) : self.classList.remove(c); return on; },
    };
  }
  get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
  get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
  get hidden() { return 'hidden' in this.attrs; } set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get disabled() { return this._disabled; } set disabled(v) { this._disabled = !!v; }
  get type() { return this.attrs.type || ''; } set type(v) { this.attrs.type = v; }
  get title() { return this.attrs.title || ''; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  get children() { return this.childNodes.filter(n => n.tagName !== '#text'); }
  get textContent() { return this.tagName === '#text' ? this.data : this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) this.appendChild(this.doc.createTextNode(String(v))); }
  appendChild(c) { if (c.parentNode) c.parentNode.childNodes = c.parentNode.childNodes.filter(n => n !== c); c.parentNode = this; this.childNodes.push(c); return c; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  dispatch(type, extra) {
    let stopped = false, prevented = false;
    const ev = Object.assign({ type, target: this, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }, extra || {});
    for (let n = this; n && !stopped; n = n.parentNode) (n.handlers[type] || []).slice().forEach(fn => fn(ev));
    if (!stopped) (this.doc.handlers[type] || []).slice().forEach(fn => fn(ev));
    return !prevented;
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  descendants() { const out = []; const walk = n => n.children.forEach(c => { out.push(c); walk(c); }); walk(this); return out; }
  querySelectorAll(sel) { return this.descendants().filter(n => matches(n, sel, this)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  matches(sel) { return matches(this, sel, null); }
}

function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m, used = 0;
  while ((m = re.exec(s))) {
    if (m.index !== used) break;
    used = re.lastIndex;
    if (m[1]) c.tag = m[1].toUpperCase(); else if (m[2]) c.id = m[2]; else if (m[3]) c.classes.push(m[3]); else c.attrs.push([m[4], m[5]]);
  }
  if (used !== s.length) throw new Error('sélecteur non pris en charge : ' + s);
  return c;
}
function matchCompound(n, c) {
  if (c.tag && n.tagName !== c.tag) return false;
  if (c.id && n.id !== c.id) return false;
  if (c.classes.some(k => !n.classList.contains(k))) return false;
  return c.attrs.every(([k, v]) => k in n.attrs && (v === undefined || n.attrs[k] === v));
}
function matches(n, sel, scope) {
  return sel.split(',').some(one => {
    const parts = one.trim().replace(/\s*~\s*/g, ' ~').split(/\s+/).map(p => p.startsWith('~') ? { sib: true, c: parseCompound(p.slice(1)) } : { c: parseCompound(p) });
    let i = parts.length - 1;
    if (!matchCompound(n, parts[i].c)) return false;
    let cur = n;
    while (i > 0) {
      const p = parts[i];
      i--;
      if (p.sib) {
        const sibs = cur.parentNode ? cur.parentNode.children : [];
        const prev = sibs.slice(0, sibs.indexOf(cur)).find(s => matchCompound(s, parts[i].c));
        if (!prev) return false; cur = prev; continue;
      }
      let a = cur.parentNode;
      while (a && a !== scope && !(a.tagName !== '#doc' && matchCompound(a, parts[i].c))) a = a.parentNode;
      if (!a || a === scope) return false;
      cur = a;
    }
    return true;
  });
}

function parseHtml(html, doc) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const root = new Node('body', {}, doc);
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    const top = stack[stack.length - 1];
    if (m[4]) { if (m[4].trim()) top.appendChild(doc.createTextNode(m[4].replace(/\s+/g, ' '))); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2].replace(/&amp;/g, '&');
    const el = new Node(tag, attrs, doc);
    top.appendChild(el);
    if (!VOID.has(tag) && !/\/$/.test(m[3])) stack.push(el);
  }
  return root;
}

function messagesGetter(lang) {
  const messages = JSON.parse(read('extension/_locales/' + lang + '/messages.json'));
  return (key, subs) => {
    const m = messages[key];
    if (!m) return '';
    return m.message.replace(/\$(\w+)\$/g, (all, name) => {
      const p = m.placeholders && m.placeholders[name.toLowerCase()];
      return p ? p.content.replace(/\$(\d)/g, (x, i) => ([].concat(subs || []))[i - 1] ?? '') : all;
    });
  };
}

/* granted : { crunchyroll: true, ... } ; answer : réponse à chrome.permissions.request */
function loadPopup({ lang = 'fr', store = {}, granted = {}, answer = true, clipboardFails = false } = {}) {
  const PLATFORMS = require('../../extension/lib/platforms.js');
  const doc = { handlers: {}, title: '', documentElement: {} };
  doc.createElement = tag => new Node(tag, {}, doc);
  doc.createTextNode = t => { const n = new Node(null, {}, doc); n.data = String(t); return n; };
  doc.addEventListener = (t, fn) => { (doc.handlers[t] = doc.handlers[t] || []).push(fn); };
  doc.body = parseHtml(read('extension/options.html'), doc);
  doc.body.parentNode = null;
  doc.getElementById = id => doc.body.querySelector('#' + id);
  doc.querySelectorAll = sel => doc.body.querySelectorAll(sel);
  doc.querySelector = sel => doc.body.querySelector(sel);
  const data = { ...store };
  const listeners = [];
  const fire = changes => listeners.forEach(fn => fn(changes, 'local'));
  const pick = k => { const ks = k == null ? Object.keys(data) : [].concat(k); const o = {}; ks.forEach(x => { if (x in data) o[x] = data[x]; }); return o; };
  const local = {
    get: (k, cb) => (cb ? cb(pick(k)) : Promise.resolve(pick(k))),
    set: (o, cb) => { const ch = {}; for (const k in o) { ch[k] = { oldValue: data[k], newValue: o[k] }; data[k] = o[k]; } fire(ch); return cb ? cb() : Promise.resolve(); },
    remove: (k, cb) => { const ch = {}; [].concat(k).forEach(x => { if (x in data) { ch[x] = { oldValue: data[x] }; delete data[x]; } }); if (Object.keys(ch).length) fire(ch); return cb ? cb() : Promise.resolve(); },
  };
  const requests = [], sent = [], tabs = [], copied = [], intervals = [];
  const nameOf = q => Object.keys(PLATFORMS).find(k => PLATFORMS[k].origins.join() === q.origins.join());
  const perm = { added: [], removed: [] };
  const ctx = {
    document: doc,
    window: { matchMedia: () => ({ matches: true }), close() {} },
    chrome: {
      i18n: { getMessage: messagesGetter(lang), getUILanguage: () => lang },
      runtime: { lastError: undefined, getManifest: () => JSON.parse(read('extension/manifest.json')), sendMessage: (m, cb) => { sent.push(m); if (cb) cb({ ok: true, started: true }); }, openOptionsPage() {} },
      tabs: { create: o => tabs.push(o.url) },
      permissions: {
        contains: (q, cb) => cb(!!granted[nameOf(q)]),
        request: (q, cb) => { requests.push(q.origins); if (answer) granted[nameOf(q)] = true; cb(answer); },
        remove: (q, cb) => { granted[nameOf(q)] = false; cb(true); },
        getAll: async () => ({ origins: [] }),
        onAdded: { addListener: fn => perm.added.push(fn) }, onRemoved: { addListener: fn => perm.removed.push(fn) },
      },
      scripting: { getRegisteredContentScripts: async () => [] },
      storage: { local, onChanged: { addListener: fn => listeners.push(fn) } },
    },
    navigator: { userAgent: 'test', clipboard: { writeText: async t => { if (clipboardFails) throw new Error('no'); copied.push(t); } } },
    CinepisodePlatforms: PLATFORMS,
    setTimeout: fn => { fn(); return 0; }, setInterval: fn => { intervals.push(fn); return 0; },
    Date, Number, String, Object, Math, JSON, Array, Promise, Error, RegExp,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('extension/options.js'), ctx);
  const $ = id => doc.getElementById(id);
  const visible = () => ['viewOff', 'viewMain', 'viewSettings'].filter(v => !$(v).hidden);
  return { doc, $, data, ctx, requests, sent, tabs, copied, granted, intervals, visible,
    q: (role, p) => doc.querySelector('[data-role="' + role + '"][data-p="' + p + '"]'),
    set: o => local.set(o), updateImport: v => local.set({ wlImport: v }) };
}

module.exports = { loadPopup, parseHtml, read };
