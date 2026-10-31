(() => {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tabId'));
  const format = params.get('format') === 'pdf' ? 'pdf' : 'txt';
  const scanId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const statusText = document.getElementById('statusText');
  const percent = document.getElementById('percent');
  const progressBar = document.getElementById('progressBar');
  const details = document.getElementById('details');
  const warningPanel = document.getElementById('warningPanel');
  const warningList = document.getElementById('warningList');
  const previewPanel = document.getElementById('previewPanel');
  const errorPanel = document.getElementById('errorPanel');
  const transcriptEl = document.getElementById('transcript');
  const downloadTextButton = document.getElementById('downloadText');
  const printAgainButton = document.getElementById('printAgain');
  let chunks = [];
  let expectedChunks = null;
  let result = null;
  let textFileName = 'ai-conversation.txt';
  let completed = false;

  function setProgress(value, message, detail) {
    const clean = Math.max(0, Math.min(100, Number(value) || 0));
    percent.textContent = `${Math.round(clean)}%`;
    progressBar.style.width = `${clean}%`;
    if (message) statusText.textContent = message;
    if (detail) details.textContent = detail;
  }
  function showError(message) {
    errorPanel.hidden = false;
    document.getElementById('errorText').textContent = message;
    setProgress(100, 'Export stopped', 'No export file was created.');
    progressBar.style.background = '#e58e9c';
  }
  function safeFilename(name, extension) {
    const base = String(name || 'ai-conversation')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'ai-conversation';
    return `${base}.${extension}`;
  }
  function exportDate(iso) {
    const d = new Date(iso || Date.now());
    return Number.isNaN(d.getTime()) ? new Date().toLocaleString() : d.toLocaleString();
  }
  function transcriptAsText(data) {
    const lines = [
      `Chat transcript: ${data.title || 'AI conversation'}`,
      `AI service: ${data.site || 'AI assistant'}`,
      `Source URL: ${data.url || ''}`,
      `Exported: ${exportDate(data.exportedAt)}`,
      `Messages: ${(data.messages || []).length}`,
      '',
      '='.repeat(72),
      ''
    ];
    (data.messages || []).forEach((message, index) => {
      lines.push(`${message.role === 'user' ? 'User' : 'AI Agent'}:`);
      lines.push(message.text || '[No text content detected]');
      if (index < data.messages.length - 1) lines.push('', '-'.repeat(72), '');
    });
    if (data.warnings && data.warnings.length) {
      lines.push('', '='.repeat(72), 'SCAN WARNINGS');
      data.warnings.forEach(warning => lines.push(`- ${warning}`));
    }
    return lines.join('\n');
  }
  function downloadText() {
    if (!result) return;
    const blob = new Blob([transcriptAsText(result)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = textFileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function renderTranscript(data) {
    transcriptEl.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = data.title || 'AI conversation';
    transcriptEl.appendChild(title);
    const metaItems = [
      `${data.site || 'AI assistant'} conversation`,
      `Exported: ${exportDate(data.exportedAt)}`,
      `Messages: ${(data.messages || []).length}`
    ];
    for (const metaText of metaItems) {
      const p = document.createElement('p');
      p.className = 'meta';
      p.textContent = metaText;
      transcriptEl.appendChild(p);
    }
    if (data.url) {
      const p = document.createElement('p');
      p.className = 'meta';
      p.textContent = `Source: ${data.url}`;
      transcriptEl.appendChild(p);
    }
    const hr = document.createElement('hr');
    hr.className = 'rule';
    transcriptEl.appendChild(hr);

    (data.messages || []).forEach(message => {
      const section = document.createElement('section');
      section.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
      const label = document.createElement('p');
      label.className = 'message-label';
      label.textContent = message.role === 'user' ? 'User' : 'AI Agent';
      const body = document.createElement('pre');
      body.className = 'message-body';
      body.textContent = message.text || '[No text content detected]';
      section.append(label, body);
      transcriptEl.appendChild(section);
    });
  }
  function showWarnings(list) {
    warningList.replaceChildren();
    if (!list || !list.length) { warningPanel.hidden = true; return; }
    list.forEach(warning => {
      const li = document.createElement('li');
      li.textContent = warning;
      warningList.appendChild(li);
    });
    warningPanel.hidden = false;
  }
  function finish() {
    if (completed) return;
    completed = true;
    try {
      const serialized = chunks.join('');
      result = JSON.parse(serialized);
    } catch (error) {
      showError(`The transcript data could not be reassembled. ${error.message || ''}`);
      return;
    }
    const siteSlug = String(result.site || 'AI-chat').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    textFileName = safeFilename(`${result.title || siteSlug} - ${siteSlug}`, 'txt');
    document.title = `${result.title || 'AI conversation'} - Transcript`;
    document.getElementById('subtitle').textContent = `${result.site || 'AI assistant'} · ${result.messages.length} messages`;
    document.getElementById('documentTitle').textContent = result.title || 'Conversation transcript';
    document.getElementById('messageCount').textContent = `${result.messages.length} messages captured${result.topReached && result.bottomReached ? ' · top and bottom reached' : ''}`;
    showWarnings(result.warnings || []);
    renderTranscript(result);
    previewPanel.hidden = false;
    setProgress(100, 'Transcript ready', 'Review any warnings below before handing this transcript to another AI.');
    if (format === 'txt') {
      downloadText();
      details.textContent = 'Your TXT download should be available. You can also use the button below to download it again.';
    } else {
      details.textContent = 'Choose “Save to PDF” or the PDF destination in the print dialog. The PDF is generated by your browser; no external service is used.';
      // Wait for DOM layout so print preview includes the entire transcript.
      setTimeout(() => window.print(), 500);
    }
    downloadTextButton.addEventListener('click', downloadText);
    printAgainButton.addEventListener('click', () => window.print());
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.scanId !== scanId) return undefined;
    if (message.type === 'CHAT_HANDOFF_PROGRESS') {
      setProgress(message.percent, message.text);
    } else if (message.type === 'CHAT_HANDOFF_RESULT_CHUNK') {
      if (expectedChunks === null) expectedChunks = message.total;
      if (message.total !== expectedChunks || !Number.isInteger(message.index) || message.index < 0 || message.index >= expectedChunks) {
        showError('Received inconsistent transcript data. Reload the chat and try exporting again.');
      } else {
        chunks[message.index] = message.data;
      }
    } else if (message.type === 'CHAT_HANDOFF_SCAN_COMPLETE') {
      if (expectedChunks === null || chunks.length !== expectedChunks || !Array.from({ length: expectedChunks }, (_, i) => chunks[i]).every(chunk => typeof chunk === 'string')) {
        showError('The transcript transfer was incomplete. Please retry the export.');
      } else {
        finish();
      }
    } else if (message.type === 'CHAT_HANDOFF_SCAN_ERROR') {
      showError(message.error || 'An unexpected error occurred while scanning the conversation.');
    }
    return undefined;
  });

  async function start() {
    if (!Number.isInteger(tabId) || tabId < 0) {
      showError('The source browser tab could not be identified. Close this tab and start from the extension button on your AI conversation.');
      return;
    }
    try {
      setProgress(1, 'Connecting to the source conversation…');
      const response = await browser.tabs.sendMessage(tabId, { type: 'CHAT_HANDOFF_START_SCAN', scanId });
      if (!response || !response.accepted) {
        showError((response && response.error) || 'The conversation page did not accept the scan. Reload it and try again.');
        return;
      }
      setProgress(3, 'Connected. Scanning conversation…', 'The source page may scroll while older messages are loaded. It will be restored after the scan.');
    } catch (error) {
      showError('Could not connect to the source tab. Make sure it is open on chatgpt.com or claude.ai, then reload that page and try again. Details: ' + (error.message || error));
    }
  }

  // Fail visibly rather than leaving an endless progress indicator if the source tab or site stops responding.
  setTimeout(() => {
    if (!completed && errorPanel.hidden) showError('The scan did not finish within five minutes. The conversation may be exceptionally long or the page may have stopped responding. Reload the chat and retry.');
  }, 300000);

  start();
})();
