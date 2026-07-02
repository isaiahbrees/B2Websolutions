/* ReelForge app shell: sidebar, toasts, modals, api helper. Each app page
   includes this and calls Shell.mount('pageId'). */

const Shell = (() => {
  const NAV = [
    { section: 'Create' },
    { id: 'dashboard', href: '/app', label: 'Dashboard', icon: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z' },
    { id: 'new', href: '/app/new', label: 'New reel', icon: 'M12 5v14M5 12h14' },
    { id: 'projects', href: '/app/projects', label: 'Projects', icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
    { section: 'Library' },
    { id: 'templates', href: '/app/templates', label: 'Templates', icon: 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z' },
    { id: 'brand', href: '/app/brand', label: 'Brand kits', icon: 'M12 3l2.5 6H21l-5 4 2 7-6-4.5L6 20l2-7-5-4h6.5z' },
    { id: 'assets', href: '/app/assets', label: 'Assets', icon: 'M4 5h16v14H4zM4 15l4-4 3 3 5-5 4 4' },
    { section: 'Workspace' },
    { id: 'billing', href: '/app/billing', label: 'Plan & usage', icon: 'M3 7h18v10H3zM3 11h18' },
    { id: 'settings', href: '/app/settings', label: 'Settings', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5L7 17M17 17l1.5 1.5M5.5 5.5L7 7' },
    { id: 'help', href: '/app/help', label: 'Help', icon: 'M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4.5M12 18h.01' },
  ];

  const icon = (d) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      ...opts,
    });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Not logged in');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`);
      err.upgradeTo = body.upgradeTo;
      throw err;
    }
    return body;
  }

  function toast(msg, kind = 'ok') {
    let host = document.querySelector('.toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = kind === 'ok' ? `<span class="tick">✓</span>` : `<span>⚠️</span>`;
    el.appendChild(Object.assign(document.createElement('span'), { textContent: msg }));
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function modal({ title, body, actions }) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h2 style="margin-bottom:8px">${title}</h2><div class="muted" style="font-size:13.5px">${body}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`;
      b.textContent = a.label;
      b.onclick = () => {
        back.remove();
        a.onClick && a.onClick();
      };
      row.appendChild(b);
    }
    m.appendChild(row);
    back.appendChild(m);
    back.onclick = (e) => e.target === back && back.remove();
    document.body.appendChild(back);
    return back;
  }

  function upgradeModal(reason, upgradeTo) {
    modal({
      title: 'Upgrade to unlock',
      body: `${esc(reason)}<div style="margin-top:10px" class="faint small">You can change plans anytime from Plan &amp; usage.</div>`,
      actions: [
        { label: 'Not now' },
        { label: `See plans`, primary: true, onClick: () => (location.href = '/app/billing') },
      ],
    });
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const timeAgo = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  function mount(active) {
    const shell = document.querySelector('.shell');
    const side = document.createElement('aside');
    side.className = 'sidebar';
    side.innerHTML = `<a class="logo" href="/app"><span class="logo-mark">R</span><span data-brand-name>ReelForge</span></a>`;
    for (const item of NAV) {
      if (item.section) {
        side.insertAdjacentHTML('beforeend', `<div class="nav-section">${item.section}</div>`);
        continue;
      }
      side.insertAdjacentHTML(
        'beforeend',
        `<a class="nav-item ${item.id === active ? 'active' : ''}" href="${item.href}">${icon(item.icon)}${item.label}</a>`,
      );
    }
    side.insertAdjacentHTML(
      'beforeend',
      `<div class="sidebar-foot">
        <div class="card" style="padding:10px 12px" id="side-usage" hidden>
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600"><span>Exports</span><span class="muted" id="side-usage-num"></span></div>
          <div class="meter" style="margin-top:7px"><div id="side-usage-bar" style="width:0%"></div></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="signout" style="justify-content:flex-start">Sign out</button>
      </div>`,
    );
    shell.prepend(side);
    document.getElementById('signout').onclick = async () => {
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      location.href = '/login';
    };

    // mobile toggle
    const burger = document.createElement('button');
    burger.className = 'btn btn-ghost btn-sm';
    burger.style.cssText = 'position:fixed;top:12px;left:12px;z-index:60;display:none';
    burger.textContent = '☰';
    burger.onclick = () => side.classList.toggle('open');
    document.body.appendChild(burger);
    if (matchMedia('(max-width: 900px)').matches) burger.style.display = 'inline-flex';

    // shared workspace summary (usage meter + plan gates on pages)
    api('/api/workspace')
      .then((ws) => {
        Shell.workspace = ws;
        document.querySelectorAll('[data-brand-name]').forEach((el) => (el.textContent = ws.branding.name));
        const u = ws.usage;
        const box = document.getElementById('side-usage');
        box.hidden = false;
        document.getElementById('side-usage-num').textContent = `${u.used}/${u.limit}`;
        const pct = Math.min(100, (u.used / u.limit) * 100);
        const bar = document.getElementById('side-usage-bar');
        bar.style.width = pct + '%';
        bar.parentElement.classList.toggle('warn', pct >= 75 && pct < 100);
        bar.parentElement.classList.toggle('full', pct >= 100);
        document.dispatchEvent(new CustomEvent('workspace', { detail: ws }));
      })
      .catch(() => {});
  }

  return { mount, api, toast, modal, upgradeModal, esc, timeAgo, workspace: null };
})();
