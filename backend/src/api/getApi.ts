import { getJsonAndSave } from '@/api/downloader';
import { getCacheDirectory, getFileNameFromUrl } from '@/api/utils';
import { logger } from '@/logger';
import * as fs from 'fs';
import * as path from 'path';

async function callAPIAndCacheResponse(url: string, cacheTime: number = 0, retryCount: number = 3): Promise<object> {
  if (url.includes('hhwx.org/api/tracker/data')) {
    url = url.replace('hhwx.org/api/tracker/data', 'hhwx.org/api/bandori/tracker/data');  // HHWX数据源修复
  }
  const cacheDir = getCacheDirectory(url);
  const fileName = getFileNameFromUrl(url);
  //console.log('callAPIAndCacheResponse:',url,' cacheTime:',cacheTime)
  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const data = await getJsonAndSave(url, cacheDir, fileName, cacheTime);
      return data;
    } catch (e) {
      if (e && e.response && e.response.status === 404) {
        // 当URL返回404错误后，不再重试，直接抛出错误。
        logger(`API`,`URL "${url}" returned 404 Not Found. No more retries will be made.`);
        throw e
      }
      logger(`API`, `Failed to get JSON from "${url}" on attempt ${attempt + 1}. Error: ${e.message}`);
      if (attempt === retryCount - 1) {
        //所有重试均失败：若磁盘上存在过期缓存，则返回旧数据兜底，
        //避免外部数据源抖动直接导致指令失败
        try {
          const cachedData = fs.readFileSync(path.join(cacheDir, fileName), 'utf-8');
          logger(`API`, `All attempts failed for "${url}". Falling back to stale cache.`);
          return JSON.parse(cachedData);
        } catch (cacheErr) {
          throw e; // 无缓存可用时抛出原始错误
        }
      }
      //指数退避重试：500ms → 1s → 2s
      const delay = Math.min(2000, 500 * Math.pow(2, attempt));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed to get JSON from "${url}" after ${retryCount} attempts`);
}

export { callAPIAndCacheResponse };
