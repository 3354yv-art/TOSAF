// ==UserScript==
// @name         מתמחים טופ – למי נתתי לייק ודיסלייק
// @namespace    mitmachim-my-votes
// @version      1.0
// @description  מציג את כל הפוסטים שנתת להם לייק או דיסלייק, עם חיפוש וסיכום לפי משתמש
// @match        https://mitmachim.top/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MAX_PAGES = 50;           // עד כמה עמודים לטעון מכל רשימה
  const cache = { upvoted: null, downvoted: null };
  let tab = 'upvoted';            // upvoted | downvoted
  let view = 'posts';             // posts | users

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toText = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; d.querySelectorAll('blockquote, img').forEach(e => e.remove()); return d.textContent.replace(/\s+/g, ' ').trim(); };
  const decode = (s) => { const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; };
  const me = () => window.app && app.user && app.user.userslug;
  const date = (iso) => { try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };

  /* ---------- טעינת הנתונים מהפורום ---------- */
  async function fetchAll(kind, onProgress) {
    const slug = me();
    if (!slug) throw new Error('צריך להיות מחובר לפורום');
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`/api/user/${encodeURIComponent(slug)}/${kind}?page=${page}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('הפורום החזיר שגיאה ' + res.status);
      const data = await res.json();
      const posts = data.posts || [];
      out.push(...posts.map(p => ({
        pid: p.pid,
        user: p.user ? (p.user.displayname || p.user.username) : 'משתמש',
        userslug: p.user && p.user.userslug,
        picture: p.user && p.user.picture,
        iconText: p.user && p.user['icon:text'],
        iconBg: p.user && p.user['icon:bgColor'],
        topic: p.topic ? decode(p.topic.title) : '',
        text: toText(p.content),
        time: p.timestampISO,
      })));
      onProgress && onProgress(out.length);
      const pageCount = data.pagination && data.pagination.pageCount;
      if (!posts.length || !pageCount || page >= pageCount) break;
    }
    return out;
  }

  /* ---------- עיצוב ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #mvt-back{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1070;display:none}
  #mvt-back.open{display:block}
  #mvt{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:640px;max-width:calc(100vw - 20px);height:80vh;display:flex;flex-direction:column;
    background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);direction:rtl;font-size:14px}
  #mvt .h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--bs-border-color,#dee2e6);font-weight:600;font-size:16px}
  #mvt .h .x{margin-inline-start:auto;border:0;background:none;font-size:20px;cursor:pointer;color:inherit;opacity:.6}
  #mvt .bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px}
  #mvt .tb{border:1px solid var(--bs-border-color,#dee2e6);background:none;color:inherit;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
  #mvt .tb.on{background:var(--bs-primary,#0d6efd);border-color:var(--bs-primary,#0d6efd);color:#fff}
  #mvt .sep{width:1px;height:22px;background:var(--bs-border-color,#dee2e6);margin:0 4px}
  #mvt .q{flex:1;min-width:160px;padding:6px 10px;border:1px solid var(--bs-border-color,#dee2e6);border-radius:6px;background:transparent;color:inherit;font:inherit}
  #mvt .list{flex:1;overflow-y:auto;padding:0 8px 8px}
  #mvt .it{display:flex;gap:10px;padding:10px 6px;border-bottom:1px solid var(--bs-border-color,#eee)}
  #mvt .av{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;object-fit:cover}
  #mvt .who{font-weight:700}
  #mvt .meta{font-size:12px;opacity:.7}
  #mvt .tt{color:var(--bs-primary,#0d6efd);text-decoration:none;font-weight:600}
  #mvt .tt:hover{text-decoration:underline}
  #mvt .snip{margin-top:3px;opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  #mvt .cnt{margin-inline-start:auto;font-weight:700;font-size:16px;align-self:center}
  #mvt .msg{padding:30px;text-align:center;opacity:.7}
  #mvt .foot{padding:8px 14px;border-top:1px solid var(--bs-border-color,#dee2e6);font-size:12px;opacity:.75;display:flex;justify-content:space-between}
  #mvt .foot button{border:0;background:none;color:var(--bs-primary,#0d6efd);cursor:pointer;font:inherit}
  #mvt mark{background:#fff3a3;color:inherit;padding:0}
  `;
  document.head.appendChild(css);

  /* ---------- החלון ---------- */
  const back = document.createElement('div');
  back.id = 'mvt-back';
  back.innerHTML = `
  <div id="mvt">
    <div class="h"><i class="fa fa-thumbs-up text-primary"></i> ההצבעות שלי<button class="x" title="סגירה">×</button></div>
    <div class="bar">
      <button class="tb" data-tab="upvoted">👍 לייקים</button>
      <button class="tb" data-tab="downvoted">👎 דיסלייקים</button>
      <span class="sep"></span>
      <button class="tb" data-view="posts">לפי פוסטים</button>
      <button class="tb" data-view="users">לפי משתמשים</button>
      <input class="q" placeholder="חיפוש לפי שם משתמש, נושא או תוכן…">
    </div>
    <div class="list"></div>
    <div class="foot"><span class="sum"></span><button class="reload">רענון</button></div>
  </div>`;
  document.body.appendChild(back);

  const $ = (s) => back.querySelector(s);
  const listEl = $('.list');
  const qEl = $('.q');

  function hl(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return safe;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  function avatar(p) {
    if (p.picture) return `<img class="av" src="${esc(p.picture)}" alt="">`;
    return `<span class="av" style="background:${esc(p.iconBg || '#6c757d')}">${esc(p.iconText || (p.user || '?')[0])}</span>`;
  }
  function snippet(text, q) {
    if (!q) return esc(text.slice(0, 220));
    const i = text.toLowerCase().indexOf(q);
    const start = Math.max(0, i - 60);
    const part = (start ? '…' : '') + text.slice(start, start + 220);
    return hl(part, q);
  }

  function render() {
    back.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    back.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    const data = cache[tab];
    if (!data) return;
    const q = qEl.value.trim().toLowerCase();
    const word = tab === 'upvoted' ? 'לייקים' : 'דיסלייקים';

    if (view === 'users') {
      const map = new Map();
      data.forEach(p => { const k = p.user; const e = map.get(k) || { ...p, n: 0 }; e.n++; map.set(k, e); });
      const users = [...map.values()].filter(u => !q || u.user.toLowerCase().includes(q)).sort((a, b) => b.n - a.n);
      $('.sum').textContent = `${map.size} משתמשים · ${data.length} ${word}`;
      listEl.innerHTML = users.length ? users.map(u => `
        <div class="it">${avatar(u)}
          <div style="min-width:0"><a class="tt" href="/user/${esc(u.userslug || '')}">${hl(u.user, q)}</a></div>
          <span class="cnt">${u.n}</span>
        </div>`).join('') : `<div class="msg">${data.length ? 'לא נמצאו משתמשים' : `עוד לא נתת ${word}`}</div>`;
      return;
    }

    const items = data.filter(p => !q || p.user.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q) || p.text.toLowerCase().includes(q));
    $('.sum').textContent = q ? `${items.length} מתוך ${data.length} ${word}` : `${data.length} ${word}`;
    listEl.innerHTML = items.length ? items.map(p => `
      <div class="it">${avatar(p)}
        <div style="min-width:0;flex:1">
          <div><span class="who">${hl(p.user, q)}</span> <span class="meta">· ${date(p.time)}</span></div>
          <a class="tt" href="/post/${p.pid}">${hl(p.topic || 'פוסט', q)}</a>
          <div class="snip">${snippet(p.text, q)}</div>
        </div>
      </div>`).join('') : `<div class="msg">${data.length ? 'לא נמצאו תוצאות' : `עוד לא נתת ${word}`}</div>`;
  }

  async function load(force) {
    if (cache[tab] && !force) return render();
    const kind = tab;
    listEl.innerHTML = `<div class="msg">טוען… <span class="n"></span></div>`;
    $('.sum').textContent = '';
    try {
      cache[kind] = await fetchAll(kind, n => { const s = listEl.querySelector('.n'); if (s) s.textContent = `(${n})`; });
      if (tab === kind) render();
    } catch (e) {
      listEl.innerHTML = `<div class="msg">לא הצלחתי לטעון: ${esc(e.message)}</div>`;
    }
  }

  function open() { back.classList.add('open'); qEl.value = ''; load(); setTimeout(() => qEl.focus(), 50); }
  function close() { back.classList.remove('open'); }

  back.addEventListener('click', e => {
    if (e.target === back || e.target.closest('.x')) return close();
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; return load(); }
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; return render(); }
    if (e.target.closest('.reload')) return load(true);
    const a = e.target.closest('a[href^="/"]');
    if (a && window.ajaxify && typeof ajaxify.go === 'function' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); close(); ajaxify.go(a.getAttribute('href').slice(1));
    }
  });
  qEl.addEventListener('input', render);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.altKey && (e.key === 'l' || e.key === 'ך')) { e.preventDefault(); back.classList.contains('open') ? close() : open(); }
  });

  /* ---------- כפתור בסרגל הצד ---------- */
  function addNavButton() {
    const nav = document.getElementById('main-nav');
    if (!nav || document.getElementById('mvt-nav')) return;
    const li = document.createElement('li');
    li.id = 'mvt-nav';
    li.className = 'nav-item mx-2';
    li.title = 'ההצבעות שלי (Alt+L)';
    li.innerHTML = `
      <a class="nav-link navigation-link d-flex gap-2 justify-content-between align-items-center" href="#" role="button" aria-label="ההצבעות שלי">
        <span class="d-flex gap-2 align-items-center text-nowrap truncate-open">
          <span class="position-relative"><i class="fa fa-fw fa-thumbs-up"></i></span>
          <span class="nav-text small visible-open fw-semibold text-truncate">ההצבעות שלי</span>
        </span>
      </a>`;
    li.querySelector('a').addEventListener('click', e => { e.preventDefault(); open(); });
    nav.appendChild(li);
  }
  addNavButton();
  new MutationObserver(addNavButton).observe(document.body, { childList: true, subtree: true });
})();
