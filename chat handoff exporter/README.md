# Chat Handoff Exporter (Firefox)

A local-only Firefox WebExtension that exports visible ChatGPT and Claude conversations to a plain-text transcript or a print-ready document that can be saved as PDF.

## What it does

- Supports `chatgpt.com`, the legacy `chat.openai.com`, and `claude.ai`.
- Scrolls upward to encourage the site to load older turns, collecting each viewport as it goes.
- Scans down from the top as a second pass, merging overlapping viewport snapshots to account for chat UIs that recycle/reuse message DOM nodes.
- Keeps chronological order and labels turns `User:` and `AI Agent:`.
- Replaces visible media/file cards with markers such as `[Image attachment]` or `[File attached or provided: report.pdf]`. It does not read the contents of uploaded/generated files.
- Exports `.txt` directly. PDF export opens Firefox's print dialog so you can choose the PDF destination.
- Shows warnings if it cannot confirm that it reached the top/bottom, if the page stops scrolling, or if very few messages were detected.
- Performs extraction and file generation locally in the browser. There are no analytics, remote APIs, or external script dependencies.

## Install temporarily in Firefox

1. Use `chat-handoff-exporter.xpi` with **Load Temporary Add-on…**, or unzip `chat-handoff-exporter.zip` and select the folder's `manifest.json`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select the XPI or `manifest.json`.
4. Open or reload a ChatGPT or Claude conversation. If it was already open during installation, reload it once so the content script is attached.
5. Click the extension icon, select **Text file** or **PDF document**, then click **Export conversation**.
6. Keep the exporter tab open until scanning is complete. For PDF, choose the PDF save destination in Firefox's print dialog.

Temporary add-ons are removed when Firefox restarts. A permanently installed Firefox release generally needs Mozilla signing (unless using a developer/enterprise configuration that permits unsigned add-ons).

## Accuracy and limitations

The extension captures messages exposed by the current page's DOM while scrolling, using current and legacy message selectors for the supported sites. It does not call undocumented service APIs or extract hidden server-side conversation records. This is intentional: all work stays within the browser page and extension. Site DOM changes, network/loading failures, very long individual turns, a virtualized page that does not expose every turn during the sweep, or a page that blocks scripted scrolling can prevent a complete export. Always check the captured message count and any warning displayed before relying on a transcript. If the export looks incomplete, wait until the conversation has loaded, reload the source page, and retry.

The extension does not export the contents of images, PDFs, spreadsheets, or other attachments. It records that a file/media item was present, and uses a filename when one is exposed in the page UI.

## Files

- `manifest.json` — extension metadata and supported sites
- `popup.html`, `popup.css`, `popup.js` — format picker and toolbar popup
- `content.js` — local message extraction, scroll scanning, and viewport merging
- `export.html`, `export.css`, `export.js` — progress, TXT download, and print-to-PDF view
