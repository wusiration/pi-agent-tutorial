# 部署文档

本文档介绍如何将 VitePress 教程站点部署到各种静态托管平台。

---

## 构建产物

```bash
cd pi-agent-tutorial
npm install
npm run docs:build
```

构建完成后，静态文件位于：

```
docs/.vitepress/dist/
├── index.html
├── 404.html
├── assets/           # JS/CSS/字体资源
├── guide/            # 原理篇页面
├── demos/            # Demo 篇页面
├── project/          # 项目篇页面
└── logo.svg
```

这是一个纯静态站点，可以部署到任何支持静态文件托管的平台。

---

## 部署到 GitHub Pages

### 方法一：GitHub Actions 自动部署（推荐）

1. **创建 GitHub 仓库**并推送代码

```bash
git init
git add .
git commit -m "init: 教程站点"
git remote add origin https://github.com/YOUR_NAME/pi-agent-tutorial.git
git push -u origin main
```

2. **创建部署配置文件**

```yaml
# .github/workflows/deploy.yml
name: Deploy VitePress to GitHub Pages

on:
  push:
    branches: [main]

  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

3. **配置 GitHub Pages**

- 进入仓库 Settings → Pages
- Source 选择 "GitHub Actions"
- 等待首次部署完成

4. **访问站点**

```
https://YOUR_NAME.github.io/pi-agent-tutorial/
```

> ⚠️ 注意：如果仓库名不是 `pi-agent-tutorial`，需要同步修改 `docs/.vitepress/config.mts` 中的 `base` 配置。

---

## 部署到 Vercel

### 方法一：Vercel CLI

```bash
# 1. 安装 Vercel CLI
npm i -g vercel

# 2. 登录
vercel login

# 3. 部署（在项目根目录执行）
vercel --prod

# 按照提示配置：
# - Set up and deploy? [Y/n] → Y
# - Which scope? → 选择你的账户
# - Link to existing project? [y/N] → N
# - What's your project name? → pi-agent-tutorial
# - In which directory is your code located? → ./
# - Want to modify these settings? [y/N] → N
```

### 方法二：Git 集成（推荐）

1. 在 [Vercel Dashboard](https://vercel.com/dashboard) 点击 "Add New Project"
2. 导入 GitHub 仓库
3. 配置构建命令：
   - Framework Preset: `VitePress`
   - Build Command: `npm run docs:build`
   - Output Directory: `docs/.vitepress/dist`
4. 点击 Deploy

### 配置 vercel.json（可选）

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    { "source": "/:path*", "destination": "/:path*.html" }
  ]
}
```

---

## 部署到 Netlify

### 方法一：Drop 部署（最简单）

1. 本地构建：`npm run docs:build`
2. 将 `docs/.vitepress/dist/` 目录压缩为 zip
3. 登录 [Netlify](https://app.netlify.com/drop)
4. 拖拽 zip 文件到 Drop 区域

### 方法二：Git 集成

1. 在 Netlify 点击 "Add new site" → "Import an existing project"
2. 选择 GitHub 仓库
3. 配置构建设置：
   - Build command: `npm run docs:build`
   - Publish directory: `docs/.vitepress/dist`
4. 点击 Deploy site

### 配置 netlify.toml

```toml
[build]
  command = "npm run docs:build"
  publish = "docs/.vitepress/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 部署到 Cloudflare Pages

### 方法一：Wrangler CLI

```bash
# 1. 安装 Wrangler
npm i -g wrangler

# 2. 登录
wrangler login

# 3. 构建
npm run docs:build

# 4. 部署
wrangler pages deploy docs/.vitepress/dist --project-name=pi-agent-tutorial
```

### 方法二：Git 集成

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Pages → Create a project
3. 连接 GitHub 仓库
4. 构建设置：
   - Build command: `npm run docs:build`
   - Build output directory: `docs/.vitepress/dist`
5. 保存并部署

---

## 部署到自有服务器（Nginx）

### 1. 构建并上传

```bash
# 本地构建
npm run docs:build

# 上传到服务器（示例）
rsync -avz docs/.vitepress/dist/ user@your-server:/var/www/pi-agent-tutorial/
```

### 2. Nginx 配置

```nginx
server {
    listen 80;
    server_name docs.your-domain.com;
    root /var/www/pi-agent-tutorial;
    index index.html;

    # 支持 clean URLs
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    # 缓存静态资源
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 404 页面
    error_page 404 /404.html;
}
```

### 3. 启用 HTTPS（Let's Encrypt）

```bash
sudo certbot --nginx -d docs.your-domain.com
```

---

## 配置检查清单

部署前请确认：

- [ ] `docs/.vitepress/config.mts` 中的 `base` 配置正确
  - 自定义域名：`base: '/'`
  - GitHub Pages（项目页）：`base: '/pi-agent-tutorial/'`
- [ ] `npm run docs:build` 本地构建成功
- [ ] 构建产物中所有链接可正常访问
- [ ] 站点 Logo 和 favicon 正常显示

---

## 故障排查

### 页面 404

**原因**：`base` 配置不匹配，或服务器未配置 clean URLs

**解决**：
- 检查 `config.mts` 中的 `base` 是否与部署路径一致
- 确认服务器配置了 `try_files $uri $uri.html`

### 资源加载失败（CSS/JS 404）

**原因**：`base` 路径错误，导致资源引用路径不对

**解决**：
```ts
// 如果部署到 https://user.github.io/repo-name/
// base 应该设置为：
base: '/repo-name/'
```

### 搜索功能不工作

**原因**：VitePress 的 local search 需要在构建时生成索引

**解决**：确保构建命令正确执行，且 `config.mts` 中启用了 `search: { provider: 'local' }`

---

## 自动部署配置参考

| 平台 | 触发方式 | 配置位置 |
|------|---------|---------|
| GitHub Pages | Git push | `.github/workflows/deploy.yml` |
| Vercel | Git push | Vercel Dashboard / `vercel.json` |
| Netlify | Git push | Netlify Dashboard / `netlify.toml` |
| Cloudflare Pages | Git push | Cloudflare Dashboard |
| 自有服务器 | 手动/CI | `rsync` + `ssh` |

---

> 💡 **推荐**：对于开源教程项目，GitHub Pages + GitHub Actions 是最简单且免费的方案。如果需要更快的全球访问速度，可选择 Cloudflare Pages 或 Vercel。
