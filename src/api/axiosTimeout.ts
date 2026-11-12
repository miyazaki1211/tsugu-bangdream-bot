export const RENDER_TIMEOUT = 60000;
//fuzzySearch / remoteDB / 外部 API 等小 JSON 请求
export const API_TIMEOUT = 15000;
//房间玩家查询：上游含串行锁与最多4次重试，耗时可能远超普通API
export const ROOM_QUERY_TIMEOUT = 30000;
