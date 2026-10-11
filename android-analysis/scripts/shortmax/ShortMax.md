# ShortMax 分析与数据

核实日期：2026-10-10。应用包名 `live.shorttv.apps`，分析版本 `2.27.1`（versionCode `2987`）。原始拆分 APK、Apktool 与 JADX 产物位于 `../../编译结果/shortmax/`。

## 当前结论

- 播放路径与官方离线下载路径分开。反编译结果显示，官方离线下载启动前会检查订阅状态；“可播放”不等于“可通过官方入口离线下载”。
- 播放器使用 TTVideoEngine，剧集播放地址为 HLS `main.m3u8`。运行期通过 `BaseEpisode.parseVideoUrl` 将地址关联到剧集信息，再通过 `TTVideoEngineImpl.playUrlChanged` 确认实际播放切换。
- 已验证的免费剧集分片从 CDN 取得时不是普通 MPEG-TS；应用内 `ee.c` 处理后的内容具有完整的 188 字节 TS 包结构。按播放列表顺序合并后，可用 FFmpeg 无重编码封装为 MP4。
- 监听脚本只处理运行期明确标记 `locked=false` 且 `realLocked=false` 的剧集。播放切换也可能由自动连播触发；尚未将事件限定为手动点选。

## 运行

先在设备上打开 App，再在项目根目录执行：

```bash
node android-analysis/scripts/shortmax/run.js
```

需要 Node.js、`adb`、与设备端版本匹配的 Node Frida（本机安装命令：`npm install -g frida@16.7.19`），以及 FFmpeg。脚本也能直接使用已安装的 `imageio-ffmpeg` 附带的 FFmpeg 可执行文件，不会调用 Python。默认连接 `emulator-5554`，其他设备用 `--device` 指定。按 `Ctrl-C` 停止监听，已排队任务会继续完成。

数据按 `data/<短剧名称>/第N集/` 保存，MP4 名称为 `第N集.mp4`；同一目录保留原始分片、TS 和校验报告。重复保存同一集时，脚本会创建带时间后缀的集数目录，不覆盖已有文件。监听事件单独记录为 `data/.monitor-<时间>.jsonl`。

## 保留的完整数据

| 剧集 | 目录 | 分片 | 合并 TS | MP4 | 校验 |
| --- | --- | ---: | ---: | ---: | --- |
| `12077` 第 1 集《郡主，你找的替婚夫君是仙帝》 | `data/郡主，你找的替婚夫君是仙帝/第1集/` | 13/13 | 12,582,840 字节 | 11,166,714 字节 | 分片哈希、TS 拼接、MP4 全程解码通过 |
| `10853` 第 1 集《醉剑寻魔录》 | `data/醉剑寻魔录/第1集/` | 27/27 | 35,662,660 字节 | 32,551,723 字节 | MP4 全程解码通过 |
| `10800` 第 1 集（剧名未确认） | `data/未确认剧名-10800/第1集/` | 32/32 | 34,792,408 字节 | 31,219,683 字节 | 分片哈希、TS 拼接、MP4 全程解码通过 |

完整剧集均保留 `main.m3u8`、每个分片的原始网络字节 `segment-*.network.bin`、应用处理后的 TS 字节 `segment-*.player.bin`、`episode.ts`、`第1集.mp4` 及转换与校验报告。`10800` 的媒体 ID 与分片校验值在 `manifest.json` 和 `results.jsonl`；其剧名和 episode ID 尚未确认。

`data/剑开天门/第1集-未完成/` 是失败任务，只保存了 17 个计划分片中的前 3 个，没有合并 TS 或 MP4。其 `status.json` 和分片文件保留供排错，不应当作完整剧集。

静态分析源码存在 JADX 反编译误差；复杂方法应回看 `../../编译结果/shortmax/apktool/` 下的 smali。
