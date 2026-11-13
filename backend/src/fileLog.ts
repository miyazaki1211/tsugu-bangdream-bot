/**
 * 文件日志: 将控制台输出(stdout/stderr)逐条镜像到 backend/logs/ 下按天滚动的日志文件。
 * - 文件名: YYYY-MM-DD.log(本地时间), 跨天写入时自动切换到新文件
 * - 内容与 console 输出完全一致(logger 与散落的 console.* 均会被记录)
 * - 采用同步写入, 进程崩溃/控制台丢失前的日志不丢失
 * - 必须在 app.ts 中最先 import, 以拦截其后所有模块的输出
 */
import * as fs from 'fs';
import * as path from 'path';

// src/fileLog.ts 与 dist/fileLog.js 均位于 backend 根下一级, ../logs 即 backend/logs
const LOG_DIR = path.resolve(__dirname, '..', 'logs');

let fileLogEnabled = true;
let logFd: number | null = null;
let logDate = '';

function localDateString(d: Date): string {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function writeToFile(chunk: string | Uint8Array): void {
    if (!fileLogEnabled) {
        return;
    }
    try {
        const date = localDateString(new Date());
        // 懒检测跨天: 每次写入核对日期, 变化则切换到新文件
        if (logFd === null || date !== logDate) {
            if (logFd !== null) {
                fs.closeSync(logFd);
            }
            fs.mkdirSync(LOG_DIR, { recursive: true });
            logFd = fs.openSync(path.join(LOG_DIR, `${date}.log`), 'a');
            logDate = date;
        }
        // writeSync 的 string / Uint8Array 重载不兼容联合类型, 按实际类型分支调用
        if (typeof chunk === 'string') {
            fs.writeSync(logFd, chunk);
        }
        else {
            fs.writeSync(logFd, chunk);
        }
    }
    catch (error) {
        // 日志文件写入失败不应影响服务本身: 停止文件记录并用原始终端输出提示一次
        fileLogEnabled = false;
        const fd = logFd;
        logFd = null;
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            }
            catch {
                // 关闭已出错的文件描述符失败可安全忽略
            }
        }
        originalStdoutWrite(`[fileLog] 写入日志文件失败, 已停止文件日志: ${String(error)}\n`);
    }
}

process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => {
    writeToFile(chunk);
    return originalStdoutWrite(chunk, encoding, cb);
}) as typeof process.stdout.write;

process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => {
    writeToFile(chunk);
    return originalStderrWrite(chunk, encoding, cb);
}) as typeof process.stderr.write;
