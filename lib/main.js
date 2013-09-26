var {Cc, Ci, Cu} = require("chrome");
Cu.import('resource://gre/modules/Services.jsm');
//let { setTimeout } = require('sdk/timers');

const widgets = require("sdk/widget");
const tabs = require("sdk/tabs");
const data = require("sdk/self").data;
const prefs = require('sdk/preferences/service');

const NetLog = require('net-log');
const PageProgress = require('net-log/page-progress');

const switchTooltipAcrobat = "Reload the pdf with Acrobat plugin";
const switchTooltipPDFJS   = "Reload the pdf with internal viewer";
const switchLabelAcrobat   = "Switch Viewer";

const widgetID = "pdfviewerswitcherbutton";
const buttonID = "widget:" + require("self").id + "-" + widgetID;

var mediator = Cc['@mozilla.org/appshell/window-mediator;1'].
  getService(Ci.nsIWindowMediator);
var window = mediator.getMostRecentWindow("navigator:browser");
var navigator = window.navigator;

require("sdk/context-menu").Item({
  id: "pdfviewerswitchermenu",
  label: switchTooltipAcrobat,
  image: data.url("pdf.png"),
  contentScript: 'self.on("context", function (node) {' +
                 '  return ' +
                 '    ((navigator.plugins["Adobe Acrobat"] || findAcroReadLinux())' + 
                 '     && (tab.contentType == "application/pdf")); ' + 
                 '});' +
                 'self.on("click", self.postMessage);',
   onMessage: function() {
     reloadInPlugin();
   }
});

//var widget = require("toolbarwidget").ToolbarWidget({
var widget = widgets.Widget({
  id: widgetID,
  label: switchLabelAcrobat,
  tooltip: switchTooltipAcrobat,
  contentURL: data.url("pdfjs.png"), //"moz-icon://goat.pdf?size=16", //"http://www.mozilla.org/favicon.ico",
  onClick: reloadInPlugin
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
        var view = widget.getView(tab.window);
        if (view && buttonVisible()) {
          view.tooltip = switchTooltipPDFJS;
          view.contentURL = data.url("pdfjs.png"); 
        }
      }
    }
  });
}

function innerReloadInPlugin() {
  if (tabs.activeTab.contentType != "application/pdf"){
    return;
  }

  let mimeService = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
  let handlerInfo = mimeService.getFromTypeAndExtension('application/pdf', 'pdf');
//console.log(JSON.stringify(handlerInfo, null, " "));

  // Open PDF internally
  handlerInfo.preferredAction = handlerInfo.handleInternally;
  let handlerService = Cc['@mozilla.org/uriloader/handler-service;1'].
    getService(Ci.nsIHandlerService);
  handlerService.store(handlerInfo);

  let backupPref = prefs.get("plugin.disable_full_page_plugin_for_types");
  let backupPrefDisable = prefs.get("pdfjs.disabled");

  prefs.reset("plugin.disable_full_page_plugin_for_types");
  prefs.set("pdfjs.disabled", true);

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
              prefs.set("plugin.disable_full_page_plugin_for_types", backupPref);
              delete backupPref;
            }
            prefs.set("pdfjs.disabled", backupPrefDisable);
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

function buttonVisible() {
  var activeXULWindow = require("window/utils").getMostRecentBrowserWindow();
  var toolbox = activeXULWindow.gNavToolbox;
  if (toolbox) {
    var button = toolbox.ownerDocument.getElementById(buttonID);
    if (!button) {
//      console.log("no button found");
      return false;
    } else {
//      console.log("button found");
      return true;
    }
  }
}

function attachWidget() {
//  console.log("attach widget");
  updateWidgetState(tabs.activeTab);
}

//Observe tab switch or document changes in each existing tab:
function updateWidgetState(tab) {
  var view = widget.getView(tab.window);
  if (!view) return;
  if (!buttonVisible()) return;

  mediator = Cc['@mozilla.org/appshell/window-mediator;1'].
    getService(Ci.nsIWindowMediator);
  window = mediator.getMostRecentWindow("navigator:browser");
  navigator = window.navigator;

  try {
    if (   (navigator.plugins["Adobe Acrobat"] || findAcroReadLinux())
        && (tab.contentType == "application/pdf")) {
      view.contentURL = data.url("pdf.png"); //"moz-icon://goat.pdf?size=16"; //"http://www.mozilla.org/favicon.ico",
    } else {
      view.contentURL = data.url("pdfgrey.png"); //"moz-icon://goat.html?size=16&state=disabled"; //"http://www.mozilla.org/favicon.ico",
    }
  }
  catch (err) {}
  
  tab.attach({
    contentScript: "if (document.body) {self.postMessage(document.body.innerHTML);}",
    onMessage: function(body)
    {
      if (body && body.search('<embed type="application/pdf"') != -1 &&
          body.search('name="plugin"') != -1) {
//        console.log("switch label to pdfjs");
        view.tooltip = switchTooltipPDFJS; 
        view.contentURL = data.url("pdfjs.png"); 
      } else {
//        console.log("switch label to acrobat");
        view.tooltip = switchTooltipAcrobat;
      }
    }
  });
}

function findAcroReadLinux() {
  for (var i = 0; i < navigator.plugins.length; i++) {
    if (navigator.plugins[i].name.search('Adobe Reader') != -1) {
      return true;
    }
  }
  return false;
}

attachWidget();
//widget.on("attach", attachWidget);
tabs.on('ready', updateWidgetState);
tabs.on('activate', updateWidgetState);