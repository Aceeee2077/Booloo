<div align="center">

<img src="docs/brand/booloo-icon.png" width="128" height="128" alt="Booloo 桌宠图标" />

# Booloo · 轻量桌宠

**简体中文** ｜ [English](./README-EN.md)

Booloo 的名字来自布噜（Bulu），这只猫也是应用的默认角色。

一只常驻桌面的透明小宠物：会走动、会打瞌睡，也会因为你拖来一张照片而开心。

[![Release](https://img.shields.io/github/v/release/Aceeee2077/Prismoo?label=release&color=ff8fb0)](https://github.com/Aceeee2077/Prismoo/releases)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-4c8bf5)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![Rust](https://img.shields.io/badge/Rust-1.77.2%2B-dea584)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![License](https://img.shields.io/badge/license-MIT-3da639)

</div>

## 预览

![Booloo 布噜宣传短片：桌面陪伴、摸头互动、健康提醒与好感度成长](docs/screenshots/booloo-promo.gif)


### 桌面与设置

桌宠常驻在最上层，不占任务栏、不进 Alt+Tab：

![桌宠在桌面上](docs/screenshots/lightweight-pet.png)

从托盘菜单或右键菜单打开设置，换宠物、导入自己的图片、调大小与透明度：

![设置面板](docs/screenshots/lightweight-settings.png)

## 功能

- **内置布噜** — 布噜是唯一的自带角色，也是默认形象；右键的「挥爪」「舔爪」「伸懒腰」「打哈欠」「挠头」播放的是真实姿势动画（`src/assets/animated-pets/bulu-actions.webp`，4×5 姿势图集：每行一个动作、四个帧），不是换个静止帧。
- **换成自己的图片** — 图片先进入预览，确认画面完整后再替换；可选「去掉纯色背景」，抠图若会使主体消失，应用会保留原图。
- **自动抠图 + 手动微调** — 预览里点「手动微调抠图…」打开独立编辑窗口：Rust 后端先在本地生成初始蒙版，再用「擦除背景 / 恢复主体」笔刷修边缘，可调笔刷大小与边缘硬度；支持撤销 / 重做（Ctrl+Z / Ctrl+Y）、滚轮缩放、平移、原图对比和「重新抠图」（可调强度与羽化）。图片不上传，保存结果是透明 PNG。
- **拖文件互动** — 把文件拖到桌宠身上，它会按图片、文档、压缩包、音乐或视频说一句话并做出短暂动作。只识别扩展名，不读取或改动文件内容；可在「日常设置」关闭。
- **眨眼** — 布噜站着不动时，两只眼睛会一起眨一下（约 3.2～8.4 秒一次，闭眼约 150 毫秒）。闭眼帧是 `scripts/build-bulu-blink.mjs` 从待机帧自己画出来的，不额外占用图集。
- **分区互动** — 摸头会冒爱心；摸背它会呼噜一声并舔爪；戳一下按部位给不同回应；快速双击它会开心地挥爪冒出爱心；按住不放它会挠头抗议；睡着时戳它会先醒过来再抱怨一句。
- **待办提醒** — 右键选「提醒…」，或在设置的「待办提醒」里写一句话加一个时间（早于此刻的时间按明天算），到点桌宠会跑到屏幕中央举牌提醒你，点一下它就收起牌子。错过太久的提醒（超过 10 分钟）不会事后补报。
- **健康计划** — 三件事各自独立计时：站立提醒（默认开启、5 分钟）、护眼、喝水（后两项默认关闭，在设置的「健康计划」里一键打开）。三者的间隔都是**预设 + 自定义**：站立 5/10/20/30，护眼 20/30/60，喝水 30/45/60/90，选「自定义」再填 1～240 之间的整数分钟。到点桌宠会来说一句——站立提醒还会跑到屏幕中央；设置页底部显示「今天：久坐 3 次 · 护眼 5 次 · 喝水 2 次」。
- **点击热力图** — 设置的「点击热力图」按天记录你点了它多少次，并按**自然年**铺满整张图（1 月 1 日到 12 月 31 日，53～54 周，横向不滚动）：10 次是最浅的一档，40、70 逐级加深，100 次及以上最深，不到 10 次的那天画成空格但鼠标悬停仍能看到真实次数。**今天之后的格子同样画出来**，只是还没到、暂时空着（悬停会显示"还没到"），到了那天自然参与统计；「带描边」的那格就是今天——点它一下就会变色。左上角的 ‹ › 可以翻年（最早只能翻到有记录的那年，未来年份不可选）。按本地日期分桶（见 `src/renderer/lite-day.ts`），跨零点自动换格，不需要联网校时。
- **好感度** — 摸它、戳它、双击、拖文件给它都会涨好感度，每天第一次互动额外 +5；同一天最多累计 40 点，所以分数是"处出来的"而不是一晚点出来的。五档从「陌生」到「挚友」（0 / 60 / 200 / 500 / 1000 分），升级会冒出 🎉 气泡和爱心，每次加分的 `+n ❤️` 会从它头顶飘一下。设置页有一节显示当前等级、进度条、还差多少分，以及陪伴天数 / 首次陪伴 / 累计点击；右键菜单顶部也会显示当前等级。阈值和等级名的唯一来源是 `src/renderer/lite-affinity.ts`。
- **设置页的 GitHub 按钮** — 设置窗口标题栏右上角有一颗 GitHub 图标：鼠标移上去图标放大变蓝、上方浮出「GitHub」提示，点一下用系统默认浏览器打开本仓库。地址写死在 `src-tauri/src/opener.rs`，该命令不收参数，所以页面无法借它打开任意链接。
- **感知电脑状态** — 读取 CPU / 内存 / 电池（Windows 用系统 API，macOS 用 1 分钟负载）：CPU 持续吃紧它会出汗并嘟囔一句，电量低于 20% 会挂着 🪫 打盹得更频繁，插上电源立刻精神起来。可在「日常设置」关闭，纯本地读取、不联网也不上报。
- **睡觉与报时** — 睡着时会偶尔冒出短暂的梦境气泡；整点轻报时默认开启，电脑休眠期间错过的整点不会补报。
- **中英双语界面** — 「日常设置」里可切换 中文 / English，桌宠气泡、右键菜单、设置面板和托盘提示会一起切换，选择会被记住。
- **自动更新** — 安装版启动几秒后自动检查新版本（可在设置里关掉），有新版就后台下载并让桌宠提醒你；设置里的「🔄 更新」区块可以手动检查、看下载进度、一键重启安装。安装包来自本仓库的 GitHub Releases，带 minisign 签名校验。
- **日常设置** — 宠物大小、透明度、自主走动、拖文件互动、站立提醒、整点报时、电脑状态感知、开机启动、重置位置。

单张图片使用轻微的呼吸和点击动画，不会自动生成走路或睡觉姿势；布噜使用逐帧素材与姿势图集。

## 使用

1. 在托盘菜单中打开「设置」。
2. 直接用默认的布噜，或点击「导入我的图片」换成你自己的照片 / 图片。
3. 图片会先进入预览；确认画面完整后点击「使用这张图片」。取消不会替换当前宠物。
4. 「去掉纯色背景」仅适合背景颜色较一致的图片。抠图若会使主体消失，应用会保留原图。透明 PNG 无需再次抠图。
5. 想要更干净的边缘，点「手动微调抠图…」：窗口左侧选笔刷与参数，中间涂抹（右键或按住空格拖动可平移，滚轮缩放），右侧实时对比原图与抠图效果，满意后点「使用这张图片」。

## 自动更新

- **客户端** — `src-tauri/src/updater.rs` 把 `tauri-plugin-updater` 包成 `update_get_state / update_check / update_download / update_install / update_install_when_ready` 几个命令：设置面板的「🔄 更新」区块和桌宠的更新气泡都调它们。更新地址与公钥写在 `src-tauri/tauri.conf.json` 的 `plugins.updater`。
- **发布端** — `.github/workflows/release.yml` 在推送 `v*` 标签（或手动触发）时先校验签名密钥，再用 `tauri-action` 构建 NSIS 安装包，并把安装包 + `latest.json` + `.sig` 一起发到 Releases；客户端检查更新时读的就是那份 `latest.json`。
- **版本号** — `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处必须一致，且新 tag 要大于已安装版本，否则客户端会认为已是最新。
- **本地打包** — 因为开了 `createUpdaterArtifacts`，`npm run dist:win` 需要 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（与 CI secret 相同），否则会在签名一步失败；只想本地验证功能用 `npm run tauri:check`，不需要密钥。

## macOS

**暂不提供 macOS 安装包。** 代码本身是跨平台的（差异只在 `tauri.conf.json` 和几处 `#[cfg(target_os = "macos")]`），只是官方没有构建和签名，想用只能自己编：

- 在 Mac 上 `npm install && npm run dist:mac`；想一次产出 Intel 与 Apple Silicon 通用的单包，用 `npx tauri build --target universal-apple-darwin --bundles app,dmg`。
- 产物未签名，第一次打开需「右键 → 打开」，或执行 `xattr -dr com.apple.quarantine Booloo.app`。

## 技术栈

| 层次 | 选型 | 在这一版里负责什么 |
| :--- | :--- | :--- |
| 桌面外壳 | **Tauri 2** | 透明、无边框、置顶、跳过任务栏的窗口；托盘图标与原生右键菜单；单实例、开机启动、原生文件对话框 |
| 后端 | **Rust 2021** | 配置读写与迁移、窗口拖拽 / 定位 / 多屏边界吸附、点击穿透、托盘，以及用 `include_str!` 把 i18n 词条编进二进制 |
| 前端 | **TypeScript 5**（无框架） | 8 个脚本文件直接用 `<script>` 加载：桌宠主循环、设置面板、抠图编辑窗口、右键菜单、Tauri 调用封装、图片导入、文件类型反应、i18n 运行时 |
| 国际化 | **中英双字典 + `config.locale`** | 词条集中在 `src/shared/i18n.ts`，编译进 Rust 侧后用 `i18n_get` 交给页面；切换语言只需一次 `config_set`，托盘、气泡、菜单一起跟随 |
| 渲染 | **Canvas 2D** | 逐帧播放精灵表与姿势图集、图片导入预览、抠图蒙版编辑（`destination-out` 擦除 + 羽化笔刷），并按像素透明度做命中检测 |
| 资源生成 | **Node.js 脚本 + sharp** | 程序化生成像素精灵表与品牌图标（PNG / ICO / ICNS），并把 `src/shared/i18n.ts` 导出成 Rust 侧读取的 JSON |
| 打包 | **Tauri CLI** | `npm run dist:win` 产出 Windows NSIS 安装包，`npm run dist:mac` 产出 macOS 的 `.app` / `.dmg`；图标由同一份矢量源生成 PNG / ICO / ICNS |
| 持续集成 | **GitHub Actions** | 推送 `v*` 标签后并行构建 Windows x64 与 macOS（Apple Silicon + Intel），校验签名密钥，并发布安装包与自动更新用的 `latest.json` / `.sig` |

## 开发

```bash
npm install
npm run build      # 生成精灵表与图标 → tsc → 拷贝页面资源 → 导出 src-tauri/resources/i18n.json
npm test           # 轻量页面行为测试（Node）+ Rust 单元测试
npm run screenshots # 重新生成 README 配图（中英各一套，需要本机有 Chrome / Edge）
npm run tauri:dev  # 开发模式启动
npm run dist:win   # 打 Windows 安装包
npm run dist:mac   # 在 Mac 上打 .app / .dmg（真正签名还需要 Apple 证书，见下）
```

环境要求：Windows 10/11 + WebView2 运行时，或 macOS 10.15+（用系统 WebView，无需额外运行时）；Node.js 20+；Rust 1.77.2+（仅从源码构建时需要）。
`npm run tauri:check` 会构建并启动真实窗口做自检，需要一个可用的 Windows WebView2 图形会话。

## 目录结构

```text
src/renderer/      桌宠页面 index.html、设置页 settings.html、抠图窗口 mask.html、右键菜单 menu.html
  lite-app.ts      桌宠主循环：动画、眨眼、拖拽、分区互动、睡觉、提醒、健康计划、每日计数、电脑状态反应
  lite-settings.ts 设置面板  ·  lite-mask.ts 抠图微调  ·  lite-menu.ts 右键菜单
  lite-day.ts      本地日历日：每日计数的分桶口径（跨零点、跨时区都按本机时钟算）
  lite-api.ts      Tauri 调用封装（窗口 / 配置 / 拖拽 / 事件）
  lite-image.ts    图片导入：纯色背景抠图与预览
  lite-i18n.ts     中英文切换：词典、占位符替换、data-i18n 静态文案
src/shared/        前后端共用的类型与 i18n 词条（i18n.ts 是词条唯一来源）
src-tauri/         Rust 后端：窗口、托盘、配置、自定义图片、i18n
  cutout.rs        自动抠图：边界取色 + 泛洪填充生成初始蒙版（换模型只需替换 segment()）
  load.rs          机器状态：CPU / 内存 / 电量（Windows 调 kernel32，macOS 读 1 分钟负载）
src/assets/        动画素材与品牌图标（精灵表和图标由 npm run build 生成）
scripts/           构建、资源生成与测试脚本（build-bulu-blink.mjs 从待机帧生成闭眼帧）
docs/screenshots/  README 配图
```
