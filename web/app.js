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
const benchmarkBtn = document.getElementById('benchmark-btn');
const benchmarkModal = document.getElementById('benchmark-modal');
const closeBenchmark = document.getElementById('close-benchmark');
const benchmarkContent = document.getElementById('benchmark-content');
const mobileNavToggle = document.getElementById('mobile-nav-toggle');

let queryCount = 0;
let attachedImage = null;
let isProcessing = false;
let conversationHistory = [];

const codeHealth = { critical: 0, warning: 0, info: 0, clean: 0, issues: [] };

function updateHealthDisplay() {
  const total = codeHealth.critical + codeHealth.warning + codeHealth.info + codeHealth.clean;
  const score = total === 0 ? 100 : Math.max(0, Math.round(
    100 - (codeHealth.critical * 25 + codeHealth.warning * 10 + codeHealth.info * 2)
  ));

  const scoreEl = document.getElementById('health-score');
  const barEl = document.getElementById('health-bar');
  scoreEl.textContent = total === 0 ? '--' : score;
  scoreEl.className = 'health-score ' + (score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad');
  barEl.style.width = (total === 0 ? 100 : score) + '%';
  barEl.className = 'health-bar ' + (score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad');

  document.getElementById('critical-count').textContent = codeHealth.critical;
  document.getElementById('warning-count').textContent = codeHealth.warning;
  document.getElementById('info-count').textContent = codeHealth.info;
  document.getElementById('clean-count').textContent = codeHealth.clean;
}

if (typeof marked !== 'undefined') {
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight: null,
  });
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    if (typeof marked !== 'undefined') {
      let html = marked.parse(text);
      html = html.replace(/<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g, (_, lang, code) => {
        const id = 'code-' + Math.random().toString(36).slice(2, 8);
        return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'code'}</span><button class="copy-btn" onclick="copyCode('${id}')">Copy</button></div><pre class="code-block" id="${id}"><code>${code}</code></pre></div>`;
      });
      return html;
    }
  } catch { /* fallback below */ }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = el.parentElement.querySelector('.copy-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }
  });
}
window.copyCode = copyCode;

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
    const toSave = conversationHistory.slice(-50);
    localStorage.setItem('devbrain-history', JSON.stringify(toSave));
  } catch { /* ignore */ }
}

async function speakText(btn) {
  const text = btn.getAttribute('data-text');
  if (!text) return;
  btn.disabled = true;
  btn.style.opacity = '0.5';
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.headers.get('Content-Type')?.includes('audio')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      if (data.error) addMessage('system', `TTS: ${data.error}`);
    }
  } catch (err) {
    addMessage('system', `TTS unavailable: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}
window.speakText = speakText;

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessageToDOM(type, content, meta = null, save = true) {
  const div = document.createElement('div');
  div.className = `message ${type}`;

  let html = '';

  if (meta?.steps?.length) {
    html += `<div class="pipeline">`;
    for (let i = 0; i < meta.steps.length; i++) {
      const step = meta.steps[i];
      const label = step.agent + (step.action ? `: ${step.action}` : step.intent ? `: ${step.intent}` : '');
      const agentClass = `agent-${step.agent}`;
      html += `<span class="pipeline-step ${agentClass}" style="animation-delay: ${i * 0.1}s">${escapeHtml(label)}</span>`;
      if (i < meta.steps.length - 1) html += `<span class="pipeline-arrow">&#8594;</span>`;
    }
    html += `</div>`;
  }

  if (type === 'assistant') {
    html += `<div class="content markdown">${renderMarkdown(content)}</div>`;
    const safeText = escapeHtml(content.slice(0, 500)).replace(/"/g, '&quot;');
    html += `<button class="btn-tts" onclick="speakText(this)" data-text="${safeText}" title="Read aloud (TTS)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
    </button>`;
  } else {
    html += `<div class="content">${escapeHtml(content)}</div>`;
  }

  if (meta) {
    html += `<div class="meta">`;
    if (meta.intent) html += `<span class="tag intent">${meta.intent}</span>`;
    if (meta.durationMs) html += `<span class="tag duration">${(meta.durationMs / 1000).toFixed(1)}s</span>`;
    if (meta.steps?.length > 2) html += `<span class="tag agents">${meta.steps.length} agents</span>`;
    if (meta.security?.warnings?.length) {
      html += `<span class="tag security">&#9888; Security: ${meta.security.warnings.length} warning(s)</span>`;
    }
    html += `</div>`;
  }

  div.innerHTML = html;
  messagesEl.appendChild(div);
  scrollToBottom();

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
    let pipelineSteps = [];

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

            if (event.step === 'router_done' && event.intent) {
              pipelineSteps.push({ agent: 'router', label: event.intent });
              renderPipeline(pipelineEl, pipelineSteps, true);
            } else if (event.step === 'rag_done') {
              pipelineSteps.push({ agent: 'rag', label: `${event.resultsCount} results` });
              renderPipeline(pipelineEl, pipelineSteps, true);
            } else if (event.step === 'rerank') {
              pipelineSteps.push({ agent: 'reranker', label: 're-ranking' });
              renderPipeline(pipelineEl, pipelineSteps, true);
            } else if (event.step === 'tool_search' || event.step === 'tool_verify' || event.step === 'tool_read') {
              pipelineSteps.push({ agent: 'tool', label: event.message });
              renderPipeline(pipelineEl, pipelineSteps, true);
            } else if (event.step === 'generating') {
              const label = (event.message || '').includes('MedPsy') ? 'MedPsy review' : 'generating';
              const agent = (event.message || '').includes('MedPsy') ? 'review' : 'llm';
              pipelineSteps.push({ agent, label });
              renderPipeline(pipelineEl, pipelineSteps, true);
            }
            scrollToBottom();
          } else if (event.type === 'token') {
            const progressEl = streamDiv.querySelector('#stream-progress');
            if (progressEl) progressEl.style.display = 'none';
            fullText += event.token;
            contentEl.innerHTML = renderMarkdown(fullText) + '<span class="cursor">&#9610;</span>';
            scrollToBottom();
          } else if (event.type === 'done') {
            clearInterval(elapsedTimer);
            contentEl.innerHTML = renderMarkdown(fullText);
            streamDiv.classList.remove('streaming');

            if (event.steps?.length) {
              renderPipeline(pipelineEl, event.steps.map(s => ({
                agent: s.agent,
                label: s.action || s.intent || ''
              })), false);
            }

            let metaHtml = '';
            if (event.intent) metaHtml += `<span class="tag intent">${event.intent}</span>`;
            if (event.durationMs) metaHtml += `<span class="tag duration">${(event.durationMs / 1000).toFixed(1)}s</span>`;
            if (event.steps?.length > 2) metaHtml += `<span class="tag agents">${event.steps.length} agents</span>`;
            metaEl.innerHTML = metaHtml;

            queryCount++;
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

function renderPipeline(el, steps, animating) {
  let html = '';
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isLast = i === steps.length - 1;
    const agentClass = `agent-${s.agent}`;
    const animClass = (animating && isLast) ? ' active' : '';
    html += `<span class="pipeline-step ${agentClass}${animClass}" style="animation-delay: ${i * 0.08}s">${escapeHtml(s.agent)}${s.label ? ': ' + escapeHtml(s.label) : ''}</span>`;
    if (!isLast) html += `<span class="pipeline-arrow">&#8594;</span>`;
  }
  el.innerHTML = html;
}

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

const chatArea = document.querySelector('.chat-area');
chatArea.addEventListener('dragover', (e) => { e.preventDefault(); chatArea.classList.add('dragover'); });
chatArea.addEventListener('dragleave', () => chatArea.classList.remove('dragover'));
chatArea.addEventListener('drop', (e) => {
  e.preventDefault();
  chatArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

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

      addMessage('system', 'Transcribing voice input on-device (Whisper)...');
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64 }),
        });
        const data = await res.json();
        if (data.text && data.text.trim()) {
          queryInput.value = data.text.trim();
          queryInput.style.height = 'auto';
          queryInput.style.height = Math.min(queryInput.scrollHeight, 150) + 'px';
          addMessage('system', `Transcribed: "${data.text.trim()}" \u2014 press Enter to send.`);
        } else if (data.error) {
          addMessage('system', `STT error: ${data.error}`);
        } else {
          addMessage('system', 'Could not transcribe audio. Try speaking more clearly.');
        }
      } catch (err) {
        addMessage('system', `STT unavailable: ${err.message}. Type your question instead.`);
      }
    };

    mediaRecorder.start();
    micBtn.classList.add('recording');
    addMessage('system', 'Recording... click mic again to stop.');
  } catch {
    addMessage('system', 'Microphone access denied. Please allow microphone access.');
  }
});

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'message system';
    welcome.innerHTML = `<div class="content"><strong>DevBrain v2.0</strong><br>Chat cleared. Ask questions about your indexed codebase.</div>`;
    messagesEl.appendChild(welcome);
    conversationHistory = [];
    saveHistory();
  });
}

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
        if (msg.meta?.durationMs) md += ` \u2014 ${(msg.meta.durationMs / 1000).toFixed(1)}s`;
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

    // Code health from status
    if (data.codeHealth) {
      Object.assign(codeHealth, data.codeHealth);
      updateHealthDisplay();
    }
  } catch {
    // server not ready
  }
}

const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  try {
    const change = JSON.parse(e.data);

    if (change.type === 'smell') {
      // Track code health
      const issueText = (change.issues || '').toUpperCase();
      if (issueText.includes('CRITICAL')) codeHealth.critical++;
      else if (issueText.includes('WARNING')) codeHealth.warning++;
      else codeHealth.info++;
      codeHealth.issues.push({ file: change.filePath, time: Date.now(), issues: change.issues });
      if (codeHealth.issues.length > 50) codeHealth.issues.shift();
      updateHealthDisplay();

      // Code smell detected — show as proactive alert
      const alertDiv = document.createElement('div');
      alertDiv.className = 'message smell-alert';
      alertDiv.innerHTML = `
        <div class="smell-header">
          <span class="smell-icon">&#9888;</span>
          <strong>Code Issue Detected</strong>
          <span class="smell-file">${escapeHtml(change.filePath)}</span>
        </div>
        <div class="content markdown">${renderMarkdown(change.issues)}</div>
      `;
      messagesEl.appendChild(alertDiv);
      scrollToBottom();
      conversationHistory.push({ type: 'smell', content: `[${change.filePath}] ${change.issues}`, meta: null });
      saveHistory();
      return;
    }

    if (change.type === 'smell_clean') {
      codeHealth.clean++;
      updateHealthDisplay();
      return;
    }

    const el = document.getElementById('file-changes');
    const text = document.getElementById('change-text');
    text.textContent = `${change.type}: ${change.relPath}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  } catch {
    // ignore
  }
};

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    queryInput.focus();
  }
  if (e.key === 'Escape') {
    logsModal.classList.add('hidden');
  }
});

document.querySelectorAll('.quick-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const q = btn.getAttribute('data-query');
    if (q && !isProcessing) {
      queryInput.value = q;
      sendStreamingQuery();
    }
  });
});

if (benchmarkBtn) {
  benchmarkBtn.addEventListener('click', () => {
    benchmarkContent.innerHTML = `
      <div style="text-align:center; padding:30px;">
        <div class="spinner" style="width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 12px;"></div>
        <p>Running 5 benchmark queries...</p>
      </div>`;
    benchmarkModal.classList.remove('hidden');

    fetch('/api/benchmark')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          benchmarkContent.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
          return;
        }
        renderBenchmarkResults(data);
      })
      .catch((err) => {
        benchmarkContent.innerHTML = `<p class="error">Benchmark failed: ${escapeHtml(err.message)}</p>`;
      });
  });
}

if (closeBenchmark) {
  closeBenchmark.addEventListener('click', () => benchmarkModal.classList.add('hidden'));
  benchmarkModal.addEventListener('click', (e) => { if (e.target === benchmarkModal) benchmarkModal.classList.add('hidden'); });
}

function renderBenchmarkResults(data) {
  const s = data.summary;
  const c = data.comparison;
  let html = `
    <div class="benchmark-grid">
      <div class="benchmark-card">
        <h4>Avg TTFT</h4>
        <span class="bm-value">${s.avgTtft}ms</span>
      </div>
      <div class="benchmark-card">
        <h4>Avg TPS</h4>
        <span class="bm-value">${s.avgTps}</span>
      </div>
      <div class="benchmark-card">
        <h4>Avg Latency</h4>
        <span class="bm-value">${s.avgLatencyMs}ms</span>
      </div>
      <div class="benchmark-card">
        <h4>Queries Run</h4>
        <span class="bm-value">${data.queriesRun}</span>
      </div>
    </div>

    <h3 style="font-size:0.85rem; margin:16px 0 8px;">Query Results</h3>
    <table class="benchmark-table">
      <thead><tr><th>Query</th><th>TTFT</th><th>TPS</th><th>Latency</th><th>Tokens</th></tr></thead>
      <tbody>
        ${data.results.map((r) => `<tr>
          <td>${escapeHtml(r.label)}</td>
          <td>${r.ttft || '--'}ms</td>
          <td>${r.tps || '--'}</td>
          <td>${r.durationMs}ms</td>
          <td>${r.tokensIn}/${r.tokensOut}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="benchmark-comparison">
      <div class="comparison-card local">
        <h4>DevBrain (Local)</h4>
        <div class="comp-row"><span class="comp-label">Cost</span><span class="comp-value" style="color:var(--success)">${c.local.cost}</span></div>
        <div class="comp-row"><span class="comp-label">Avg Latency</span><span class="comp-value">${c.local.avgLatencyMs}ms</span></div>
        <div class="comp-row"><span class="comp-label">Privacy</span><span class="comp-value" style="font-size:0.7rem">${c.local.privacy}</span></div>
        <div class="comp-row"><span class="comp-label">Models</span><span class="comp-value" style="font-size:0.65rem">${c.local.modelsLoaded.join(', ')}</span></div>
      </div>
      <div class="comparison-card cloud">
        <h4>Cloud API (Estimated)</h4>
        <div class="comp-row"><span class="comp-label">Cost</span><span class="comp-value" style="color:var(--error)">${c.cloud.estimatedCost}</span></div>
        <div class="comp-row"><span class="comp-label">Avg Latency</span><span class="comp-value">${c.cloud.avgLatencyMs}ms</span></div>
        <div class="comp-row"><span class="comp-label">Privacy</span><span class="comp-value" style="font-size:0.7rem">${c.cloud.privacy}</span></div>
        <div class="comp-row"><span class="comp-label">Note</span><span class="comp-value" style="font-size:0.6rem">${c.cloud.note}</span></div>
      </div>
    </div>
  `;
  benchmarkContent.innerHTML = html;
}

if (mobileNavToggle) {
  mobileNavToggle.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('mobile-open')) {
      sidebar.classList.remove('mobile-open');
      document.querySelector('.sidebar-overlay')?.remove();
    } else {
      sidebar.classList.add('mobile-open');
      const overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        overlay.remove();
      });
      document.body.appendChild(overlay);
    }
  });

  function checkMobile() {
    if (window.innerWidth <= 768) {
      mobileNavToggle.classList.remove('hidden');
    } else {
      mobileNavToggle.classList.add('hidden');
      document.querySelector('.sidebar')?.classList.remove('mobile-open');
      document.querySelector('.sidebar-overlay')?.remove();
    }
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);
}

function displayLanUrl() {
  const lanEl = document.getElementById('lan-url');
  if (!lanEl) return;
  const host = location.hostname;
  const port = location.port || '3000';
  if (host !== 'localhost' && host !== '127.0.0.1') {
    lanEl.textContent = `${host}:${port}`;
  } else {
    lanEl.textContent = `localhost:${port}`;
    lanEl.title = 'Access from phone using your LAN IP';
  }
}
displayLanUrl();

// Initial status + polling + load history
loadHistory();
updateStatus();
setInterval(updateStatus, 5000);
