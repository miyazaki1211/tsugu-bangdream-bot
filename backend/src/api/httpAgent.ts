import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import * as net from 'net';
import { logger } from '@/logger';

//共享 keep-alive 连接池参数：
//- keepAlive: true       复用 TCP 连接，省去每次请求的 TCP/TLS 握手
//- keepAliveMsecs: 60000 空闲连接的 TCP 保活探测间隔
//- timeout: 60000        空闲 socket 在连接池中闲置超过 60 秒即被 Agent 销毁断开，
//                        60 秒内有新请求则继续复用
const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: 60000,
    timeout: 60000
};

//经代理建立到目标的 CONNECT 隧道，回调返回隧道上的裸 socket（由调用方决定是否包 TLS）
function connectThroughProxy(proxy: URL, targetHost: string, targetPort: number, callback: any): void {
    const target = `${targetHost}:${targetPort}`;
    const headers: { [key: string]: string } = { Host: target };
    if (proxy.username) {
        headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(
            `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
        ).toString('base64');
    }
    const req = http.request({
        host: proxy.hostname,
        port: Number(proxy.port || 80),
        method: 'CONNECT',
        path: target,
        headers
    });
    req.setTimeout(15000, () => req.destroy(new Error(`proxy CONNECT timeout (${proxy.hostname}:${proxy.port})`)));
    req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
            socket.destroy();
            callback(new Error(`proxy CONNECT failed: ${res.statusCode}`));
            return;
        }
        callback(null, socket);
    });
    req.on('error', (e) => callback(e));
    req.end();
}

//对 socket 施加与直连 Agent 一致的空闲超时与 TCP 保活
function applySocketOptions(socket: tls.TLSSocket | net.Socket, options: any): void {
    if (options.timeout) {
        socket.setTimeout(options.timeout);
    }
    socket.setKeepAlive(true, options.keepAliveMsecs || 1000);
}

//http 目标的代理隧道 Agent：CONNECT 隧道 + 裸 socket（明文 HTTP 经隧道直达目标）
//注意必须继承 http.Agent —— Node 会用 agent.protocol 校验请求协议，
//若把 https.Agent 子类实例当作 httpAgent 传给 http 请求会抛 ERR_INVALID_PROTOCOL
class HttpOverHttpAgent extends http.Agent {
    proxyUrl: URL;
    sockOptions: http.AgentOptions;

    constructor(proxyUrl: URL, options?: http.AgentOptions) {
        super(options);
        this.proxyUrl = proxyUrl;
        this.sockOptions = options || {};
    }

    createConnection(options: any, callback: any): any {
        connectThroughProxy(this.proxyUrl, options.host, options.port || 80, (err: Error | null, socket: net.Socket) => {
            if (err) {
                callback(err);
                return;
            }
            applySocketOptions(socket, this.sockOptions);
            callback(null, socket);
        });
    }
}

//https 目标的代理隧道 Agent：CONNECT 隧道 + TLS
class HttpsOverHttpAgent extends https.Agent {
    proxyUrl: URL;

    constructor(proxyUrl: URL, options?: https.AgentOptions) {
        super(options);
        this.proxyUrl = proxyUrl;
    }

    createConnection(options: any, callback: any): any {
        connectThroughProxy(this.proxyUrl, options.host, options.port || 443, (err: Error | null, socket: net.Socket) => {
            if (err) {
                callback(err);
                return;
            }
            const tlsSocket = tls.connect({ socket: socket, servername: options.host });
            applySocketOptions(tlsSocket, this.options);
            const onError = (e: Error) => callback(e);
            tlsSocket.once('error', onError);
            tlsSocket.once('secureConnect', () => {
                tlsSocket.removeListener('error', onError);
                callback(null, tlsSocket);
            });
        });
    }
}

const directHttpAgent = new http.Agent(agentOptions);
const directHttpsAgent = new https.Agent(agentOptions);

//解析代理地址，格式非法时忽略并告警
function parseProxyUrl(raw: string): URL | null {
    if (!raw) {
        return null;
    }
    try {
        const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
        if (!parsed.hostname) {
            return null;
        }
        return parsed;
    } catch (e) {
        logger('httpAgent', `无法解析代理地址 "${raw}"，忽略代理: ${e.message}`);
        return null;
    }
}

//目标是否命中 NO_PROXY；未配置 NO_PROXY 时默认本机地址直连（保护 predict 等本地服务）
function isNoProxyHost(hostname: string): boolean {
    const noProxy = process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1';
    const entries = noProxy.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
    for (const entry of entries) {
        if (entry === '*') {
            return true;
        }
        if (hostname === entry) {
            return true;
        }
        if (entry.startsWith('.') && hostname.endsWith(entry)) {
            return true;
        }
    }
    return false;
}

//按目标 URL 的协议解析应使用的代理环境变量（与 axios 的 proxy-from-env 语义一致）：
//- https 目标读 HTTPS_PROXY/https_proxy/ALL_PROXY/all_proxy
//- http  目标读 HTTP_PROXY/http_proxy/ALL_PROXY/all_proxy
//注意 HTTPS_PROXY 不作用于 http 目标、HTTP_PROXY 不作用于 https 目标
function getProxyForUrl(url: string): URL | null {
    let protocol = '';
    let hostname = '';
    try {
        const parsed = new URL(url);
        protocol = parsed.protocol;
        hostname = parsed.hostname.toLowerCase();
    } catch (e) {
        return null;
    }
    if (isNoProxyHost(hostname)) {
        return null;
    }
    let raw = '';
    if (protocol === 'https:') {
        raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || '';
    } else if (protocol === 'http:') {
        raw = process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || '';
    } else {
        return null;
    }
    return parseProxyUrl(raw);
}

//隧道 Agent 按"代理地址+协议"缓存，同一代理的所有连接共享一个池
const httpTunnelAgentCache = new Map<string, HttpOverHttpAgent>();
const httpsTunnelAgentCache = new Map<string, HttpsOverHttpAgent>();

function getHttpTunnelAgent(proxy: URL): HttpOverHttpAgent {
    const key = proxy.href;
    if (!httpTunnelAgentCache.has(key)) {
        httpTunnelAgentCache.set(key, new HttpOverHttpAgent(proxy, agentOptions));
        logger('httpAgent', `http 目标已启用经代理(${proxy.host})的 keep-alive 隧道，空闲60秒回收`);
    }
    return httpTunnelAgentCache.get(key) as HttpOverHttpAgent;
}

function getHttpsTunnelAgent(proxy: URL): HttpsOverHttpAgent {
    const key = proxy.href;
    if (!httpsTunnelAgentCache.has(key)) {
        httpsTunnelAgentCache.set(key, new HttpsOverHttpAgent(proxy, agentOptions));
        logger('httpAgent', `https 目标已启用经代理(${proxy.host})的 keep-alive 隧道，空闲60秒回收`);
    }
    return httpsTunnelAgentCache.get(key) as HttpsOverHttpAgent;
}

//按 URL 生成 axios 请求配置（展开到 axios 请求参数中使用）：
//- 目标未命中代理环境变量（或命中 NO_PROXY）→ 直连 keep-alive Agent
//- 目标命中代理 → 对应协议的 keep-alive 隧道 Agent + proxy:false
//  （proxy:false 同时禁止 axios 走自身"绕过 Agent 且无连接池"的代理路径）
export function keepAliveAxiosConfig(url: string): { proxy: false, httpAgent: http.Agent, httpsAgent: https.Agent } {
    const proxy = getProxyForUrl(url);
    if (!proxy) {
        return { proxy: false, httpAgent: directHttpAgent, httpsAgent: directHttpsAgent };
    }
    const isHttps = (() => {
        try {
            return new URL(url).protocol === 'https:';
        } catch (e) {
            return false;
        }
    })();
    if (isHttps) {
        const agent = getHttpsTunnelAgent(proxy);
        return { proxy: false, httpAgent: agent, httpsAgent: agent };
    }
    const agent = getHttpTunnelAgent(proxy);
    return { proxy: false, httpAgent: agent, httpsAgent: directHttpsAgent };
}
