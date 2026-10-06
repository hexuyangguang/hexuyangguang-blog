/* ============================================================
 * 页面渲染
 *
 * 首页 / 文章详情 / 关于 / 404 四个视图都往 <main id="app"> 里灌 HTML。
 * 文章正文和关于页的内容是运行时 fetch 对应 .md 文件再用 marked 转换的。
 * ============================================================ */

var app = document.getElementById('app');

/* ---------- 工具函数 ---------- */

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str == null ? '' : String(str)));
  return div.innerHTML;
}

/* 用于拼进 onclick / href 的字符串，先转义 HTML 再转义引号 */
function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  var parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  return parts[0] + '-' + parts[1] + '-' + parts[2];
}

/* 按中文字符数估算阅读时长，英文按 4 字符≈1 词折算 */
function estimateReadingTime(text) {
  if (!text) return '1 min';
  var chinese = (text.match(/[一-龥]/g) || []).length;
  var englishWords = (text.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  var minutes = Math.max(1, Math.ceil(chinese / 400 + englishWords / 200));
  return minutes + ' min';
}

function renderLoading() {
  return '<div class="loading"><div class="spinner"></div></div>';
}

/* marked / highlight.js 走 CDN，网络不通时会整体加载失败。
 * 提前拦一道，好把错误指向"依赖没加载"而不是"文件不存在"。 */
function requireMarked() {
  if (typeof window.marked === 'undefined' || typeof window.marked.parse !== 'function') {
    throw new Error('DEP_MISSING:marked');
  }
  return window.marked;
}

function highlightCode() {
  if (window.hljs && typeof window.hljs.highlightAll === 'function') {
    window.hljs.highlightAll();
  }
}

function getPublishedPosts() {
  return SITE_CONFIG.posts
    .filter(function (p) { return p.published; })
    .sort(function (a, b) { return b.date.localeCompare(a.date); });
}

function getCategories() {
  var cats = {};
  getPublishedPosts().forEach(function (p) {
    if (p.category) cats[p.category] = (cats[p.category] || 0) + 1;
  });
  return cats;
}

function tagLink(tag, extraClass) {
  return '<a href="#/?tag=' + encodeURIComponent(tag) + '" class="tag ' +
    (extraClass || '') + '">#' + escapeHtml(tag) + '</a>';
}

/* 导航栏有两个搜索框（桌面一个、移动端菜单里一个），保持一致 */
function syncSearchInputs(value) {
  var inputs = document.querySelectorAll('.nav-search-input');
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i].value !== value) inputs[i].value = value;
  }
}

/* ---------- 侧边栏 ---------- */

function renderSidebar(selectedTag) {
  var posts = getPublishedPosts();
  var cats = getCategories();

  var html = '<aside class="sidebar">';

  // 作者卡
  html += '<div class="sidebar-card author-card">';
  html += '  <div class="author-avatar">' + escapeHtml(SITE_CONFIG.avatarText || SITE_CONFIG.author.charAt(0)) + '</div>';
  html += '  <h3 class="author-name">' + escapeHtml(SITE_CONFIG.author) + '</h3>';
  html += '  <span class="author-title">' + escapeHtml(SITE_CONFIG.authorTitle) + '</span>';
  html += '  <p class="author-bio">' + escapeHtml(SITE_CONFIG.bio) + '</p>';
  html += '  <div class="author-stats">';
  html += '    <div class="author-stat"><span class="author-stat-label">文章</span><span class="author-stat-value">' + posts.length + '</span></div>';
  html += '    <div class="author-stat"><span class="author-stat-label">分类</span><span class="author-stat-value">' + Object.keys(cats).length + '</span></div>';
  html += '    <div class="author-stat"><span class="author-stat-label">标签</span><span class="author-stat-value">' + SITE_CONFIG.globalTags.length + '</span></div>';
  html += '  </div>';
  if (SITE_CONFIG.socials && SITE_CONFIG.socials.length) {
    html += '  <div class="author-socials">';
    SITE_CONFIG.socials.forEach(function (s) {
      html += '<a href="' + escapeAttr(s.url) + '" target="_blank" rel="noopener" class="social-btn">' + escapeHtml(s.name) + '</a>';
    });
    html += '  </div>';
  }
  html += '</div>';

  // 标签云
  html += '<div class="sidebar-card">';
  html += '  <h4 class="sidebar-card-title"><span class="sidebar-card-title-bar indigo"></span>标签</h4>';
  html += '  <div class="tag-cloud">';
  SITE_CONFIG.globalTags.forEach(function (tag) {
    html += tagLink(tag, selectedTag === tag ? 'active' : '');
  });
  html += '  </div>';
  html += '</div>';

  html += '</aside>';
  return html;
}

/* ---------- 首页 ---------- */

function renderHome(params) {
  var searchQuery = (params && params.q) || '';
  var selectedTag = (params && params.tag) || '';
  var posts = getPublishedPosts();

  if (searchQuery) {
    var q = searchQuery.toLowerCase();
    posts = posts.filter(function (p) {
      var inTitle = p.title.toLowerCase().indexOf(q) >= 0;
      var inExcerpt = (p.excerpt || '').toLowerCase().indexOf(q) >= 0;
      var inTags = (p.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
      var inCategory = (p.category || '').toLowerCase().indexOf(q) >= 0;
      return inTitle || inExcerpt || inTags || inCategory;
    });
  }

  if (selectedTag) {
    posts = posts.filter(function (p) {
      return p.tags && p.tags.indexOf(selectedTag) >= 0;
    });
  }

  var html = '<div class="container"><div class="home-layout"><div>';

  // 过滤条
  if (searchQuery || selectedTag) {
    html += '<div class="filter-bar">';
    html += '  <div>';
    html += '    <span class="filter-bar-label">当前过滤：</span>';
    if (selectedTag) html += '<span class="filter-bar-badge">#' + escapeHtml(selectedTag) + '</span>';
    if (searchQuery) html += '<span class="filter-bar-badge">“' + escapeHtml(searchQuery) + '”</span>';
    html += '  </div>';
    html += '  <a href="#/" class="filter-bar-clear">重置</a>';
    html += '</div>';
  }

  // 区块标题
  html += '<div class="section-heading">';
  html += '  <div class="section-heading-left"><span class="section-heading-bar"></span>';
  html += selectedTag ? '#' + escapeHtml(selectedTag) + ' 的文章' : '最新文章';
  html += '    <span class="section-heading-count">(' + posts.length + ')</span>';
  html += '  </div>';
  html += '</div>';

  // 文章卡片
  html += '<div class="card-list">';
  posts.forEach(function (post) {
    var url = '#/article/' + encodeURIComponent(post.slug);
    html += '<article class="card" onclick="window.location.hash=\'' + escapeAttr(url) + '\'">';
    html += '  <div class="card-meta">';
    if (post.category) html += '<span class="card-category">' + escapeHtml(post.category) + '</span>';
    html += '    <span>' + formatDate(post.date) + '</span>';
    html += '    <span>· ' + estimateReadingTime(post.excerpt) + '</span>';
    html += '  </div>';
    html += '  <h3 class="card-title"><a href="' + escapeAttr(url) + '">' + escapeHtml(post.title) + '</a></h3>';
    html += '  <p class="card-excerpt">' + escapeHtml(post.excerpt) + '</p>';
    html += '  <div class="card-bottom">';
    html += '    <div class="card-tags">';
    (post.tags || []).slice(0, 4).forEach(function (t) {
      html += tagLink(t);
    });
    html += '    </div>';
    html += '    <a href="' + escapeAttr(url) + '" class="card-read-more">查看详情 &rarr;</a>';
    html += '  </div>';
    html += '</article>';
  });

  if (!posts.length) {
    html += '<div class="empty-state">';
    html += '  <p>没有找到匹配的文章</p>';
    html += '  <a href="#/">清除筛选条件</a>';
    html += '</div>';
  }

  html += '</div></div>';
  html += renderSidebar(selectedTag);
  html += '</div></div>';

  app.innerHTML = html;
  document.title = SITE_CONFIG.title + ' · ' + SITE_CONFIG.tagline;
  syncSearchInputs(searchQuery);
  window.scrollTo(0, 0);
}

/* ---------- 文章详情 ---------- */

function renderArticle(slug) {
  var post = SITE_CONFIG.posts.filter(function (p) { return p.slug === slug; })[0];
  if (!post) {
    render404();
    return;
  }

  app.innerHTML = renderLoading();

  fetch(SITE_CONFIG.baseUrl + 'posts/' + slug + '.md')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(function (md) {
      var html = '<div class="container container--narrow">';
      html += '<article class="article-detail">';

      // 面包屑
      html += '<div class="article-breadcrumb">';
      html += '  <a href="#/" class="back-link">&larr; 返回首页</a>';
      html += '  <div class="breadcrumb-path">';
      html += '    <span>首页</span><span class="breadcrumb-sep">/</span>';
      if (post.category) html += '<span>' + escapeHtml(post.category) + '</span><span class="breadcrumb-sep">/</span>';
      html += '    <span class="breadcrumb-current">' + escapeHtml(post.title) + '</span>';
      html += '  </div>';
      html += '</div>';

      html += '<h1 class="article-title">' + escapeHtml(post.title) + '</h1>';

      html += '<div class="article-meta">';
      html += '  <span class="article-meta-item">' + escapeHtml(SITE_CONFIG.author) + '</span>';
      html += '  <span class="meta-separator">|</span>';
      html += '  <span class="article-meta-item">' + formatDate(post.date) + '</span>';
      html += '  <span class="meta-separator">|</span>';
      html += '  <span class="article-meta-item">' + estimateReadingTime(md) + '</span>';
      html += '</div>';

      html += '<div class="article-content">' + requireMarked().parse(md) + '</div>';

      if (post.tags && post.tags.length) {
        html += '<div class="article-footer">';
        html += '  <span class="article-footer-label">标签：</span>';
        post.tags.forEach(function (t) { html += tagLink(t); });
        html += '</div>';
      }

      html += '</article></div>';

      app.innerHTML = html;
      document.title = post.title + ' · ' + SITE_CONFIG.title;
      highlightCode();
      syncSearchInputs('');
      window.scrollTo(0, 0);
    })
    .catch(function (err) {
      console.error('加载文章失败：', err);
      if (err && String(err.message).indexOf('DEP_MISSING') === 0) renderDependencyError();
      else renderLoadError(slug);
    });
}

/* ---------- 关于 ---------- */

function renderAbout() {
  app.innerHTML = renderLoading();

  fetch(SITE_CONFIG.baseUrl + 'about.md')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(function (md) {
      var html = '<div class="container container--narrow">';
      html += '<article class="article-detail">';
      html += '  <div class="article-breadcrumb">';
      html += '    <a href="#/" class="back-link">&larr; 返回首页</a>';
      html += '    <div class="breadcrumb-path"><span class="breadcrumb-current">关于</span></div>';
      html += '  </div>';
      html += '  <div class="article-content">' + requireMarked().parse(md) + '</div>';
      html += '</article></div>';

      app.innerHTML = html;
      document.title = '关于 · ' + SITE_CONFIG.title;
      highlightCode();
      syncSearchInputs('');
      window.scrollTo(0, 0);
    })
    .catch(function (err) {
      console.error('加载关于页失败：', err);
      if (err && String(err.message).indexOf('DEP_MISSING') === 0) renderDependencyError();
      else render404();
    });
}

/* ---------- 404 / 加载失败 ---------- */

function render404() {
  var html = '<div class="container container--narrow">';
  html += '  <div class="not-found">';
  html += '    <h1 class="not-found-title">404</h1>';
  html += '    <p class="not-found-text">这个页面不存在，或者已经被移走了</p>';
  html += '    <a href="#/" class="back-link">&larr; 返回首页</a>';
  html += '  </div>';
  html += '</div>';

  app.innerHTML = html;
  document.title = '404 · ' + SITE_CONFIG.title;
  syncSearchInputs('');
}

/* CDN 依赖（marked）没加载成功时的提示。
 * 国内网络访问 jsdelivr 偶尔会失败，这时提示"文件不存在"会把人带偏。 */
function renderDependencyError() {
  var html = '<div class="container container--narrow">';
  html += '  <div class="not-found">';
  html += '    <h1 class="not-found-title">:(</h1>';
  html += '    <p class="not-found-text">Markdown 解析库加载失败</p>';
  html += '    <p class="not-found-text" style="font-size:12px;line-height:1.9;">';
  html += '      页面依赖 CDN 上的 marked 库，可能是网络不通或 CDN 被拦截。<br>';
  html += '      请刷新重试；若持续失败，可把库文件下载到本地并修改 index.html 的引用路径（见 README）。';
  html += '    </p>';
  html += '    <a href="#/" class="back-link">&larr; 返回首页</a>';
  html += '  </div>';
  html += '</div>';

  app.innerHTML = html;
  document.title = '依赖加载失败 · ' + SITE_CONFIG.title;
}

/* 元数据里有、但 .md 文件缺失或路径不对时的提示 */
function renderLoadError(slug) {
  var html = '<div class="container container--narrow">';
  html += '  <div class="not-found">';
  html += '    <h1 class="not-found-title">:(</h1>';
  html += '    <p class="not-found-text">文章正文加载失败</p>';
  html += '    <p class="not-found-text" style="font-size:12px;font-family:var(--font-mono);">';
  html += '      请确认文件存在：<code>' + escapeHtml(SITE_CONFIG.baseUrl + 'posts/' + slug + '.md') + '</code>';
  html += '    </p>';
  html += '    <p class="not-found-text" style="font-size:12px;">';
  html += '      若你是用 file:// 直接打开的页面，请改用本地服务器（见 README）。';
  html += '    </p>';
  html += '    <a href="#/" class="back-link">&larr; 返回首页</a>';
  html += '  </div>';
  html += '</div>';

  app.innerHTML = html;
  document.title = '加载失败 · ' + SITE_CONFIG.title;
}
