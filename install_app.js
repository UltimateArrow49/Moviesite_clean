(function () {
  let deferredPrompt = null;
  let toastTimeout = null;

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
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        showToast('The Blackbox is installing. Look for it on your desktop.');
      } else {
        showToast('Install cancelled. You can add The Blackbox anytime from your browser menu.');
      }
    } catch (error) {
      console.warn('Unable to prompt for install automatically', error);
      showToast('Install The Blackbox from your browser menu to create a desktop shortcut.');
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.documentElement.dataset.pwaReady = 'true';
    showToast('Preparing The Blackbox desktop app…');
    setTimeout(() => {
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        promptInstall();
      }
    }, 1200);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.documentElement.dataset.pwaReady = 'false';
    showToast('The Blackbox is installed. Enjoy the dedicated window!');
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && deferredPrompt) {
      promptInstall();
    }
  });
})();
