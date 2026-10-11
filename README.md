# Web Novel & Short Drama App Hooks

用于整理网文与短剧 Android App 的运行时 Hook 脚本和分析记录。当前覆盖四个 App，其中 GoodNovel 与 ShortMax 已完成可复用脚本，Dreame 与 DramaBox 仍在分析中。

## App 状态

| App | 类型 | 状态 | 入口 |
| --- | --- | --- | --- |
| GoodNovel | 网文 | 已完成 | [`android-analysis/scripts/goodnovel/`](android-analysis/scripts/goodnovel/) |
| ShortMax | 短剧 | 已完成 | [`android-analysis/scripts/shortmax/`](android-analysis/scripts/shortmax/) |
| Dreame | 网文 | 分析中 | [`android-analysis/scripts/dreame/Dreame.md`](android-analysis/scripts/dreame/Dreame.md) |
| DramaBox | 短剧 | 分析中 | [`android-analysis/scripts/dramabox/DramaBox.md`](android-analysis/scripts/dramabox/DramaBox.md) |

## 内容范围

仓库保存 Hook 脚本、运行说明和分析记录。APK、反编译结果、设备采集数据及运行生成文件不纳入 Git。

## 环境要求

具体依赖与运行方式见各 App 目录中的说明文档。脚本运行前请确认设备、Frida 与目标应用版本匹配，并仅在获授权的设备和应用上使用。
