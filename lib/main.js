var {Cc, Ci, Cu} = require("chrome");
Cu.import('resource://gre/modules/Services.jsm');

const tabs = require("sdk/tabs");
const data = require("sdk/self").data;
const prefs = require('sdk/preferences/service');
const timers = require('sdk/timers');
const NetLog = require('net-log');
const PageProgress = require('net-log/page-progress');
const ui = require("sdk/ui");

const switchTooltipAcrobat = "Reload the pdf with Acrobat plugin";
const switchTooltipPDFJS   = "Reload the pdf with internal viewer";
const switchLabelAcrobat   = "Switch Viewer";

const widgetID = "pdfviewerswitcherbutton";
const buttonID = "widget:" + require("sdk/self").id + "-" + widgetID;

const reloadTimeout = 1000;

var mediator = Cc['@mozilla.org/appshell/window-mediator;1'].
  getService(Ci.nsIWindowMediator);
var window = mediator.getMostRecentWindow("navigator:browser");
var navigator = window.navigator;

function debug(msg) {
  if (require('sdk/simple-prefs').prefs['debugLog']) {
    console.log("PVS: " + msg);
  }
}

function getLinkedBrowser() {
  let activeXULWindow = require("sdk/window/utils").getMostRecentBrowserWindow();
  let linkedBrowser = activeXULWindow.gBrowser.selectedTab.linkedBrowser;
  debug(activeXULWindow.gBrowser.selectedTab.linkedBrowser);
  return linkedBrowser;
}

var contextCreated = false;

function createContextMenu() {
  "use strict";
  if (contextCreated) {
    debug("createContextMenu return");
    return;
  }
  contextCreated = true;

  const contextMenu = require("sdk/context-menu");

  let plugins = findPdfPlugins();
  debug("createContextMenu: " + JSON.stringify(plugins));

  for (let i = 0; i < plugins.length; i++) {
    let pluginName = plugins[i];
    debug("createContextMenu: " + pluginName);
    contextMenu.Item({
      id: "pdfviewerswitchermenu" + i,
      label: "Reload the pdf with " + pluginName,
      image: data.url("pdf.png"),
      contentScript: 'function findPluginName() { ' +
                     '  for (var i = 0; i < navigator.plugins.length; i++) { ' +
                     '    if (navigator.plugins[i].name.search("' + pluginName +
                     '") != -1) { ' +
                     '      return true; ' +
                     '    }' +
                     '  }' +
                     '  return false;' +
                     '}; ' +
                     'self.on("context", function (node) {' +
                     '  return ' +
                     '    (findPluginName() && (document.contentType == "application/pdf")); ' +
                     '});' +
                     'self.on("click", function() {self.postMessage("' + pluginName + '")});',
       onMessage: function(pluginName) {
         debug("reload with plugin: " + pluginName);
         reloadInPlugin(pluginName);
       }
    });


  }
}


var action_button = ui.ActionButton({
  id: widgetID,
  label: switchLabelAcrobat,
  tooltip: switchTooltipAcrobat,
  icon: data.url("pdfjs.png"),
  // contentURL: data.url("pdfjs.png"), //"moz-icon://goat.pdf?size=16",
  onClick: function() {reloadInPlugin("Adobe Acrobat");},
});

var errorPanel = require("sdk/panel").Panel({
  width:300,
  height:100,
  contentURL: data.url("error.html"),
});

errorPanel.on("show", function() {
  timers.setTimeout(function() {
    errorPanel.hide();
  }, 5000);
});

function reloadInPlugin(pluginName) {
  var tab = require("sdk/tabs").activeTab;

  tab.attach({
    contentScript: "self.postMessage(document.body.innerHTML);",
    onMessage: function(body)
    {
      if (body && body.search('<embed type="application/pdf"') != -1 &&
          body.search('name="plugin"') != -1) {
        debug("simple reload");
        tabs.activeTab.url = tabs.activeTab.url;
//        tabs.activeTab.reload();
      } else {
        debug("call innerReload");
        innerReloadInPlugin(tab, pluginName);
//        debug("switch icon to active pdfjs.png");
//        action_button.state("tab",
//          {
//            "icon": data.url("pdfjs.png"),
//            "disabled": false,
//            "label": switchTooltipPDFJS
//          }
//        );
      }
    }
  });
}

function innerReloadInPlugin(aTab, pluginName) {
  if (tabs.activeTab.contentType != "application/pdf"){
    debug("no pdf file recognized")
    return;
  }

  let mimeService = Cc["@mozilla.org/mime;1"].getService(Ci.nsIMIMEService);
  let handlerInfo = mimeService.getFromTypeAndExtension('application/pdf', 'pdf');

  if (!handlerInfo) {
    debug("did not find handler info, probably no plugin installed!");
    return;
  }
  //debug(JSON.stringify(handlerInfo, null, " "));
  disablePdfPlugins(pluginName);

  // Open PDF internally
  handlerInfo.preferredAction = handlerInfo.handleInternally;
  let handlerService = Cc['@mozilla.org/uriloader/handler-service;1'].
    getService(Ci.nsIHandlerService);
  handlerService.store(handlerInfo);

  var backupPref = prefs.get("plugin.disable_full_page_plugin_for_types");
  var backupPrefDisable = prefs.get("pdfjs.disabled");

  prefs.reset("plugin.disable_full_page_plugin_for_types");
  prefs.set("pdfjs.disabled", true);

  var catMan = Cc["@mozilla.org/categorymanager;1"].
                   getService(Ci.nsICategoryManager);
  catMan.addCategoryEntry("Gecko-Content-Viewers",
    "application/pdf",
    "@mozilla.org/content/plugin/document-loader-factory;1",
    false,
    true);

  let p = PageProgress.registerBrowser(getLinkedBrowser());
  var timerID = timers.setTimeout(errorResetPrefs, reloadTimeout);
  p.on('loadstarted', function() {
    debug("loadstarted");
    // When load starts, we start net-log
    NetLog.registerBrowser(getLinkedBrowser(), {
        onResponse: function(response) {
          debug("onResponse " + response.stage);
          if (response.stage == "data" ||
              response.stage == "end" ) {
            timers.clearTimeout(timerID);
            resetPrefs();
            NetLog.unregisterBrowser(getLinkedBrowser());
            PageProgress.unregisterBrowser(getLinkedBrowser());
            debug("onResponse end");
          }
        }
    });
    this.once('contentloaded', function() {
      // Content is loaded, remove net-log
      NetLog.unregisterBrowser(getLinkedBrowser());
      PageProgress.unregisterBrowser(getLinkedBrowser());
      debug("contentloaded");
    });
  });

  function errorResetPrefs() {
    errorPanel.show();
    resetPrefs();
  }

  function resetPrefs() {
    resetPdfPlugins();

    if (typeof backupPref != 'undefined') {
      prefs.set("plugin.disable_full_page_plugin_for_types", backupPref);
      delete backupPref;
    }
    if (typeof backupPrefDisable != 'undefined') {
      prefs.set("pdfjs.disabled", backupPrefDisable);
      delete backupPrefDisable;
    }
    try {
      catMan.deleteCategoryEntry("Gecko-Content-Viewers",
          "application/pdf", false);
    }
    catch (err) {}
    updateWidgetState(tabs.activeTab);
  }

  tabs.activeTab.url = tabs.activeTab.url;
//  tabs.activeTab.reload();
}


function buttonVisible() {
  return true;
  var activeXULWindow = require("sdk/window/utils").getMostRecentBrowserWindow();
  var toolbox = activeXULWindow.gNavToolbox;
  if (toolbox) {
    var button = toolbox.ownerDocument.getElementById(buttonID);
    if (!button) {
      debug("no button found");
      return false;
    } else {
      debug("button found");
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
  createContextMenu();
  var activeTab = tab;

  debug(action_button.icon);
  mediator = Cc['@mozilla.org/appshell/window-mediator;1'].
  getService(Ci.nsIWindowMediator);
  window = mediator.getMostRecentWindow("navigator:browser");
  navigator = window.navigator;

  try {
    if (   (navigator.plugins["Adobe Acrobat"] || findAcroReadLinux())
        && (activeTab.contentType == "application/pdf"))
    {
      debug("switch icon to active pdf.png");
      debug(action_button.icon);
      action_button.state("tab",
        {
          "icon": data.url("pdf.png"),
          "disabled": false,
          "label": switchTooltipAcrobat
        }
      );
      debug("switch active pdf.png: " + action_button.icon);
    } else {
      debug("switch icon to disabled pdf.png");
      action_button.state("tab",
        {
          "icon": data.url("pdf.png"),
          "disabled": true,
          "label": switchLabelAcrobat
        }
      );
      debug("switch disabled pdf.png: " + action_button.icon);
    }
  }
  catch (err) {}

  function switchPDFJS() {
    action_button.state("tab",
      {
        "icon": data.url("pdfjs.png"),
        "disabled": false,
        "label": switchTooltipPDFJS
      }
    );
  }

  tab.attach({
    contentScript: "if (document.body) {self.postMessage(document.body.innerHTML);}",
    onMessage: function(body)
    {

      if (body && body.search('<embed type="application/pdf"') != -1 &&
          body.search('name="plugin"') != -1) {
        debug("switch label to pdfjs");
        switchPDFJS();
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

function findPdfPlugins() {
  "use strict";

  let pluginHost = Cc["@mozilla.org/plugin/host;1"].getService(Ci.nsIPluginHost);
  let pluginTags = pluginHost.getPluginTags();

  let pdfPlugins = [];
  for (let i = 0; i < pluginTags.length; ++i) {
    let pluginTag = pluginTags[i];

    debug("check Plugin: " + JSON.stringify(pluginTag));

    let mimeTypes = pluginTag.getMimeTypes();
    for (let j = 0; j < mimeTypes.length; ++j) {
      let type = mimeTypes[j];

      if (type == "application/pdf" && (pdfPlugins.indexOf(pluginTag.name) < 0)) {
        debug("plugin name: " + pluginTag.name);
        pdfPlugins.push(pluginTag.name);
      }
    }
  }

  return pdfPlugins;
}

var pluginStates = {};

function disablePdfPlugins(pluginName) {
  "use strict";

  let pluginHost = Cc["@mozilla.org/plugin/host;1"].getService(Ci.nsIPluginHost);
  let pluginTags = pluginHost.getPluginTags();

  debug("use plugin: " + pluginName);
  for (let i = 0; i < pluginTags.length; ++i) {
    let pluginTag = pluginTags[i];

    debug("check Plugin: >>" + pluginTag.name + "<<");

    let mimeTypes = pluginTag.getMimeTypes();
    for (let j = 0; j < mimeTypes.length; ++j) {
      let type = mimeTypes[j];

      if ((type == "application/pdf") && !(pluginTag.name == pluginName)) {
        debug("disable plugin: >>" + pluginTag.name + "<<");
        if (!pluginStates.hasOwnProperty(pluginTag.name)) {
          pluginStates[pluginTag.name] = pluginTag.enabledState;
        }
        pluginTag.enabledState = pluginTag.STATE_DISABLED;
        debug("pluginStates: " + JSON.stringify(pluginStates));
        break;
      }
      else if ((require('sdk/simple-prefs').prefs['enableAllPlugins']) &&
              (type == "application/pdf") &&
              (pluginTag.name == pluginName)
              ) {
        debug("disable plugin: >>" + pluginTag.name + "<<");
        if (!pluginStates.hasOwnProperty(pluginTag.name)) {
          pluginStates[pluginTag.name] = pluginTag.enabledState;
        }
        pluginTag.enabledState = pluginTag.STATE_ENABLED;
      }
    }
  }
}

function resetPdfPlugins() {
  "use strict";
  debug("resetPdfPlugins");

  let pluginHost = Cc["@mozilla.org/plugin/host;1"].getService(Ci.nsIPluginHost);
  let pluginTags = pluginHost.getPluginTags();

  for (let i = 0; i < pluginTags.length; ++i) {
    let pluginTag = pluginTags[i];
    let pluginName = pluginTag.name;

    debug("check Plugin: " + pluginName);
    debug("pluginStates: " + JSON.stringify(pluginStates));

    if (pluginStates.hasOwnProperty(pluginName)) {
      debug("reset plugin: " + pluginName + " to state " + pluginStates[pluginName]);
      pluginTag.enabledState = pluginStates[pluginName];
    }
  }

  pluginStates = {};
  debug("resetPdfPlugins end!");
}


attachWidget();
createContextMenu();
//widget.on("attach", attachWidget);
tabs.on('ready', updateWidgetState);
tabs.on('activate', updateWidgetState);