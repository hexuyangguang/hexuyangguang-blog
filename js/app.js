/* ============================================================
 * 启动引导：注册路由、绑定导航交互
 * ============================================================ */

/* ---------- 路由表 ----------
 * 顺序有意义：首页的宽松匹配要放在最前面，但它带了 $ 锚定，
 * 不会误吞 #/about 和 #/article/xxx。 */

Router.addRoute(/^#\/(?:home)?(?:\?(.*))?$/, function (query) {
  renderHome(Router.parseQuery(query));
});

Router.addRoute(/^#\/article\/([^?]+)/, function (slug) {
  var decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch (e) {}
  renderArticle(decoded);
});

Router.addRoute(/^#\/about(?:\?.*)?$/, function () {
  renderAbout();
});

/* ---------- 搜索 ---------- */

function handleSearch(value) {
  syncSearchInputs(value);

  var q = (value || '').trim();
  var next = q ? '#/?q=' + encodeURIComponent(q) : '#/';

  var hash = window.location.hash;
  var isHome = !hash || hash === '#/' || hash.indexOf('#/?') === 0;

  // 不在首页（比如正看文章）：正常跳回首页并带上查询条件
  if (!isHome) {
    window.location.hash = next;
    return;
  }

  // 首页内搜索：用 replaceState 更新地址栏但不等价于导航，
  // 所以不会触发 hashchange 重复渲染，也不会每敲一个字就压一条历史记录
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.href.split('#')[0] + next);
  } else {
    window.location.hash = next;
    return;
  }

  renderHome(Router.parseQuery(next));
}

/* 搜索框回车时取消焦点，方便看结果 */
function handleSearchKeydown(e) {
  if (e.key === 'Enter') e.target.blur();
}

/* ---------- 导航交互 ---------- */

function toggleMobileMenu() {
  var menu = document.getElementById('navMenu');
  if (menu) menu.classList.toggle('open');
}

function initBackToTop() {
  var btn = document.getElementById('backToTop');
  if (!btn) return;

  var onScroll = function () {
    if (window.scrollY > 400) btn.classList.add('visible');
    else btn.classList.remove('visible');
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* 点击页面空白处收起移动端菜单 */
function initOutsideClick() {
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('navMenu');
    var toggle = document.getElementById('mobileToggle');
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(e.target) || (toggle && toggle.contains(e.target))) return;
    menu.classList.remove('open');
  });
}

/* ---------- 启动 ---------- */

document.addEventListener('DOMContentLoaded', function () {
  Theme.init();
  initBackToTop();
  initOutsideClick();
  Router.start();
});
