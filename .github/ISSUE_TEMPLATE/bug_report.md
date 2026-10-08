---
name: 🐛 Bug 报告 / Bug Report
about: 报告一个可以帮助改进的问题 / Report an issue that helps us improve
title: "[Bug] "
labels: bug
assignees: ''
---

**Describe the bug / 描述问题**
A clear and concise description of what the bug is. / 清晰简洁地描述这个 bug 是什么。

**To reproduce / 复现步骤**
1. Run `npm run tauri:build` and launch `src-tauri/target/debug/booloo.exe`
   / 运行 `npm run tauri:build`，然后启动 `src-tauri/target/debug/booloo.exe`
2. Perform: ... / 执行操作：...
3. Observed: ... / 观察现象：...

**Expected behavior / 期望行为**
What did you expect to happen? / 你期望发生什么？

**Actual behavior / 实际行为**
What actually happened? (Screenshots / terminal logs / `npm run tauri:check` output are very helpful)
/ 实际发生了什么？（附上截图 / 终端日志 / `npm run tauri:check` 输出会非常有帮助）

**Environment / 环境信息**
- OS: Windows / macOS / Linux (with version) / 操作系统（附版本）
- Booloo version (Settings → 🔄 Update shows it) / Booloo 版本（设置 → 🔄 更新 里能看到）
- Run mode: dev build (`npm run tauri:build`) / packaged installer / 运行方式：开发构建 / 打包安装包
- Runtime versions: output of `rustc --version` and (Windows) the WebView2 runtime version
  / 运行时版本：`rustc --version` 的输出，以及（Windows）WebView2 运行时版本
- Using an imported picture as the pet: yes / no / 是否用导入的图片当桌宠：是 / 否

**Additional context / 其他**
Anything else that might help. Redact config file contents — never paste API keys.
/ 任何其他有助于解决问题的信息（配置文件内容注意脱敏，不要贴 API Key）。
