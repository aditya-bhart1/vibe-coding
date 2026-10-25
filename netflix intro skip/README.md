# Netflix Auto Skip Intro

Automatically clicks Netflix's **Skip Intro** control as soon as it appears.

## Supported browsers

- Google Chrome
- Mozilla Firefox
- Microsoft Edge
- Brave
- Vivaldi
- Other Chromium browsers supporting Manifest V3

The same `manifest.json` is used for both Chrome/Chromium and Firefox. Chrome ignores the Firefox-specific `browser_specific_settings` section, while Firefox uses it to identify the add-on. Firefox's current WebExtension documentation supports Manifest V3 `content_scripts` and `host_permissions`, and requires a Gecko extension ID for signing MV3 extensions. This extension declares no data collection. 

## Chrome / Edge / Brave / Vivaldi

1. Extract the ZIP.
2. Open the browser's extensions page (`chrome://extensions/`, `edge://extensions/`, etc.).
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `netflix-auto-skip` folder.
6. Reload the Netflix tab.

## Firefox

### Temporary testing install

1. Extract the ZIP.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select the extracted `manifest.json` file.
5. Open or reload Netflix.

Temporary Firefox add-ons are removed when Firefox restarts.

### Permanent installation

Firefox: https://addons.mozilla.org/en-US/firefox/addon/netflix-auto-skip-intro/

## How it works

The content script watches Netflix's page with a `MutationObserver` and also performs a lightweight periodic scan. It first looks for Netflix's current `data-uia="player-skip-intro"` control, then uses narrow button/ARIA/title fallbacks for resilience. When a visible Skip Intro or Skip Recap control appears, it clicks it automatically.

No popup, account access, background service worker, cookies, storage, or external network access is used.
