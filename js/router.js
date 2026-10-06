/* ============================================================
 * Hash 路由
 *
 * 之所以用 hash（#/article/xxx）而不是 history API，是因为它
 * 不需要服务端做任何重写规则：GitHub Pages 和 EdgeOne Pages
 * 都能开箱即用，刷新任意页面也不会 404。
 * ============================================================ */

var Router = (function () {
  var routes = [];

  function addRoute(pattern, handler) {
    routes.push({ pattern: pattern, handler: handler });
  }

  function navigate() {
    var hash = window.location.hash || '#/';
    for (var i = 0; i < routes.length; i++) {
      var match = hash.match(routes[i].pattern);
      if (match) {
        routes[i].handler(match[1]);
        updateActiveNav(hash);
        return;
      }
    }
    if (typeof render404 === 'function') {
      render404();
    }
  }

  /* 解析 #/?tag=xxx&q=yyy 形式的查询参数
   * 传入完整 hash 或裸查询串（tag=xxx&q=yyy）都可以 */
  function parseQuery(input) {
    var out = {};
    if (!input) return out;

    var str = String(input);
    var hashAt = str.indexOf('#');
    if (hashAt >= 0) str = str.slice(hashAt + 1);

    var qs = str.indexOf('?') >= 0 ? str.slice(str.indexOf('?') + 1) : str;
    if (!qs) return out;
    qs.split('&').forEach(function (pair) {
      if (!pair) return;
      var idx = pair.indexOf('=');
      var key = idx < 0 ? pair : pair.slice(0, idx);
      var val = idx < 0 ? '' : pair.slice(idx + 1);
      try {
        out[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, ' '));
      } catch (e) {
        out[key] = val;
      }
    });
    return out;
  }

  function updateActiveNav(hash) {
    var links = document.querySelectorAll('.nav-link');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.remove('active');
    }

    var activePage = '';
    if (hash === '#/' || hash === '#/home' || hash.indexOf('#/?') === 0) {
      activePage = 'home';
    } else if (hash === '#/about') {
      activePage = 'about';
    }
    if (activePage) {
      var activeLink = document.querySelector('.nav-link[data-page="' + activePage + '"]');
      if (activeLink) activeLink.classList.add('active');
    }

    // 移动端导航后自动收起菜单
    var menu = document.getElementById('navMenu');
    if (menu) menu.classList.remove('open');
  }

  function start() {
    window.addEventListener('hashchange', navigate);
    navigate();
  }

  return {
    addRoute: addRoute,
    start: start,
    parseQuery: parseQuery
  };
})();
