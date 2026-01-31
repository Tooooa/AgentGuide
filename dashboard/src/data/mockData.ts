
// Mock data removed - using database only

import type { Trajectory } from '../types';

// Mock data removed - using database only

// --- Types ---

// Removed inline types, imported from ../types

// --- Helper Functions ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// --- Exports ---

// Default preset scenarios from original ToolBench data
export const scenarios: Trajectory[] = [
    {
        id: 'preset_1301',
        title: {
            en: 'Find Top-Rated Movies',
            zh: '查找高评分电影'
        },
        taskName: 'Movie Search',
        userQuery: 'I want to find movies with high ratings. Can you provide me with a list of top-rated movies along with their IMDb ratings and summaries? Please sort the results by their IMDb ratings in descending order.',
        userQueryZh: '我想找一些平时评分比较高的电影。你能给我一份评分最高的电影清单，以及它们的IMDb评分和简介吗？请按IMDb评分降序排列结果。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_28',
        title: {
            en: 'Track Package Delivery',
            zh: '追踪包裹配送'
        },
        taskName: 'Package Tracking',
        userQuery: 'I am currently tracking a package with the ID CA107308006SI. Can you provide me with the latest information and localization details of the package? Additionally, I would like to know the country and the type of event associated with the package.',
        userQueryZh: '我正在追踪一个ID为CA107308006SI的包裹。你能提供该包裹的最新信息和定位详情吗？此外，我想知道与该包裹相关的国家和事件类型。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_4117',
        title: {
            en: 'Unit Conversion',
            zh: '单位换算'
        },
        taskName: 'Unit Converter',
        userQuery: "I'm planning a trip and need to convert 90 degrees to turns. Additionally, I would like to convert 100 grams to pounds and find out the temperature in Celsius for a given Fahrenheit value of 90.",
        userQueryZh: '我正在计划一次旅行，需要把90度转换成圈数。另外，我想把100克换算成磅，并算出华氏90度对应的摄氏温度。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_3672',
        title: {
            en: 'Movie Night Planning',
            zh: '电影之夜计划'
        },
        taskName: 'Movie & Music',
        userQuery: "I'm planning a movie night with my family, and I need a movie that is suitable for all ages. Can you provide me with the detailed response for the movie with the ID 399566? Additionally, fetch the monthly top 100 music torrents for some lively background music during the movie night.",
        userQueryZh: '我计划和家人举办一个电影之夜，需要一部老少皆宜的电影。你能提供ID为399566的电影的详细信息吗？另外，请获取月度下载量前100的音乐种子，以便在电影之夜播放一些欢快的背景音乐。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_9581',
        title: {
            en: 'Movie Recommendations',
            zh: '电影推荐'
        },
        taskName: 'Similar Movies',
        userQuery: "My company is organizing a movie-themed event and we're looking for movies that are similar to 'Titanic'. Can you recommend some movies with a similar genre and visual style? Additionally, it would be great if you could provide a list of movies along with their posters and release dates.",
        userQueryZh: '我们要举办一个电影主题活动，正在寻找与《泰坦尼克号》相似的电影。你能推荐一些类型和视觉风格相似的电影吗？如果能提供电影列表以及海报和上映日期就更好了。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_4155',
        title: {
            en: 'Check Order Status',
            zh: '查询订单状态'
        },
        taskName: 'Order Details',
        userQuery: 'Can you fetch the details of my recent orders? I would like to know the products I ordered, the order status, and the delivery date.',
        userQueryZh: '你能获取我最近的订单详情吗？我想知道我订购的产品、订单状态和送达日期。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_83',
        title: {
            en: 'Gift Package Tracking',
            zh: '礼物包裹追踪'
        },
        taskName: 'Gift Delivery',
        userQuery: "I want to surprise my family by tracking the delivery of the gift package with the tracking ID 6045e2f44e1b233199a5e77a. Can you provide me with the current status? Also, fetch the relevant information for the Pack & Send reference number 'ReferenceNumberHere'. Additionally, check the health of the suivi-colis API.",
        userQueryZh: '我想给家人一个惊喜，追踪物流ID为6045e2f44e1b233199a5e77a的礼物包裹。你能告诉我目前的状态吗？另外，获取Pack & Send参考号“ReferenceNumberHere”的相关信息，并检查suivi-colis API的健康状况。',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_29',
        title: {
            en: 'Monitor Multiple Packages',
            zh: '监控多个包裹'
        },
        taskName: 'Batch Tracking',
        userQuery: 'My company needs to monitor the progress of multiple packages. Can you help us count the number of steps in the history for each package? This will allow us to optimize our resources and network consumption.',
        userQueryZh: '我们公司需要监控多个包裹的进度。你能帮我们统计每个包裹历史记录中的步骤数量吗？这将有助于我们优化资源和网络消耗。',
        totalSteps: 0,
        steps: []
    }
];
