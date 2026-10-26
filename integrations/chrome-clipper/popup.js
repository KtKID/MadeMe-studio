import { clipMarkdown, createDraft, draftInput, hostPermissionPattern, normalizeSiteUrl, normalizeToken } from '../shared/client.ts';

const el = id => document.getElementById(id);
let connection = null;
let busy = false;
let saved = false;
function status(message, error = false) { el('status').textContent = message; el('status').dataset.error = String(error); }
function updateSave() { el('save').disabled = busy || saved || !connection || !el('title').value.trim() || !el('markdown').value.trim(); }
function resetResult() { if (!busy) { saved = false; el('studio').hidden = true; } updateSave(); }

// 凭据仅暴露给扩展可信上下文；网页没有常驻脚本。
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const stored = await chrome.storage.local.get(['site', 'token']);
if (stored.site && stored.token) {
  try { connection = { site: normalizeSiteUrl(stored.site), token: normalizeToken(stored.token) }; } catch { /* 无效配置需重新输入。 */ }
}
el('site').value = connection?.site || '';
el('token').value = connection?.token || '';
el('connection').open = !connection;
// 更改目标站点时不能静默复用原站点凭据。
el('site').addEventListener('input', () => { el('token').value = ''; connection = null; updateSave(); });
el('token').addEventListener('input', () => { connection = null; updateSave(); });
el('title').addEventListener('input', resetResult);
el('markdown').addEventListener('input', resetResult);

el('connect').addEventListener('click', async () => {
  if (busy) return;
  try {
    const next = { site: normalizeSiteUrl(el('site').value), token: normalizeToken(el('token').value) };
    // 必须在用户点击回调内、其他 await 之前申请具体站点权限。
    const allowed = await chrome.permissions.request({ origins: [hostPermissionPattern(next.site)] });
    if (!allowed) throw new Error('Site permission was not granted. Nothing was sent.');
    const previous = await chrome.storage.local.get('site');
    await chrome.storage.local.set(next);
    if (previous.site) {
      try {
        const old = hostPermissionPattern(previous.site);
        if (old !== hostPermissionPattern(next.site)) await chrome.permissions.remove({ origins: [old] });
      } catch { /* 旧授权移除失败不阻断新连接；仍可在扩展设置中撤销。 */ }
    }
    connection = next;
    el('connection').open = false;
    status('Connection saved locally. Review the content, then save a draft.');
    updateSave();
  } catch (error) { status(error.message, true); }
});

el('forget').addEventListener('click', async () => {
  if (busy) return;
  try {
    const old = await chrome.storage.local.get('site');
    await chrome.storage.local.remove(['site', 'token']);
    connection = null; el('site').value = ''; el('token').value = ''; updateSave();
    if (old.site) await chrome.permissions.remove({ origins: [hostPermissionPattern(old.site)] });
    status('Local credentials and site permission removed. Revoke the token in Studio if needed.');
  } catch { status('Credentials were cleared where possible. Review extension permissions and revoke the token in Studio.', true); }
});

el('clip-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!connection || busy || saved) return;
  try {
    const input = draftInput({ title: el('title').value, markdown: el('markdown').value });
    busy = true; updateSave();
    if (!await chrome.permissions.contains({ origins: [hostPermissionPattern(connection.site)] })) {
      throw new Error('Site access was removed. Use Connection settings to grant it again.');
    }
    status('Saving your draft… Keep this popup open until it finishes.');
    const result = await createDraft({ ...connection, ...input });
    saved = true;
    status(`Private draft saved (version ${result.version}). Nothing has been published.`);
    el('studio').href = result.studioUrl; el('studio').hidden = false;
  } catch (error) { status(error.message, true); }
  finally { busy = false; updateSave(); }
});

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('Open an ordinary web page first. Browser settings and extension pages cannot be clipped.');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // 不读取表单内容、隐藏 DOM、网页 HTML 或 iframe。
      const target = document.activeElement;
      if (target?.closest('input, textarea, [contenteditable]')) return { text: '', truncated: false };
      const selected = window.getSelection()?.toString() || '';
      return { text: selected.slice(0, 100_000), truncated: selected.length > 100_000 };
    },
  });
  el('title').value = (tab.title || 'Saved page').slice(0, 240);
  const captured = result?.result || { text: '', truncated: false };
  el('markdown').value = clipMarkdown(captured.text, tab.url);
  status(captured.truncated ? 'Long selection: only the first 100,000 characters are included. Review before saving.' : captured.text ? 'Selection captured. Review it before saving.' : 'No text selected. You can save the page link or add text above.');
} catch (error) { status(error.message || 'This page cannot be clipped. You can enter content manually.', true); }
updateSave();
