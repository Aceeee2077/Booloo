# Recording the demo GIF / 录制演示 GIF

`docs/demo.gif` is the first thing a visitor sees on the repository page, so it
carries more weight than any paragraph of the README.
`docs/demo.gif` 是访客在仓库首页看到的第一样东西，它比 README 里任何一段文字都重要。

The file that ships right now is a **placeholder**: ten seconds cut out of the
existing `Booloo-promo.mp4` promo (640×360, ~1.9 MB, subtitles in Chinese). It
proves the app exists and animates, but it does not show the one feature that
makes Booloo different — importing a photo. Replace it when you have a recording.
当前文件是**占位版**：从现成的 `Booloo-promo.mp4` 宣传片里截出来的 10 秒
（640×360，约 1.9 MB，字幕是中文）。它能证明应用存在且会动，但没有展示
Booloo 最独特的那个功能——导入照片。录到真素材后请替换掉它。

## Target spec / 目标规格

| | |
| :--- | :--- |
| Length / 时长 | 8–12 s, silent, loops cleanly / 8–12 秒，无声，循环无跳帧 |
| Size / 体积 | ≤ 3 MB (a 5 MB ceiling is the point where mobile visitors give up / 超过 5 MB 手机端基本会放弃) |
| Width / 宽度 | 640–800 px (GitHub renders the README column at ~880 px) |
| Frame rate / 帧率 | 10–15 fps |
| Format / 格式 | GIF at `docs/demo.gif` |

## Shot list / 分镜（10 秒）

The order matters: the photo import is the hook, so it comes before the cute stuff.
顺序很重要——导入照片是钩子，必须排在卖萌之前。

| t | On screen / 画面 | Why / 要点 |
| :--- | :--- | :--- |
| 0.0–2.0 s | Bulu walking on a clean desktop / 布噜在干净桌面上走动 | Establishes "this is a desktop pet" / 先建立"这是桌宠" |
| 2.0–5.0 s | Settings → **Import my image** → preview → **Use this image** / 设置 → 导入我的图片 → 预览 → 使用这张图片 | The killer feature, in three actions / 杀手功能，三个动作讲完 |
| 5.0–7.0 s | One brush stroke in the cutout editor, then apply / 在抠图编辑器里刷一笔，然后应用 | Shows the automatic pass *and* the manual fix / 同时体现自动抠图与手动微调 |
| 7.0–9.0 s | Back on the desktop: the imported picture breathing as the pet / 回到桌面，图片宠物开始呼吸 | The payoff / 结果 |
| 9.0–10.0 s | Pet the head → hearts → `+1 ❤️` and the affinity bar / 摸头 → 冒爱心 → `+1 ❤️` 与好感度 | "Companionship you can measure" / 量化陪伴 |

Optional second GIF if you want a health-plan loop as well: `/health` → three
reminders firing.
如果想再补一条健康计划的动图：打开健康计划，让三个提醒各触发一次。

## How to capture / 怎么录

| Platform | Tool |
| :--- | :--- |
| Windows | **[ScreenToGif](https://www.screentogif.com/)** (free, records a region and exports a GIF directly — the least work) or `Win`+`G` Game Bar, then convert with the ffmpeg command below |
| macOS | QuickTime Player → File → New Screen Recording, then convert |
| Linux | Peek, Kooha or OBS Studio, then convert |

Recording tips / 录制注意：

- Record at 1920×1080 or 1280×720 and crop; do not record the whole 4K desktop.
  用 1080p 或 720p 录再裁切，不要直接录 4K 全屏。
- Use a plain wallpaper and close personal windows, tabs and files first — this
  GIF is permanent. / 用素色壁纸，先关掉私人窗口、标签页和文件，这个 GIF 会长期挂着。
- Keep the pet at 100% size and don't drag it fast; slow, deliberate mouse moves
  read much better once the GIF is at 12 fps. / 宠物保持 100% 大小，鼠标动作放慢，
  12 fps 下慢动作更清楚。
- One continuous take beats a cut-together edit — cut points are the first thing
  that looks broken in a loop. / 一镜到底优于拼接，切点最容易在循环里露馅。

## Convert to GIF / 转成 GIF

ScreenToGif can export directly; if you start from a video file, ffmpeg with a
two-pass palette is the smallest and cleanest result:
ScreenToGif 可以直接导出 GIF；如果从视频文件开始，用 ffmpeg 两遍调色板体积最小、颜色最干净：

```bash
# 1. build a palette from the clip
ffmpeg -i recording.mp4 -t 10 -vf "fps=12,scale=640:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png

# 2. encode with it
ffmpeg -i recording.mp4 -i palette.png -t 10 \
  -lavfi "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 docs/demo.gif
```

Check the result before committing — the numbers that matter are the ones in the
table above:
提交前先自检，就看上面那张表里的三个数字：

```bash
ls -l docs/demo.gif   # target: under 3 MB
```

## Where it is used / 引用位置

- `README.md` and `README.zh-CN.md` — directly under the title, both languages
  share this one file. / 两个语言版本的 README 共用这一个文件，位置都在标题正下方。
- `docs/screenshots/README.md` — the image inventory table. / 配图清单表。

## Two traps / 两个坑

1. **Do not put it in `docs/screenshots/`.** `.gitignore` still lists
   `/docs/screenshots/demo.gif` from the Electron era, so a file there is silently
   ignored and the README would show a broken image. The path is `docs/demo.gif`.
   **不要放进 `docs/screenshots/`**：`.gitignore` 里还留着 Electron 时代的
   `/docs/screenshots/demo.gif` 规则，放进去会被静默忽略，README 上就是坏图。
2. **`docs/screenshots/booloo-promo.gif` is 9.3 MB.** It is the full 30-second
   promo and it is still linked (as a link, not inline) from the README. Keep it
   out of the first screen. / 那个 30 秒完整宣传片有 9.3 MB，README 里只做文字链接、
   不内嵌，首屏不要用它。
