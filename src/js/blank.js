/* global Database */
(function(window, document) {
  "use strict";

  // variables.//{{{
  let db = null;

  const MAX_RECORSIVE_COUNT       = 3;

  const title_on_html = document.querySelector('#title');
  const url_on_html   = document.querySelector('#url');

  const ICON_ON_HTML      = document.querySelector('#favicon');

  const gObjF5Key = generateKeyString({
    ctrl    : false,
    alt     : false,
    shift   : false,
    meta    : false,
    keyCode : 116,
  });
  //}}}

  function getOpts(pOptionName)//{{{
  {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(pOptionName, items => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        let option = items.hasOwnProperty(pOptionName) ?
                     items[pOptionName] : gMapDefaultValues.get(pOptionName);
        resolve(option === true ? true : false);
      });
    });
  }//}}}

  function getFaviconOfCurrentPage(pElement)//{{{
  {
    let xpath_icon = document.evaluate(
      '//link[@rel="shortcut icon" or @rel="icon"]', pElement, null, 7, null);
    return (xpath_icon.snapshotLength > 0) ? xpath_icon.snapshotItem(0) : null;
  }//}}}

  function cancelPinnedTab(pTabId)//{{{
  {
    console.assert(toType(pTabId) === 'number', "not number type.");

    return new Promise((resolve, reject) => {
      getOpts('when_purge_tab_to_pin')
      .then(pinned => {
        if (pinned === false) {
          console.log(
              'the option "When purges a tab, to pin it." is disabled.');
          resolve();
          return;
        }

        chrome.tabs.get(pTabId, tab => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          chrome.tabs.update(tab.id, { pinned: false }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve();
          });
        });
      });
    });
  }//}}}

  function navigateToPageBeforePurged()//{{{
  {
    let args_in_url = getQueryString(document);
    let url         = '';

    if (args_in_url.hasOwnProperty('url')){
      url = args_in_url.url;
    } else if (url_on_html !== void 0 &&
               url_on_html !== null &&
               url_on_html.textContent.length > 0) {
      url = url_on_html.textContent;
    } else {
      throw new Error("Doesn't find the url for redirect at the previous url.");
    }

    location.replace(url);
  }//}}}

  function getDataOfBeforeToPurge(pRecorsiveCount)//{{{
  {
    console.assert(toType(pRecorsiveCount) === 'number', "not number type.");

    let url = url_on_html.textContent;
    return ajax({ url: url, responseType: 'document' })
    .then(pResult => {
      if (pResult.status === 200) {
        let new_title = pResult.response.title;
        if (new_title) {
          let host = getSplitURI(url).hostname;

          db.add({
            name: gStrDbPageInfoName,
            data: {
              url:   url,
              title: new_title || 'Unknown',
              host:  host,
            },
          });

          let favicon = getFaviconOfCurrentPage(pResult.response);
          let favicon_url = favicon ? favicon.href :
                                      window.location.origin + '/favicon.ico';

          getDataURI(favicon_url)
          .then(pIconDataURI => {
            db.add({
              name: gStrDbDataURIName,
              data: {
                host:    host,
                dataURI: pIconDataURI,
              }
            });
          });
        }

        return loadPurgedTabInfo(pRecorsiveCount);
      }
    });
  }//}}}

  function loadPurgedTabInfo(pRecorsiveCount)
  {
    console.assert(
        toType(pRecorsiveCount) === 'number' ||
        pRecorsiveCount === void 0 ||
        pRecorsiveCount === null,
        "not any type in number, nundefined, or null.");

    return new Promise((resolve, reject) => {
      if (pRecorsiveCount === void 0 || pRecorsiveCount === null) {
        pRecorsiveCount = MAX_RECORSIVE_COUNT;
      } else if (pRecorsiveCount < 0) {
        reject(new Error("Doesn't get a title of a purged tab."));
        return;
      }

      let args_in_url = getQueryString(document);
      if (!args_in_url.hasOwnProperty('url') || args_in_url.url.length === 0) {
        reject(new Error("Doesn't get a url of arguments on web page."));
        return;
      }

      (() => {
        return new Promise(resolve => {
          chrome.runtime.sendMessage(
            { event: 'check_purged_tab', url: args_in_url.url }, resolve);
        });
      })()
      .then(() => {
        let span = url_on_html;
        while (span.firstChild) {
          span.removeChild(span.firstChild);
        }

        if (args_in_url.url) {
          let url         = args_in_url.url;
          let a_tag       = document.createElement('a');
          a_tag.href      = url;
          a_tag.innerText = url;
          span.appendChild(a_tag);
        } else {
          span.innerHTML = 'None';
          reject(new Error("Doesn't get a purged url."));
          return;
        }

        return db.get({
          name : gStrDbPageInfoName,
          key  : args_in_url.url,
        });
      })
      .then(pageInfo => {
        if (pageInfo === void 0 ||
            pageInfo === null ||
            !pageInfo.hasOwnProperty('title') ||
            pageInfo.title === 'Unknown') {
            document.title = url_on_html.textContent;
            title_on_html.setAttribute('style', 'display: none');
          console.log('RecorsiveCount is ', pRecorsiveCount);

          (() => {
            return new Promise((resolve2, reject2) => {
              if (pageInfo !== void 0 &&
                  pageInfo !== null &&
                  pageInfo.hasOwnProperty('url') &&
                  pageInfo.url.length > 0) {
                db.delete({ name: gStrDbPageInfoName, keys: pageInfo.url })
                .then(resolve2)
                .catch(reject2);
              } else {
                resolve();
              }
            });
          })()
          .then(getDataOfBeforeToPurge(--pRecorsiveCount))
          .then(resolve)
          .catch(reject);
        } else {
          document.title            = pageInfo.title;
          title_on_html.textContent = pageInfo.title;
          title_on_html.removeAttribute('style');

          return db.get({
            name : gStrDbDataURIName,
            key  : pageInfo.host,
          });
        }
      })
      .then(dataURIInfo => {
        if (dataURIInfo !== void 0 && dataURIInfo !== null) {
          let favicon_url = dataURIInfo.dataURI;

          let head = document.querySelector('head');
          let link = document.createElement('link');
          link.rel  = 'shortcut icon';
          link.href = decodeURIComponent(favicon_url);

          let favicon = getFaviconOfCurrentPage(document);
          if (favicon) {
            head.removeChild(favicon);
          }
          head.appendChild(link);

          ICON_ON_HTML.src = favicon_url;
          removeStringFromAttributeOfElement(
            ICON_ON_HTML, 'class', 'doNotShow');
        }
      })
      .then(resolve)
      .catch(reject);
    });
  }

  function getCurrentTab()//{{{
  {
    return new Promise((resolve, reject) => {
      chrome.tabs.getCurrent(tab => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(tab.id);
      });
    });
  }//}}}

  function restorePage(pTabId)//{{{
  {
    if (toType(pTabId) === 'number') {
      cancelPinnedTab(pTabId)
        .then(navigateToPageBeforePurged);
    } else {
      getCurrentTab()
        .then(cancelPinnedTab)
        .then(navigateToPageBeforePurged);
    }
  }//}}}

  document.addEventListener('click', restorePage, true);

  document.addEventListener('keydown', pEvent => {//{{{
    if (gObjF5Key === generateKeyString( keyCheck(pEvent) )) {
      restorePage();
    }
  }, true);//}}}

  document.addEventListener('DOMContentLoaded', () => {//{{{
    (() => {
      db = new Database(gStrDbName, gNumDbVersion);
      return db.open(gObjDbCreateStores);
    })()
    .then(loadPurgedTabInfo());
  });//}}}

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {//{{{
    switch (message.event) {
      case 'location_replace':
        console.assert(toType(message.tabId) === 'number', "not number type.");

        try {
          restorePage(message.tabId);
        } catch (e) {
          console.error(e);
          sendResponse(false);
          break;
        }
        sendResponse(true);
        break;
    }
  });//}}}
})(this, this.document);
