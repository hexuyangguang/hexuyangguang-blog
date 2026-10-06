# 和煦阳光 · 嵌入式技术博客

一个纯静态的个人技术博客，原生 HTML + CSS + JavaScript，无框架、无构建步骤。文章以 Markdown 文件存放，运行时由前端加载渲染。

## 特性

- **文章列表** —— 按日期倒序，含分类徽章、阅读时长、标签
- **文章详情** —— Markdown 渲染 + 代码语法高亮 + 面包屑导航
- **关于页** —— 同样由 Markdown 驱动
- **搜索与标签筛选** —— 导航栏实时搜索，标签云点击筛选，两者可叠加，过滤条件进 URL 可分享
- **侧边栏** —— 作者卡（含文章/分类/标签统计、社交链接）+ 标签云
- **深色模式** —— 跟随系统偏好，可手动切换，选择持久化到 localStorage
- **响应式** —— 1024px 以下侧边栏堆叠，768px 以下切换为移动端导航
- **双平台部署** —— 同一份代码同时兼容 GitHub Pages 子路径和 EdgeOne Pages 根路径

## 目录结构

```
demo_blog/
├── index.html            页面骨架（导航 + 内容容器 + 页脚）
├── css/
│   ├── style.css         设计令牌、导航、卡片、侧边栏、页脚、深色模式
│   ├── article.css       文章详情与 Markdown 正文排版
│   └── responsive.css    响应式断点
├── js/
│   ├── config.js         站点配置与文章元数据  ← 日常只改这个文件
│   ├── theme.js          深色模式逻辑
│   ├── router.js         Hash 路由
│   ├── renderer.js       页面渲染
│   └── app.js            启动引导
├── posts/                文章正文（Markdown）
├── about.md              关于页正文
└── .nojekyll             供 GitHub Pages 使用
```

## 本地预览

> **必须用本地服务器打开。** 直接双击 `index.html`（`file://` 协议）时，浏览器会因 CORS 策略拦截 `fetch`，导致文章正文加载失败。

任选一种：

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .
```

然后访问 <http://localhost:8000>。

## 日常写作

### 新增一篇文章

**第一步**，在 `posts/` 下新建 `<slug>.md`，文件名就是文章标识（建议用英文短横线命名，例如 `my-new-post.md`）：

````markdown
## 一级小节

正文内容，支持标准 Markdown 语法和代码块：

```c
int main(void) { return 0; }
```
````

**第二步**，在 `js/config.js` 的 `posts` 数组里加一条元数据，`slug` 必须和文件名（去掉 `.md`）一致：

```js
{
  slug: 'my-new-post',
  title: '文章标题',
  date: '2026-10-06',
  category: '外设驱动',
  tags: ['STM32', '调试'],
  excerpt: '列表页显示的文章摘要，建议 50-80 字。',
  published: true
}
```

保存并刷新页面即可看到。把 `published` 改成 `false` 可以临时下架文章。

### 修改站点信息

`js/config.js` 顶部的 `title`、`author`、`bio`、`socials` 等字段控制全站品牌信息。

**社交链接目前是占位地址（`https://github.com/yourname` 等），记得换成你自己的。**

### 想加一个标签

标签云由 `js/config.js` 的 `globalTags` 数组驱动。新增标签只需在数组里加一项，同时在相关文章的 `tags` 里引用它。标签页按 `#/?tag=标签名` 访问。

## 部署

### GitHub Pages

1. 把项目推到一个 GitHub 仓库：

   ```bash
   git init
   git add .
   git commit -m "初始化博客"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 进入仓库的 **Settings → Pages**，`Source` 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。
3. 等一两分钟，站点会发布在 `https://<你的用户名>.github.io/<仓库名>/`。

**关于路径**：项目页部署在 `/<仓库名>/` 子路径下。`js/config.js` 里的 `baseUrl` 会在运行时自动推导出这个前缀，**不需要手动改任何配置**。`.nojekyll` 文件已包含，用于阻止 Jekyll 处理静态资源。

> 如果仓库名是 `<用户名>.github.io`（用户主页），站点会部署在根路径，同样无需改配置。

### EdgeOne Pages

1. 把代码推送到 GitHub / GitLab / Gitee 仓库。
2. 登录腾讯云 EdgeOne 控制台，创建 Pages 项目并关联该仓库。
3. 构建设置：
   - **构建命令**：留空（本项目无需构建）
   - **输出目录**：`/`（或留空）
4. 部署完成后会分配一个 `*.edgeone.app` 域名，也可以绑定自己的域名。

站点部署在根路径，`baseUrl` 会自动推导为 `/`。

### 其他静态托管

Netlify、Vercel、Cloudflare Pages、对象存储静态网站托管等都可以，把整个目录作为站点根目录上传即可，无需任何构建配置。

## 自定义外观

所有颜色都定义在 `css/style.css` 顶部的 CSS 变量里，分浅色 `:root` 和深色 `[data-theme='dark']` 两组。改品牌色最直接的方式是替换这一组：

```css
:root {
  --color-brand-blue: #2563eb;   /* 主色：链接、按钮、强调 */
  --color-brand-deep: #0b1e36;   /* 深色：区块标题装饰条 */
  --color-brand-primary: #123456;/* 导航 logo 底色 */
}
```

同时记得改 `[data-theme='dark']` 里的对应值。整站的主题变量是成对的，改一处就够了——组件样式全部引用变量，不需要逐一调整。

## 技术说明

- **路由**：使用 Hash 路由（`#/article/xxx`）而非 History API，因此服务端不需要任何重写规则，任意页面刷新都不会 404。
- **baseUrl**：在 `js/config.js` 中由 `location.pathname` 运行时推导，这是同一份代码能同时适配子路径和根路径部署的原因。
- **运行时依赖**：marked（Markdown 解析）和 highlight.js（代码高亮）通过 CDN 引入。如果需要离线或内网部署，把这两个库下载到本地并修改 `index.html` 里的引用路径即可。
- **浏览器支持**：需要支持 ES5、CSS 自定义属性、`fetch` 和 `matchMedia` 的现代浏览器（Chrome / Edge / Firefox / Safari 近几年版本均可）。
