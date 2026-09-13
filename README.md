# Cloudflare Proxy — GitHub/Docker 加速站

基于 Cloudflare Pages + Worker 的自建加速代理：GitHub Clone/Release/Raw 下载加速、Docker Hub 镜像代理，兼容 GHCR / Quay / GCR 等第三方 Registry。零构建、零依赖、免费部署。

## 功能特性

| 能力 | 说明 |
|------|------|
| GitHub 加速 | `git clone`、Release 附件、Raw 文件、Archive 归档，通过 `/https://github.com/...` 路径代理 |
| Docker 镜像 | Registry Mirror 方式代理 Docker Hub；`docker pull 你的域名/nginx` 单次拉取 |
| 多 Registry | 自动识别 `ghcr.io`、`quay.io`、`gcr.io`、`registry.k8s.io` 等，无需单独配置 |
| 自动鉴权 | 拦截 401 挑战 → 获取 Bearer Token → 自动重试；支持 `docker login` 透传账号配额，规避匿名限流 |
| S3 反代 | 拦截 302/307 重定向到 AWS S3 的响应并重新代理，解决国内直连 S3 慢的问题 |
| 边缘缓存 | Docker blob 缓存 7 天、GitHub raw/archive 缓存 1 小时，命中后不回源 |
| 防滥用 | 拦截扫描器 UA，屏蔽 `/v2/_catalog` 枚举接口 |

## 快速使用

部署后，把目标地址拼在加速域名后面：

```bash
# Git Clone
git clone https://你的域名/https://github.com/user/repo.git

# 下载 Release
wget https://你的域名/https://github.com/user/repo/releases/download/v1.0/file.zip

# Docker 拉取（单次）
docker pull 你的域名/library/nginx:latest
```

Docker 常驻加速：修改 `/etc/docker/daemon.json` 添加 `"registry-mirrors": ["https://你的域名"]` 后重启 Docker。

## 部署（Cloudflare Pages，约 5 分钟）

1. Fork 本仓库：[github.com/DecodeAZ/cloudflare-proxy](https://github.com/DecodeAZ/cloudflare-proxy)
2. Cloudflare Dashboard → Workers & Pages → 创建 → Pages → 连接 Git，选中 Fork 的仓库
3. 构建配置全部留空：构建命令为空、输出目录填 `/`
4. 编辑 `assets/js/config.js`，将 `DOMAIN` 改为你的实际域名（页面会自动替换所有示例中的占位符）
5. 绑定自定义域名（可选）：Pages 项目 → 自定义域 → 添加 CNAME

也可以用 Wrangler 命令行部署（配置见 `wrangler.jsonc`）：

```bash
npx wrangler deploy
```

## 项目结构

```
_worker.js            Worker：代理路由、Docker 鉴权、S3 反代、缓存、防滥用
index.html            首页（功能介绍、快速上手、FAQ）
gh.html               GitHub 加速页（代理链接生成器）
docker.html           Docker 加速页（各 OS 配置教程）
docs.html             部署文档页
assets/js/config.js   站点域名配置
assets/js/layout.js   公共布局（Tailwind 配置、导航栏、页脚，JS 注入）
assets/js/main.js     公共逻辑（占位域名替换、标签页、复制按钮）
assets/js/gh.js       GitHub 页链接生成逻辑
assets/js/docker.js   Docker 页系统标签切换
```

## 常见问题

- **收费吗？** 不收费。Workers 免费计划每日 10 万次请求，个人使用足够。
- **Docker 拉取报 429 / TOOMANYREQUESTS？** Docker Hub 对匿名拉取限流（100 次/6 小时）且所有用户共享代理出口 IP。执行 `docker login 你的域名` 用自己的 Docker Hub 账号登录一次即可改用个人配额（免费账户 200 次/6 小时）。
- **支持 SSH（git@）地址吗？** 不支持，Worker 只处理 HTTP/HTTPS。
- **想代理其他网站？** 在 `_worker.js` 的 `ALLOWED_HOSTS` 数组中添加目标域名。

## 许可

仅供个人学习与自用，请遵守所在地区法律法规及上游服务条款。
