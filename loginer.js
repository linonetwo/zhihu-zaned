// 引入 superagent、cheerio
var superagent= require("superagent");
var cheerio=require("cheerio");

// 登陆 url 、目标 url
var  url={
    url:"http://www.zhihu.com/",
    login_url:"http://www.zhihu.com/login/email",
    target_url:"https://www.zhihu.com/collections"
};


// 浏览器请求报文头部部分信息
var browserMsg={
'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.116 Safari/537.36',
'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
};



var cookie;


// post 参数信息，其中，还差先前分析的 _xsrf 信息
var loginMsg=
{
    password:'changfei5',
    remember_me:true,
    email:"18925771057"
};


// 获取 _xrsf 值
function getXrsf(){
    superagent.get(url.url).end(function(err,res){
        if(!err){
            var $=cheerio.load(res.text);
            loginMsg._xsrf=$('[name=_xsrf]').attr('value');
        }else
            console.dir(err);
    });
}




getXrsf()
console.log(loginMsg);


// 发送登陆请求，获取 cookie 信息
function getLoginCookie() {
    //  首先，需在 set 方法中设置请求报文中参数，以性器官免服务器端有针对非浏览器请求做相关处理
    //  send 方法中设置 post 请求中需提交的参数
    //  redirects 方法调用，其中参数为 0 ，为了避免在用户登陆成功后，引起的页面重新刷新，从而无法获取 cookie
    superagent.post(url.login_url).set(browserMsg).send(loginMsg).redirects(0).end(function (err, response) {
        if (!err) {
            cookie = response.headers["set-cookie"];
            console.dir(cookie);
        } else

            console.dir(err);
    });
}





// 根据 cookie ，获取 target 页面关注信息
// 通过分析可知，仅取出 z_c0 的 cookie 即可，而 getLoginCookie 方法返回为一个 cookie 数组，稍做处理即可
function getFollower(){
        superagent.get(url.target_url).set("Cookie",cookie).set(browserMsg).end(function(err,response){
        if (err) {
            console.log(err);
        } else {

            var $ = cheerio.load(response.text);

            // 此处，同样利用 F12 开发者工具，分析页面 Dom 结构，利用 cheerio 模块匹配元素
            var array = $('#zh-favlist-following-wrap .zm-item');
            console.log(" 收藏夹标题 " + " " + " 收藏人数");
            if (array && array.length > 0) {
                array.each(function () {
                    console.log($(this).find('.zm-item-title>a').text() + " " + ($(this).find('.zg-num').text() ? $(this).find('.zg-num').text() : "0"));
                    //$(this).find('.zm-item-title>a').text();
                    //$(this).find('.zg-num').text();

                });
            }

        }
    });


    }
