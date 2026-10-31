(() => {
  const siteName = document.getElementById('siteName');
  const siteHint = document.getElementById('siteHint');
  const exportButton = document.getElementById('exportButton');
  let activeTab = null;

  function siteFromUrl(url) {
    try {
      const host = new URL(url).hostname;
      if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'ChatGPT';
      if (host === 'claude.ai') return 'Claude';
    } catch (_) {}
    return null;
  }

  document.querySelectorAll('.format-option').forEach(label => {
    const input = label.querySelector('input');
    const update = () => label.classList.toggle('selected', Boolean(input && input.checked));
    if (input) input.addEventListener('change', () => {
      document.querySelectorAll('.format-option').forEach(item => item.classList.remove('selected'));
      update();
    });
    update();
  });

  async function init() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs && tabs[0];
      const site = activeTab && siteFromUrl(activeTab.url || '');
      if (site) {
        siteName.textContent = `${site} tab detected`;
        siteHint.textContent = 'Open the conversation you want to export.';
        document.querySelector('.site-dot').style.background = '#6ed6a1';
        exportButton.disabled = false;
      } else {
        siteName.textContent = 'Unsupported tab';
        siteHint.textContent = 'Open a chatgpt.com or claude.ai conversation.';
        exportButton.disabled = true;
      }
    } catch (error) {
      siteName.textContent = 'Could not inspect this tab';
      siteHint.textContent = 'Open a supported AI conversation and try again.';
      exportButton.disabled = true;
    }
  }

  exportButton.addEventListener('click', async () => {
    if (!activeTab || !activeTab.id) return;
    const selected = document.querySelector('input[name="format"]:checked');
    const format = selected ? selected.value : 'txt';
    const url = browser.runtime.getURL('export.html') +
      `?tabId=${encodeURIComponent(activeTab.id)}&format=${encodeURIComponent(format)}`;
    try {
      await browser.tabs.create({ url });
      window.close();
    } catch (error) {
      siteHint.textContent = `Could not open exporter: ${error.message || error}`;
    }
  });

  init();
})();
