#!/usr/bin/env node
'use strict';

// One-file ShortMax listener. Run with Node.js while the app is open.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const BASE = __dirname;
const DATA = path.join(BASE, 'data');
const PACKAGE = 'live.shorttv.apps';
const PLAYLIST = /^https:\/\/akamai-static\.shorttv\.live\/hls-encrypted\/([0-9a-f]{32}_[0-9]+)\/main\.m3u8$/;
const SEGMENT = /^main\/segment-(\d+)\.ts$/;

// This part runs inside the Android process. Keep it compatible with the
// Frida JavaScript runtime used by the device's frida-server.
const AGENT = String.raw`
'use strict';

var episodeByUrl = {};
var lockStateLast = {};

function safeUrl(value) {
    var text = String(value || '');
    var match = text.match(/^(https?:\/\/[^/?#]+)(\/[^?#]*)?/i);
    return match ? match[1] + (match[2] || '/') : '';
}

function episodeInfo(episode, lockedOverride) {
    try {
        return {
            shortPlayId: String(episode.getShortPlayId()),
            shortPlayName: String(episode.getShortPlayName() || ''),
            episodeId: String(episode.getId()),
            episodeNum: Number(episode.getEpisodeNum()),
            totalEpisodes: Number(episode.getTotalEpisodes()),
            locked: typeof lockedOverride == 'undefined' ? Boolean(episode.isLocked()) : Boolean(lockedOverride),
            realLocked: Boolean(episode.isRealLocked()),
            vipFree: Number(episode.getVipFree()),
            unlockType: Number(episode.getUnlockType()),
            price: Number(episode.getPrice()),
            videoType: Number(episode.getVideoType())
        };
    } catch (error) {
        return { metadataError: String(error) };
    }
}

function emit(event, value) {
    var url = safeUrl(value);
    if (url) {
        var record = { time: new Date().toISOString(), event: event, url: url };
        if (episodeByUrl[url]) record.episode = episodeByUrl[url];
        send(record);
    }
}

rpc.exports = {
    capturesegment: function (index, mediaId, captureName) {
        return new Promise(function (resolve) {
            Java.perform(function () {
                try {
                    var URL = Java.use('java.net.URL');
                    var File = Java.use('java.io.File');
                    var FileOutputStream = Java.use('java.io.FileOutputStream');
                    var ByteArrayOutputStream = Java.use('java.io.ByteArrayOutputStream');
                    var ByteBuffer = Java.use('java.nio.ByteBuffer');
                    var ActivityThread = Java.use('android.app.ActivityThread');
                    var Decryptor = Java.use('ee.c');
                    var app = ActivityThread.currentApplication();
                    var directory = File.$new(app.getExternalFilesDir(null), captureName);
                    directory.mkdirs();
                    var source = 'https://akamai-static.shorttv.live/hls-encrypted/' + mediaId + '/main/segment-' + index + '.ts';
                    var connection = URL.$new(source).openConnection();
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(20000);
                    var input = connection.getInputStream();
                    var bytes = Java.array('byte', Array(32768).fill(0));
                    var accumulator = ByteArrayOutputStream.$new();
                    try {
                        while (true) {
                            var count = input.read(bytes);
                            if (count < 0) break;
                            if (count > 0) accumulator.write(bytes, 0, count);
                        }
                    } finally {
                        input.close();
                    }
                    var network = accumulator.toByteArray();
                    var decryptor = Decryptor.$new(app, 'shortmax00000000');
                    var result = decryptor.g(ByteBuffer.wrap(network));
                    var outputLength = result.b();
                    if (outputLength <= 0) {
                        resolve({ index: index, source: source, networkLength: network.length, outputLength: outputLength });
                        return;
                    }
                    var outputBuffer = result.a().duplicate();
                    ByteBuffer.position.overload('int').call(outputBuffer, 0);
                    var output = Java.array('byte', Array(outputLength).fill(0));
                    ByteBuffer.get.overload('[B').call(outputBuffer, output);
                    function save(suffix, payload) {
                        var file = File.$new(directory, 'segment-' + ('000' + index).slice(-3) + '.' + suffix + '.bin');
                        var stream = FileOutputStream.$new(file);
                        try {
                            stream.write(payload);
                        } finally {
                            stream.close();
                        }
                    }
                    save('network', network);
                    save('player', output);
                    resolve({
                        index: index, source: source, networkLength: network.length,
                        outputLength: outputLength, directory: directory.getAbsolutePath().toString()
                    });
                } catch (error) {
                    resolve({ index: index, error: String(error), stack: error.stack || '' });
                }
            });
        });
    }
};

Java.perform(function () {
    try {
        var BaseEpisode = Java.use('com.startshorts.androidplayer.bean.shorts.BaseEpisode');
        var isLocked = BaseEpisode.isLocked.overload();
        isLocked.implementation = function () {
            var locked = isLocked.call(this);
            var info = episodeInfo(this, locked);
            var key = info.shortPlayId + ':' + info.episodeId;
            var state = JSON.stringify(info);
            if (lockStateLast[key] != state) {
                lockStateLast[key] = state;
                send({ time: new Date().toISOString(), event: 'episode_lock_state', episode: info });
            }
            return locked;
        };

        var parseVideoUrl = BaseEpisode.parseVideoUrl.overload('int');
        parseVideoUrl.implementation = function (resolution) {
            var result = parseVideoUrl.call(this, resolution);
            var url = safeUrl(result);
            if (url) {
                var info = episodeInfo(this);
                episodeByUrl[url] = info;
                send({ time: new Date().toISOString(), event: 'episode_video_url_resolved', url: url, episode: info });
            }
            return result;
        };

        var Engine = Java.use('com.ss.ttvideoengine.TTVideoEngine');
        var directUrl = Engine.setDirectURL.overload('java.lang.String');
        directUrl.implementation = function (value) {
            emit('ttvideo_set_direct_url', value);
            return directUrl.call(this, value);
        };
        var getCurrentUrl = Engine.getCurrentPlayUrl.overload();
        var lastUrl = '';
        getCurrentUrl.implementation = function () {
            var result = getCurrentUrl.call(this);
            var url = safeUrl(result);
            if (url && url != lastUrl) {
                lastUrl = url;
                emit('ttvideo_current_play_url', result);
            }
            return result;
        };

        var InternalEngine = Java.use('com.ss.ttvideoengine.TTVideoEngineImpl');
        var urlChanged = InternalEngine.playUrlChanged.overload('int', 'java.lang.String', 'java.lang.String');
        urlChanged.implementation = function (index, primaryUrl, backupUrl) {
            emit('ttvideo_play_url_changed', primaryUrl);
            emit('ttvideo_backup_play_url', backupUrl);
            return urlChanged.call(this, index, primaryUrl, backupUrl);
        };
        var internalDirectUrl = InternalEngine.setDirectURL.overload('java.lang.String');
        internalDirectUrl.implementation = function (value) {
            emit('ttvideo_impl_set_direct_url', value);
            return internalDirectUrl.call(this, value);
        };

        send({ time: new Date().toISOString(), event: 'ready', message: 'ShortMax hooks installed' });
    } catch (error) {
        send({ time: new Date().toISOString(), event: 'hook_error', message: String(error) });
    }
});
`;

function usage() {
    console.log('用法: node android-analysis/scripts/shortmax/run.js [--device 设备ID] [--ffmpeg 路径]');
}

function options(argv) {
    const result = { device: 'emulator-5554', ffmpeg: null };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--help' || argv[i] === '-h') {
            usage();
            process.exit(0);
        }
        if ((argv[i] === '--device' || argv[i] === '--ffmpeg') && argv[i + 1]) {
            result[argv[i].slice(2)] = argv[++i];
        } else {
            throw new Error(`未知参数: ${argv[i]}`);
        }
    }
    return result;
}

function loadFrida() {
    try {
        return require('frida');
    } catch (localError) {
        try {
            const globalRoot = require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
            return require(path.join(globalRoot, 'frida'));
        } catch (globalError) {
            throw new Error('缺少 Node Frida：运行 npm install -g frida@16.7.19，或在脚本目录安装同版本');
        }
    }
}

function locateFfmpeg(explicit) {
    if (explicit) {
        if (!fs.existsSync(explicit)) throw new Error(`FFmpeg 不存在: ${explicit}`);
        return explicit;
    }
    const candidates = ['ffmpeg'];
    const pythonRoot = path.join(os.homedir(), 'Library', 'Python');
    if (fs.existsSync(pythonRoot)) {
        for (const version of fs.readdirSync(pythonRoot)) {
            const binaries = path.join(pythonRoot, version, 'lib', 'python', 'site-packages', 'imageio_ffmpeg', 'binaries');
            if (fs.existsSync(binaries)) {
                candidates.push(...fs.readdirSync(binaries).filter((name) => name.startsWith('ffmpeg-'))
                    .map((name) => path.join(binaries, name)));
            }
        }
    }
    return candidates;
}

async function chooseFfmpeg(explicit) {
    for (const candidate of locateFfmpeg(explicit)) {
        try {
            await execFileAsync(candidate, ['-version'], { timeout: 10000 });
            return candidate;
        } catch (error) {
            if (explicit) throw new Error(`FFmpeg 无法运行: ${candidate}: ${error.message}`);
        }
    }
    throw new Error('找不到 FFmpeg；安装 ffmpeg，或用 --ffmpeg 指定可执行文件');
}

function timestamp() {
    return new Date().toISOString().replace(/[-:.]/g, '');
}

function dramaName(title, showId) {
    const cleaned = String(title || '').normalize('NFC').trim()
        .replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
    return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : `shortPlay-${showId}`;
}

async function episodeFolder(dataRoot, episode, label) {
    const dramaDir = path.join(dataRoot, dramaName(episode.shortPlayName, episode.shortPlayId));
    await fsp.mkdir(dramaDir, { recursive: true, mode: 0o700 });
    const name = `第${episode.episodeNum}集`;
    const primary = path.join(dramaDir, name);
    try {
        await fsp.mkdir(primary, { mode: 0o700 });
        return primary;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const duplicate = path.join(dramaDir, `${name}-${label}`);
        await fsp.mkdir(duplicate, { mode: 0o700 });
        return duplicate;
    }
}

function json(pathname, value) {
    fs.writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function adb(device, args, options = {}) {
    return execFileAsync('adb', ['-s', device, ...args], { timeout: 60000, maxBuffer: 64 * 1024 * 1024, ...options });
}

function parsePlaylist(url, payload) {
    const lines = payload.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines[0].trim() !== '#EXTM3U') throw new Error('响应不是 HLS 播放列表');
    const indices = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const absolute = new URL(line, url).toString();
        const prefix = url.slice(0, url.lastIndexOf('/') + 1);
        if (!absolute.startsWith(prefix)) throw new Error(`异常分片地址: ${absolute}`);
        const match = SEGMENT.exec(absolute.slice(prefix.length));
        if (!match) throw new Error(`不支持的播放列表条目: ${line}`);
        indices.push(Number(match[1]));
    }
    if (!indices.length || new Set(indices).size !== indices.length) throw new Error('分片列表为空或编号重复');
    return indices;
}

async function pull(device, remote, local, expectedLength) {
    const { stdout } = await adb(device, ['exec-out', 'cat', remote], { encoding: 'buffer' });
    if (stdout.length !== expectedLength) throw new Error(`${path.basename(local)} 长度不符: ${stdout.length}/${expectedLength}`);
    await fsp.writeFile(local, stdout, { flag: 'wx', mode: 0o600 });
    return stdout;
}

async function runLogged(command, args, logFile) {
    const output = fs.createWriteStream(logFile, { flags: 'wx', mode: 0o600 });
    try {
        await new Promise((resolve, reject) => {
            const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            child.stdout.pipe(output, { end: false });
            child.stderr.pipe(output, { end: false });
            child.on('error', reject);
            child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}，见 ${logFile}`)));
        });
    } finally {
        await new Promise((resolve) => output.end(resolve));
    }
}

async function waitReady(ready) {
    let timer;
    try {
        await Promise.race([ready, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Hook 启动超时')), 15000);
        })]);
    } finally {
        clearTimeout(timer);
    }
}

async function convert(folder, ffmpeg, episodeNum) {
    const source = path.join(folder, 'episode.ts');
    const pending = path.join(folder, `第${episodeNum}集.pending.mp4`);
    const output = path.join(folder, `第${episodeNum}集.mp4`);
    await runLogged(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-movflags', '+faststart', pending], path.join(folder, 'episode.convert.log'));
    await runLogged(ffmpeg, ['-hide_banner', '-nostdin', '-xerror', '-v', 'info',
        '-i', pending, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'],
    path.join(folder, 'episode.verify.log'));
    await fsp.rename(pending, output);
    const ts = await fsp.readFile(source);
    const mp4 = await fsp.readFile(output);
    json(path.join(folder, 'episode.report.json'), {
        source, sourceBytes: ts.length, sourceSha256: sha256(ts), output,
        outputBytes: mp4.length, outputSha256: sha256(mp4),
        conversion: 'stream copy, no re-encode', videoAndAudioFullDecodeSucceeded: true,
        conversionLog: 'episode.convert.log', verificationLog: 'episode.verify.log'
    });
    return { tsBytes: ts.length, mp4Bytes: mp4.length };
}

async function capture(script, device, dataRoot, url, episode, ffmpeg) {
    const match = PLAYLIST.exec(url);
    if (!match) throw new Error(`不支持的播放地址: ${url}`);
    const mediaId = match[1];
    const episodeNum = Number(episode.episodeNum);
    const label = timestamp();
    const folder = await episodeFolder(dataRoot, episode, label);
    const remoteName = `shortmax-run-js-${label}`;
    json(path.join(folder, 'episode.json'), { capturedAt: new Date().toISOString(), episode, playbackUrl: url, mediaId, device });
    json(path.join(folder, 'status.json'), { stage: 'started', time: new Date().toISOString() });
    console.log(`[开始] ${episode.shortPlayName} 第${episodeNum}集 -> ${folder}`);
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`播放列表 HTTP ${response.status}`);
        const playlist = Buffer.from(await response.arrayBuffer());
        await fsp.writeFile(path.join(folder, 'main.m3u8'), playlist, { flag: 'wx', mode: 0o600 });
        const indices = parsePlaylist(url, playlist);
        json(path.join(folder, 'status.json'), { stage: 'segments', total: indices.length, time: new Date().toISOString() });
        const journal = fs.openSync(path.join(folder, 'segments.jsonl'), 'wx', 0o600);
        const records = [];
        try {
            for (const [position, index] of indices.entries()) {
                const result = await script.exports.capturesegment(index, mediaId, remoteName);
                if (result.error) throw new Error(`分片 ${index}: ${result.error}\n${result.stack || ''}`);
                if (result.outputLength <= 0) throw new Error(`分片 ${index}: 播放器未产生 TS`);
                const directory = result.directory;
                if (!directory.endsWith(`/Android/data/${PACKAGE}/files/${remoteName}`)) {
                    throw new Error(`设备输出目录异常: ${directory}`);
                }
                const record = { position: position + 1, index, source: result.source };
                for (const [phase, field] of [['network', 'networkLength'], ['player', 'outputLength']]) {
                    const name = `segment-${String(index).padStart(3, '0')}.${phase}.bin`;
                    const bytes = await pull(device, `${directory}/${name}`, path.join(folder, name), Number(result[field]));
                    record[phase] = { file: name, bytes: bytes.length, sha256: sha256(bytes) };
                    if (phase === 'player' && (bytes.length % 188 !== 0 ||
                        Array.from({ length: bytes.length / 188 }, (_, n) => bytes[n * 188]).some((byte) => byte !== 0x47))) {
                        throw new Error(`分片 ${index}: MPEG-TS 同步字节无效`);
                    }
                }
                records.push(record);
                fs.writeSync(journal, `${JSON.stringify(record)}\n`);
                console.log(`[分片] ${position + 1}/${indices.length}`);
            }
        } finally {
            fs.closeSync(journal);
        }
        const ts = await fsp.open(path.join(folder, 'episode.ts'), 'wx', 0o600);
        try {
            for (const record of records) await ts.writeFile(await fsp.readFile(path.join(folder, record.player.file)));
        } finally {
            await ts.close();
        }
        json(path.join(folder, 'status.json'), { stage: 'converting', time: new Date().toISOString() });
        const sizes = await convert(folder, ffmpeg, episodeNum);
        json(path.join(folder, 'status.json'), { stage: 'complete', time: new Date().toISOString(),
            segments: indices.length, ...sizes });
        console.log(`[完成] TS: ${path.join(folder, 'episode.ts')}\n       MP4: ${path.join(folder, `第${episodeNum}集.mp4`)}`);
    } catch (error) {
        json(path.join(folder, 'status.json'), { stage: 'failed', time: new Date().toISOString(), error: error.message });
        console.error(`[失败] ${folder}: ${error.message}`);
        throw error;
    }
}

async function main() {
    const args = options(process.argv.slice(2));
    process.umask(0o077);
    const ffmpeg = await chooseFfmpeg(args.ffmpeg);
    const { stdout } = await adb(args.device, ['shell', 'pidof', PACKAGE], { encoding: 'utf8' });
    const pid = Number(stdout.trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`请先在 ${args.device} 打开 ${PACKAGE}`);
    const frida = loadFrida();
    await fsp.mkdir(DATA, { recursive: true, mode: 0o700 });
    const events = fs.openSync(path.join(DATA, `.monitor-${timestamp()}.jsonl`), 'wx', 0o600);
    console.log(`数据目录: ${DATA}`);
    let session;
    let script;
    let accepting = true;
    let work = Promise.resolve();
    const queued = new Set();
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const onMessage = (message) => {
        const payload = message.type === 'send' && typeof message.payload === 'object'
            ? message.payload : { event: 'frida_message', message };
        fs.writeSync(events, `${JSON.stringify(payload)}\n`);
        if (payload.event === 'ready') readyResolve();
        if (payload.event === 'hook_error') readyReject(new Error(payload.message));
        if (!accepting || payload.event !== 'ttvideo_play_url_changed') return;
        const episode = payload.episode;
        const url = payload.url || '';
        if (!episode || episode.locked !== false || episode.realLocked !== false ||
            !episode.shortPlayId || !episode.episodeId || !Number.isInteger(episode.episodeNum)) {
            console.log('[跳过] 未确认是免费且已解锁的剧集；请重新点选目标集');
            return;
        }
        if (!PLAYLIST.test(url)) {
            console.log('[跳过] 播放地址不是已验证的 HLS 格式');
            return;
        }
        const key = `${episode.shortPlayId}:${episode.episodeId}:${url}`;
        if (queued.has(key)) return;
        queued.add(key);
        console.log(`[排队] ${episode.shortPlayName} 第${episode.episodeNum}集`);
        work = work.then(() => capture(script, args.device, DATA, url, episode, ffmpeg))
            .catch((error) => { queued.delete(key); console.error(`任务失败: ${error.message}`); });
    };
    try {
        session = await (await frida.getDevice(args.device)).attach(pid);
        script = await session.createScript(AGENT);
        script.message.connect(onMessage);
        await script.load();
        await waitReady(ready);
        console.log('监听中：在 App 中点选免费剧集；Ctrl-C 停止监听（当前任务会继续完成）。');
        await new Promise((resolve) => {
            process.once('SIGINT', resolve);
            session.detached.connect(resolve);
        });
        accepting = false;
        console.log('停止监听，等待已排队任务完成…');
        await work;
    } finally {
        accepting = false;
        if (script) {
            try { await script.unload(); } catch (error) { console.error(`卸载 Hook: ${error.message}`); }
        }
        if (session) {
            try { await session.detach(); } catch (error) { console.error(`断开 Frida: ${error.message}`); }
        }
        fs.closeSync(events);
    }
}

if (require.main === module) {
    main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { AGENT, capture, chooseFfmpeg, dramaName, episodeFolder, parsePlaylist };
