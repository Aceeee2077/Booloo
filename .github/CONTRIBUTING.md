# Contributing / 贡献指南

Thanks for considering contributing to Booloo — code, art, or docs! 🎉
感谢你愿意为 Booloo 贡献代码、美术或文档！

## Development Environment / 开发环境

```bash
# Requirements: Node.js >= 20 + Rust toolchain + WebView2 / 环境要求：Node.js ≥ 20 + Rust 工具链 + WebView2
npm install
npm run build            # Front-end build (sprites + brand icons + tsc + assets) / 前端构建
npm test                 # Lightweight-page tests + Rust unit tests / 轻量页面测试 + Rust 单元测试
npm run tauri:build      # Compile the Tauri debug build / 编译 Tauri 调试版
npm run tauri:check      # Launch the real windows for a self-check, exit code 0 = pass / 启动真实窗口自检，退出码 0 = 通过
npm run dist:win         # Package the Windows installer / 打包 Windows 安装包
```

## Project Layout / 项目结构速览

```
src-tauri/    Rust backend (window / tray / config / custom image / i18n) / Rust 后端
src/renderer/ Renderer (lite-app.ts = pet animation & interactions; lite-settings.ts = panel;
              lite-menu.ts = context menu; index.html / settings.html / menu.html) / 渲染层
src/renderer/lite-api.ts   The Tauri bridge the lite pages call / 轻量页面调用的 Tauri 通道
src/renderer/lite-i18n.ts  The zh / en runtime, driven by config.locale / 中英文运行时（跟随 config.locale）
src/shared/   Shared types & i18n dictionaries (i18n.ts is the single source of truth) / 共享类型与 i18n 字典
scripts/      Build & tooling (sprite generator / brand icons / i18n resource gen / self-check) / 构建与工具
```

Only the `lite-*.ts` pages are loaded at runtime; the earlier full-featured source
(wardrobe / PetPack / AI chat / weather / statistics / animation debugging) is kept
locally and listed in `.gitignore`, so it is not pushed.
运行时只会加载 `lite-*.ts` 这套页面；旧版完整功能（衣柜 / PetPack / AI 对话 / 天气 / 统计 / 动画调试）
保留在本地并在 `.gitignore` 中列出，不随仓库推送。

## Brand and Compatibility / 品牌与兼容性

The app is Booloo; its default cat remains Bulu / 布噜. The GitHub repository
address and `com.petric.desktop-pet` identifier stay unchanged to preserve user
data and signed updates. Release builds transfer an enabled startup registration
from the previous product name on first launch; debug builds do not alter it.
The NSIS hooks retain the previous installation registry keys so upgrades replace
the existing installation, and migrate its shortcuts to Booloo.
应用名为 Booloo，默认猫咪角色仍叫布噜 / Bulu。仓库地址和应用标识保持原值，
以沿用已有数据与签名更新；正式版首次启动时会迁移已开启的旧开机启动项，
调试版不会修改这些启动注册项。
NSIS 安装钩子保留旧的内部安装注册键，使新版能覆盖原有安装，并将快捷方式改为 Booloo。

## Commit Guidelines / 提交规范

- Branch naming: `feature/xxx`, `fix/xxx`, `docs/xxx` / 分支命名：`feature/xxx`、`fix/xxx`、`docs/xxx`
- Commit messages in Chinese or English are both fine; prefer `type(scope): description`,
  e.g. `fix(renderer): fix interactions triggered on transparent areas`, `feat(sprites): add rabbit skin`
  / Commit 信息用中文或英文均可，建议采用 `类型(范围): 描述` 的格式
- Before opening a PR, make sure: / PR 前请确保：
  - `npm run build` passes (sprites + TypeScript + asset copy) / `npm run build` 通过
  - `npm run tauri:check` passes / `npm run tauri:check` 通过
  - Meaningful feature changes include a short description (screenshots or GIFs welcome)
    / 有实际意义的功能改动附带简单说明（最好有演示 GIF 或截图）

## Ideas to Contribute / 可以贡献的方向

- 🎨 **Art for Bulu**: the shipped atlas is `src/assets/animated-pets/bulu.png`
  (4 × 4 cells of 192 px: idle / walking / sleeping / click) plus
  `bulu-actions.webp` (16 × 5, one right-click action per row). Both are
  assembled by `scripts/build-bulu-art.mjs` from the authoring sheets in
  `docs/pet-sources/bulu-actions/`, which are **not** in the repository — so a new
  character or a new pose means producing those source sheets first. Open an issue
  before investing in art, so we can agree on the layout.
  / **布噜的美术**：随包图集是 `src/assets/animated-pets/bulu.png`（4 × 4、每格 192 px，
  依次是待机 / 走路 / 睡觉 / 点击）和 `bulu-actions.webp`（16 × 5，每行一个右键动作），
  两者都由 `scripts/build-bulu-art.mjs` 从 `docs/pet-sources/bulu-actions/` 里的原始
  素材表合成，而那些素材表**不在仓库里**。所以要做新角色或新姿势，得先产出这些素材表——
  动手前请先开 issue 对齐规格。
- 🖼 **Imported-picture path**: improving the cutout (`src-tauri/src/cutout.rs`, one
  `segment()` function) or the brush editor helps every user who brings their own
  pet. / **导入图片这条路**：改进抠图（`src-tauri/src/cutout.rs`，只有 `segment()`
  一个入口）或笔刷编辑器，受益的是所有导入自家宠物的用户。
- ✨ **New features**: small, self-contained additions win — see the issue tracker for open requests
  / **新功能**：最欢迎小而自洽的改动，可以到 issue 列表里找找已有需求
- 🐛 **Bug fixes**: include reproduction steps and impact / **Bug 修复**：提交时说明复现步骤与影响
- 📖 **Docs**: README, tutorials, screenshots & demo GIFs / **文档**：README、教程、截图与演示 GIF

## Releases / 发布流程

Releases are cut from a tag; nobody uploads installers by hand.
发版完全由 tag 驱动，不需要手动上传安装包。

1. Bump the version in **all three** places, which have to agree:
   `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
   (plus the two `version` fields in `package-lock.json`).
   / 把版本号在**三处**同步改掉：`package.json`、`src-tauri/tauri.conf.json`、
   `src-tauri/Cargo.toml`（以及 `package-lock.json` 里的两个 `version` 字段）。
2. Add an entry to `CHANGELOG.md`. / 在 `CHANGELOG.md` 里补一条。
3. Commit, push, then tag and push the tag:
   / 提交并推送，然后打 tag 并推送：

   ```bash
   git tag v0.7.0 && git push origin v0.7.0
   ```

4. `.github/workflows/release.yml` builds Windows and macOS, signs the updater
   artifacts, and publishes the release with `latest.json` and the `.sig` files —
   so the in-app updater picks it up on its own. Signing needs the
   `TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD` secrets; the workflow fails early
   with a clear message if either is missing.
   / `.github/workflows/release.yml` 会构建 Windows 与 macOS、签名更新包，并把
   `latest.json` 与 `.sig` 一起发布，应用内的自动更新会自动接上。签名需要
   `TAURI_SIGNING_PRIVATE_KEY` 与对应密码两个 secret，缺失时 workflow 会在前期
   直接报错说明。
5. Linux has no published bundle yet — the **Build** workflow uploads AppImage and
   deb artifacts on every run instead.
   / Linux 目前没有正式发布包，改由 **Build** workflow 在每次运行时上传
   AppImage / deb 构建产物。

## Code of Conduct / 行为准则

Participating means you agree to the [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md).
参与本项目即表示同意遵守 [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)。
