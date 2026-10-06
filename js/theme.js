/* ============================================================
 * 深色模式
 *
 * 优先级：localStorage 里的手动选择 > 系统偏好
 * 主题写在 <html data-theme="dark"> 上，CSS 侧只需覆盖一组
 * 颜色变量，组件样式完全不用改。
 *
 * 防闪烁（FOUC）的初始化脚本内联在 index.html 的 <head> 里，
 * 那个必须同步执行，不能放到这里。
 * ============================================================ */

var Theme = (function () {
  var STORAGE_KEY = 'blog-theme';
  var root = document.documentElement;

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function syncHighlightTheme(theme) {
    // highlight.js 的明暗两套主题同时引入，靠 disabled 切换
    var light = document.getElementById('hljs-light');
    var dark = document.getElementById('hljs-dark');
    if (light) light.disabled = theme === 'dark';
    if (dark) dark.disabled = theme !== 'dark';
  }

  function syncToggleIcon(theme) {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var isDark = theme === 'dark';
    btn.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
    btn.setAttribute('aria-label', btn.getAttribute('title'));
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    syncHighlightTheme(theme);
    syncToggleIcon(theme);
  }

  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      /* 隐私模式下 localStorage 可能不可用，忽略即可 */
    }
  }

  function init() {
    apply(current());

    // 用户没手动选过时，跟随系统主题实时变化
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function (e) {
        var saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (err) {}
        if (!saved) apply(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  return {
    init: init,
    toggle: toggle,
    current: current
  };
})();
