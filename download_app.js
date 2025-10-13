(function () {
  const DEFAULT_FILENAME = 'theblackbox-desktop.zip';
  const MIME_TYPE = 'application/zip';
  const DEFAULT_PACKAGE_BASE64 = [
    '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',
    'AAAAAAQABADqAAAAMhIAAAAA'
  ].join('');
  let defaultUrl = null;

  function base64ToBlob(base64, mimeType) {
    const normalized = base64.replace(/\s+/g, '');
    const binary = atob(normalized);
    const buffer = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      buffer[i] = binary.charCodeAt(i);
    }

    return new Blob([buffer], { type: mimeType });
  }

  function getDefaultUrl() {
    if (!defaultUrl) {
      const blob = base64ToBlob(DEFAULT_PACKAGE_BASE64, MIME_TYPE);
      defaultUrl = URL.createObjectURL(blob);
    }

    return defaultUrl;
  }

  function triggerDownload(button) {
    const filename = button.dataset.filename || DEFAULT_FILENAME;
    const overrideBase64 = button.dataset.packageBase64;
    let url;
    let blobToRevoke = null;

    if (overrideBase64) {
      blobToRevoke = URL.createObjectURL(base64ToBlob(overrideBase64, MIME_TYPE));
      url = blobToRevoke;
    } else {
      url = getDefaultUrl();
    }

    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    if (blobToRevoke) {
      URL.revokeObjectURL(blobToRevoke);
    }
  }

  function handleClick(event) {
    event.preventDefault();
    const button = event.currentTarget;

    if (button.dataset.downloading === 'true') {
      return;
    }

    button.dataset.downloading = 'true';
    button.classList.add('is-downloading');
    button.setAttribute('aria-busy', 'true');

    try {
      triggerDownload(button);
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
