import * as path from 'path';
import { assetsRootPath } from '@/config';
import { getCacheDirectory, getFileNameFromUrl } from '@/api/utils';
import { download, isKnownBadUrl } from '@/api/downloader';
import { Buffer } from 'buffer';
import { assetErrorImageBuffer } from '@/image/utils';
import { logger } from '@/logger';
import * as fs from 'fs';

async function downloadFile(url: string, IgnoreErr: boolean = true, overwrite = false, retryCount: number = 3): Promise<Buffer> {
  try {
    if(url.includes('undefined')) {
      throw new Error("downloadFile: url.includes('undefined')");
    }

    const cacheTime = overwrite ? 0 : 1 / 0;
    const cacheDir = getCacheDirectory(url);
    const fileName = getFileNameFromUrl(url);

    for (let attempt = 0; attempt < retryCount; attempt++) {
      let assetNotExists = false;
      if (attempt > 0) {
        logger(`downloader`, `Retrying download for "${url}" (attempt ${attempt + 1}/${retryCount})`);
      }
      try {
        const data = await download(url, cacheDir, fileName, cacheTime);
        const htmlSig = Buffer.from("<!DOCTYPE html>");
        const slice = Buffer.from(data.subarray(0, htmlSig.length));
        if (slice.equals(htmlSig)) {
          fs.unlinkSync(path.join(cacheDir, fileName));
          assetNotExists = true;
          throw new Error("downloadFile: data.toString().startsWith(\"<!DOCTYPE html>\")");
        }
        return data;
      } catch (e) {
        if (attempt === retryCount - 1) {
          throw e;
        }
        if(assetNotExists){
          throw e;
        }
        //404 或已被拉黑的 URL 重试必定失败，立即放弃，不再空等
        if (String(e.message).includes('404') || isKnownBadUrl(url)) {
          throw e;
        }
        //指数退避重试：500ms → 1s → 2s
        const delay = Math.min(3000, 500 * Math.pow(2, attempt));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  } catch (e) {
    logger(`downloader`, `Failed to download file from "${url}". Error: ${e.message}`);

    if ((url.includes('.png') || url.includes('.svg')) && IgnoreErr) {
      return assetErrorImageBuffer;
    }

    throw e; // 抛出错误
  }
}

export { downloadFile };
