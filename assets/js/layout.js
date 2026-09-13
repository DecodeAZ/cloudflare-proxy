/**
 * Cloudflare Proxy — Shared Layout
 * =================================
 * 所有页面共用的 Tailwind 配置、导航栏与页脚。
 * 在 <head> 中于 tailwind CDN 脚本之后加载；导航/页脚在 DOM ready 时注入。
 * 当前页高亮根据 location.pathname 自动判断，新增页面无需改这里以外的任何代码。
 */

tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          bg: '#0F172A',
          card: '#1E293B',
          hover: '#334155',
          border: '#334155',
          text: '#F8FAFC',
          muted: '#94A3B8',
          accent: '#22C55E',
          'accent-hover': '#16A34A',
        }
      }
    }
  }
};

(function () {
  var GH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>';
  var LOGO_SVG = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" class="shrink-0"><rect width="28" height="28" rx="7" fill="#22C55E"/><path d="M8 14h4l2-6 4 12 2-6h4" stroke="#0F172A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var NAV_LINKS = [
    { href: '/', label: '首页' },
    { href: '/gh.html', label: 'GitHub 加速' },
    { href: '/docker.html', label: 'Docker 加速' },
    { href: '/docs.html', label: '文档' },
  ];

  function isActive(href) {
    var path = location.pathname;
    if (href === '/') return path === '/' || path === '/index.html';
    return path === href;
  }

  function renderNav() {
    var links = NAV_LINKS.map(function (l) {
      var cls = isActive(l.href)
        ? 'px-3.5 py-2 rounded-lg bg-brand-accent/15 text-brand-accent transition-colors duration-200'
        : 'px-3.5 py-2 rounded-lg text-brand-muted hover:text-brand-text hover:bg-brand-hover/50 transition-colors duration-200';
      return '<a href="' + l.href + '" class="' + cls + '">' + l.label + '</a>';
    }).join('');

    return '' +
'<nav class="fixed top-4 left-4 right-4 z-50 max-w-6xl mx-auto bg-brand-card/80 backdrop-blur-xl border border-brand-border rounded-2xl px-6 py-3 flex items-center justify-between shadow-lg shadow-black/20">' +
  '<a href="/" class="flex items-center gap-2.5 font-semibold text-lg tracking-tight">' + LOGO_SVG +
    '<span class="hidden sm:inline">Cloudflare Proxy</span></a>' +
  '<div class="flex items-center gap-1 text-sm font-medium">' + links +
    '<a href="https://github.com/DecodeAZ/cloudflare-proxy" target="_blank" rel="noopener" class="ml-2 p-2 rounded-lg text-brand-muted hover:text-brand-text hover:bg-brand-hover/50 transition-colors duration-200 cursor-pointer" aria-label="GitHub">' + GH_SVG + '</a>' +
  '</div>' +
'</nav>';
  }

  var FOOTER_HTML = '' +
'<footer class="border-t border-brand-border py-10 px-4 sm:px-6 lg:px-8">' +
  '<div class="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-brand-muted">' +
    '<div class="flex items-center gap-2">' +
      '<svg width="22" height="22" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="#22C55E"/><path d="M8 14h4l2-6 4 12 2-6h4" stroke="#0F172A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<span class="text-brand-text font-medium">Cloudflare Proxy</span>' +
    '</div>' +
    '<div class="flex items-center gap-6">' +
      '<a href="/" class="hover:text-brand-text transition-colors duration-200">首页</a>' +
      '<a href="/gh.html" class="hover:text-brand-text transition-colors duration-200">GitHub 加速</a>' +
      '<a href="/docker.html" class="hover:text-brand-text transition-colors duration-200">Docker 加速</a>' +
      '<a href="/docs.html" class="hover:text-brand-text transition-colors duration-200">文档</a>' +
    '</div>' +
    '<span>Powered by Cloudflare Pages</span>' +
  '</div>' +
'</footer>';

  function injectLayout() {
    document.body.insertAdjacentHTML('afterbegin', renderNav());
    document.body.insertAdjacentHTML('beforeend', FOOTER_HTML);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLayout);
  } else {
    injectLayout();
  }
})();
