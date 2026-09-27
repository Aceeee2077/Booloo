<div align="center">

<img src="src/assets/brand/prismoo-icon.svg" width="128" height="128" alt="Prismoo 桌宠图标" />

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
- **拖文件互动** — 把文件拖到桌宠身上，它会按图片、文档、压缩包、音乐或视频说一句话并做出短暂动作。只识别扩展名，不读取或改动文件内容；可在「日常设置」关闭。
- **摸摸头** — 在桌宠头部左右轻轻移动鼠标，桌宠会冒爱心。
- **站立提醒** — 默认开启、间隔 5 分钟，也可选 10、20、30 分钟或自定义 1～240 分钟。到点后桌宠会跑到当前屏幕中央，说「老板，该站起来活动活动了！」。
- **睡觉与报时** — 睡着时会偶尔冒出短暂的梦境气泡；整点轻报时默认开启，电脑休眠期间错过的整点不会补报。
- **中英双语界面** — 「日常设置」里可切换 中文 / English，桌宠气泡、右键菜单、设置面板和托盘提示会一起切换，选择会被记住。
- **日常设置** — 宠物大小、透明度、自主走动、开机启动、重置位置。

单张图片使用轻微的呼吸和点击动画，不会自动生成走路或睡觉姿势；内置宠物使用逐帧素材。

## 使用

1. 在托盘菜单中打开「设置」。
2. 选择内置宠物，或点击「导入我的图片」。
3. 图片会先进入预览；确认画面完整后点击「使用这张图片」。取消不会替换当前宠物。
4. 「去掉纯色背景」仅适合背景颜色较一致的图片。抠图若会使主体消失，应用会保留原图。透明 PNG 无需再次抠图。

## 技术栈

| 层次 | 选型 | 在这一版里负责什么 |
| :--- | :--- | :--- |
| 桌面外壳 | **Tauri 2** | 透明、无边框、置顶、跳过任务栏的窗口；托盘图标与原生右键菜单；单实例、开机启动、原生文件对话框 |
| 后端 | **Rust 2021** | 配置读写与迁移、窗口拖拽 / 定位 / 多屏边界吸附、点击穿透、托盘，以及用 `include_str!` 把 i18n 词条编进二进制 |
| 前端 | **TypeScript 5**（无框架） | 7 个脚本文件直接用 `<script>` 加载：桌宠主循环、设置面板、右键菜单、Tauri 调用封装、图片抠图、文件类型反应、i18n 运行时 |
| 国际化 | **中英双字典 + `config.locale`** | 词条集中在 `src/shared/i18n.ts`，编译进 Rust 侧后用 `i18n_get` 交给页面；切换语言只需一次 `config_set`，托盘、气泡、菜单一起跟随 |
| 渲染 | **Canvas 2D** | 逐帧播放精灵表与姿势图集、图片导入预览，并按像素透明度做命中检测 |
| 资源生成 | **Node.js 脚本 + sharp** | 程序化生成像素精灵表与品牌图标（PNG / ICO / ICNS），并把 `src/shared/i18n.ts` 导出成 Rust 侧读取的 JSON |
| 打包 | **Tauri CLI + NSIS** | `npm run dist:win` 直接产出 Windows 安装包 |
| 持续集成 | **GitHub Actions** | 推送 `v*` 标签后自动构建、校验签名密钥并发布 Release |

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
src/renderer/      桌宠页面 index.html、设置页 settings.html、右键菜单 menu.html
  lite-app.ts      桌宠主循环：动画、拖拽、睡觉、站立提醒、整点报时
  lite-settings.ts 设置面板  ·  lite-menu.ts 右键菜单
  lite-api.ts      Tauri 调用封装（窗口 / 配置 / 拖拽 / 事件）
  lite-image.ts    图片导入：纯色背景抠图与预览
  lite-i18n.ts     中英文切换：词典、占位符替换、data-i18n 静态文案
src/shared/        前后端共用的类型与 i18n 词条（i18n.ts 是词条唯一来源）
src-tauri/         Rust 后端：窗口、托盘、配置、自定义图片、i18n
src/assets/        动画素材与品牌图标（精灵表和图标由 npm run build 生成）
scripts/           构建、资源生成与测试脚本
docs/screenshots/  README 配图
```

## 关于这一版

轻量版只加载 `lite-*.ts` 这套页面。旧版完整功能（衣柜、PetPack、AI 对话、天气、旧版提醒、统计、动画调试）的源码与文档仍保留在本机，但已不在本仓库的推送范围内 —— 具体规则见 [.gitignore](./.gitignore)。

**English:** [README-EN.md](./README-EN.md)
