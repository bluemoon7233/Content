let extractedPosts = [];

// ─── Meta connection status ─────────────────────────────────────────────────
async function checkMetaStatus() {
  const el = document.getElementById('meta-status');
  try {
    const res = await fetch('/api/meta/verify');
    const data = await res.json();
    if (data.connected) {
      el.textContent = `Connected: ${data.page?.name || 'Meta Page'}`;
      el.className = 'connected';
    } else {
      el.textContent = 'Meta: not connected';
      el.className = 'error';
    }
  } catch {
    el.textContent = 'Meta: unavailable';
    el.className = 'error';
  }
}

// ─── Upload / drag & drop ───────────────────────────────────────────────────
const zone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');

zone.addEventListener('click', () => fileInput.click());
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', e => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  const allowed = ['application/pdf', 'text/html', 'application/xhtml+xml'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(file.type) && !['pdf', 'html', 'htm'].includes(ext)) {
    showToast('Please upload a PDF or HTML file.');
    return;
  }

  showProgress(10, 'Reading file…');
  const formData = new FormData();
  formData.append('file', file);

  showProgress(30, 'Extracting content with AI…');
  try {
    const res = await fetch('/api/extract', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Extraction failed');
    }
    showProgress(80, 'Rendering posts…');
    const data = await res.json();
    extractedPosts = data.posts;
    renderSummary(data.raw_summary);
    renderPosts(data.posts);
    showProgress(100, 'Done!');
    setTimeout(() => document.getElementById('progress-bar').style.display = 'none', 600);
  } catch (e) {
    hideProgress();
    showToast(e.message);
  }
}

// ─── Progress ────────────────────────────────────────────────────────────────
function showProgress(pct, label) {
  const bar = document.getElementById('progress-bar');
  bar.style.display = 'block';
  bar.querySelector('.progress-fill').style.width = pct + '%';
  bar.querySelector('#progress-label').textContent = label;
}
function hideProgress() {
  document.getElementById('progress-bar').style.display = 'none';
}

// ─── Summary ─────────────────────────────────────────────────────────────────
function renderSummary(text) {
  const sec = document.getElementById('summary-section');
  sec.style.display = 'block';
  document.getElementById('summary-text').textContent = text;
}

// ─── Posts ───────────────────────────────────────────────────────────────────
function renderPosts(posts) {
  const sec = document.getElementById('posts-section');
  const container = document.getElementById('posts-container');
  container.innerHTML = '';

  posts.forEach((post, i) => {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.dataset.index = i;

    const scheduledVal = post.scheduled_time
      ? new Date(post.scheduled_time).toISOString().slice(0, 16)
      : '';

    card.innerHTML = `
      <div class="post-header">
        <span class="post-number">Post ${i + 1}</span>
        <span class="platform-badge ${post.platform}">${platformLabel(post.platform)}</span>
        <span class="platform-badge" style="background:rgba(99,102,241,0.1);color:#a78bfa">${post.post_type}</span>
      </div>

      <div class="post-row">
        <div class="field-group">
          <div class="field-label">Platform</div>
          <select data-field="platform">
            <option value="both" ${post.platform==='both'?'selected':''}>Both</option>
            <option value="facebook" ${post.platform==='facebook'?'selected':''}>Facebook</option>
            <option value="instagram" ${post.platform==='instagram'?'selected':''}>Instagram</option>
          </select>
        </div>
        <div class="field-group">
          <div class="field-label">Post type</div>
          <select data-field="post_type">
            ${['text','image','video','reel','story'].map(t =>
              `<option value="${t}" ${post.post_type===t?'selected':''}>${t}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">Caption</div>
        <textarea data-field="caption">${escapeHtml(post.caption)}</textarea>
      </div>

      <div class="post-row">
        <div class="field-group">
          <div class="field-label">Hashtags (space-separated)</div>
          <input type="text" data-field="hashtags" value="${(post.hashtags||[]).join(' ')}">
        </div>
        <div class="field-group">
          <div class="field-label">Scheduled time</div>
          <input type="datetime-local" data-field="scheduled_time" value="${scheduledVal}">
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">Image URL (required for Instagram)</div>
        <input type="text" data-field="image_url" placeholder="https://…" value="${post.image_url||''}">
      </div>

      ${post.notes ? `<div class="notes-text">Note: ${escapeHtml(post.notes)}</div>` : ''}
    `;

    // Live sync back to extractedPosts
    card.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => syncPost(i, card));
    });

    container.appendChild(card);
  });

  sec.style.display = 'block';
  document.getElementById('actions-section').style.display = 'block';
  document.getElementById('results-section').style.display = 'none';
}

function syncPost(index, card) {
  const p = extractedPosts[index];
  p.platform = card.querySelector('[data-field=platform]').value;
  p.post_type = card.querySelector('[data-field=post_type]').value;
  p.caption = card.querySelector('[data-field=caption]').value;
  const hashRaw = card.querySelector('[data-field=hashtags]').value;
  p.hashtags = hashRaw.trim() ? hashRaw.trim().split(/\s+/).map(h => h.replace(/^#/, '')) : [];
  const schedVal = card.querySelector('[data-field=scheduled_time]').value;
  p.scheduled_time = schedVal ? new Date(schedVal).toISOString() : null;
  p.image_url = card.querySelector('[data-field=image_url]').value.trim() || null;
}

function platformLabel(p) {
  return { facebook: 'Facebook', instagram: 'Instagram', both: 'Facebook + Instagram' }[p] || p;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function doAction(action) {
  const btns = document.querySelectorAll('.btn');
  btns.forEach(b => b.disabled = true);

  showProgress(20, action === 'publish_now' ? 'Publishing…' : action === 'schedule' ? 'Scheduling…' : 'Saving drafts…');

  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: extractedPosts, action }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Publish failed');
    }
    const data = await res.json();
    showProgress(100, 'Done!');
    setTimeout(() => hideProgress(), 400);
    renderResults(data.results);
  } catch (e) {
    hideProgress();
    showToast(e.message);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

// ─── Results ─────────────────────────────────────────────────────────────────
function renderResults(results) {
  const sec = document.getElementById('results-section');
  sec.style.display = 'block';
  const container = document.getElementById('results-container');
  container.innerHTML = '<h2 style="margin-bottom:1rem;font-size:1.1rem;font-weight:600;">Results</h2>';

  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'result-item';
    const dot = `<span class="status-dot ${r.status}"></span>`;
    const label = `${r.platform} — ${r.status}`;
    const meta = r.meta_id ? `ID: ${r.meta_id}` : (r.error ? r.error : '');
    item.innerHTML = `${dot}<span>${label}</span>${meta ? `<span class="result-meta">${escapeHtml(meta)}</span>` : ''}`;
    container.appendChild(item);
  });

  sec.scrollIntoView({ behavior: 'smooth' });
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.display = 'none', 5000);
}

// ─── Init ────────────────────────────────────────────────────────────────────
checkMetaStatus();
