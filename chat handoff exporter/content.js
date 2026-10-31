(() => {
  if (window.__chatHandoffExporterInstalled) return;
  window.__chatHandoffExporterInstalled = true;

  const MAX_SCROLL_STEPS = 1000;
  const SCROLL_WAIT_MS = 90;
  const TOP_STABLE_TRIES = 7;
  const BOTTOM_STABLE_TRIES = 5;
  let activeScanId = null;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const safeSend = async (payload) => {
    try { await browser.runtime.sendMessage(payload); } catch (_) { /* Export tab may have closed. */ }
  };
  const progress = (scanId, percent, text) => safeSend({
    type: 'CHAT_HANDOFF_PROGRESS', scanId, percent, text
  });

  function isChatGPT() {
    return /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/i.test(location.hostname);
  }
  function getSiteName() { return isChatGPT() ? 'ChatGPT' : /(^|\.)claude\.ai$/i.test(location.hostname) ? 'Claude' : location.hostname; }

  function inferRole(el) {
    const author = (el.getAttribute('data-message-author-role') || '').toLowerCase();
    const turnRole = (el.getAttribute('data-turn') || '').toLowerCase();
    if (author === 'user' || author === 'human' || turnRole === 'user' || turnRole === 'human') return 'user';
    if (author === 'assistant' || author === 'ai' || turnRole === 'assistant' || turnRole === 'ai') return 'assistant';
    if (el.getAttribute('data-user-message-bubble') === 'true') return 'user';

    // Newer ChatGPT layouts put the stable data-turn-key on an ancestor rather than
    // exposing data-message-author-role on each message. Infer its role from the
    // contained bubble/content marker before falling back to older attributes.
    if (el.hasAttribute('data-turn-key')) {
      if (el.querySelector('[data-user-message-bubble="true"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"]')) return 'user';
      if (el.querySelector('[data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"], [data-message-author-role="assistant"], [data-testid="assistant-message"]')) return 'assistant';
      if (el.querySelector('.markdown, .prose, [class*="markdown"]')) return 'assistant';
    }

    const testid = (el.getAttribute('data-testid') || '').toLowerCase();
    const classes = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    const contentKey = (el.getAttribute('data-content-search-unit-key') || '').toLowerCase();
    const searchKey = (el.getAttribute('data-chatgpt-search-unit-key') || '').toLowerCase();
    const perfRow = (el.getAttribute('data-perf-row') || '').toLowerCase();
    const signal = `${testid} ${classes} ${(el.getAttribute('aria-label') || '').toLowerCase()} ${contentKey} ${searchKey}`;
    if (/(^|[^a-z])(user|human)([^a-z]|$)|user-message|human-message|message-human|user_message|font-user-message/.test(signal) || perfRow === 'human') return 'user';
    if (/assistant|ai-message|message-assistant|claude-message/.test(signal) || perfRow === 'assistant' || /:assistant$/.test(contentKey) || /:assistant$/.test(searchKey)) return 'assistant';

    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const role = (parent.getAttribute('data-message-author-role') || '').toLowerCase();
      if (role === 'user' || role === 'human') return 'user';
      if (role === 'assistant' || role === 'ai') return 'assistant';
      const parentKey = (parent.getAttribute('data-content-search-unit-key') || parent.getAttribute('data-chatgpt-search-unit-key') || '').toLowerCase();
      if (/:user$/.test(parentKey)) return 'user';
      if (/:assistant$/.test(parentKey)) return 'assistant';
      const parentPerf = (parent.getAttribute('data-perf-row') || '').toLowerCase();
      if (parentPerf === 'human') return 'user';
      if (parentPerf === 'assistant') return 'assistant';
      parent = parent.parentElement;
    }
    return null;
  }

  function getMessageElements() {
    const modernChatGPTScope = isChatGPT() ? document.querySelector('[data-app-action-timeline-scroll][role="region"]') : null;
    const root = modernChatGPTScope || document;
    let selectors;
    if (isChatGPT()) {
      selectors = [
        '[data-user-message-bubble="true"]',
        '[data-content-search-unit-key$=":user"]',
        '[data-chatgpt-search-unit-key$=":user"]',
        '[data-content-search-unit-key$=":assistant"]',
        '[data-chatgpt-search-unit-key$=":assistant"]',
        '[data-turn-key]',
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"]'
      ];
    } else {
      selectors = [
        '[data-testid="user-message"]', '[data-testid="human-message"]',
        '[data-testid="message-human"]', '[data-testid="user-human-turn"]',
        '[data-testid="user_message"]', '[data-testid="assistant-message"]',
        '[data-testid="ai-message"]', '[data-testid="message-assistant"]',
        '.\\!font-user-message', '.font-user-message', '.assistant-message', '.user-message'
      ];
      // The older .font-claude-response selector can now match a project-title link outside the transcript.
      // Use it only as a legacy fallback when modern assistant-message markers are absent.
      if (!root.querySelector('[data-testid="assistant-message"], [data-testid="ai-message"], [data-testid="message-assistant"]')) {
        selectors.push('.font-claude-response', '.font-claude-message');
      }
    }

    const unique = new Map();
    for (const selector of selectors) {
      let found = [];
      try { found = root.querySelectorAll(selector); } catch (_) { continue; }
      for (const el of found) {
        const role = inferRole(el);
        if (role && !unique.has(el)) unique.set(el, { el, role });
      }
    }

    let records = [...unique.values()].sort((a, b) => {
      if (a.el === b.el) return 0;
      const rel = a.el.compareDocumentPosition(b.el);
      return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // Prefer the outer message container when multiple supported selectors match nested wrappers.
    records = records.filter(record => {
      let parent = record.el.parentElement;
      while (parent) {
        const outer = unique.get(parent);
        if (outer && outer.role === record.role) return false;
        parent = parent.parentElement;
      }
      return true;
    });
    return records;
  }

  function visibleTextFromNode(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|button|svg|nav|form|input|textarea|select|option|noscript)$/.test(tag)) return '';
    if (el.getAttribute('aria-hidden') === 'true') return '';
    if (el.getAttribute('role') === 'button') return '';
    if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'canvas') return '';
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n---\n';

    const childText = () => Array.from(el.childNodes).map(visibleTextFromNode).join('');
    if (tag === 'pre') return `\n${el.innerText || el.textContent || childText()}\n`;
    if (tag === 'li') return `\n• ${childText().trim()}\n`;
    if (tag === 'td' || tag === 'th') return `${childText().trim()} | `;
    if (tag === 'tr') return `\n${childText().replace(/\s*\|\s*$/, '')}\n`;
    if (/^(p|div|section|article|blockquote|h[1-6]|ul|ol|table|header|footer)$/.test(tag)) {
      return `\n${childText()}\n`;
    }
    return childText();
  }

  function collectFileNames(el) {
    const names = new Set();
    const filenameRe = /[^\s\\/:*?"<>|]{1,180}\.(?:pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|rtf|odt|ods|odp|json|xml|html?|css|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|zip|7z|rar|tar|gz|png|jpe?g|gif|webp|svg|mp[34]|wav|m4a|ogg|webm|mp4|mov|ipynb|sql|yaml|yml|toml|log|epub|mobi|psd|ai|fig|sketch|dmg|exe|apk|bin|parquet|feather|pickle|pkl|r|go|rs|rb|php|sh|bat|ps1)$/i;
    const nodes = [...el.querySelectorAll('[data-filename], [title], [download], a[href], [aria-label], [data-testid*="file"], [class*="file-name"], [class*="attachment"]')];
    for (const node of nodes) {
      const samples = [node.getAttribute && node.getAttribute('data-filename'), node.getAttribute && node.getAttribute('download'), node.getAttribute && node.getAttribute('title'), node.getAttribute && node.getAttribute('aria-label'), node.textContent];
      for (const sample of samples) {
        if (!sample) continue;
        const cleaned = String(sample).trim().replace(/^Download\s+/i, '').replace(/^Open\s+/i, '');
        if (cleaned.length > 220) continue;
        const match = cleaned.match(filenameRe);
        if (match && match[0].length <= 180) names.add(match[0].replace(/[),.;:]+$/, ''));
      }
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^(sandbox:|blob:)/i.test(href)) {
          const txt = (node.textContent || '').trim();
          const match = txt.match(filenameRe) || href.match(filenameRe);
          if (match) names.add(match[0]);
          else names.add('downloadable file');
        }
      }
    }
    return [...names].slice(0, 8);
  }

  function collectMediaMarkers(el, role, filenames) {
    const markers = [];
    const imgs = [...el.querySelectorAll('img')].filter(img => {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const cls = typeof img.className === 'string' ? img.className.toLowerCase() : '';
      if (/avatar|profile|logo|icon|emoji/.test(`${alt} ${cls}`)) return false;
      if (img.closest('button,[role="button"]')) return false;
      return true;
    });
    const videos = el.querySelectorAll('video').length;
    const audios = el.querySelectorAll('audio').length;
    const downloadLinks = el.querySelectorAll('a[download], a[href^="sandbox:"], a[href^="blob:"]').length;
    const attachmentUI = el.querySelector('[data-testid*="attachment"], [data-testid*="file-card"], [data-testid*="uploaded-file"], [class*="attachment-preview"], [class*="file-upload"]');

    if (filenames.length) {
      for (const name of filenames) markers.push(`[File attached or provided: ${name}]`);
    } else if (downloadLinks || attachmentUI) {
      markers.push(`[File attached, uploaded, or provided${role === 'user' ? ' by user' : ''}]`);
    }
    if (imgs.length) markers.push(role === 'user' ? `[Image attachment${imgs.length > 1 ? `s (${imgs.length})` : ''}]` : `[Image displayed or generated${imgs.length > 1 ? ` (${imgs.length})` : ''}]`);
    if (videos) markers.push(`[Video attachment or media (${videos})]`);
    if (audios) markers.push(`[Audio attachment or media (${audios})]`);
    return [...new Set(markers)];
  }

  function extractMessage(record) {
    const { el, role } = record;
    const names = collectFileNames(el);
    const mediaMarkers = collectMediaMarkers(el, role, names);
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button,[role="button"],svg,script,style,nav,form,input,textarea,select,noscript,[aria-hidden="true"],[class~="sr-only"],[data-testid="message-actions"],[data-testid*="toolbar"]').forEach(node => node.remove());
    const raw = visibleTextFromNode(clone)
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\u00a0 ]+\n/g, '\n')
      .replace(/\n[\t ]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    let text = raw;
    if (mediaMarkers.length) {
      const markerBlock = mediaMarkers.join('\n');
      // Avoid an extra marker only when identical label text is already part of the visible body.
      const missing = mediaMarkers.filter(marker => !raw.includes(marker));
      if (missing.length) text = [raw, ...missing].filter(Boolean).join('\n');
    }
    if (!text && mediaMarkers.length) text = mediaMarkers.join('\n');
    if (!text) return null;

    const identityNode = el.closest('[data-turn-key], [data-testid="transcript-row"][data-index][data-rs-index], [data-index][data-rs-index], [data-message-id]');
    const explicitId = el.getAttribute('data-message-id') || el.getAttribute('data-turn-key') || el.getAttribute('data-id') ||
      identityNode?.getAttribute('data-turn-key') ||
      (identityNode?.getAttribute('data-index') && identityNode?.getAttribute('data-rs-index')
        ? `row-${identityNode.getAttribute('data-index')}-${identityNode.getAttribute('data-rs-index')}` : '') ||
      identityNode?.getAttribute('data-message-id') ||
      el.querySelector('[data-message-id]')?.getAttribute('data-message-id') || '';
    return {
      role,
      text,
      id: explicitId || '',
      signature: `${role}\u241f${explicitId || text}`
    };
  }

  function snapshotMessages(scrollEl = null, visibleOnly = true) {
    let records = getMessageElements();
    if (visibleOnly && scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 80) {
      const isRoot = scrollEl === document.scrollingElement || scrollEl === document.documentElement || scrollEl === document.body;
      const rect = isRoot ? { top: 0, bottom: window.innerHeight, height: window.innerHeight } : scrollEl.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const height = Math.max(100, bottom - top);
      const margin = height * 0.38;
      records = records.filter(({ el }) => {
        const r = el.getBoundingClientRect();
        return r.bottom >= top - margin && r.top <= bottom + margin;
      });
    }
    return records.map(extractMessage).filter(Boolean);
  }

  function sameMessage(a, b) { return a.signature === b.signature; }
  function sequenceContains(haystack, needle) {
    if (!needle.length || needle.length > haystack.length) return false;
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (!sameMessage(haystack[i + j], needle[j])) continue outer;
      return true;
    }
    return false;
  }
  function longestSuffixPrefix(left, right) {
    const max = Math.min(left.length, right.length);
    for (let n = max; n > 0; n--) {
      let good = true;
      for (let i = 0; i < n; i++) if (!sameMessage(left[left.length - n + i], right[i])) { good = false; break; }
      if (good) return n;
    }
    return 0;
  }
  function longestSuffixPrefixReverse(left, right) {
    // Length of suffix(right) matching prefix(left): used to prepend when scrolling upwards.
    const max = Math.min(left.length, right.length);
    for (let n = max; n > 0; n--) {
      let good = true;
      for (let i = 0; i < n; i++) if (!sameMessage(right[right.length - n + i], left[i])) { good = false; break; }
      if (good) return n;
    }
    return 0;
  }
  function mergeSnapshot(collected, current, direction) {
    if (!current.length) return collected;
    if (!collected.length) return current.slice();
    if (sequenceContains(collected, current)) return collected;

    const appendOverlap = longestSuffixPrefix(collected, current);
    const prependOverlap = longestSuffixPrefixReverse(collected, current);
    if (appendOverlap >= prependOverlap && appendOverlap > 0) {
      return collected.concat(current.slice(appendOverlap));
    }
    if (prependOverlap > 0) {
      return current.slice(0, current.length - prependOverlap).concat(collected);
    }
    return direction === 'up' ? current.concat(collected) : collected.concat(current);
  }

  function isScrollable(el) {
    if (!el || !el.clientHeight || el.clientHeight < 120) return false;
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    return /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight + 80;
  }
  function findScrollContainer() {
    const current = getMessageElements().map(x => x.el);
    const candidates = new Set();
    if (document.scrollingElement) candidates.add(document.scrollingElement);
    for (const message of current) {
      let node = message.parentElement;
      let depth = 0;
      while (node && node !== document.body && depth < 12) {
        if (isScrollable(node)) candidates.add(node);
        node = node.parentElement;
        depth++;
      }
    }
    const allMain = document.querySelectorAll('main,[role="main"]');
    for (const node of allMain) if (isScrollable(node) && current.some(m => node.contains(m))) candidates.add(node);
    const viable = [...candidates].filter(node => {
      if (node === document.documentElement || node === document.body) return isScrollable(document.scrollingElement) || node.scrollHeight > node.clientHeight + 80;
      return isScrollable(node) && current.some(m => node.contains(m));
    });
    viable.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return viable[0] || document.scrollingElement || document.documentElement;
  }
  function getScrollTop(el) {
    if (el === document.scrollingElement || el === document.documentElement || el === document.body) return document.scrollingElement.scrollTop;
    return el.scrollTop;
  }
  function setScrollTop(el, value) {
    if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
      document.scrollingElement.scrollTop = value;
      return;
    }
    el.scrollTop = value;
  }
  function getScrollMax(el) {
    if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
      return Math.max(0, document.scrollingElement.scrollHeight - window.innerHeight);
    }
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }
  function countStable(previous, current) {
    if (!previous || !current) return false;
    return previous.count === current.count && previous.top === current.top && previous.height === current.height && previous.signature === current.signature;
  }
  function currentState(el, messages) {
    return {
      count: messages.length,
      top: Math.round(getScrollTop(el)),
      height: Math.round(el.scrollHeight),
      signature: messages.slice(0, 2).map(m => m.signature).join('||') + '::' + messages.slice(-2).map(m => m.signature).join('||')
    };
  }

  async function sendResult(scanId, result) {
    const serialized = JSON.stringify(result);
    const chunkSize = 36000;
    const total = Math.max(1, Math.ceil(serialized.length / chunkSize));
    for (let index = 0; index < total; index++) {
      await safeSend({
        type: 'CHAT_HANDOFF_RESULT_CHUNK', scanId, index, total,
        data: serialized.slice(index * chunkSize, (index + 1) * chunkSize)
      });
      if (index % 20 === 0) await progress(scanId, 93 + Math.min(5, Math.floor(index / Math.max(1, total) * 5)), `Transferring transcript data (${index + 1}/${total})…`);
    }
    await safeSend({ type: 'CHAT_HANDOFF_SCAN_COMPLETE', scanId, chunks: total });
  }

  async function runScan(scanId) {
    if (activeScanId) {
      await safeSend({ type: 'CHAT_HANDOFF_SCAN_ERROR', scanId, error: 'A scan is already running in this tab. Wait for it to finish or reload the chat and try again.' });
      return;
    }
    activeScanId = scanId;
    const originalScrollEl = findScrollContainer();
    const originalTop = getScrollTop(originalScrollEl);
    let collected = [];
    const warnings = [];
    let topReached = false;
    let bottomReached = false;
    let stepLimitHit = false;
    let movementSeen = false;

    try {
      await progress(scanId, 2, 'Finding the conversation messages…');
      collected = mergeSnapshot(collected, snapshotMessages(originalScrollEl, Boolean(originalScrollEl && getScrollMax(originalScrollEl) > 0)), 'down');
      if (!collected.length) throw new Error('No conversation messages were detected. Open a normal ChatGPT or Claude conversation, reload the page, and try again.');
      const scrollable = originalScrollEl && (getScrollMax(originalScrollEl) > 0);
      if (!scrollable) {
        warnings.push('No scrollable conversation area was detected. Only messages present in the page DOM could be exported.');
        topReached = true;
        bottomReached = true;
      } else {
        const stepSize = () => Math.max(360, Math.floor((originalScrollEl.clientHeight || window.innerHeight) * 0.72));
        await progress(scanId, 5, 'Scrolling upward and collecting older messages…');
        let lastTop = getScrollTop(originalScrollEl);
        let noMoveCount = 0;
        for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
          const now = snapshotMessages(originalScrollEl, true);
          collected = mergeSnapshot(collected, now, 'up');
          const top = getScrollTop(originalScrollEl);
          if (top <= 3) {
            topReached = true;
            let stable = 0;
            let prevState = null;
            for (let hold = 0; hold < TOP_STABLE_TRIES; hold++) {
              await sleep(260);
              const after = snapshotMessages(originalScrollEl, true);
              collected = mergeSnapshot(collected, after, 'up');
              const state = currentState(originalScrollEl, after);
              if (countStable(prevState, state)) stable++; else stable = 0;
              prevState = state;
              // Some apps prepend older messages once they reach the top and adjust scrollTop.
              if (getScrollTop(originalScrollEl) > 3) { topReached = false; stable = 0; break; }
              if (stable >= 2) break;
            }
            if (topReached) break;
          }
          const next = Math.max(0, top - stepSize());
          setScrollTop(originalScrollEl, next);
          await sleep(SCROLL_WAIT_MS);
          const afterTop = getScrollTop(originalScrollEl);
          if (Math.abs(afterTop - lastTop) > 2) { movementSeen = true; noMoveCount = 0; }
          else noMoveCount++;
          lastTop = afterTop;
          if (noMoveCount >= 5 && afterTop > 3) {
            warnings.push('The conversation scroll area stopped moving before the top was reached. Some older messages may be missing.');
            break;
          }
          if (step === MAX_SCROLL_STEPS - 1) stepLimitHit = true;
          if (step % 3 === 0) await progress(scanId, 6 + Math.min(36, Math.floor(step / MAX_SCROLL_STEPS * 36)), `Scanning older messages… ${collected.length} collected`);
        }
        if (!topReached && getScrollTop(originalScrollEl) <= 3) topReached = true;
        if (!topReached) warnings.push('The scan could not confirm reaching the top of the conversation. The export may be incomplete.');

        // Start from the top and scan down so recycled DOM nodes and tall messages are covered too.
        setScrollTop(originalScrollEl, 0);
        await sleep(220);
        collected = mergeSnapshot(collected, snapshotMessages(originalScrollEl, true), 'down');
        await progress(scanId, 47, 'Scanning downward to catch messages recycled by the page…');
        let lastTopDown = getScrollTop(originalScrollEl);
        let downNoMove = 0;
        for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
          const before = snapshotMessages(originalScrollEl, true);
          collected = mergeSnapshot(collected, before, 'down');
          const top = getScrollTop(originalScrollEl);
          const max = getScrollMax(originalScrollEl);
          if (max - top <= 3) {
            bottomReached = true;
            let stable = 0;
            let prevState = null;
            for (let hold = 0; hold < BOTTOM_STABLE_TRIES; hold++) {
              await sleep(220);
              const after = snapshotMessages(originalScrollEl, true);
              collected = mergeSnapshot(collected, after, 'down');
              const state = currentState(originalScrollEl, after);
              if (countStable(prevState, state)) stable++; else stable = 0;
              prevState = state;
              if (getScrollMax(originalScrollEl) - getScrollTop(originalScrollEl) > 3) { bottomReached = false; stable = 0; break; }
              if (stable >= 2) break;
            }
            if (bottomReached) break;
          }
          const next = Math.min(max, top + stepSize());
          setScrollTop(originalScrollEl, next);
          await sleep(SCROLL_WAIT_MS);
          const afterTop = getScrollTop(originalScrollEl);
          if (Math.abs(afterTop - lastTopDown) > 2) { movementSeen = true; downNoMove = 0; }
          else downNoMove++;
          lastTopDown = afterTop;
          if (downNoMove >= 5 && getScrollMax(originalScrollEl) - afterTop > 3) {
            warnings.push('The conversation scroll area stopped moving before the bottom was reached. Some newer messages may be missing.');
            break;
          }
          if (step === MAX_SCROLL_STEPS - 1) stepLimitHit = true;
          if (step % 3 === 0) await progress(scanId, 48 + Math.min(39, Math.floor(step / MAX_SCROLL_STEPS * 39)), `Scanning conversation… ${collected.length} collected`);
        }
        if (!bottomReached && getScrollMax(originalScrollEl) - getScrollTop(originalScrollEl) <= 3) bottomReached = true;
        if (!bottomReached) warnings.push('The scan could not confirm reaching the bottom of the conversation. The export may be incomplete.');
        if (stepLimitHit) warnings.push(`The safety limit of ${MAX_SCROLL_STEPS} scroll steps was reached. Review the message count before relying on this export.`);
        if (!movementSeen && getScrollMax(originalScrollEl) > 200) warnings.push('The scroll position did not appear to change. If the export is short, try reloading the conversation before exporting again.');
      }

      // Filter accidental adjacent duplicates only if the exact same stable ID is repeated by selector overlap.
      const finalMessages = [];
      const seenStableIds = new Set();
      for (const message of collected) {
        if (message.id) {
          const idKey = `${message.role}:${message.id}`;
          if (seenStableIds.has(idKey)) continue;
          seenStableIds.add(idKey);
        }
        finalMessages.push({ role: message.role, text: message.text });
      }

      if (finalMessages.length < 2) warnings.push(`Only ${finalMessages.length} message(s) were detected. Check the transcript carefully; the site's page structure may have changed or the chat may not have loaded fully.`);
      await progress(scanId, 92, `Preparing export with ${finalMessages.length} messages…`);
      const result = {
        title: (document.title || 'AI conversation').replace(/\s*[|–-]\s*(ChatGPT|Claude).*$/i, '').trim() || 'AI conversation',
        site: getSiteName(),
        url: location.href,
        pageTitle: document.title || '',
        exportedAt: new Date().toISOString(),
        messageCount: finalMessages.length,
        topReached,
        bottomReached,
        warnings,
        messages: finalMessages
      };
      await sendResult(scanId, result);
    } catch (error) {
      await safeSend({ type: 'CHAT_HANDOFF_SCAN_ERROR', scanId, error: error && error.message ? error.message : String(error) });
    } finally {
      try { setScrollTop(originalScrollEl, originalTop); } catch (_) {}
      activeScanId = null;
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'CHAT_HANDOFF_START_SCAN' || !message.scanId) return undefined;
    if (activeScanId) return Promise.resolve({ accepted: false, error: 'A scan is already running in this tab.' });
    // Start the scan after returning the acknowledgement; keep long work out of the request response.
    void runScan(message.scanId);
    return Promise.resolve({ accepted: true });
  });
})();
