# Android APK 反编译状态

核对日期：2026-10-09

使用 JADX `simple` 控制流模式和 100 次类型更新上限生成恢复版。各应用的原始 APK、标准 JADX 输出和 Apktool 输出均保留。

| 应用 | 恢复版 Java 文件 | 恢复版 JADX 错误 | 原标准模式错误 |
| --- | ---: | ---: | ---: |
| GoodNovel | 53,901 | 227 | 435 |
| Dreame | 2,950 | 1 | 3 |
| DramaBox | 52,366 | 144 | 334 |
| ShortMax | 43,903 | 161 | 718 |

恢复版位于各应用目录的 `decompiled-jadx-recovered/`，运行日志位于 `diagnostics/jadx-recovered.log`。原标准输出仍在 `decompiled-jadx/`。

## Dreame 的 DEX 情况

Dreame 的 APK 只有一个约 29 个类的网易易盾加载器 `classes.dex`；JADX 当前解出的约 2,950 个 Java 文件主要来自 APK 内嵌的第三方广告 SDK。业务 DEX 没有以常规 DEX 文件形式存在于 APK 中，因此更改 JADX 参数无法还原其业务 Java 代码。`apktool/smali/` 中的少量代码是壳加载器，不代表完整应用代码。

## 仍有的 JADX 错误

恢复模式显著减少了错误，但 JADX 仍不能把全部方法还原成结构化 Java。剩余错误不影响原始 APK 完整性；相应方法可在 Apktool 的 smali 输出中查看。Dreame 业务代码需先从运行时授权应用中提取已解密 DEX，再单独交给 JADX 处理。
