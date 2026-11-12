import * as axios from 'axios';
import { API_TIMEOUT } from './axiosTimeout'

export async function callAPIAndCacheResponse(url: string, cacheTime: number = 0): Promise<object> {
  const response = await axios.default.get(url, { timeout: API_TIMEOUT });
  return response.data;
}
