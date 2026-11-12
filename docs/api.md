# API

此 API 体系是由 Yamamoto-2 在将 Tsugu 搬迁至 Koishi 框架中时，为了进行前后端的分离而构建的一套 API 体系。整套 API 分为三个部分，分别为查询用 API 、用户数据 API 和车站 API 。

## 请求结构

对于请求中的 `mainServer` 型字段，在 **[查询 API](#查询-api)** 中，该字段为 [Server](#server-服务器) 列举中的值，而在 **[用户数据 API](#用户数据-api)** 中，该字段为 [ServerId](#serverid-服务器-id) 列举中的值。

### Server 服务器

| 名称 | 支持的值 | 说明 |
|:----:|:-------:|:-----|
| JP | `0`, `jp` | 日服 |
| EN | `1`, `en` | 国际服 |
| TW | `2`, `tw` | 台服 |
| CN | `3`, `cn` | 国服 |
| KR | `4`, `kr` | 韩服 (已停服) |

### ServerId 服务器 ID

| 名称 | 支持的值 | 说明 |
|:----:|:-------:|:-----|
| JP | `0` | 日服 |
| EN | `1` | 国际服 |
| TW | `2` | 台服 |
| CN | `3` | 国服 |
| KR | `4` | 韩服 (已停服) |


对于请求中的 `fuzzySearchResult` (模糊搜索过滤器) 型字段与 `text` 字段，在 **[查询 API](#查询-api)** 中，该字段用于在查询时进行过滤。

`fuzzySearchResult` 字段的格式为 `{ [key: string]: (string | number)[]; }`, 其中 `key` 代表需要过滤的键， `(string | number)[]` 为需要过滤的值。如果值为`string`类型`Array`，需要全部小写。

`key`中，`_all`, `_relationStr` 与 `_number`为特殊键，其中`_all`中的值代表从所有键过滤。`_relationStr`中包括表示数值关系的值，比如`>100`,`1-99`，`_number`中为常用的数字类型值(目前只有卡牌加成数值) (因为指令在只有数字的时候，会直接查询数字对应的的ID的内容，所以数字值需要特殊考虑)。

目前有接口可以将 `text` 转换为 `fuzzySearchResult` **[模糊搜索过滤器](#模糊搜索过滤器)**

例: 在查卡时(`/searchCardg`) `{ characterId: [ 10 ], _number: [ 100 ] }` 表示查询角色Id为10(Tsugu)，技能加成为100%的卡

例子: 在查曲时(`/searchSong`)  `fuzzySearchResult` 为 `{ _all: [ 'bird' ] }` 表示查询任何位置包括bird关键词的曲。

## 响应结构

除 **用户数据 API** 与 **车站 API** 以外的 API 都有一个统一的响应结构，为一个对象列表。对于用户数据 API 和车站 API ，其有单独的响应结构。

### 响应对象

此统一响应结构为一个列表，其中的元素为如下的对象。

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `type` | string | `string` / `base64` | 表示 `string` 字段的值的内容类型。 |
| `string` | string | - | 当 `type` 值为 `string` 时，为 API 返回的响应文本；当 `type` 值为 `base64` 时，为 API 返回的图片的 Base64 字符串。 |

## 查询 API

进行信息和数据查询的 API ，当查询到具体信息后，后端将会返回多张图片；若查询出错，后端将会返回文本信息，表示后端出现的错误信息。

### 查询团队 festival 活动舞台数据

查询指定服务器的团队 festival 活动舞台数据，仅当指定活动为团队 festival 活动时可以获取到数据。

终结点: `POST /eventStage`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 用户所在的服务器。 |
| `eventId` | number? | `null` | 指定的活动 ID ，不指定则为当前活动。 |
| `meta` | boolean? | `false` | 是否携带歌曲分数信息。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。|

#### 响应结构

一个 [Response](#响应对象) 列表。

### 模拟抽卡

模拟指定卡池的抽卡结果。

终结点: `POST /gachaSimulate`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 抽卡模拟使用的服务器，同一卡池在不同服务器的表现可能不同。 |
| `times` | number? | `10` | 模拟抽卡的次数。 |
|`compress`| boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |
| `gachaId` | number? | `null` | 若传入则模拟指定卡池的抽卡结果，不传入则默认为指定服务器的最新卡池。|

#### 响应结构

一个 [Response](#响应对象) 列表。

### 获取卡面图片

获取指定 ID 卡牌的卡面图片。

终结点: `POST /getCardIllustration`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `cardId` | number | - | 要获取卡面的卡牌 ID 。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询历史预测线

查询与指定活动相关的指定档位的历史预测线。

终结点: `POST /cutoffListOfRecentEvent`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 要查询的指定服务器。 |
| `tier` | number | - | 要查询的档位排名。若传入不存在的档位会出现错误。 |
| `eventId` | number? | `null` | 若传入则查询指定活动，不传入则默认为指定服务器的最新活动。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 绘制房间列表图片

传入获取到的房间列表信息，获取绘制后的图片，或当没有房间时返回的信息。

终结点: `POST /roomList`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `roomList` | [Room](#room-房间信息)[] | - | 获取到的房间信息列表。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询卡牌信息

查询指定卡牌的信息，或查询符合条件的卡牌列表。

终结点: `POST /searchCard`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `text` | string | - | 将要查询的查询文本。 |
| `fuzzySearchResult` | FuzzySearchResult | - | 将要查询的查询模糊搜索过滤器。 |
| `useEasyBG` | boolean | - | 是否使用简易背景。 `false` 即为不使用简易背景，此时后端图片生成耗时可能会大幅增加。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |
| `playerId` | number? | - | 执行指令的玩家所绑定的玩家ID。与 `playerServer` 同时提供且查询结果为卡牌列表时，列表中会在玩家已拥有的卡牌ID右侧绘制绿色圆形标记。另有与绑定无关的标记：日服已发布而国服未发布的卡牌，卡牌ID小于国服当前活动卡牌最大ID时为红色标记，大于时为灰色标记。 |
| `playerServer` | Server | - | 执行指令的玩家所绑定的玩家所在服务器。与 `playerId` 同时提供时生效。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询角色信息

查询符合条件的角色信息。

终结点: `POST /searchCharacter`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `text` | string | - | 将要查询的查询参数。 |
| `fuzzySearchResult` | FuzzySearchResult | - | 将要查询的查询模糊搜索过滤器。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询活动信息

查询指定活动的信息，或查询符合条件的活动列表。

终结点: `POST /searchEvent`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `text` | string | - | 将要查询的查询参数。 |
| `fuzzySearchResult` | FuzzySearchResult | - | 将要查询的查询模糊搜索过滤器。 |
| `useEasyBG` | boolean | - | 是否使用简易背景。 `false` 即为不使用简易背景，此时后端图片生成耗时可能会大幅增加。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询卡池信息

查询指定卡池的信息。

终结点: `POST /searchGacha`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `gachaId` | number | - | 查询的卡池 ID 。 |
| `useEasyBG` | boolean | - | 是否使用简易背景。 `false` 即为不使用简易背景，此时后端图片生成耗时可能会大幅增加。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询玩家状态

查询指定服务器的指定玩家的状态图片。仅能查询到已公开的信息。

终结点: `POST /searchPlayer`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `playerId` | number | - | 查询的用户 ID 。 |
| `mainServer` | [Server](#server-服务器) | - | 用户所在的服务器。 |
| `useEasyBG` | boolean | - | 是否使用简易背景。 `false` 即为不使用简易背景，此时后端图片生成耗时可能会大幅增加。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询歌曲信息

查询指定歌曲的信息，或查询符合条件的歌曲列表。

终结点: `POST /searchSong`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `text` | string | - | 将要查询的查询参数。 |
| `fuzzySearchResult` | FuzzySearchResult | - | 将要查询的查询模糊搜索过滤器。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 获取歌曲谱面

获取指定歌曲的谱面图片。

终结点: `POST /songChart`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `songId` | number | - | 指定的歌曲 ID 。 |
| `difficultyText` | string | - | 指定谱面难度文本。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 微操计算

计算绑定玩家在当前活动选定歌曲上的微操理论最高分，返回概要信息与微操谱面图。队伍来自 `/v1/calc-result` 计算结果，歌曲与难度来自玩家的「选择歌曲」设置（未设置时使用活动默认曲）。仅支持挑战（challenge）/ 对邦（versus）类型活动，其他类型返回错误提示。

终结点: `POST /microOptimize`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `playerId` | number | - | 绑定的玩家 ID 。 |
| `mainServer` | [Server](#server-服务器) | - | 玩家的主服务器。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询歌曲分数表

查询歌曲分数排行表。

终结点: `POST /songMeta`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `displayedServerList` | [Server](#server-服务器)[] | - | 默认服务器列表，将会按顺序查询第一个有效的服务器。 |
| `mainServer` | [Server](#server-服务器) | - | 要查询的主服务器。 |
| `fever` | boolean? | `true` | 是否计算带 Fever 的分数。 |
| `scoreUpMaxValue` | number? | `150`（无 Fever 时 `130`） | 技能倍率百分比，如技能为 150% 时传 `150`。默认值取决于 `fever`：带 Fever 为 `150`，无 Fever 为 `130`。 |
| `skillDuration` | number? | `7` | 技能持续时间（秒），必须是 meta 数据中存在的值（如 `3`、`5`、`7` 等），否则返回错误提示。 |
| `difficultyFilter` | string? | - | 难度过滤条件，格式为 `<N` 或 `>N`（如 `<26` 表示只展示难度低于 26 的曲目，`>20` 表示只展示难度高于 20 的曲目），数字为 0 到 100 之间的正数。仅过滤展示的曲目，不改变排名。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询指定档位预测线

查询指定活动的指定档位的预测线。

终结点: `POST /cutoffDetail`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 要查询的指定服务器。 |
| `tier` | number | - | 要查询的档位排名。若传入不存在的档位会出现错误。 |
| `eventId` | number? | `null` | 若传入则查询指定活动，不传入则默认为指定服务器的最新活动。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询全档位预测线

查询指定活动的全档位预测线。

终结点: `POST /cutoffAll`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 要查询的指定服务器。 |
| `eventId` | number? | `null` | 若传入则查询指定活动，不传入则默认为指定服务器的最新活动。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询国服活动日历

查询国服活动日历图片，包含活动档期（官方公布与 HHWX 预测）、节假日休/班安排。日历仅覆盖国服。

终结点: `POST /calendar`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `year` | number? | 当年 | 日历年份（国服时区）。 |
| `month` | number? | 当月 | 日历月份（1-12，国服时区）。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询月榜前十车速排名

查询月榜前十玩家的分速排名图片。月榜数据经排名数据源链获取，国服优先使用本地 GarupaSpeedTracker 数据源（`LOCAL_RANKING_API_URL`，默认 `http://127.0.0.1:5519`，探测可用时自动启用）。

终结点: `POST /monthlyTopRateRanking`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 主服务器。 |
| `monthlyRankingId` | number? | 当前月榜 | 月榜 ID 。省略时根据 `date` （省略则为当前时间）自动解析对应期月榜。 |
| `length` | number? | `60` | 统计时间范围（分钟）。 |
| `date` | number? | 当前时间 | 指定结束时间（毫秒时间戳）。 |
| `compareTier` | number? | - | 对比玩家的排名（1-10）。 |
| `compareUid` | number? | - | 对比玩家的 UID 。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询月榜前十分速表

查询月榜前十玩家的分速表图片，可显示时间范围内出现过分变动的全部玩家。

终结点: `POST /monthlyTopTenMinuteSpeed`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 主服务器。 |
| `monthlyRankingId` | number? | 当前月榜 | 月榜 ID 。省略时根据 `date` （省略则为当前时间）自动解析对应期月榜。 |
| `time` | number? | `60` | 统计时间范围（分钟）。 |
| `date` | number? | 当前时间 | 指定结束时间（毫秒时间戳）。 |
| `allPlayer` | boolean? | `false` | 是否显示时间范围内的全部玩家（榜外玩家加括号显示）。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询月榜玩家分数散点图

查询月榜前十指定玩家的单把出分散点图与数据特征分析图片。

终结点: `POST /monthlyTopPointStat`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 主服务器。 |
| `monthlyRankingId` | number? | 当前月榜 | 月榜 ID 。 |
| `playerId` | number? | - | 玩家 UID 。与 `tier` 至少提供一个。 |
| `tier` | number? | - | 玩家排名（1-10）。与 `playerId` 至少提供一个。 |
| `limit` | string? | - | 分数过滤条件，如 `>10000` 、 `<=20000` 、 `10000-20000` 。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 查询月榜玩家分数变化（月榜查岗）

查询月榜前十指定玩家的近期分数变化与统计数据图片。

终结点: `POST /monthlyTopRateDetail`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `mainServer` | [Server](#server-服务器) | - | 主服务器。 |
| `monthlyRankingId` | number? | 当前月榜 | 月榜 ID 。 |
| `playerId` | number? | - | 玩家 UID 。与 `tier` 至少提供一个。 |
| `tier` | number? | - | 玩家排名（1-10）。与 `playerId` 至少提供一个。 |
| `day` | number? | - | 指定月榜第几天的分数变动详情。 |
| `limit` | string? | - | 分数过滤条件，如 `>10000` 、 `<=20000` 、 `10000-20000` 。 |
| `count` | number? | `20` | 显示最近的几次分数变化。 |
| `compress` | boolean? | `false` | 是否在后端压缩图像，压缩图像可以加快传输速度，但是会降低图片清晰度。 |

#### 响应结构

一个 [Response](#响应对象) 列表。

### 记录结榜成绩

记录群内玩家的国服活动结榜成绩（PT 榜或歌榜），供生成结榜图使用。后端按"最近一个已结束的国服活动"归档，仅允许在活动结束后至结束日期+3天 24:00（北京时间）内记录。记录时后端按 `uid` 拉取玩家资料快照（昵称/等级/签名/头像/牌子），`signature` 提供时覆盖签名。同一玩家 PT 榜与歌榜成绩合并在同一条记录中，重复提交覆盖更新。数据存储于 MongoDB（`finalRankings` 集合，`tsugu-bangdream-bot` 库），接口不依赖 `LOCAL_DB` 开关。

终结点: `POST /finalRanking/submit`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 前端平台标识。 |
| `groupId` | string | - | 群号。 |
| `type` | string | - | `event` 表示 PT 榜，`music` 表示歌榜。 |
| `uid` | number | - | 国服玩家 ID 。 |
| `ranking` | number | - | 排名。 |
| `pt` | number? | - | `type` 为 `event` 时的 PT ，必填。 |
| `score` | number? | - | `type` 为 `music` 时的分数，必填。 |
| `songIndex` | number? | `1` | 第几首歌，仅挑战(CP)活动有效，组曲/对邦活动忽略。 |
| `signature` | string? | - | 自定义签名，覆盖玩家当前签名显示。 |
| `groupName` | string? | - | 群名称，存储用于渲染兜底。 |
| `recordedBy` | string? | - | 记录者标识（审计用）。 |

#### 响应结构

一个 [Response](#响应对象) 列表（确认文本）。

### 查询结榜图

生成指定群的国服活动结榜图片，PT 榜与歌榜均按排名排序，歌榜在 PT 榜下方，标题处显示群名称与群号。

终结点: `POST /finalRanking/query`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 前端平台标识。 |
| `groupId` | string | - | 群号。 |
| `eventId` | number? | 本群最新有记录的一期 | 指定活动 ID ，可查询往期结榜图。 |
| `groupName` | string? | 数据库快照 | 群名称，用于标题显示。 |
| `useEasyBG` | boolean | - | 是否使用简易背景。 |

#### 响应结构

一个 [Response](#响应对象) 列表。（图片恒定输出 PNG 不压缩，不受压缩配置影响）

### 删除结榜数据

删除指定群最新有记录的一期活动中该玩家的结榜数据（前端应自行校验仅群主/管理员可调用）。

终结点: `POST /finalRanking/delete`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 前端平台标识。 |
| `groupId` | string | - | 群号。 |
| `uid` | number | - | 国服玩家 ID 。 |

#### 响应结构

一个 [Response](#响应对象) 列表（确认文本）。

## 用户数据 API

进行用户数据获取和用户绑定的 API 。所有的 API 都有一个统一的 `/user` 终结点前缀。

单个用户通过 `platform` 和 `userId` 字段进行联合指定。其中由于历史原因，QQ 平台的 `platform` 最好指定为 `red` ，否则对于之前绑定过的用户可能无法被指定到。**`onebot` 以及 `chronocat` 平台都将被后端处理为 `red` 。**

### 获取用户数据

获取指定用户的数据。

终结点: `POST /user/getUserData`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string / [tsuguUser](#tsuguuser-用户数据) | - | 后端响应结果。若 `status` 为 `success` 则该字段为相应的数据对象，为 `failed` 则为错误原因。 |

##### tsuguUser 用户数据

| 字段名 | 数据类型 | 说明 |
|:------:|:-------:|:-----|
| `_id` | string? | 可能存在。若用户已存在，此字段为用户的唯一标识符。 |
| `userId` | string | 用户 ID 。 |
| `platform` | string | 用户所在平台。 |
| `mainServer` | [Server](#serverid-服务器-id) | 用户的主服务器模式。 |
| `displayedServerList` | [Server](#serverid-服务器-id)[] | 用户的默认服务器列表。 |
| `shareRoomNumber` | boolean | 是否转发该用户的房间号。 `false` 则会忽视来自该用户的房间号。 |
| `tokenPlatform` | string? | 凭据对应的登录平台（ `ios` / `android` ），由数据源自动探测后回写。 |
| `channelUid` | string? | B站渠道登录凭据（扫码登录获得）：B站用户 mid，与 `channelToken` 成对。 |
| `channelToken` | string? | B站渠道登录凭据（扫码登录获得）：access_token。 |
| `userPlayerList` | [tsuguUserServerInList](#tsuguuserserverinlist-服务器绑定数据)[] | 该用户绑定的服务器数据列表 |

##### tsuguUserServerInList 服务器绑定数据

| 字段名 | 数据类型 | 说明 |
|:------:|:-------:|:-----|
| `playerId` | number | 玩家ID 。 |
| `server` | Server | 玩家ID 对应的服务器 |

##### BindingStatus 绑定状态

| 名称 | 值 | 说明 |
|:----:|:--:|:-----|
| None | `0` | 未绑定 |
| Verifying | `1` | 正在验证 |
| Success | `2` | 绑定成功 |

### 修改用户数据

修改指定用户的数据。

尽管接收一个 [PartialTsuguUser](#partialtsuguuser-修改用户数据) 作为参数，实际上只能够通过该 API 修改 `mainServer` , `displayedServerList` 和 `shareRoomNumber` 字段数据。

终结点: `POST /user/changeUserData`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |
| `update` | [PartialTsuguUser](#partialtsuguuser-修改用户数据) | - | 一个数据结构，用以传入想要修改的用户数据字段以及对应的值。 |

##### PartialTsuguUser 修改用户数据

| 字段名 | 数据类型 | 说明 |
|:------:|:-------:|:-----|
| `userId` | string? | 用户 ID 。 |
| `platform` | string? | 用户所在平台。 |
| `mainServer` | [Server](#serverid-服务器-id)? | 用户的主服务器模式。 |
| `displayedServerList` | [Server](#serverid-服务器-id)[]? | 用户的默认服务器列表。 |
| `shareRoomNumber` | boolean? | 是否转发该用户的房间号。 `false` 则会忽视来自该用户的房间号。 |
| `userPlayerList` | [tsuguUserServerInList](#tsuguuserserverinlist-服务器绑定数据)[]? | 该用户绑定的服务器数据列表。长度必定等于全部服务器数，列表中每一项代表着对应服务器上的绑定数据，下标与 [Server](#serverid-服务器-id) 对应。 |

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string? | - | 后端响应结果。 |

### 请求绑定用户

向后端发送绑定用户的请求。

终结点: `POST /user/bindPlayerRequest`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |
| `mainServer` | [Server](#serverid-服务器-id) | - | 要绑定的服务器。 |
| `bindType` | boolean | - | `true` 为绑定玩家， `false` 为进行解绑。 |

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string / [VerifyCode](#verifycode-验证码) | - | 后端响应结果。若 `status` 为 `success` 则该字段为相应的数据对象 [VerifyCode](#verifycode-验证码) ，为 `failed` 则为错误原因 `string` 。 |

##### VerifyCode 验证码

| 字段名 | 数据类型 | 说明 |
|:------:|:-------:|:----|
| `verifyCode` | number | 一个五位的数字，用于进行验证。 |

### 验证绑定用户

向后端发送验证绑定用户的请求。

终结点: `POST /user/bindPlayerVerification`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |
| `mainServer` | [Server](#serverid-服务器-id) | - | 要绑定的服务器。 |
| `playerId` | number | - | 要进行操作的玩家 ID 。 |
| `bindType` | boolean | - | `true` 为绑定玩家， `false` 为进行解绑。 |

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string | - | 后端响应结果。若 `status` 为 `success` 则该字段为成功信息，为 `failed` 则为错误原因。 |

### 设置令牌（B站扫码登录）

通过哔哩哔哩APP扫码获取本人渠道凭据（ `channelUid` + `channelToken` ），供 导入全部配置/查PT 等指令使用。接口挂载于 `/user/qrcodeLogin` 前缀，同 `/user` 受 `LOCAL_DB` 开关控制。

#### 第一步：申请二维码

终结点: `POST /user/qrcodeLogin/start`

##### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |

同一用户 10 秒内重复调用会返回 `429`。

##### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data.qrBase64` | string | - | 登录二维码 PNG 图片的 Base64 字符串。 |
| `data.expiresIn` | number | `180` | 二维码有效期（秒）。 |
| `data.gen` | number | - | 本次登录任务的代数，轮询时需原样传回。 |

#### 第二步：轮询扫码状态

终结点: `POST /user/qrcodeLogin/poll`

##### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |
| `gen` | number | - | start 返回的代数；不匹配时视为过期。 |

建议 2.5 秒轮询一次；后端对B站接口做了 1.5 秒限速，窗口内的调用直接返回上次状态。

##### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data.state` | string | `pending` / `scanned` / `success` / `expired` | `pending` 未扫码；`scanned` 已扫码未确认；`success` 已确认并落库；`expired` 二维码过期或任务不存在。 |
| `data.channelUid` | string? | - | 仅 `state` 为 `success` 时返回（B站用户 mid）。 |

`state` 为 `success` 时后端已将 `channelUid` / `channelToken` 写入用户数据，无需再调用其它接口保存。

### 删除令牌

清空指定用户的本人凭据（ `channelUid` / `channelToken` / `tokenPlatform` ）。

终结点: `POST /user/qrcodeLogin/delete`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:-----:|:-----|
| `platform` | string | - | 用户的平台名称。 |
| `userId` | string | - | 用户的 ID 。 |

#### 响应结构

一个 [Response](#响应对象) 列表（成功为 `令牌已删除` 文本）。

## 车站 API

后端对车站进行转接的 API 。所有的 API 都有一个统一的 `/station` 终结点前缀。

### 上传房间

向车站上传房间信息。

终结点: `POST /station/submitRoomNumber`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:------:|:----|
| `number` | number | - | 上传的房间号。 |
| `rawMessage` | string | - | 房间号的备注信息，用于对房间进行说明。 |
| `platform` | string | - | 用户所在平台。 |
| `userId` | string | - | 用户的 ID 。 |
| `userName` | string | - | 用户的名称。 |
| `time` | number | - | 房间上传的时间。 |
| `bandoriStationToken` | string? | - | 使用的车站令牌，不传入则使用 Tsugu 的令牌。 |

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string | - | 后端响应结果。若 `status` 为 `success` 则该字段为成功信息，为 `failed` 则为错误原因。 |

### 查询最近房间数据

查询车站里最近的房间数据列表。

终结点: `GET /station/queryAllRoom`

> 该 API 没有请求结构。

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string / [Room](#room-房间信息)[] | - | 后端响应结果。若 `status` 为 `success` 则该字段为相应的数据对象 [Room](#room-房间信息)[] ，为 `failed` 则为错误原因 `string` 。 |

##### Room 房间信息

对于 [`/roomList`](#绘制房间列表图片) API ，其需要一个专门的房间信息对象列表。

同时，该对象也是 [`/station/queryAllRoom`](#查询最近房间数据) API 响应成功时的响应数据对象。

| 字段名 | 数据类型 | 说明 |
|:------:|:-------:|:-----|
| `number` | number | 房间号。 |
| `rawMessage` | string | 上传房间时的附加注释信息。 |
| `source` | string | 上传房间号的来源。 |
| `userId` | number | 上传房间号的用户 ID 。 |
| `time` | number | 房间号上传时的时间戳。 |
| `player` | [Player](#player-玩家信息) | 上传用户的默认玩家信息。 |
| `avatarUrl` | string? | 上传房间号的用户头像。 |
| `userName` | string? | 上传房间号的用户名称。 |

##### Player 玩家信息

| 字段名 | 数据类型 | 说明 |
|:------:|:-------:|:-----|
| `id` | number | 玩家 ID 。 |
| `mainServer` | [Server](#serverid-服务器-id) | 服务器 ID 。 |

### 模糊搜索过滤器

向车站上传房间信息。

终结点: `POST /fuzzySearch`

#### 请求结构

| 字段名 | 数据类型 | 默认值 | 说明 |
|:------:|:-------:|:------:|:----|
| `text` | string | - | 将要查询的查询参数。 |

#### 响应结构

| 字段名 | 数据类型 | 可能的值 | 说明 |
|:------:|:-------:|:-------:|:-----|
| `status` | string | `success` / `failed` | 后端是否成功处理请求。 |
| `data` | string | - | 后端响应结果。若 `status` 为 `success` 则该字段为成功信息，为 `failed` 则为错误原因。 |
