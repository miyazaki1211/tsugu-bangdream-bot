import { tierListOfServer } from '../config'
import { Server } from '../types/Server'

export function generateVerifyCode(): number {
  let verifyCode: number;
  do {
    verifyCode = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
  } while (verifyCode.toString().includes('64') || verifyCode.toString().includes('89'));
  return verifyCode
}

export function isInteger(char: string): boolean {
  const regex = /^-?[1-9]\d*$/;
  return regex.test(char);
}

//校验档线是否为对应服务器的合法档位, tier=10 为前十线, 是所有服务器通用的特殊合法值
export function isValidTier(server: Server, tier: number): boolean {
  if (tier == 10) {
    return true
  }
  const tierList = tierListOfServer[Server[server] as keyof typeof tierListOfServer]
  return tierList != undefined && tierList.includes(tier)
}




