# Screenshots / 截图

Only the lightweight edition's images are pushed with the repository, and each one
exists once per language — `README.md` uses the plain names, `README-EN.md` the `-en`
ones.
只推送轻量版的配图，并且每种语言各一套：`README.md` 用无后缀文件，`README-EN.md` 用 `-en` 文件。

| File / 文件 | Size / 尺寸 | Content / 内容 | Used by / 用于 |
| :--- | :--- | :--- | :--- |
| `lightweight-pet.png` | 900×520 | The pet on a simulated desktop, zh speech bubble / 桌宠在模拟桌面上，中文气泡 | `README.md` |
| `lightweight-pet-en.png` | 900×520 | Same desktop, en speech bubble / 同一张桌面，英文气泡 | `README-EN.md` |
| `lightweight-settings.png` | 680×936 | The settings panel, zh UI / 设置面板，中文界面 | `README.md` |
| `lightweight-settings-en.png` | 680×936 | The settings panel, en UI / 设置面板，英文界面 | `README-EN.md` |

## Regenerating / 如何重新生成

```bash
npm run build                # the screenshots render dist/renderer
npm run screenshots          # both languages
npm run screenshots -- en    # English only
npm run screenshots -- zh    # Chinese only
```

Needs a local Chrome or Edge (`PRISMOO_CHROME` overrides which one is used).
需要本机装有 Chrome 或 Edge（可用环境变量 `PRISMOO_CHROME` 指定路径）。

How the pictures are produced / 生成方式：

- **Settings panel**: the shipped `src/renderer/settings.html` is rendered in headless
  Chrome against a stub `window.__TAURI__` that answers `config_get` / `i18n_get` with a
  sample config and the real dictionary (from `src-tauri/resources/i18n.json`). It is
  therefore the real page with the real stylesheet, in the language that was asked for,
  and the script asserts the rendered DOM contains that language before saving.
  **设置面板**：用无头 Chrome 渲染真正发布的 `settings.html`，`window.__TAURI__` 由脚本桩提供，
  `config_get` / `i18n_get` 返回示例配置和真实词典；保存前会断言渲染出的 DOM 确实是目标语言。
- **Desktop**: a simulated desktop (wallpaper, a window, the taskbar, the pet and a speech
  bubble carrying `bubble.greeting`). The pet is a transparent always-on-top window, so a
  genuine screen capture would need a DWM composition pass — the README images are
  illustrations, not captures.
  **桌面图**：模拟桌面（壁纸 + 窗口 + 任务栏 + 桌宠 + 气泡，气泡文案取自词典的 `bubble.greeting`）。
- The panel height is measured per language instead of hard-coded: the language selector
  pushed it past the old 780 px, which used to clip the last row.
  面板高度是按语言实测的，不再写死 —— 加了语言选项后原来的 780px 会把最后一行裁掉。

## Not shipped / 不再推送

`pet-cat.png`, `pet-cat-en.png`, `settings-panel.png`, `settings-panel-en.png` and `demo.gif`
were produced by the pre-migration Electron build, which still had wardrobe / AI chat / PetPack
UI. They show screens the lightweight app no longer has, so `.gitignore` keeps them local.

这几张图由迁移前的 Electron 版生成，画面里还有轻量版已经没有的界面内容，因此被 `.gitignore`
留在本地，不随仓库推送。
