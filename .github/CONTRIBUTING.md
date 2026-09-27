# Contributing / 贡献指南

Thanks for considering contributing to Prismoo — code, art, or docs! 🎉
感谢你愿意为 Prismoo 贡献代码、美术或文档！

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

- 🎨 **New skins**: sprite sheets follow 4 rows × 4 columns (idle / walking / sleeping / click),
  32×32 frames, placed in `src/assets/sprites/`; or extend the generator in
  `scripts/generate-sprites.mjs` (procedural pixel art is a project highlight — new animal designs are welcome)
  / **新皮肤**：精灵表遵循 4 行 × 4 列、帧 32×32 的规范放入 `src/assets/sprites/`；或扩展生成器
- ✨ **New features**: small, self-contained additions win — see the issue tracker for open requests
  / **新功能**：最欢迎小而自洽的改动，可以到 issue 列表里找找已有需求
- 🐛 **Bug fixes**: include reproduction steps and impact / **Bug 修复**：提交时说明复现步骤与影响
- 📖 **Docs**: README, tutorials, screenshots & demo GIFs / **文档**：README、教程、截图与演示 GIF

## Code of Conduct / 行为准则

Participating means you agree to the [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md).
参与本项目即表示同意遵守 [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)。
