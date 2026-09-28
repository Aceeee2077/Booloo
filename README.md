<div align="center">

<img src="docs/brand/prismoo-icon.png" width="128" height="128" alt="Prismoo 桌宠图标" />

# Prismoo · 轻量桌宠

一只常驻桌面的透明小宠物：会走动、会打瞌睡，也会因为你拖来一张照片而开心。

[![Release](https://img.shields.io/github/v/release/Aceeee2077/Prismoo?label=release&color=ff8fb0)](https://github.com/Aceeee2077/Prismoo/releases)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-4c8bf5)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![Rust](https://img.shields.io/badge/Rust-1.77.2%2B-dea584)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![License](https://img.shields.io/badge/license-MIT-3da639)

</div>

## 预览

桌宠常驻在最上层，不占任务栏、不进 Alt+Tab：

![桌宠在桌面上](docs/screenshots/lightweight-pet.png)

从托盘菜单或右键菜单打开设置，换宠物、导入自己的图片、调大小与透明度：

![设置面板](docs/screenshots/lightweight-settings.png)

## 功能

- **五只内置宠物** — 猫、狐狸、兔子、布噜、机器人。右键可选择「挥爪」「舔爪」「伸懒腰」「打哈欠」；布噜会播放专属姿势动画（`src/assets/animated-pets/bulu-actions.webp`），其他内置宠物沿用现有的互动或睡眠帧。
- **换成自己的图片** — 图片先进入预览，确认画面完整后再替换；可选「去掉纯色背景」，抠图若会使主体消失，应用会保留原图。
- **自动抠图 + 手动微调** — 预览里点「手动微调抠图…」打开独立编辑窗口：Rust 后端先在本地生成初始蒙版，再用「擦除背景 / 恢复主体」笔刷修边缘，可调笔刷大小与边缘硬度；支持撤销 / 重做（Ctrl+Z / Ctrl+Y）、滚轮缩放、平移、原图对比和「重新抠图」（可调强度与羽化）。图片不上传，保存结果是透明 PNG。
- **拖文件互动** — 把文件拖到桌宠身上，它会按图片、文档、压缩包、音乐或视频说一句话并做出短暂动作。只识别扩展名，不读取或改动文件内容；可在「日常设置」关闭。
- **摸摸头** — 在桌宠头部左右轻轻移动鼠标，桌宠会冒爱心。
- **站立提醒** — 默认开启、间隔 5 分钟，也可选 10、20、30 分钟或自定义 1～240 分钟。到点后桌宠会跑到当前屏幕中央，说「老板，该站起来活动活动了！」。
- **睡觉与报时** — 睡着时会偶尔冒出短暂的梦境气泡；整点轻报时默认开启，电脑休眠期间错过的整点不会补报。
- **中英双语界面** — 「日常设置」里可切换 中文 / English，桌宠气泡、右键菜单、设置面板和托盘提示会一起切换，选择会被记住。
- **自动更新** — 安装版启动几秒后自动检查新版本（可在设置里关掉），有新版就后台下载并让桌宠提醒你；设置里的「🔄 更新」区块可以手动检查、看下载进度、一键重启安装。安装包来自本仓库的 GitHub Releases，带 minisign 签名校验。
- **日常设置** — 宠物大小、透明度、自主走动、开机启动、重置位置。

单张图片使用轻微的呼吸和点击动画，不会自动生成走路或睡觉姿势；内置宠物使用逐帧素材。

## 使用

1. 在托盘菜单中打开「设置」。
2. 选择内置宠物，或点击「导入我的图片」。
3. 图片会先进入预览；确认画面完整后点击「使用这张图片」。取消不会替换当前宠物。
4. 「去掉纯色背景」仅适合背景颜色较一致的图片。抠图若会使主体消失，应用会保留原图。透明 PNG 无需再次抠图。
5. 想要更干净的边缘，点「手动微调抠图…」：窗口左侧选笔刷与参数，中间涂抹（右键或按住空格拖动可平移，滚轮缩放），右侧实时对比原图与抠图效果，满意后点「使用这张图片」。

## 自动更新

- **客户端** — `src-tauri/src/updater.rs` 把 `tauri-plugin-updater` 包成 `update_get_state / update_check / update_download / update_install / update_install_when_ready` 几个命令：设置面板的「🔄 更新」区块和桌宠的更新气泡都调它们。更新地址与公钥写在 `src-tauri/tauri.conf.json` 的 `plugins.updater`。
- **发布端** — `.github/workflows/release.yml` 在推送 `v*` 标签（或手动触发）时先校验签名密钥，再用 `tauri-action` 构建 NSIS 安装包，并把安装包 + `latest.json` + `.sig` 一起发到 Releases；客户端检查更新时读的就是那份 `latest.json`。
- **版本号** — `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处必须一致，且新 tag 要大于已安装版本，否则客户端会认为已是最新。
- **本地打包** — 因为开了 `createUpdaterArtifacts`，`npm run dist:win` 需要 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（与 CI secret 相同），否则会在签名一步失败；只想本地验证功能用 `npm run tauri:check`，不需要密钥。

## 技术栈

| 层次 | 选型 | 在这一版里负责什么 |
| :--- | :--- | :--- |
| 桌面外壳 | **Tauri 2** | 透明、无边框、置顶、跳过任务栏的窗口；托盘图标与原生右键菜单；单实例、开机启动、原生文件对话框 |
| 后端 | **Rust 2021** | 配置读写与迁移、窗口拖拽 / 定位 / 多屏边界吸附、点击穿透、托盘，以及用 `include_str!` 把 i18n 词条编进二进制 |
| 前端 | **TypeScript 5**（无框架） | 8 个脚本文件直接用 `<script>` 加载：桌宠主循环、设置面板、抠图编辑窗口、右键菜单、Tauri 调用封装、图片导入、文件类型反应、i18n 运行时 |
| 国际化 | **中英双字典 + `config.locale`** | 词条集中在 `src/shared/i18n.ts`，编译进 Rust 侧后用 `i18n_get` 交给页面；切换语言只需一次 `config_set`，托盘、气泡、菜单一起跟随 |
| 渲染 | **Canvas 2D** | 逐帧播放精灵表与姿势图集、图片导入预览、抠图蒙版编辑（`destination-out` 擦除 + 羽化笔刷），并按像素透明度做命中检测 |
| 资源生成 | **Node.js 脚本 + sharp** | 程序化生成像素精灵表与品牌图标（PNG / ICO / ICNS），并把 `src/shared/i18n.ts` 导出成 Rust 侧读取的 JSON |
| 打包 | **Tauri CLI + NSIS** | `npm run dist:win` 直接产出 Windows 安装包 |
| 持续集成 | **GitHub Actions** | 推送 `v*` 标签后自动构建、校验签名密钥，并发布安装包与自动更新用的 `latest.json` / `.sig` |

## 开发

```bash
npm install
npm run build      # 生成精灵表与图标 → tsc → 拷贝页面资源 → 导出 src-tauri/resources/i18n.json
npm test           # 轻量页面行为测试（Node）+ Rust 单元测试
npm run screenshots # 重新生成 README 配图（中英各一套，需要本机有 Chrome / Edge）
npm run tauri:dev  # 开发模式启动
npm run dist:win   # 打 Windows 安装包
```

环境要求：Windows 10/11 + WebView2 运行时；Node.js 20+；Rust 1.77.2+（仅从源码构建时需要）。
`npm run tauri:check` 会构建并启动真实窗口做自检，需要一个可用的 Windows WebView2 图形会话。

## 目录结构

```text
src/renderer/      桌宠页面 index.html、设置页 settings.html、抠图窗口 mask.html、右键菜单 menu.html
  lite-app.ts      桌宠主循环：动画、拖拽、睡觉、站立提醒、整点报时
  lite-settings.ts 设置面板  ·  lite-mask.ts 抠图微调  ·  lite-menu.ts 右键菜单
  lite-api.ts      Tauri 调用封装（窗口 / 配置 / 拖拽 / 事件）
  lite-image.ts    图片导入：纯色背景抠图与预览
  lite-i18n.ts     中英文切换：词典、占位符替换、data-i18n 静态文案
src/shared/        前后端共用的类型与 i18n 词条（i18n.ts 是词条唯一来源）
src-tauri/         Rust 后端：窗口、托盘、配置、自定义图片、i18n
  cutout.rs        自动抠图：边界取色 + 泛洪填充生成初始蒙版（换模型只需替换 segment()）
src/assets/        动画素材与品牌图标（精灵表和图标由 npm run build 生成）
scripts/           构建、资源生成与测试脚本
docs/screenshots/  README 配图
```

## 关于这一版

轻量版只加载 `lite-*.ts` 这套页面。旧版完整功能（衣柜、PetPack、AI 对话、天气、旧版提醒、统计、动画调试）的源码与文档仍保留在本机，但已不在本仓库的推送范围内 —— 具体规则见 [.gitignore](./.gitignore)。

**English:** [README-EN.md](./README-EN.md)
