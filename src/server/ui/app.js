const $ = (sel, el = document) => el.querySelector(sel);

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
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// --- session ---
api('/api/me').then((me) => {
  $('#user-email').textContent = me.email || '';
});
$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login';
});

// --- new job form ---
$('#job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = $('#job-error');
  errEl.hidden = true;
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.fps) data.fps = Number(data.fps);
  if (data.durationTarget) data.durationTarget = Number(data.durationTarget);
  try {
    await api('/api/jobs', { method: 'POST', body: JSON.stringify(data) });
    form.beforeUrl.value = '';
    form.afterUrl.value = '';
    form.clientName.value = '';
    refresh();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

// --- job list ---
const STATUS_LABELS = {
  queued: 'Queued',
  capturing: 'Capturing sites…',
  rendering: 'Rendering…',
  posting: 'Posting…',
  done: 'Done',
  error: 'Failed',
};

function jobCard(job) {
  const el = document.createElement('article');
  el.className = 'card job';
  el.dataset.id = job.id;

  const pct = Math.round((job.progress || 0) * 100);
  const busy = ['queued', 'capturing', 'rendering', 'posting'].includes(job.status);
  const posted = job.postedVia
    ? `<span class="badge badge-done">Posted via ${job.postedVia}</span>`
    : '';

  el.innerHTML = `
    <div class="job-head">
      <div>
        <strong>${escapeHtml(job.params.clientName)}</strong>
        <div class="muted small">${escapeHtml(shortUrl(job.params.beforeUrl))} ➜ ${escapeHtml(shortUrl(job.params.afterUrl))}</div>
      </div>
      <span class="badge badge-${job.status}">${STATUS_LABELS[job.status] || job.status}</span>
    </div>
    ${busy && job.stage ? `<div class="muted small stage">${escapeHtml(job.stage)}</div>` : ''}
    ${
      job.captures
        ? `<div class="thumbs">${['before', 'after']
            .map((k) => {
              const c = job.captures[k];
              if (!c) return '';
              return `<figure>
                <div class="thumb"><img src="/api/jobs/${job.id}/capture/${k}" alt="${k} capture" loading="lazy"></div>
                <figcaption>${k} · ${c.cssWidth}×${c.cssHeight}px · ${c.sections} section${c.sections === 1 ? '' : 's'}${c.mode === 'lite' ? ' · lite mode' : ''}</figcaption>
              </figure>`;
            })
            .join('')}</div>`
        : ''
    }
    ${job.status === 'rendering' ? `<div class="progress"><div style="width:${pct}%"></div></div><div class="muted small">${pct}%</div>` : ''}
    ${busy && job.status !== 'rendering' ? '<div class="progress indeterminate"><div></div></div>' : ''}
    ${job.error ? `<p class="error">${escapeHtml(job.error)}</p>` : ''}
    ${
      job.videoFile && !busy
        ? `<video controls preload="metadata" src="/api/jobs/${job.id}/video"></video>
           <div class="job-actions">
             <a class="btn btn-ghost" href="/api/jobs/${job.id}/video" download="reel-${job.id}.mp4">Download</a>
             ${
               job.postedVia
                 ? posted
                 : `<select class="post-via">
                      <option value="reel">Facebook Reel</option>
                      <option value="facebook">Feed video</option>
                      <option value="make">Make.com</option>
                    </select>
                    <button class="btn btn-primary post-btn">Post</button>`
             }
           </div>`
        : ''
    }
  `;

  const postBtn = $('.post-btn', el);
  if (postBtn) {
    postBtn.addEventListener('click', async () => {
      postBtn.disabled = true;
      postBtn.textContent = 'Posting…';
      try {
        await api(`/api/jobs/${job.id}/post`, {
          method: 'POST',
          body: JSON.stringify({ via: $('.post-via', el).value }),
        });
      } catch (err) {
        alert(`Posting failed: ${err.message}`);
      }
      refresh();
    });
  }
  return el;
}

const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let lastJson = '';
async function refresh() {
  try {
    const jobs = await api('/api/jobs');
    const json = JSON.stringify(jobs);
    if (json === lastJson) return; // avoid re-rendering (and restarting videos) needlessly
    lastJson = json;
    const wrap = $('#jobs');
    wrap.replaceChildren(...jobs.map(jobCard));
    $('#no-jobs').hidden = jobs.length > 0;
  } catch {
    /* transient network error — next poll will retry */
  }
}

refresh();
setInterval(refresh, 2500);
