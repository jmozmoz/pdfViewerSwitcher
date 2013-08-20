var {Cc, Ci, Cu} = require("chrome");

var widgets = require("sdk/widget");
var tabs = require("sdk/tabs");
var data = require("sdk/self").data;

const NetLog = require('net-log/net-log');
const PageProgress = require('net-log/page-progress');

const switchLabel = "Reload the pdf with Acrobat plugin";

var mediator = Cc['@mozilla.org/appshell/window-mediator;1'].
  getService(Ci.nsIWindowMediator);
var window = mediator.getMostRecentWindow("navigator:browser");
var navigator = window.navigator;

require("sdk/context-menu").Item({
  id: "pdfviewerswitchermenu",
  label: switchLabel,
  image: data.url("pdf.png"),
  contentScript: 'self.on("context", function (node) {' +
                 '  return (navigator.plugins["Adobe Acrobat"]' +
                 ' && (document.contentType == "application/pdf"));' +
                 '});' +
                 'self.on("click", self.postMessage);',
   onMessage: function() {
     reloadInPlugin();
   }
});

var widget = widgets.Widget({
  id: "pdfviewerswitcherbutton",
  label: switchLabel,
  contentURL: data.url("pdfgrey.png"), //"moz-icon://goat.pdf?size=16", //"http://www.mozilla.org/favicon.ico",
  onClick: function() {
    reloadInPlugin();
  }
});

function reloadInPlugin() {
  
  var tab = require("tabs").activeTab;
  
  tab.attach({
    contentScript: "self.postMessage(document.body.innerHTML);",
    onMessage: function(body)
    {
      if (body && body.search('<embed type="application/pdf"') != -1 &&
          body.search('name="plugin"') != -1) {
//        console.log("simple reload");
        tabs.activeTab.url = tabs.activeTab.url; 
//        tabs.activeTab.reload();
      } else {
//        console.log("call innerReload");
        innerReloadInPlugin();
      }
    }
  });
}

function innerReloadInPlugin() {
  if (tabs.activeTab.contentType != "application/pdf"){
    return;
  }

  let mimeService = Cc["@mozilla.org/mime;1"].
    getService(Ci.nsIMIMEService);
  let handlerInfo = mimeService.getFromTypeAndExtension('application/pdf', 'pdf');
//console.log(JSON.stringify(handlerInfo, null, " "));

  // Open PDF internally
  handlerInfo.preferredAction = handlerInfo.handleInternally;
  let handlerService = Cc['@mozilla.org/uriloader/handler-service;1'].
    getService(Ci.nsIHandlerService);
  handlerService.store(handlerInfo);

  let backupPref = require('sdk/preferences/service').
                     get("plugin.disable_full_page_plugin_for_types");
  require('sdk/preferences/service').
    reset("plugin.disable_full_page_plugin_for_types");

  //
  var catMan = Cc["@mozilla.org/categorymanager;1"].
                   getService(Ci.nsICategoryManager);
  catMan.addCategoryEntry("Gecko-Content-Viewers",
    "application/pdf",
    "@mozilla.org/content/plugin/document-loader-factory;1",
    false,
    true);

  let tab = require("tab-browser").activeTab;
  let p = PageProgress.registerBrowser(tab.linkedBrowser);
  p.on('loadstarted', function() {
//    console.log("loadstarted");
    // When load starts, we start net-log
    NetLog.registerBrowser(tab.linkedBrowser, {
        onResponse: function(response) {
//            console.log("onResponse " + response.stage);
          if (response.stage == "end") {
            if (backupPref) {
              require('sdk/preferences/service').
                set("plugin.disable_full_page_plugin_for_types", backupPref);
              delete backupPref;
            }
            try {
              catMan.deleteCategoryEntry("Gecko-Content-Viewers",
                  "application/pdf", false);
            }
            catch (err) {}
            NetLog.unregisterBrowser(tab.linkedBrowser);
            PageProgress.unregisterBrowser(tab.linkedBrowser);
//            console.log("onResponse end");
          }
        }
    });
    this.once('contentloaded', function() {
        // Content is loaded, remove net-log
        NetLog.unregisterBrowser(tab.linkedBrowser);
        PageProgress.unregisterBrowser(tab.linkedBrowser);
//        console.log("contentloaded");
    });
  });

  tabs.activeTab.url = tabs.activeTab.url;
//  tabs.activeTab.reload();
}

//Observe tab switch or document changes in each existing tab:
function updateWidgetState(tab) {
  var view = widget.getView(tab.window);
  if (!view) return;

  if (navigator.plugins["Adobe Acrobat"] && (tab.contentType == "application/pdf")) {
    view.contentURL = data.url("pdf.png"); //"moz-icon://goat.pdf?size=16"; //"http://www.mozilla.org/favicon.ico",
  }
  else {
    view.contentURL = data.url("pdfgrey.png"); //"moz-icon://goat.html?size=16&state=disabled"; //"http://www.mozilla.org/favicon.ico",
  }
//  console.log("updateWidgetState: " + tab.contentType);
  // Update widget displayed text:
//  view.content = tab.url.match(/^https/) ? "Secured" : "Unsafe";
}

updateWidgetState(tabs.activeTab);

tabs.on('ready', updateWidgetState);
tabs.on('activate', updateWidgetState);