// 文件日志必须最先加载: 拦截其后所有模块的 stdout/stderr, 镜像到 backend/logs/
import '@/fileLog';
import express from 'express';
import { gachaSimulateRouter } from '@/routers/gachaSimulate';
import { cardIllustrationRouter } from '@/routers/getCardIllustration';
import { roomListRouter } from '@/routers/roomList';
import { searchCardRouter } from '@/routers/searchCard';
import { searchCharacterRouter } from '@/routers/searchCharacter';
import { searchEventRouter } from '@/routers/searchEvent';
import { searchMonthlyRankingRouter } from '@/routers/searchMonthlyRanking';
import { searchGachaRouter } from '@/routers/searchGacha';
import { searchPlayerRouter } from '@/routers/searchPlayer';
import { playerPtRouter } from '@/routers/playerPt';
import { playerMusicRouter } from '@/routers/playerMusic';
import { searchSongRouter } from '@/routers/searchSong';
import { songMetaRouter } from '@/routers/songMeta';
import { cutoffDetailRouter } from '@/routers/cutoffDetail';
import { cutoffListOfRecentEventRouter } from '@/routers/cutoffListOfEvent';
import { cutoffAllRouter } from '@/routers/cutoffAll';
import { cutOffMusicRouter } from '@/routers/cutOffMusic';
import { monthlyRankingCutoffDetailRouter } from '@/routers/monthlyRankingCutoffDetail';
import { monthlyRankingCutoffListOfRecentRouter } from '@/routers/monthlyRankingCutoffListOfRecent';
import { monthlyRankingCutoffAllRouter } from '@/routers/monthlyRankingCutoffAll';
import { songChartRouter } from '@/routers/songChart';
import { userRouter } from '@/routers/user'
import { qrcodeLoginRouter } from '@/routers/qrcodeLogin'
import { stationRouter } from '@/routers/station'
import { eventPreviewRouter } from '@/routers/article/eventPreview'
import { eventReportRouter } from '@/routers/article/eventReport'
import { eventStageRouter } from '@/routers/eventStage'
import { calendarRouter } from '@/routers/calendar'
import { songRandomRouter } from '@/routers/songRandom'
import { fuzzySearchRouter } from '@/routers/fuzzySearch'
import { teamBuildDetailRouter } from '@/routers/teamBuildDetail'
import { calcResultRouter } from './routers/calcResult';
import { ptMaximizeRouter } from '@/routers/ptMaximize';
import { scoreRangeRouter } from '@/routers/scoreRange';
import { microOptimizeRouter } from '@/routers/microOptimize';
import { topRateDetailRouter } from '@/routers/topRateDetail';
import { topPointStatRouter } from '@/routers/topPointStat';
import { topRateRankingRouter } from '@/routers/topRateRanking';
import { topTenMinuteSpeedRouter } from '@/routers/topTenMinuteSpeed';
import { monthlyTopRateDetailRouter } from '@/routers/monthlyTopRateDetail';
import { monthlyTopPointStatRouter } from '@/routers/monthlyTopPointStat';
import { monthlyTopRateRankingRouter } from '@/routers/monthlyTopRateRanking';
import { monthlyTopTenMinuteSpeedRouter } from '@/routers/monthlyTopTenMinuteSpeed';
import { searchCompositionRouter } from '@/routers/searchComposition';
import { eventBorderPlayersRouter } from '@/routers/eventBorderPlayers';
import { musicBorderPlayersRouter } from '@/routers/musicBorderPlayers';
import { monthlyBorderPlayersRouter } from '@/routers/monthlyBorderPlayers';
import { finalRankingRouter } from '@/routers/finalRanking';

import { logger } from '@/logger'
import * as dotenv from 'dotenv';
import { startMemoryMonitor } from '@/monitoring/memoryMonitor';
import { startEventTimeOverlay } from '@/api/eventTimeOverlay';


dotenv.config();
startMemoryMonitor();
startEventTimeOverlay();


const app = express();

app.use(express.json());

app.use('/gachaSimulate', gachaSimulateRouter);
app.use('/getCardIllustration', cardIllustrationRouter);
app.use('/roomList', roomListRouter);
app.use('/searchCard', searchCardRouter);
app.use('/searchCharacter', searchCharacterRouter);
app.use('/searchEvent', searchEventRouter);
app.use('/searchMonthlyRanking', searchMonthlyRankingRouter);
app.use('/searchGacha', searchGachaRouter);
app.use('/searchPlayer', searchPlayerRouter);
app.use('/playerPt', playerPtRouter);
app.use('/playerMusic', playerMusicRouter);
app.use('/searchSong', searchSongRouter);
app.use('/songMeta', songMetaRouter);
app.use('/songChart', songChartRouter);
app.use('/cutoffDetail', cutoffDetailRouter);
app.use('/cutoffListOfRecentEvent', cutoffListOfRecentEventRouter);
app.use('/cutoffAll', cutoffAllRouter)
app.use('/monthlyRankingCutoffDetail', monthlyRankingCutoffDetailRouter);
app.use('/monthlyRankingCutoffListOfRecent', monthlyRankingCutoffListOfRecentRouter);
app.use('/monthlyRankingCutoffAll', monthlyRankingCutoffAllRouter);
app.use('/cutOffMusic', cutOffMusicRouter);
app.use('/eventStage', eventStageRouter)
app.use('/calendar', calendarRouter);
app.use('/songRandom', songRandomRouter);
app.use('/fuzzySearch', fuzzySearchRouter);
app.use('/teamBuildDetail', teamBuildDetailRouter);
app.use('/calcResult', calcResultRouter);
app.use('/ptMaximize', ptMaximizeRouter);
app.use('/scoreRange', scoreRangeRouter);
app.use('/microOptimize', microOptimizeRouter);
app.use('/topRateDetail', topRateDetailRouter);
app.use('/topPointStat', topPointStatRouter);
app.use('/topRateRanking', topRateRankingRouter);
app.use('/topTenMinuteSpeed', topTenMinuteSpeedRouter);
app.use('/monthlyTopRateDetail', monthlyTopRateDetailRouter);
app.use('/monthlyTopPointStat', monthlyTopPointStatRouter);
app.use('/monthlyTopRateRanking', monthlyTopRateRankingRouter);
app.use('/monthlyTopTenMinuteSpeed', monthlyTopTenMinuteSpeedRouter);
app.use('/searchComposition', searchCompositionRouter)
app.use('/eventBorderPlayers', eventBorderPlayersRouter);
app.use('/musicBorderPlayers', musicBorderPlayersRouter);
app.use('/monthlyBorderPlayers', monthlyBorderPlayersRouter);
//结榜图: 无条件挂载, 数据表固定存于 tsugu-bangdream-bot 库
app.use('/finalRanking', finalRankingRouter);

// console.log(process.env)
if (process.env.LOCAL_DB == 'true') {
    app.use('/user/qrcodeLogin', qrcodeLoginRouter);
    app.use('/user', userRouter);
    app.use('/station', stationRouter);
}
else {
    app.use('/user', (req, res) => {
        res.status(404).send({
            status: 'fail',
            data: '错误: 服务器未启用数据库'
        });
    });
    app.use('/station', (req, res) => {
        res.status(404).send({
            status: 'fail',
            data: '错误: 服务器未启用数据库'
        });
    });
}
if (process.env.ARTICLE == 'true') {
    app.use('/eventPreview', eventPreviewRouter);
    app.use('/eventReport', eventReportRouter);
}

const port: number = parseInt(process.env.BACKEND_PORT || '3000');

if (isNaN(port)) {
    logger('expressMainThread', `port is not a number: ${JSON.stringify(process.env.BACKEND_PORT)}`);
    process.exit(1);
}

//404
app.use((req, res) => {
    res.status(404).send('404 Not Found');
});

app.listen(port, () => {
    logger(`expressMainThread`, `listening on port ${port}`);
});
