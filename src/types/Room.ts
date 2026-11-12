import { userPlayerInList } from "../config";
import { Player } from "./Player";

interface RoomOption {
    number: number;
    rawMessage: string;
    source: string;
    userId: string;
    time: number;
    avatarUrl?: string;
    userName?: string;
    bandoriStationToken?: string;
}

export class Room {
    number: number;
    rawMessage: string;
    source: string;
    userId: string;
    time: number;
    player: userPlayerInList
    avatarUrl?: string;
    userName?: string;
    constructor({ number, rawMessage, source, userId, time, avatarUrl, userName }: RoomOption) {
        this.number = number
        this.rawMessage = rawMessage
        this.source = source
        this.userId = userId
        this.time = time
        this.avatarUrl = avatarUrl
        this.userName = userName
    }
    setPlayer(player: Player) {
        this.player = {
            playerId: player.playerId,
            server: player.server
        }
    }
}
