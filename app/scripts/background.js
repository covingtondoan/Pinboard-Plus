// {url: {title, desc, tag, time, isSaved[0: not saved; 1: saved; 2: saving]}}
var pages = {};

var getPopup = function () {
  return chrome.extension.getViews({type: 'popup'})[0];
};

var logout = function () {
  Pinboard.logout(function () {
    var popup = getPopup();
    popup && popup.$rootScope &&
      popup.$rootScope.$broadcast('logged-out');
  });
  Notifications.clearAll();
};

// save tabs
// copied from the Official Pinboard Chrome extension (version 1.0.0)
var BASE_URL = 'https://pinboard.in';
var SUBMIT_URL  = BASE_URL + '/tabs/save/';
var DISPLAY_URL = BASE_URL + '/tabs/show/';
var makeTabList = function(windows) {
  winz = [];
  result = {
    browser: 'chrome',
    windows: winz
  };
  var chromeWinz = windows;
  for (var i = 0; i < chromeWinz.length; i++) {
    var chromeTabz = chromeWinz[i].tabs;
    var tabz = [];

    for (var j = 0; j < chromeTabz.length; j++) {
      var cTab = chromeTabz[j];
      if (cTab.url) {
        tabz.push({title: cTab.title, url: cTab.url});
      }
    }
    winz.push(tabz);
  }
  tabList = result;
  var params = new FormData();
  var req = new XMLHttpRequest();
  params.append('data', JSON.stringify(result));
  console.log(JSON.stringify(result));
  req.open('POST', SUBMIT_URL, true);
  req.onreadystatechange = function() {
    if (req.readyState == 4) {
      chrome.tabs.create({url: DISPLAY_URL});
    }
  }
  req.send(params);
}

var saveTabs = function() {
  chrome.windows.getAll({
    'populate': true
  }, makeTabList);
}

var getUserInfo = function () {
  return Pinboard.getUserInfo();
};

// for popup.html to acquire page info
// if there is no page info at local then get it from server
var getPageInfo = function (url) {
  if (!url || url.indexOf('chrome://') == 0 ||
      localStorage[nopingKey] === 'true') {
    return {url: url, isSaved:false};
  }
  var pageInfo = pages[url];
  if (pageInfo) {
    return pageInfo;
  }
  // download now
  updatePageInfo(url);
  return null;
};

// refresh page info even page info has fetched from server
var updatePageInfo = function (url) {
  var popup = getPopup();
  popup && popup.$rootScope &&
    popup.$rootScope.$broadcast('show-loading', 'Loading bookmark...');
  var cb = function (pageInfo) {
    var popup = getPopup();
    popup && popup.$rootScope &&
      popup.$rootScope.$broadcast('render-page-info', pageInfo);
    updateSelectedTabExtIcon();
  };
  queryPinState({url: url, ready: cb});
};

var handleError = function (data) {
  var message;
  if (data.status == 0 || data.status == 500){
    message = 'Please check your connection or Pinboard API is probably down.';
  } if (data.status == 200 && data.responseText.includes('Pinboard is Down')) {
    message = 'Pinboard API is down.';
  } else if (data.status == 401) {
    message = 'Something wrong with the auth. Please try to login again.';
  } else {
    message = data.statusText || 'Something wrong';
  }
  addAndShowNotification(message, 'error');
};

var addAndShowNotification = function (message, type) {
  Notifications.add(message, type);
  var popup = getPopup();
  popup && popup.$rootScope &&
    popup.$rootScope.$broadcast('show-notification');
};

var getNotification = function () {
  return Notifications.getTop();
};

var closeNotification = function () {
  Notifications.remove();
};

var login = function (token) {
  Pinboard.login(
    token,
    function (data) {
      var popup = getPopup();
      if (data.result) {
        popup && popup.$rootScope &&
          popup.$rootScope.$broadcast('login-succeed');
        _getTags();
      } else {
        // login error
        addAndShowNotification(
          'Login Failed. The token format is user:TOKEN.', 'error');
      }
    },
    function (data) {
      var popup = getPopup();
      if (data.status == 401 || data.status == 500) {
        addAndShowNotification(
          'Login Failed. The token format is user:TOKEN.', 'error');
      } else {
        handleError(data);
      }
    }
  );
};


var QUERY_INTERVAL = 3 * 1000, isQuerying = false, tQuery;
var queryPinState = function (info) {
  var url = info.url,
      done = function (data) {
        isQuerying = false;
        clearTimeout(tQuery);
        var posts = data.posts,
            pageInfo = {isSaved: false};
        if (posts.length) {
          var post = posts[0];
          pageInfo = {url: post.href,
                      title: post.description,
                      desc: post.extended,
                      tag: post.tags,
                      time: post.time,
                      shared: post.shared == 'no' ? false:true,
                      toread: post.toread == 'yes' ? true:false,
                      isSaved: true};
        }
        pages[url] = pageInfo;
        info.ready && info.ready(pageInfo);
      };
  if ((info.isForce || !isQuerying) && Pinboard.isLoggedin() &&
      info.url && info.url != 'chrome://newtab/') {
    isQuerying = true;
    clearTimeout(tQuery);
    tQuery = setTimeout(function () {
      // to make the queries less frequently
      isQuerying = false;
    }, QUERY_INTERVAL);
    // The queryPinState is high frequently called
    // but without risk of lost of user data, it's OK to ignore error use noop
    Pinboard.queryPinState(url, done, $.noop);
  }
};

var updateSelectedTabExtIcon = function () {
  chrome.tabs.query({active:true, currentWindow: true}, function (activetabs) {
    var tab = activetabs[0];
    var pageInfo = pages[tab.url];
    var iconPath = noIcon;
    if (pageInfo && pageInfo.isSaved == 1) {
      iconPath = yesIcon;
    } else if (pageInfo && pageInfo.isSaved == 2) {
      iconPath = savingIcon;
    }
    chrome.browserAction.setIcon(
      {path: iconPath, tabId: tab.id});
  });
};

var addPost = function (info) {
  if (Pinboard.isLoggedin && info.url && info.title) {
    var url = info.url, title = info.title, desc = info.desc;
    if (desc.length > maxDescLen) {
      desc = desc.slice(0, maxDescLen) + '...';
    }
    var doneFn = function (data) {
      var resCode = data.result_code;
      if (pages[url]) {
        pages[url].isSaved = resCode == 'done' ? true : false;
      } else {
        pages[url] = {isSaved: resCode == 'done' ? true : false};
      }
      updateSelectedTabExtIcon();
      queryPinState({url: url, isForce: true});
      var popup = getPopup();
      popup && popup.close();
    };
    var failFn = function (data) {
      if (pages[url]) {
        pages[url].isSaved = 0;
      } else {
        pages[url] = {isSaved: 0};
      }
      updateSelectedTabExtIcon();
      var saveFailedMsg, failReason;
      if (title.length > 47) {
        var _title = title.slice(0, 47) + '...';
        saveFailedMsg = 'The post <b>' + _title + '</b> is not saved. ';
      } else {
        saveFailedMsg = 'The post <b>' + title + '</b> is not saved. ';
      }
      if (data.status == 0 || data.status == 500){
        failReason = 'Please check your connection or Pinboard' +
                     ' API is probably down.';
      } if (data.status == 200 && data.responseText.includes('Pinboard is Down')) {
        failReason = 'Pinboard API is down.';
      } else if (data.status == 401) {
        failReason = 'Something wrong with the auth. Please try to login again.';
      } else {
        failReason = data.statusText || 'Something wrong.';
      }
      var message = saveFailedMsg + failReason;
      // only store error and no need to show as popup is close
      Notifications.add(message, 'error');
    };
    Pinboard.addPost(info.title, info.url, desc, info.tag,
                     info.shared, info.toread, doneFn, failFn);
    // change icon state
    if (pages[info.url]) {
      pages[info.url].isSaved = 2;
    } else {
      pages[info.url] = {isSaved: 2};
    }
    updateSelectedTabExtIcon();
    // add new tags into _tags
    if (info.tag) {
      _updateTags(info.tag.split(' '));
    }
  }
};

var deletePost = function (url) {
  if (Pinboard.isLoggedin() && url) {
    var doneFn = function (data) {
      var resCode = data.result_code;
      var popup = getPopup();
      if (resCode == 'done' || resCode == 'item not found') {
        delete pages[url];
        updateSelectedTabExtIcon();
      } else {
        // error
        popup && popup.$rootScope &&
          popup.$rootScope.$broadcast('error');
      }
      popup && popup.close();
    };
    Pinboard.deletePost(url, doneFn, handleError);
  }
};

var getSuggest = function (url) {
  if (Pinboard.isLoggedin() && url) {
    var doneFn = function (data) {
      var popularTags = [], recommendedTags = [];
      if (data && data.length > 0) {
        popularTags = data[0].popular;
        recommendedTags = data[1].recommended;
      }
      // default to popluar tags, add new recommended tags
      var suggests = popularTags.slice();
      $.each(recommendedTags, function(index, tag){
        if(popularTags.indexOf(tag) === -1){
          suggests.push(tag);
        }
      });
      var popup = getPopup();
      popup && popup.$rootScope &&
        popup.$rootScope.$broadcast('render-suggests', suggests);
    };
    Pinboard.getSuggest(url, doneFn);
  }
};

var _tags = [];
// acquire all user tags from server refresh _tags
var _getTags = function () {
  if (Pinboard.isLoggedin()) {
    var doneFn = function (data) {
      if (data) {
        _tags = _.sortBy(_.keys(data),
                         function (tag) {
                           return data[tag].count;
                         }).reverse();
      }
    };
    Pinboard.getTags(doneFn);
  }
};
_getTags();

// add new tags into _tags
var _updateTags = function (tags) {
  var newTags = _.difference(tags, _tags);
  if (newTags.length > 0) {
    _tags.push.apply(_tags, newTags)
  }
};

var getTags = function () {
  if (!_tags || _tags.length === 0) {
    _getTags();
  }
  return _tags;
};

Notifications.init();

// query at first time extension loaded
chrome.tabs.query({active:true, currentWindow: true}, function (activetabs) {
  var tab = activetabs[0];
  if (localStorage[nopingKey] === 'true') {
    return;
  }
  queryPinState({url: tab.url,
                 ready: function (pageInfo) {
                   if (pageInfo && pageInfo.isSaved) {
                     chrome.browserAction.setIcon(
                       {path: yesIcon, tabId: tab.id});
                   }
                 }});
});

chrome.tabs.onUpdated.addListener(
  function(id, changeInfo, tab) {
    if (localStorage[nopingKey] === 'true') {
      return;
    }
    if (changeInfo.url) {
      var url = changeInfo.url;
      if (!pages.hasOwnProperty(url)) {
        chrome.browserAction.setIcon({path: noIcon, tabId: tab.id});
        queryPinState({url: url,
                       ready: function (pageInfo) {
                         if (pageInfo && pageInfo.isSaved) {
                           chrome.browserAction.setIcon(
                             {path: yesIcon, tabId: tab.id});
                         }
                       }});
      }
    }
    var url = changeInfo.url || tab.url;
    if (pages[url] && pages[url].isSaved) {
      chrome.browserAction.setIcon({path: yesIcon, tabId: tab.id});
    }
  }
);

chrome.tabs.onActivated.addListener(
  function(tabId, selectInfo) {
    if (localStorage[nopingKey] === 'true') {
      return;
    }
    chrome.tabs.query(
      {active:true, currentWindow: true}, function (activetabs) {
        var tab = activetabs[0];
        var url = tab.url;
        if (!pages.hasOwnProperty(url)) {
          queryPinState({url: url,
                         ready: function (pageInfo) {
                           if (pageInfo && pageInfo.isSaved) {
                             chrome.browserAction.setIcon(
                               {path: yesIcon, tabId: tab.id});
                           }
                         }});
        }
      });
  }
);
