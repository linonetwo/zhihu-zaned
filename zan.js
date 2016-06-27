var fetch = require('node-fetch');
var cheerio = require('cheerio');
var poll = require('when/poll');
var mapPromise = require('when').map;

var uuid = require('node-uuid');

const config = require('./config');


const LoggerFactory = require('logger-utils');
const logger = LoggerFactory.createDefault('test');

// () => Promise(string: xsrf)
// idempotent
// xsrf 似乎是一个很容易取得的值，用不到用户名密码 http://www.lyyyuna.com/2016/02/28/zhihu-lundaiguang/
function getXrsf() {
  logger.info('Entering getXrsf');
  return fetch('https://www.zhihu.com/', {
   'method': 'GET',
   'mode': 'no-cors'
  })
  .then(res => res.text())
  .then(res => {
   let $ = cheerio.load(res);
   xsrf = $('[name=_xsrf]').attr('value');
   return xsrf;
  })
}


var neo4j = require('neo4j-driver').v1;

const NO_RESULT = Symbol.for('NO_RESULT');
function useNeo4jDB(url, userName, passWord) {
  // Create a driver instance, for the user neo4j with password neo4j.
  const driver = neo4j.driver(`bolt://${url}`, neo4j.auth.basic(userName, passWord));

  // Create a session to run Cypher statements in.
  // Note: Always make sure to close sessions when you are done using them!
  const session = driver.session();

  let _session = session;
  let _lastTransaction = session;


  return (cypherQuery, transaction = undefined) => {
    if (transaction !== undefined) { // 只有 transaction 开关被显式指定了，才进入此分支
      _session = transaction ? session.beginTransaction() : session; // 如果打开事务性开关，就把接下来的所有命令
      // 都放在 session.beginTransaction() 里执行
      if (transaction === true) {
        _lastTransaction = _session; // 每次 transaction 开始后就保存一个 session.beginTransaction() 的副本，以便 commit
      }
    }
    return new Promise((resolve, reject) => {
      if (cypherQuery.query.length === 0 && transaction !== undefined) {
        // cypherQuery 中的请求为空字符串的情况视作只是想修改 transaction 模式
        resolve(_lastTransaction); // 见下方事务性调用的例子
      }

      _session.run(cypherQuery.query, cypherQuery.params)
      .then(result => {
        if (result.records.length === 0 || !result.records[0]) {
          resolve(NO_RESULT); // 没啥结果的时候
        } else {
          resolve(result.records); // 还是有点结果的时候
        }
      })
      .catch(err => reject(err));
    });
  };
}

const run = useNeo4jDB(config.neo4jHost.split('//')[1] + ':' + config.neo4jBoltPort, config.neo4jUserName, config.neo4jPassword);

// (userName, password, gotItPreviously: xsrf) => Promise(string: cooikes)
// 不登陆的情况下点击知乎里的各种按钮可能会叫你登陆，一个原因就是你没有带 cookies
function getLoginCookie(userName, password, xsrf) {
  logger.info('Entering getLoginCookie');
  // 头中主要是浏览器信息
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.116 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
  };

  // 知乎有两种登陆方式，一种是邮箱，一种是手机，它们要用不同的请求体
  let userNameType = 'email';
  if (/^1[3|4|5|7|8]\d{9}$/.test(userName)) {
    userNameType = 'phone_num';
  }

  return fetch('http://www.zhihu.com/login/email', {
    'method': 'POST',
    headers,
    'mode': 'cors',
    'body': `${userNameType}=${userName}&password=${password}&_xsrf=${xsrf}&remember_me=true`
  })
  .then(res => res.headers['_headers']['set-cookie'].join()); // 这里获取到的是每一项分开的数组，我们把它 join 成一个字符串方便后续使用
}


// (userName) => Promise(string: aLotOfDOM)
// idempotent
// 获取第一个页面并不需要多余的信息，直接 POST
function getFirstActivityPage(userName) {
  logger.info('Entering getFirstActivityPage');
  return fetch(`https://www.zhihu.com/people/${userName}/activities`, {
    'method': 'POST',
    'mode': 'no-cors',
  })
  .then((res) => res.json())
  .then(res => res['msg'][1])
}


// (userName, parseFromDOM: startPoint, gotItPreviously: xsrf, gotItPreviously: Cookie) => Promise(string: aLotOfDOM)
// idempotent，但太快可能会被封号
// 网页打开 https://www.zhihu.com/people/linonetwo 拉到最下面有一个 「更多」，点击它的时候需要一个 startPoint 表示历史记录从哪一个问题开始获取，以及 xsrf, Cookie 用于验证
function getNextActivityPage(userName, startPoint, xsrf, Cookie) {
  logger.info('Entering getNextActivityPage');
  const headers = {
    'Connection': 'keep-alive',
    'Referer': `https://www.zhihu.com/people/${userName}`,
    'Origin': 'https://www.zhihu.com',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept-Language': 'zh-CN,zh;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.116 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Cookie
  };

  return fetch(`https://www.zhihu.com/people/${userName}/activities`, {
    'method': 'POST',
    'mode': 'no-cors',
    headers,
    'body': `start=${startPoint}&_xsrf=${xsrf}`
  })
  .then((res) => res.json())
  .then(res => res['msg'][1]);
}


const deUnicode = (strWithUnicode) => typeof(strWithUnicode) == 'string'?strWithUnicode.replace(/&#x[\D\S]{4};/g , (unicode) => unescape('%u'+unicode.slice(3,-1))).replace(/&#x[\D\S]{2};/g , (unicode) => unescape('%u'+unicode.slice(3,-1))):''; // 把 &#x5148;&#x4E0D; 变成 「先不」


// (string: DOM) => [{...}, ]
// idempotent
// 一次传入一整页的 div。注意抓取到的是没有用一个根元素包好的一堆 div，传入这个函数之后我们会用一个 div 包好它们。
function parseDOM(activiterName, dom) {
  logger.info('Entering parseDOM');
  let $ = cheerio.load('<div>' + dom + '</div>'); // 用起来就像 jQuery
  const divList = $('div.zm-profile-section-item.zm-item.clearfix'); // 知乎里面每一个小卡片的 class 是 zm-profile-section-item zm-item clearfix

  let dataList = [];
  // 下面开始抽取信息，下面的函数是同步的，可以放心
  divList.map((index, elm) => {
    let datas = {
      'user': activiterName,
      'type': 'member_follow_question',
      'time': 0,
      'title': '',
      'link': '',
      'abstract': '',
      'author': '',
      'motto': ''
    }
    datas['type'] = $(elm).attr('data-type-detail');
    datas['time'] = parseInt($(elm).attr('data-time'));

    if (datas['type'] == 'member_voteup_article') {
      datas['title'] = $(elm).find('div.zm-profile-section-main.zm-profile-section-activity-main.zm-profile-activity-page-item-main').find('a.post-link').text();
      datas['link'] = $(elm).find('div.zm-profile-section-main.zm-profile-section-activity-main.zm-profile-activity-page-item-main').find('a.post-link').attr('href');
    } else {
      datas['title'] = $(elm).find('div.zm-profile-section-main.zm-profile-section-activity-main.zm-profile-activity-page-item-main').find('a.question_link').text();
      datas['link'] = 'https://www.zhihu.com' + $(elm).find('div.zm-profile-section-main.zm-profile-section-activity-main.zm-profile-activity-page-item-main').find('a.question_link').attr('href'); // 返回的是 /question/22638053/answer/63182583 这样子
    }

    datas['abstract'] = deUnicode( $(elm).find('div.zh-summary.summary.clearfix').html() ) || '';

    let authorInfoDiv = $(elm).find('div.zm-item-answer-author-info');
    datas['author'] = authorInfoDiv.find('a.author-link').text() || '';
    datas['motto'] = authorInfoDiv.find('span.bio').attr('title') || '';

    dataList.push(datas);
  });
  logger.info(`In parseDOM dataList has length ${dataList.length} has content `, dataList);
  return dataList;
}


// 如果在数据库里检测到添加过的数据，那么就 reject。在一组数据中只要有一个 reject 了，就不会去取下一组数据了。
function checkExistedNode(user, time) {
  logger.info('Entering checkExistedNode');
  logger.info(`With args:\n activiterName: ${user},\n time: ${time}\n\n`);
  return run({ // 用有向图表示用户与文章、回答、圆桌等的关系，统一类型为 ZAN，用属性表示具体是关注还是点赞等。
    query: 'MATCH (u:USER {userID: {user}})-[r]->(n:ZHIHU {time:{time}}) RETURN n.uuid',
    params: {
      user,
      time
    }
  }).then(result => result == NO_RESULT ? null : Promise.reject(`Exist node at Time ${time}`));
}


function addZanedNode({user, type, time, title, link, abstract, author, motto}) {
  logger.info('Entering addZanedNode');
  logger.info(`With args:\n activiterName: ${user},\n type: ${type},\n time: ${time},\n title: ${title},\n link: ${link},\n abstract: ${abstract},\n author: ${author},\n motto:${motto}\n\n`);
  return checkExistedNode(user, time)
    .then(() => run({ // 用有向图表示用户与文章、回答、圆桌等的关系，统一类型为 ZAN，用属性表示具体是关注还是点赞等。
      query: 'MATCH (u:USER {userID: {user}}) CREATE (u)-[:ZAN {uuid: {relationshipUUID}, type: {type}}]->(n:ZHIHU {uuid: {articleUUID}, time:{time}, title:{title}, link:{link}, abstract:{abstract}, author:{author}, motto:{motto}}) RETURN n.uuid',
      params: {
        user, type, time, title, link, abstract, author, motto,
        relationshipUUID: uuid.v4(),
        articleUUID: uuid.v4()
      }
    }));
}


let userName = '13143270649';
let password = 'changfei5';
let resultList = {list: [], lastUpvotedTime: 0};
const NORMAL_DIV_COUNTS = 20;
const TIME_WAIT = 500;


// 每次抓取下一页的时候都需要用到上一页最后一个帖子的点赞时间
function updateLastUpVotedTime(resultList) {
  logger.info('Entering updateLastUpVotedTime');
  const lastDataInList = resultList.list.slice(-1)[0];
  if (lastDataInList == undefined) {
    return Promise.reject('List is empty, poll is to over');
  }
  resultList.lastUpvotedTime = lastDataInList['time'];
  return Promise.resolve(resultList);
}


function putResultIntoDataBase(list) {
  logger.info('Entering putResultIntoDataBase');
  return mapPromise(list, addZanedNode)
    .then(() => resultList.list = []);
}


function nextPageLoop(activiterName, xsrf, cookies) {
  logger.info('Entering nextPageLoop');
  return poll(() => { // 开始爬虫循环
      return getNextActivityPage(activiterName, resultList.lastUpvotedTime, xsrf, cookies)
        .then(result => {
          resultList.list = resultList.list.concat(parseDOM(activiterName, result));
          logger.info(`In nextPageLoop result has length ${result.length}`);
          return updateLastUpVotedTime(resultList)
            .then(resultList => putResultIntoDataBase(resultList.list)) // 将会清空 resultList 的内容
            .then(() => result.length); // 返回这次抓取到的 div 的数量，当达到底部的时候会少于 NORMAL_DIV_COUNTS
        });
    }, TIME_WAIT, (divCounts) => divCounts <= NORMAL_DIV_COUNTS, false) // 循环等待时间是 TIME_WAIT ms，直到 divCounts 比一般情况下会抓取到的 div 数量少就停下
}


function createUser(userID) {
  return run({ // 首先开启 transaction
    query: 'MERGE (u:USER {userID: {userID}}) RETURN u',
    params: {
      userID
    }
  });
}

// 爬取用户 activiterName 赞过的内容，最好用一个小号来爬
function getZanedAnswers(activiterName, userName, password) {
  logger.info('Entering getZanedAnswers');
  return createUser(activiterName)
    .then(getXrsf)
    .then(xsrf =>
      getLoginCookie(userName, password, xsrf)
        .then(cookies =>
          getFirstActivityPage(activiterName)
            .then(result => {
              resultList.list = resultList.list.concat(parseDOM(activiterName, result));
              return updateLastUpVotedTime(resultList)
                .then(() => nextPageLoop(activiterName, xsrf, cookies)); // 然后就进入循环了
            })
        )
    )
    .then(() => resultList)
    .catch(err => console.error(err))
}


getZanedAnswers('linonetwo', userName, password);
