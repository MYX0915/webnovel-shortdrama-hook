#!/usr/bin/env python3
import datetime
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import frida
from opencc import OpenCC


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
HOOK_PATH = APP_DIR / "hook.js"
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_PATH = DATA_DIR / f"capture-{datetime.datetime.now():%Y-%m-%d}.ndjson"
TRADITIONAL_TO_SIMPLIFIED = OpenCC("t2s")
BOOK_NAMES_BY_ID = {}


def ensure_adb_forward():
    adb = shutil.which("adb") or str(Path.home() / "Library/Android/sdk/platform-tools/adb")
    if not Path(adb).is_file():
        print("找不到 adb；请先安装 Android platform-tools，或将 adb 加入 PATH。", file=sys.stderr)
        raise SystemExit(1)
    devices = subprocess.run([adb, "devices"], capture_output=True, text=True, check=False)
    online = [line.split()[0] for line in devices.stdout.splitlines()[1:]
              if len(line.split()) >= 2 and line.split()[1] == "device"]
    if not online:
        print("没有已连接的 Android 设备/模拟器，请先启动设备并确认 adb devices 可见。", file=sys.stderr)
        raise SystemExit(1)
    if len(online) > 1:
        print(f"检测到多个在线设备：{', '.join(online)}。请断开多余设备后重试。", file=sys.stderr)
        raise SystemExit(1)
    result = subprocess.run(
        [adb, "-s", online[0], "forward", "tcp:27042", "tcp:27042"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        print(f"设置 Frida 端口转发失败：{result.stderr.strip()}", file=sys.stderr)
        raise SystemExit(1)
    return online[0]


BOOK_INFO_LABELS = {
    "bookId": "书籍 ID",
    "bookName": "书名",
    "pseudonym": "作者",
    "authorName": "作者详情名",
    "authorId": "作者 ID",
    "authorAvatar": "作者头像 URL",
    "introduction": "简介",
    "cover": "封面 URL",
    "bookDetailCover": "详情页封面 URL",
    "languageDisplay": "语言",
    "language": "语言代码",
    "chapterCount": "章节数",
    "totalCatalog": "目录章节数",
    "totalWords": "总字数",
    "bookStatus": "作品状态代码",
    "writeStatus": "更新状态",
    "ratings": "评分",
    "viewCountDisplay": "阅读量",
    "lastChapterName": "最新章节",
    "lastUpdateTimeDisplay": "最近更新时间",
    "genreNames": "题材",
    "labels": "标签",
    "status": "状态代码",
}


def persist_book_info(record):
    if record.get("type") != "book-detail-info":
        return None
    book = record.get("book") or {}
    book_id = str(record.get("bookId") or book.get("bookId") or "unknown-book")
    book_name = str(book.get("bookName") or "unknown-title").strip()
    BOOK_NAMES_BY_ID[book_id] = book_name
    book_dir = book_output_dir(book_id, book_name)
    path = book_dir / "book-info.txt"
    lines = []
    for key, label in BOOK_INFO_LABELS.items():
        value = book.get(key)
        if value in (None, "", "null", "[]", "[object Object]"):
            continue
        if key == "authorId" and str(value) == "0":
            continue
        if isinstance(value, list):
            value = "、".join(str(item) for item in value if item not in (None, "", "[object Object]"))
            if not value:
                continue
        lines.append(f"{label}：{value}")
    if not lines:
        lines = [f"书籍 ID：{book_id}"]
    try:
        temporary_path = path.with_suffix(".txt.tmp")
        temporary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        temporary_path.replace(path)
        return {"type": "book-info-txt-saved", "bookId": book_id, "path": str(path)}
    except OSError as error:
        return {"type": "book-info-txt-error", "bookId": book_id, "path": str(path), "error": str(error)}


def book_output_dir(book_id, book_name=None):
    name = str(book_name or BOOK_NAMES_BY_ID.get(book_id) or "unknown-title").strip()
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" ._") or "unknown-title"
    safe_book_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(book_id))
    book_dir = DATA_DIR / f"《{name}》-{safe_book_id}"
    book_dir.mkdir(parents=True, exist_ok=True)
    return book_dir


def save_free_chapter(chapter):
    """Write a chapter only when the response explicitly marks it uncharged."""
    try:
        price = int(chapter.get("price"))
    except (TypeError, ValueError):
        price = None
    if str(chapter.get("orderRequired", "")).lower() != "false" or price != 0:
        chapter.pop("body", None)
        return None
    body = chapter.pop("body", None)
    if not isinstance(body, str) or not body.strip():
        return None
    book_id = str(chapter.get("bookId") or "unknown-book")
    if chapter.get("bookName"):
        BOOK_NAMES_BY_ID[book_id] = str(chapter["bookName"])
    chapter_id = str(chapter.get("id") or "unknown-chapter")
    index = str(chapter.get("index") or "")
    chapter_number = str(int(index) + 1) if index.isdigit() else f"ID_{chapter_id}"
    book_dir = book_output_dir(book_id, chapter.get("bookName"))
    traditional_path = book_dir / f"第{chapter_number}章_原始.txt"
    simplified_path = book_dir / f"第{chapter_number}章_简体.txt"
    simplified_body = TRADITIONAL_TO_SIMPLIFIED.convert(body)
    paths_created = []
    for path, text in ((traditional_path, body), (simplified_path, simplified_body)):
        try:
            with path.open("x", encoding="utf-8", newline="") as output_file:
                output_file.write(text)
            paths_created.append(str(path))
        except FileExistsError:
            pass
    return {
        "type": "chapter-txt-pair-saved" if paths_created else "chapter-txt-pair-existing",
        "bookId": book_id,
        "chapterId": chapter_id,
        "title": chapter.get("name"),
        "traditionalLength": len(body),
        "simplifiedLength": len(simplified_body),
        "traditionalPath": str(traditional_path),
        "simplifiedPath": str(simplified_path),
        "createdPaths": paths_created,
    }


def persist_chapter_bodies(record):
    if record.get("type") not in ("chapter-response-model", "chapter-list-model"):
        return []
    saved = []
    candidates = list(record.get("list") or record.get("chapters") or [])
    index_chapter = record.get("indexChapter")
    if isinstance(index_chapter, dict):
        candidates.append(index_chapter)
    for chapter in candidates:
        if isinstance(chapter, dict):
            event = save_free_chapter(chapter)
            if event:
                saved.append(event)
    return saved

adb_serial = ensure_adb_forward()
try:
    device = frida.get_device_manager().add_remote_device("127.0.0.1:27042")
except Exception as error:
    print(
        "无法连接 Frida server。请确认模拟器已 root，且 /data/local/tmp/frida-server 正在运行。\n"
        f"详细信息：{error}",
        file=sys.stderr,
    )
    raise SystemExit(1)
if len(sys.argv) > 1:
    target_pid = int(sys.argv[1])
else:
    try:
        target_pid = device.get_process("GoodNovel").pid
    except Exception:
        print(
            f"设备 {adb_serial} 上未找到 GoodNovel 进程。请先打开 GoodNovel，再运行本脚本。",
            file=sys.stderr,
        )
        raise SystemExit(1)

session = device.attach(target_pid)
script = session.create_script(HOOK_PATH.read_text(encoding="utf-8"))


def on_message(message, data):
    if message.get("type") == "send":
        payload = message.get("payload")
        try:
            record = json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            record = {"type": "message", "payload": str(payload)}
        book_info_event = persist_book_info(record)
        save_events = persist_chapter_bodies(record)
        record["capturedAt"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        line = json.dumps(record, ensure_ascii=False)
        with OUTPUT_PATH.open("a", encoding="utf-8") as output_file:
            output_file.write(line + "\n")
        print(line, flush=True)
        if book_info_event:
            book_info_event["capturedAt"] = record["capturedAt"]
            info_line = json.dumps(book_info_event, ensure_ascii=False)
            with OUTPUT_PATH.open("a", encoding="utf-8") as output_file:
                output_file.write(info_line + "\n")
            print(info_line, flush=True)
        for event in save_events:
            event["capturedAt"] = record["capturedAt"]
            save_line = json.dumps(event, ensure_ascii=False)
            with OUTPUT_PATH.open("a", encoding="utf-8") as output_file:
                output_file.write(save_line + "\n")
            print(save_line, flush=True)
    elif message.get("type") == "error":
        print(json.dumps(message, ensure_ascii=False), file=sys.stderr, flush=True)


script.on("message", on_message)
session.on("detached", lambda reason, crash: print(f"Frida detached: {reason}", flush=True))
script.load()
print(f"Hook active for PID {target_pid}; saving events to {OUTPUT_PATH}", flush=True)

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    script.unload()
    session.detach()
