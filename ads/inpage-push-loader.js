(function () {
  var scriptTag = document.currentScript;
  if (!scriptTag) {
    return;
  }

  var w = window;
  var d = document;
  var zoneKey = scriptTag.dataset.zone || '';
  var hookName = scriptTag.dataset.hook || '_mbeic';
  var loaderId = scriptTag.dataset.loaderId || hookName + '_loader';
  var primaryLoaderSrc = scriptTag.dataset.loaderSrc || 'https://delivery.monetag.com/pfe/current/tag.min.js';
  var fallbackLoaderSrc = scriptTag.dataset.loaderFallback || scriptTag.dataset.loaderFallbackSrc || '';
  var loaderSources = [primaryLoaderSrc];
  if (fallbackLoaderSrc && fallbackLoaderSrc !== primaryLoaderSrc) {
    loaderSources.push(fallbackLoaderSrc);
  }
  var currentSourceIndex = 0;
  var activeClass = scriptTag.dataset.activeClass || 'ads-active';
  var containerSelector = scriptTag.dataset.creativeSelector || '.side-ad';
  var recheckDelay = parseInt(scriptTag.dataset.recheckDelay || '1500', 10);
  var raf = (w.requestAnimationFrame || w.webkitRequestAnimationFrame || w.mozRequestAnimationFrame || w.msRequestAnimationFrame);
  var fallbackIntervalId = null;

  if (!raf) {
    raf = function (callback) {
      return setTimeout(callback, 16);
    };
  } else {
    raf = raf.bind(w);
  }

  function buildSrc(baseSrc) {
    var finalSrc = baseSrc;

    if (!finalSrc) {
      return finalSrc;
    }

    if (zoneKey) {
      if (finalSrc.indexOf('{{ZONE}}') !== -1) {
        finalSrc = finalSrc.replace('{{ZONE}}', encodeURIComponent(zoneKey));
      } else if (!/[?&]z=/.test(finalSrc)) {
        finalSrc += (finalSrc.indexOf('?') === -1 ? '?' : '&') + 'z=' + encodeURIComponent(zoneKey);
      }
    }

    return finalSrc;
  }

  function ensureHook() {
    var existing = w[hookName];
    if (typeof existing === 'function') {
      if (!existing.q) {
        existing.q = [];
      }
      return existing;
    }

    function queue() {
      queue.q.push(arguments);
      scheduleEvaluation();
    }

    queue.q = [];
    w[hookName] = queue;
    return queue;
  }

  var hook = ensureHook();

  function markLoaded() {
    hook.loaded = true;
    try {
      hook('loader:loaded');
    } catch (error) {
      if (w.console && typeof w.console.debug === 'function') {
        console.debug('In-Page Push loader callback error', error);
      }
    }
    scheduleEvaluation();
  }

  function loadVendor() {
    if (loaderId && d.getElementById(loaderId)) {
      return;
    }

    if (currentSourceIndex >= loaderSources.length) {
      scheduleEvaluation();
      return;
    }

    var target = d.head || d.documentElement;
    if (!target) {
      return;
    }

    var loader = d.createElement('script');
    if (loaderId) {
      loader.id = loaderId;
    }
    loader.async = true;
    loader.setAttribute('data-cfasync', 'false');
    var activeSrc = buildSrc(loaderSources[currentSourceIndex]);
    loader.src = activeSrc;
    loader.addEventListener('load', markLoaded, { once: true });
    loader.addEventListener('error', function (event) {
      console.warn('In-Page Push loader failed to fetch.', event);
      try {
        hook('loader:error', { source: activeSrc, zone: zoneKey });
      } catch (loaderError) {
        if (w.console && typeof w.console.debug === 'function') {
          console.debug('In-Page Push loader error hook failure', loaderError);
        }
      }

      if (loader.parentNode) {
        loader.parentNode.removeChild(loader);
      }

      currentSourceIndex += 1;
      if (currentSourceIndex < loaderSources.length) {
        raf(loadVendor);
      } else {
        scheduleEvaluation();
      }
    }, { once: true });
    target.appendChild(loader);
  }

  function wrapLoaderAssignment() {
    var current = hook;
    Object.defineProperty(w, hookName, {
      configurable: true,
      get: function () {
        return current;
      },
      set: function (value) {
        if (typeof value === 'function') {
          var wrapped = function () {
            var result = value.apply(this, arguments);
            scheduleEvaluation();
            return result;
          };

          wrapped.q = value.q || current.q || [];
          wrapped.loaded = value.loaded || current.loaded || false;
          current = wrapped;
        } else {
          current = value;
        }
      }
    });
  }

  function hasCreative(container) {
    if (!container) {
      return false;
    }

    if (container.querySelector('[data-ad-status="filled"], [data-ad-rendered], [data-loaded-ad="true"]')) {
      return true;
    }

    var creatives = container.querySelectorAll('iframe[src], iframe[data-src], img[src], video[src], object[data], embed[src]');
    for (var i = 0; i < creatives.length; i += 1) {
      var node = creatives[i];
      if (!node.getBoundingClientRect) {
        return true;
      }
      var rect = node.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) {
        return true;
      }
    }

    var possible = container.querySelectorAll('ins, div, section');
    for (var j = 0; j < possible.length; j += 1) {
      var el = possible[j];
      if (el === container) {
        continue;
      }
      if (el.childElementCount > 0) {
        var elRect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
        if (elRect.width > 2 && elRect.height > 2) {
          return true;
        }
      }
      if (el.textContent && el.textContent.trim().length > 0) {
        return true;
      }
    }

    return false;
  }

  function evaluate() {
    var body = d.body;
    if (!body) {
      return;
    }

    var containers = Array.prototype.slice.call(d.querySelectorAll(containerSelector));
    var hasActive = containers.some(hasCreative);

    if (hasActive) {
      body.classList.add(activeClass);
    } else {
      body.classList.remove(activeClass);
    }
  }

  var evaluateRequested = false;

  function scheduleEvaluation() {
    if (evaluateRequested) {
      return;
    }
    evaluateRequested = true;
    raf(function () {
      evaluateRequested = false;
      evaluate();
    });
  }

  function watchSlots() {
    evaluate();

    var containers = Array.prototype.slice.call(d.querySelectorAll(containerSelector));
    if (!containers.length) {
      return;
    }

    if (typeof w.MutationObserver !== 'function') {
      if (fallbackIntervalId === null) {
        fallbackIntervalId = setInterval(scheduleEvaluation, 1000);
      }
      return;
    }

    var observer = new w.MutationObserver(scheduleEvaluation);
    containers.forEach(function (container) {
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'data-ad-status', 'data-loaded-ad']
      });
    });
  }

  function initDomTracking() {
    if (d.readyState === 'loading') {
      d.addEventListener('DOMContentLoaded', initDomTracking, { once: true });
      return;
    }

    watchSlots();
  }

  wrapLoaderAssignment();
  loadVendor();

  try {
    hook('init', {
      zone: zoneKey,
      timestamp: Date.now()
    });
  } catch (initError) {
    if (w.console && typeof w.console.debug === 'function') {
      console.debug('In-Page Push init callback error', initError);
    }
  }

  initDomTracking();

  w.addEventListener('load', function () {
    scheduleEvaluation();
    if (!isNaN(recheckDelay) && recheckDelay > 0) {
      setTimeout(scheduleEvaluation, recheckDelay);
    }
  });
})();
