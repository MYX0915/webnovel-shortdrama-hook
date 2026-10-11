# GoodNovel 分析记录

## 项目状态

**状态：已完成**（核实日期：2026-10-09）

已完成 APK 静态分析、Frida Hook、书卡详情自动触发目录与免费章节采集、基础信息和章节正文落盘、繁简双版本生成。最近一次运行采集 4 本书，共 56 章；每章均保存原始版和简体版 TXT，章节序号连续且文件非空。书籍目录采用 `《书名》-书籍ID` 命名。

当前详情响应未提供可用的非零作者 ID，脚本会省略该字段，不写入缺省值 `0`。

## APK 与运行环境

- 包名：`com.read.goodnovel`
- 版本：`4.4.0.1350`（versionCode `4401350`）
- 分析产物：`../../编译结果/goodnovel/`
- APK：`../../编译结果/goodnovel/original/goodnovel-4.4.0.1350.apk`
- 已在 Android Studio API 35、arm64-v8a 模拟器中以游客状态打开阅读器。

## 静态分析发现

应用默认 API 主机为：

```text
https://api-akm.goodnovel.com/
```

JADX 文件：`../../编译结果/goodnovel/decompiled-jadx/sources/rs/AbstractC26460a.java`。反编译代码还列出预发布主机 `https://yfbapi.goodnovel.com/`。

章节相关接口：

| 用途 | 方法与路径 | 请求/响应线索 |
| --- | --- | --- |
| 章节目录 | `POST /hwycclient/chapter/list` | 请求体由 `bookId`、`chapterCount`、`latestChapterId` 等字段构成；返回 `ChapterListInfo.list` |
| 加载章节 | `POST /hwycclient/chapter/load/v2` | 请求体包含 `bookId`、`chapterIds`、`autoPay`、`confirmPay`、`offset`、`source`、`preLoad`、`viewAd` 等字段；返回 `ChapterOrderInfo` |
| 首章预览 | `POST /hwycclient/book/previewContent/firstChapterPreviewContent` | 返回模型含首章 `content`、`previewContent`、`charged`、`price` 等字段 |

接口定义在 `../../编译结果/goodnovel/decompiled-jadx/sources/com/read/goodnovel/net/RequestService.java`。正文加载请求字段由 `../../编译结果/goodnovel/decompiled-jadx/sources/at/C1640l.java` 中的 `m3616V` 构造。

`Chapter` 模型包含 `content`、`previewContent`、`charged`、`price`、`status`、`prevChapterId`、`nextChapterId` 等字段；`ChapterOrderInfo` 包含章节列表以及 `needLogin`、`needOrder`、`status` 等状态字段。对应文件：

- `../../编译结果/goodnovel/decompiled-jadx/sources/com/read/goodnovel/p284db/entity/Chapter.java`
- `../../编译结果/goodnovel/decompiled-jadx/sources/com/read/goodnovel/model/ChapterOrderInfo.java`

## 游客态运行监测

打开书籍并滚动章节后，Android `FirebasePerformance` 日志曾记录 `chapter/load/v2` 多次返回 HTTP 200，也记录到 `chapter/list`、`reader/init` 等请求。该日志仅包含 URL、状态码和耗时，没有请求体或响应 JSON，因此不能据此确认章节正文。

实时日志曾在当前会话中读取；目前没有归档为 `logcat-live.txt`。

## Frida 运行监测

- Frida 客户端与模拟器 server 版本均为 `16.7.19`；当前模拟器允许 `adb root`，server 可附加到 GoodNovel。
- Hook 脚本位于 `hook.js`，监测章节加载请求元数据，并读取 Retrofit 响应的 `BaseEntity.data`、`ChapterOrderInfo`、`ChapterListInfo` 与章节模型。日志只记录章节 ID、标题、索引、字数、正文长度、预览长度、付费标记、状态及前后章 ID；符合免费条件的正文单独写入 TXT。
- 请求体 Hook 捕获到书籍 ID `31001705805` 的章节 ID `65913003` 和预加载章节 ID `65913004`。请求字段记录了 `autoPay=false`、`confirmPay=false`、`viewAd=false`；`preLoad` 分别出现 `true` 和 `false`。该观察说明应用自身会发出下一章的预加载请求，不代表脚本已实现自动连续请求。
- Retrofit 响应成功解析出第 5 章（ID `65913003`）：`wordCount=1313`、`contentLength=5520`、`previewLength=0`、`charged=true`、`status=1`，前后章 ID 分别为 `65913002` 和 `65913004`。同一轮还解析出第 6 章（ID `65913004`）：`wordCount=1023`、`contentLength=4392`、`previewLength=0`、`charged=true`、`status=1`，后续章节 ID 为 `65913005`。`ChapterOrderInfo` 外层状态为 `status=0`、`needLogin=false`、`needOrder=false`。
- `charged` 不能单独作为收费判据。反编译的 `Chapter.isCharge()` 根据 `price` 与 `charged` 组合判断，且 `isNeedForBidNext()` 会区分已可用状态；运行时响应应结合 `ChapterOrderInfo.needOrder` 和章节 `price` 解读。此次滚动到第 16 章付费弹窗时，服务端模型返回 `needOrder=true`、`contentLength=0`、`previewLength=300`；第 7 至第 15 章返回 `needOrder=false` 并有正文。请求参数保持 `autoPay=false`、`confirmPay=false`、`viewAd=false`。
- 完整 Hook 事件保存在 `data/capture-YYYY-MM-DD.ndjson`。请求 URL 多次重复可能来自 OkHttp 请求对象的多次构造，不代表服务器收到的请求数量。运行 `python3 run_hook.py` 后，在 GoodNovel 中点击书卡；书籍详情响应会触发目录和免费章节采集。每本书的基础信息写入 `data/《书名》-书籍ID/book-info.txt`，免费章节正文按序号写入 `第1章_原始.txt` 和 `第1章_简体.txt`。停止脚本按 `Ctrl+C`。
- 书籍基础信息从详情响应中的 `Book` 和 `AuthorInfo` 模型读取。作者 ID 优先读取作者模型的 `id`，若不存在再使用 `uid`；缺省的 `0` 不保存。题材和标签逐项转换为文本，详情再次捕获时更新 `book-info.txt`，章节 TXT 保持不覆盖。
- 响应中的 `Chapter.content` 是 Base64 封装的加密数据，单独 Base64 解码后仍不是正文。阅读器使用 DEX 类 `kv.j` 的静态方法 `G(String)` 解码正文；JADX 中该方法显示为 `p535kv.AbstractC23931j.m48720G(String)`。Hook 只对 `needOrder=false` 且 `price=0` 的非空章节调用应用内解码方法，随后用 OpenCC `t2s` 方案转换简体。每章分别保存原始字和简体两个 TXT。付费、价格未知或正文为空的章节不会写入正文；重复运行不会覆盖已有文件。日志仅记录路径、正文长度和章节元数据，不包含正文。
- 2026-10-09 新书《重生歸來，醫妃斷絕滿門親情》（书籍 ID `31001409282`）的滚动请求捕获到第 2 章和第 3 章，二者均为 `needOrder=false`、`price=0`，正文均非空。可读 TXT 已写入 `data/31001409282/`：第 2 章解码后 2078 字符，第 3 章 2059 字符。此前原始 Base64 文件保留为同名 `.base64.txt`。本轮日志未观察到付费章节响应。
- 响应与请求体 Hook 已可工作。点击书卡后，详情响应会触发目录请求；脚本仅对目录中价格为 0 的章节发起应用内加载，并只保存响应明确标记可读且正文非空的章节。脚本不自动解锁付费章节。
- Python 依赖列在 `requirements.txt` 中。首次运行前执行 `python3 -m pip install -r requirements.txt`。
- 详情页自动采集已加入 `hook.js`：`BookDetailInfo` 解析完成后，脚本通过应用的 `at.l.r` 请求章节目录（`needBookInfo=true`）；目录响应后，对标价为 0 的章节调用应用内 `ps.l.h`。正文请求参数保持 `autoPay=false`、`confirmPay=false`、`viewAd=false`。单次目录回调最多排队 20 章，非零价格章节跳过；正文仍只在响应明确 `needOrder=false`、`price=0` 且非空时解码和保存。
- 早期运行验证：书籍 ID `31001691715` 的目录返回 100 章，前 7 章价格为 0，第 8 章起标价大于 0；应用章节加载接口对前 7 章返回 `needOrder=false` 和非空正文，保存了 7 对繁体/简体 TXT。该轮通过补发应用自身目录接口完成，作为后续自动采集实现前的基线记录。
- 完成验证（2026-10-09）：点击 4 张书卡后均捕获到详情、目录和自动章节加载事件。书籍 ID `31001366049` 保存第 1–20 章，`31001379293` 保存第 1–11 章，`31001380734` 保存第 1–13 章，`31001549468` 保存第 1–12 章。共 56 章、112 个章节 TXT 和 4 份 `book-info.txt`；章节文件均非空且序号连续。题材与标签已逐项写为文本。当前响应未提供可用作者 ID，因此书籍信息中不包含该字段。
- Reqable 主机代理为 `192.168.3.50:9000`；模拟器系统代理为 `10.0.2.2:9000`。尚未确认 Reqable 中出现解密后的请求体或章节正文。

运行监测环境核对时间：2026-10-09。
