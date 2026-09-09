/**
 * Cloudflare Proxy — Shared JavaScript
 * Used across all pages: domain replacement, copy buttons, tab switching
 */

/**
 * Replace the 'your-domain.com' placeholder in text nodes, element attributes,
 * and JSON-LD blocks with the domain configured in config.js.
 * The domain is read ONLY from config.js — no hardcoded default.
 */
function applyDomain() {
  var domain = (window.CF_PROXY && window.CF_PROXY.DOMAIN) || '';
  if (!domain) return;

  var placeholder = 'your-domain.com';

  function swap(text) {
    return text.split(placeholder).join(domain);
  }

  function walk(node) {
    if (node.nodeType === 3) {
      // 文本节点
      if (node.textContent.indexOf(placeholder) !== -1) {
        node.textContent = swap(node.textContent);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    // 跳过 script / style
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;

    // 元素属性（canonical / og:url / og:image 等）
    for (var i = 0; i < node.attributes.length; i++) {
      var attr = node.attributes[i];
      if (attr.value.indexOf(placeholder) !== -1) {
        attr.value = swap(attr.value);
      }
    }
    for (var j = 0; j < node.childNodes.length; j++) {
      walk(node.childNodes[j]);
    }
  }

  walk(document.head);
  walk(document.body);

  // JSON-LD 中的 url（script 节点不进入上面的遍历，单独处理）
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    if (s.textContent.indexOf(placeholder) !== -1) {
      s.textContent = swap(s.textContent);
    }
  });
}

/**
 * Tab switching utility.
 * Bind to buttons with [data-tab] attribute inside a `.tab-group` container.
 */
function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var container = btn.closest('.tab-group');
      var tabId = btn.getAttribute('data-tab');

      container.querySelectorAll('[data-tab]').forEach(function (b) {
        b.classList.remove('border-brand-accent', 'text-brand-accent');
        b.classList.add('border-transparent', 'text-brand-muted');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.remove('border-transparent', 'text-brand-muted');
      btn.classList.add('border-brand-accent', 'text-brand-accent');
      btn.setAttribute('aria-selected', 'true');

      container.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.add('hidden');
      });
      var panel = document.getElementById(tabId);
      if (panel) panel.classList.remove('hidden');
    });
  });
}

/**
 * Copy button: show green checkmark for 2s after copying.
 * Bind to elements with class `.copy-btn`.
 * Looks for `<code>` inside the nearest `.code-block` container.
 */
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var block = btn.closest('.code-block');
      var code = block ? block.querySelector('code').textContent : '';
      if (!code) return;

      navigator.clipboard.writeText(code).then(function () {
        var orig = btn.innerHTML;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () { btn.innerHTML = orig; }, 2000);
      });
    });
  });
}

/**
 * Hero "开始加速" button — generate proxy URL and show it inline.
 */
function initHeroButton() {
  var input = document.getElementById('hero-input');
  var btn = document.getElementById('hero-btn');
  var result = document.getElementById('hero-result');
  var resultUrl = document.getElementById('hero-result-url');
  var resultCopy = document.getElementById('hero-copy');
  if (!input || !btn || !result || !resultUrl || !resultCopy) return;

  btn.addEventListener('click', function () {
    var val = input.value.trim();
    if (!val) return;

    var domain = (window.CF_PROXY && window.CF_PROXY.DOMAIN) || location.hostname;
    resultUrl.textContent = 'https://' + domain + '/' + val;
    result.classList.remove('hidden');
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btn.click();
  });

  resultCopy.addEventListener('click', function () {
    navigator.clipboard.writeText(resultUrl.textContent).then(function () {
      var orig = resultCopy.innerHTML;
      resultCopy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(function () { resultCopy.innerHTML = orig; }, 2000);
    });
  });
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', function () {
  applyDomain();
  initTabs();
  initCopyButtons();
  initHeroButton();
});
