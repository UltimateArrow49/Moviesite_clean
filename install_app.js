(function () {
  let deferredPrompt = null;
  let toastTimeout = null;
  const INSTALL_OUTCOME_KEY = 'tbb:pwa-install-outcome';
  const INSTALL_ASKED_KEY = 'tbb:pwa-install-asked';
  const INSTALL_SESSION_KEY = 'tbb:pwa-install-session';

  function readStorage(key, storage) {
    try {
      return storage.getItem(key) || '';
    } catch (error) {
      return '';
    }
  }

  function writeStorage(key, value, storage) {
    try {
      if (value) {
        storage.setItem(key, value);
      } else {
        storage.removeItem(key);
      }
    } catch (error) {
      console.warn('Unable to persist install prompt state', error);
    }
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches;
  }

  function shouldAutoPrompt() {
    if (isStandalone()) return false;
    if (readStorage(INSTALL_OUTCOME_KEY, localStorage)) return false;
    if (readStorage(INSTALL_ASKED_KEY, localStorage)) return false;
    if (readStorage(INSTALL_SESSION_KEY, sessionStorage)) return false;
    return true;
  }

  function markInstallPromptSeen() {
    writeStorage(INSTALL_ASKED_KEY, '1', localStorage);
    writeStorage(INSTALL_SESSION_KEY, '1', sessionStorage);
  }

  function clearToast() {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
    const toast = document.getElementById('installToast');
    if (toast) {
      toast.classList.add('install-toast--hide');
      setTimeout(() => toast.remove(), 320);
    }
  }

  function showToast(message) {
    clearToast();
    const toast = document.createElement('div');
    toast.id = 'installToast';
    toast.className = 'install-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add('install-toast--visible');
    });
    toastTimeout = setTimeout(clearToast, 8000);
  }

  async function promptInstall() {
    if (!deferredPrompt) return;
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    markInstallPromptSeen();
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        writeStorage(INSTALL_OUTCOME_KEY, 'accepted', localStorage);
        showToast('The Blackbox is installing. Look for it on your desktop.');
      } else {
        writeStorage(INSTALL_OUTCOME_KEY, 'dismissed', localStorage);
        showToast('Install cancelled. You can add The Blackbox anytime from your browser menu.');
      }
    } catch (error) {
      console.warn('Unable to prompt for install automatically', error);
      writeStorage(INSTALL_OUTCOME_KEY, 'manual', localStorage);
      showToast('Install The Blackbox from your browser menu to create a desktop shortcut.');
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.documentElement.dataset.pwaReady = 'true';
    if (!shouldAutoPrompt()) {
      return;
    }
    showToast('Preparing The Blackbox desktop app...');
    setTimeout(() => {
      if (!isStandalone() && shouldAutoPrompt()) {
        promptInstall();
      }
    }, 1200);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.documentElement.dataset.pwaReady = 'false';
    writeStorage(INSTALL_OUTCOME_KEY, 'accepted', localStorage);
    showToast('The Blackbox is installed. Enjoy the dedicated window!');
  });
})();
