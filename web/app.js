// DevBrain v2.0 — Frontend Application
// Streaming responses, multimodal input, performance dashboard

const messagesEl = document.getElementById('messages');
const queryInput = document.getElementById('query-input');
const sendBtn = document.getElementById('send-btn');
const reindexBtn = document.getElementById('reindex-btn');
const logsBtn = document.getElementById('logs-btn');
const logsModal = document.getElementById('logs-modal');
const closeLogs = document.getElementById('close-logs');
const logsContent = document.getElementById('logs-content');
const imageBtn = document.getElementById('image-btn');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const previewImg = document.getElementById('preview-img');
const removeImage = document.getElementById('remove-image');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const exportBtn = document.getElementById('export-btn');

let queryCount = 0;
let attachedImage = null; // { data: base64, mimeType: string }
let isProcessing = false; // Lock to prevent concurrent queries
let conversationHistory = []; // Persist conversations

// === LOAD CONVERSATION FROM STORAGE ===
function loadHistory() {
  try {
    const saved = localStorage.getItem('devbrain-history');
    if (saved) {
      conversationHistory = JSON.parse(saved);
      for (const msg of conversationHistory) {
        addMessageToDOM(msg.type, msg.content, msg.meta, false);
      }
    }
  } catch { /* ignore */ }
}

function saveHistory() {
  try {
    // Keep last 50 messages to avoid storage bloat
    const toSave = conversationHistory.slice(-50);
    localStorage.setItem('devbrain-history', JSON.stringify(toSave));
  } catch { /* ignore */ }
}

// === MARKDOWN RENDERING ===
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks with copy button
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const id = 'code-' + Math.random().toString(36).slice(2, 8);
    return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-btn" onclick="copyCode('${id}')">Copy</button></div><pre class="code-block" id="${id}"><code>${code.trim()}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Tables
  html = renderTables(html);

  // Numbered lists
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li class="ol-item" value="$1">$2</li>');
  html = html.replace(/((<li class="ol-item"[^>]*>.*<\/li>\s*)+)/g, '<ol>$1</ol>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((<li>.*<\/li>\s*)+)/g, (match) => {
    if (match.includes('class="ol-item"')) return match;
    return `<ul>${match}</ul>`;
  });

  // Line breaks (but not inside pre/table)
  html = html.replace(/\n/g, '<br>');

  return html;
}

function renderTables(html) {
  const lines = html.split('\n');
  let result = [];
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      // Check if separator row
      if (/^\|[\s\-:|]+\|$/.test(line)) {
        // Skip separator row
        continue;
      }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(cells);
    } else {
      if (inTable) {
        result.push(buildTable(tableRows));
        inTable = false;
        tableRows = [];
      }
      result.push(lines[i]);
    }
  }
  if (inTable) {
    result.push(buildTable(tableRows));
  }
  return result.join('\n');
}

function buildTable(rows) {
  if (rows.length === 0) return '';
  let html = '<table class="md-table"><thead><tr>';
  // First row is header
  for (const cell of rows[0]) {
    html += `<th>${cell}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>';
    for (const cell of rows[i]) {
      html += `<td>${cell}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = el.parentElement.querySelector('.copy-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }
  });
}
// Make copyCode available globally
window.copyCode = copyCode;

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// === MESSAGE RENDERING ===
function addMessageToDOM(type, content, meta = null, save = true) {
  const div = document.createElement('div');
  div.className = `message ${type}`;

  let html = '';

  // Agent pipeline visualization
  if (meta?.steps?.length) {
    html += `<div class="pipeline">`;
    for (let i = 0; i < meta.steps.length; i++) {
      const step = meta.steps[i];
      const label = step.agent + (step.action ? `: ${step.action}` : step.intent ? `: ${step.intent}` : '');
      html += `<span class="pipeline-step">${escapeHtml(label)}</span>`;
      if (i < meta.steps.length - 1) html += `<span class="pipeline-arrow">→</span>`;
    }
    html += `</div>`;
  }

  // Content
  if (type === 'assistant') {
    html += `<div class="content markdown">${renderMarkdown(content)}</div>`;
  } else {
    html += `<div class="content">${escapeHtml(content)}</div>`;
  }

  // Metadata bar
  if (meta) {
    html += `<div class="meta">`;
    if (meta.intent) html += `<span class="tag intent">${meta.intent}</span>`;
    if (meta.durationMs) html += `<span class="tag duration">${(meta.durationMs / 1000).toFixed(1)}s</span>`;
    if (meta.security?.warnings?.length) {
      html += `<span class="tag security">⚠ Security: ${meta.security.warnings.length} warning(s)</span>`;
    }
    html += `</div>`;
  }

  div.innerHTML = html;
  messagesEl.appendChild(div);
  scrollToBottom();

  // Save to history
  if (save) {
    conversationHistory.push({ type, content, meta });
    saveHistory();
  }

  return div;
}

function addMessage(type, content, meta = null) {
  return addMessageToDOM(type, content, meta, true);
}

function createStreamingMessage() {
  const div = document.createElement('div');
  div.className = 'message assistant streaming';
  div.innerHTML = `
    <div class="pipeline" id="stream-pipeline"></div>
    <div class="progress-status" id="stream-progress"><span class="spinner"></span> <span class="progress-text">Starting...</span> <span class="elapsed" id="stream-elapsed">0s</span></div>
    <div class="content markdown" id="stream-content"></div>
    <div class="meta" id="stream-meta"></div>
  `;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

// === STREAMING QUERY ===
async function sendStreamingQuery() {
  const query = queryInput.value.trim();
  if (!query) return;
  if (isProcessing) return;

  isProcessing = true;
  queryInput.value = '';
  queryInput.style.height = 'auto';
  sendBtn.disabled = true;
  queryInput.disabled = true;
  queryInput.placeholder = 'Waiting for response...';

  addMessage('user', query);

  // Show image if attached
  if (attachedImage) {
    const imgMsg = document.createElement('div');
    imgMsg.className = 'message user';
    imgMsg.innerHTML = `<div class="content"><img src="data:${attachedImage.mimeType};base64,${attachedImage.data}" class="attached-img" alt="Attached"></div>`;
    messagesEl.appendChild(imgMsg);
  }

  const streamDiv = createStreamingMessage();
  const contentEl = streamDiv.querySelector('#stream-content');
  const pipelineEl = streamDiv.querySelector('#stream-pipeline');
  const metaEl = streamDiv.querySelector('#stream-meta');
  const elapsedEl = streamDiv.querySelector('#stream-elapsed');
  let fullText = '';

  // Elapsed timer
  const startTime = Date.now();
  const elapsedTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsedEl) elapsedEl.textContent = `${elapsed}s`;
  }, 1000);

  try {
    const res = await fetch('/api/query/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        imageData: attachedImage?.data,
        imageMimeType: attachedImage?.mimeType,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      contentEl.innerHTML = `<span class="error">Error: ${escapeHtml(err.error)}</span>`;
      clearInterval(elapsedTimer);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));

          if (event.type === 'progress') {
            const progressEl = streamDiv.querySelector('#stream-progress');
            const progressText = progressEl.querySelector('.progress-text');
            progressText.textContent = event.message || event.step;
            // Build pipeline as steps arrive
            if (event.step === 'router_done' && event.intent) {
              pipelineEl.innerHTML = `<span class="pipeline-step">router: ${escapeHtml(event.intent)}</span>`;
            } else if (event.step === 'rag_done') {
              pipelineEl.innerHTML += `<span class="pipeline-arrow">→</span><span class="pipeline-step">rag: ${event.resultsCount} results</span>`;
            } else if (event.step === 'generating') {
              pipelineEl.innerHTML += `<span class="pipeline-arrow">→</span><span class="pipeline-step generating">generating...</span>`;
            }
            scrollToBottom();
          } else if (event.type === 'token') {
            // Hide progress indicator once tokens start flowing
            const progressEl = streamDiv.querySelector('#stream-progress');
            if (progressEl) progressEl.style.display = 'none';
            fullText += event.token;
            contentEl.innerHTML = renderMarkdown(fullText) + '<span class="cursor">▊</span>';
            scrollToBottom();
          } else if (event.type === 'done') {
            clearInterval(elapsedTimer);
            // Finalize
            contentEl.innerHTML = renderMarkdown(fullText);
            streamDiv.classList.remove('streaming');

            // Show pipeline
            if (event.steps?.length) {
              let pipeHtml = '';
              for (let i = 0; i < event.steps.length; i++) {
                const s = event.steps[i];
                const label = s.agent + (s.action ? `: ${s.action}` : s.intent ? `: ${s.intent}` : '');
                pipeHtml += `<span class="pipeline-step">${escapeHtml(label)}</span>`;
                if (i < event.steps.length - 1) pipeHtml += `<span class="pipeline-arrow">→</span>`;
              }
              pipelineEl.innerHTML = pipeHtml;
            }

            // Show metadata
            let metaHtml = '';
            if (event.intent) metaHtml += `<span class="tag intent">${event.intent}</span>`;
            if (event.durationMs) metaHtml += `<span class="tag duration">${(event.durationMs / 1000).toFixed(1)}s</span>`;
            metaEl.innerHTML = metaHtml;

            queryCount++;

            // Save to history
            conversationHistory.push({
              type: 'assistant',
              content: fullText,
              meta: { intent: event.intent, durationMs: event.durationMs, steps: event.steps },
            });
            saveHistory();
          } else if (event.type === 'error') {
            clearInterval(elapsedTimer);
            contentEl.innerHTML = `<span class="error">Error: ${escapeHtml(event.error)}</span>`;
            streamDiv.classList.remove('streaming');
          }
        } catch {
          // ignore malformed events
        }
      }
    }

    // If stream ended without 'done' event
    if (streamDiv.classList.contains('streaming')) {
      clearInterval(elapsedTimer);
      contentEl.innerHTML = renderMarkdown(fullText) || '<em>No response</em>';
      streamDiv.classList.remove('streaming');
    }

  } catch (err) {
    clearInterval(elapsedTimer);
    contentEl.innerHTML = `<span class="error">Connection error: ${escapeHtml(err.message)}</span>`;
    streamDiv.classList.remove('streaming');
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    queryInput.disabled = false;
    queryInput.placeholder = 'Ask about your codebase... (drop images here)';
    queryInput.focus();
    clearImage();
  }
}

// === IMAGE HANDLING ===
function clearImage() {
  attachedImage = null;
  imagePreview.classList.add('hidden');
  previewImg.src = '';
  imageInput.value = '';
}

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1];
    attachedImage = { data: base64, mimeType: file.type };
    previewImg.src = e.target.result;
    imagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

imageBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleImageFile(e.target.files[0]);
});
removeImage.addEventListener('click', clearImage);

// Drag and drop
const chatArea = document.querySelector('.chat-area');
chatArea.addEventListener('dragover', (e) => { e.preventDefault(); chatArea.classList.add('dragover'); });
chatArea.addEventListener('dragleave', () => chatArea.classList.remove('dragover'));
chatArea.addEventListener('drop', (e) => {
  e.preventDefault();
  chatArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

// === VOICE INPUT ===
let mediaRecorder = null;
let audioChunks = [];

micBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    micBtn.classList.remove('recording');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      queryInput.value = '[Voice input captured — STT processing on device]';
      queryInput.focus();
    };

    mediaRecorder.start();
    micBtn.classList.add('recording');
  } catch {
    addMessage('system', 'Microphone access denied. Please allow microphone access.');
  }
});

// === CLEAR CHAT ===
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    // Keep only the welcome message
    messagesEl.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'message system';
    welcome.innerHTML = `<div class="content"><strong>Welcome to DevBrain v2.0</strong><br>Chat cleared. Ask questions about your indexed codebase.</div>`;
    messagesEl.appendChild(welcome);
    conversationHistory = [];
    saveHistory();
  });
}

// === EXPORT CONVERSATION ===
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    if (conversationHistory.length === 0) {
      addMessage('system', 'Nothing to export.');
      return;
    }
    let md = '# DevBrain Conversation Export\n\n';
    md += `Exported: ${new Date().toLocaleString()}\n\n---\n\n`;
    for (const msg of conversationHistory) {
      if (msg.type === 'user') {
        md += `## User\n\n${msg.content}\n\n`;
      } else if (msg.type === 'assistant') {
        md += `## DevBrain`;
        if (msg.meta?.intent) md += ` (${msg.meta.intent})`;
        if (msg.meta?.durationMs) md += ` — ${(msg.meta.durationMs / 1000).toFixed(1)}s`;
        md += `\n\n${msg.content}\n\n---\n\n`;
      }
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devbrain-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// === EVENT LISTENERS ===
sendBtn.addEventListener('click', sendStreamingQuery);

queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendStreamingQuery();
  }
});

queryInput.addEventListener('input', () => {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 150) + 'px';
});

// Paste image from clipboard
queryInput.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      handleImageFile(item.getAsFile());
      break;
    }
  }
});

reindexBtn.addEventListener('click', async () => {
  reindexBtn.disabled = true;
  reindexBtn.textContent = 'Indexing...';
  try {
    const res = await fetch('/api/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (data.error) {
      addMessage('system', `Indexing error: ${data.error}`);
    } else {
      addMessage('system', `Re-indexed ${data.filesCount} files (${data.chunksCount} chunks)`);
      document.getElementById('file-count').textContent = data.filesCount;
      document.getElementById('chunk-count').textContent = data.chunksCount;
    }
  } catch (err) {
    addMessage('system', `Indexing failed: ${err.message}`);
  } finally {
    reindexBtn.disabled = false;
    reindexBtn.textContent = 'Re-index';
  }
});

logsBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/logs?limit=200');
    const logs = await res.json();
    logsContent.textContent = JSON.stringify(logs, null, 2);
    logsModal.classList.remove('hidden');
  } catch (err) {
    addMessage('system', `Failed to load logs: ${err.message}`);
  }
});

closeLogs.addEventListener('click', () => logsModal.classList.add('hidden'));
logsModal.addEventListener('click', (e) => { if (e.target === logsModal) logsModal.classList.add('hidden'); });

// === STATUS POLLING ===
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

async function updateStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Models
    const modelList = document.getElementById('model-list');
    const models = data.models || {};
    const modelKeys = Object.keys(models);
    if (modelKeys.length > 0) {
      modelList.innerHTML = modelKeys.map((key) => {
        return `<div class="status-item model-item">
          <span class="model-dot active"></span>
          <span class="label">${key}</span>
        </div>`;
      }).join('');
    }

    // Index
    if (data.index) {
      document.getElementById('file-count').textContent = data.index.filesCount || 0;
      document.getElementById('chunk-count').textContent = data.index.chunksCount || 0;
    }

    // P2P
    if (data.p2p) {
      document.getElementById('p2p-status').textContent = data.p2p.running ? 'Active' : 'Inactive';
      document.getElementById('p2p-status').className = `value ${data.p2p.running ? 'active' : ''}`;
      document.getElementById('p2p-peers').textContent = data.p2p.connectedPeers || 0;
      if (data.p2p.publicKey) {
        document.getElementById('p2p-key-container').classList.remove('hidden');
        document.getElementById('p2p-key').textContent = data.p2p.publicKey.slice(0, 20) + '...';
      }
    }

    // Watcher
    if (data.watcher) {
      document.getElementById('watcher-status').textContent = data.watcher.running ? 'Active' : 'Off';
    }

    // Session stats
    if (data.session) {
      document.getElementById('avg-tps').textContent = data.session.avgTps || '--';
      document.getElementById('avg-ttft').textContent = data.session.avgTtft || '--';
      document.getElementById('total-queries').textContent = data.session.totalInferences || 0;
      document.getElementById('uptime').textContent = formatUptime(data.session.uptime || 0);
    }
  } catch {
    // server not ready
  }
}

// === FILE CHANGE EVENTS ===
const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  try {
    const change = JSON.parse(e.data);
    const el = document.getElementById('file-changes');
    const text = document.getElementById('change-text');
    text.textContent = `${change.type}: ${change.relPath}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  } catch {
    // ignore
  }
};

// === KEYBOARD SHORTCUTS ===
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + K to focus input
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    queryInput.focus();
  }
  // Escape to close modals
  if (e.key === 'Escape') {
    logsModal.classList.add('hidden');
  }
});

// Initial status + polling + load history
loadHistory();
updateStatus();
setInterval(updateStatus, 5000);
