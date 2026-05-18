/**
 * Blue Moon Publisher — Cloudflare Worker
 *
 * Uses KV only (no R2 bucket needed).
 * Images are stored in KV temporarily, served publicly so Meta can fetch
 * them, then auto-expire after 1 hour.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // ── Serve images stored in KV ─────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname.startsWith('/image/')) {
      const key = 'image:' + decodeURIComponent(url.pathname.slice(7));
      const stored = await env.STORE.get(key);
      if (!stored) return new Response('Not found', { status: 404 });

      const { data, type } = JSON.parse(stored);
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          'Content-Type': type || 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          ...CORS,
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: true, service: 'Blue Moon Publisher' }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    switch (body.action) {
      case 'upload_image':                 return uploadImage(body, env, url);
      case 'delete_image':                 return deleteImage(body, env);
      case 'publish_facebook':             return publishFacebook(body, false);
      case 'schedule_facebook':            return publishFacebook(body, true);
      case 'publish_instagram_container':  return igContainer(body, false);
      case 'schedule_instagram_container': return igContainer(body, true);
      case 'publish_instagram_publish':    return igPublish(body);
      case 'save_posts':                   return savePosts(body, env);
      case 'load_posts':                   return loadPosts(env);
      case 'debug_schedule':               return debugSchedule(body);
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  },
};

// ── Image upload → KV (no R2 needed) ─────────────────────────────────────────

async function uploadImage({ imageBase64, imageType = 'image/jpeg' }, env, url) {
  if (!imageBase64) return json({ success: false, error: 'No image data provided' });

  try {
    const base64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const ext = imageType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const filename = `bm-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // Store in KV — auto-expires after 1 hour (plenty of time for Meta to fetch it)
    await env.STORE.put(
      `image:${filename}`,
      JSON.stringify({ data: base64, type: imageType }),
      { expirationTtl: 3600 }
    );

    const publicUrl = `${url.origin}/image/${filename}`;
    return json({ success: true, url: publicUrl, filename });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

async function deleteImage({ filename }, env) {
  if (!filename) return json({ success: false, error: 'No filename' });
  try {
    await env.STORE.delete(`image:${filename}`);
    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

// ── Facebook ──────────────────────────────────────────────────────────────────

async function publishFacebook({ token, pageId, caption, imageUrl, scheduledTime }, isSchedule) {
  if (!token || !pageId) return json({ success: false, error: 'Missing token or pageId' });

  const schedTs = isSchedule && scheduledTime
    ? Math.floor(new Date(scheduledTime).getTime() / 1000)
    : null;
  const nowTs = Math.floor(Date.now() / 1000);

  if (schedTs && schedTs < nowTs + 600) {
    return json({ success: false, error: 'Scheduled time must be at least 10 minutes from now' });
  }

  try {
    let data;
    if (imageUrl) {
      const params = {
        access_token: token,
        caption,
        url: imageUrl,
        published: isSchedule ? 'false' : 'true',
      };
      if (schedTs) params.scheduled_publish_time = schedTs;
      data = await graphPost(`/${pageId}/photos`, params);
    } else {
      const params = {
        access_token: token,
        message: caption,
        published: isSchedule ? 'false' : 'true',
      };
      if (schedTs) params.scheduled_publish_time = schedTs;
      data = await graphPost(`/${pageId}/feed`, params);
    }
    return json({ success: true, id: data.id || data.post_id });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function igContainer({ token, igId, caption, imageUrl, scheduledTime }, isSchedule) {
  if (!token || !igId)  return json({ success: false, error: 'Missing token or igId' });
  if (!imageUrl)        return json({ success: false, error: 'Instagram requires an image URL' });

  const schedTs = isSchedule && scheduledTime
    ? Math.floor(new Date(scheduledTime).getTime() / 1000)
    : null;

  try {
    const params = { access_token: token, caption, image_url: imageUrl };
    if (schedTs) {
      params.published = 'false';
      params.scheduled_publish_time = schedTs;
    }
    const data = await graphPost(`/${igId}/media`, params);
    return json({ success: true, containerId: data.id });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

async function igPublish({ token, igId, containerId }) {
  if (!token || !igId || !containerId) {
    return json({ success: false, error: 'Missing token, igId, or containerId' });
  }
  try {
    const data = await graphPost(`/${igId}/media_publish`, {
      access_token: token,
      creation_id: containerId,
    });
    return json({ success: true, id: data.id });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

// ── KV post storage ───────────────────────────────────────────────────────────

async function savePosts({ posts, creds }, env) {
  try {
    await env.STORE.put('posts', JSON.stringify(posts || []));
    if (creds) await env.STORE.put('creds', JSON.stringify(creds));
    return json({ success: true });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

async function loadPosts(env) {
  try {
    const raw = await env.STORE.get('posts');
    return json({ success: true, posts: raw ? JSON.parse(raw) : [] });
  } catch (e) {
    return json({ success: true, posts: [] });
  }
}

// ── Debug ─────────────────────────────────────────────────────────────────────

async function debugSchedule({ token, pageId }) {
  try {
    const qs = new URLSearchParams({ access_token: token, fields: 'name,id' });
    const res = await fetch(`${GRAPH}/${pageId}?${qs}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return json({ success: true, page: data });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function graphPost(path, params) {
  const res = await fetch(GRAPH + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
