(function () {
  const DEFAULT_PACKAGE_PATH = 'app/theblackbox-desktop.base64.txt';
  const DEFAULT_FILENAME = 'theblackbox-desktop.zip';
  const MIME_TYPE = 'application/zip';

  function base64ToBlob(base64, mimeType) {
    const normalized = base64.replace(/\s+/g, '');
    const binary = atob(normalized);
    const buffer = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      buffer[i] = binary.charCodeAt(i);
    }

    return new Blob([buffer], { type: mimeType });
  }

  async function triggerDownload(button) {
    const packagePath = button.dataset.package || DEFAULT_PACKAGE_PATH;
    const filename = button.dataset.filename || DEFAULT_FILENAME;

    const response = await fetch(packagePath, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Failed to fetch desktop bundle (${response.status})`);
    }

    const base64 = await response.text();
    const blob = base64ToBlob(base64, MIME_TYPE);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function handleClick(event) {
    event.preventDefault();
    const button = event.currentTarget;

    if (button.dataset.downloading === 'true') {
      return;
    }

    button.dataset.downloading = 'true';
    button.classList.add('is-downloading');
    button.setAttribute('aria-busy', 'true');

    try {
      await triggerDownload(button);
      button.dispatchEvent(new CustomEvent('download-app:success', { bubbles: true }));
    } catch (error) {
      console.error('Desktop download failed', error);
      button.dispatchEvent(new CustomEvent('download-app:error', { bubbles: true, detail: error }));
      alert('The desktop download is currently unavailable. Please try again later.');
    } finally {
      button.dataset.downloading = 'false';
      button.classList.remove('is-downloading');
      button.removeAttribute('aria-busy');
    }
  }

  function initialiseDownloadButtons() {
    const buttons = document.querySelectorAll('.download-app-btn');

    buttons.forEach((button) => {
      if (!button.dataset.hasDownloadListener) {
        button.dataset.hasDownloadListener = 'true';
        button.addEventListener('click', handleClick);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseDownloadButtons, { once: true });
  } else {
    initialiseDownloadButtons();
  }
})();
