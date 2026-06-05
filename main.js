"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FloatingHeadingPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_view = require("@codemirror/view");
var import_language = require("@codemirror/language");
var DEFAULT_SETTINGS = {
  headingLevel: 2,
  fontSize: 20,
  borderRadius: 50,
  isLocked: false,
  posX: 50,
  posY: 50,
  isWidthUnlimited: true,
  maxWidth: 300,
  isManuallyHidden: false,
  ignoreMarkdownStyle: true,
  textColor: "",
  backgroundColor: ""
};
var headingExp = /^HyperMD-header_HyperMD-header-(\d)$/;
function getDistanceFromContentToScroller(view) {
  const scroller = view.scrollDOM;
  const contentContainer = view.scrollDOM.querySelector(`.cm-content`);
  let distance = 0;
  if (!scroller || !scroller.instanceOf(HTMLElement) || !contentContainer || !contentContainer.instanceOf(HTMLElement)) {
    return distance;
  }
  let currentElement = contentContainer;
  while (currentElement && currentElement !== scroller) {
    distance += currentElement.offsetTop;
    const nextParent = currentElement.offsetParent;
    if (nextParent && nextParent.instanceOf(HTMLElement)) {
      currentElement = nextParent;
    } else {
      currentElement = null;
    }
  }
  return distance;
}
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      window.setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
var FloatingHeadingPlugin = class extends import_obsidian.Plugin {
  settings = DEFAULT_SETTINGS;
  floatingContainer = null;
  currentHeadingText = null;
  currentHeadingPos = null;
  activeEditorView = null;
  isValidFile = false;
  headingTrackerInstance = null;
  renderComponent = null;
  // 修复：用于生命周期管理的独立宿主
  resizeHandleRight;
  resizeHandleBottom;
  resizeHandleCorner;
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "toggle-visibility",
      name: "\u5207\u6362\u60AC\u6D6E\u6807\u9898\u7A97\u53E3\u663E\u9690",
      callback: () => {
        this.settings.isManuallyHidden = !this.settings.isManuallyHidden;
        void this.saveSettings().then(() => {
          this.updateVisibility();
          new import_obsidian.Notice(this.settings.isManuallyHidden ? "\u60AC\u6D6E\u6807\u9898\u5DF2\u9690\u85CF" : "\u60AC\u6D6E\u6807\u9898\u5DF2\u663E\u793A", 1500);
        }).catch(console.error);
      }
    });
    this.addSettingTab(new FloatingHeadingSettingTab(this.app, this));
    this.registerEditorExtension([this.createHeadingTrackerPlugin()]);
    this.createFloatingWindow();
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.checkActiveFile(file))
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.checkActiveFile(this.app.workspace.getActiveFile()))
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && file.path === activeFile.path) {
          this.checkActiveFile(activeFile);
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.checkActiveFile(this.app.workspace.getActiveFile());
    });
  }
  onunload() {
    if (this.renderComponent) {
      this.renderComponent.unload();
    }
    if (this.floatingContainer) {
      this.floatingContainer.remove();
    }
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.updateFloatingWindowStyle();
  }
  updateVisibility() {
    if (!this.floatingContainer) return;
    const shouldShow = !this.settings.isManuallyHidden && this.isValidFile;
    this.floatingContainer.setCssStyles({ display: shouldShow ? "" : "none" });
  }
  checkActiveFile(file) {
    const previousValidity = this.isValidFile;
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.View);
    const viewType = activeView ? activeView.getViewType() : "";
    const excludedViewTypes = ["canvas", "kanban", "database", "dbfolder"];
    if (!file || excludedViewTypes.includes(viewType) || file.extension !== "md") {
      this.isValidFile = false;
    } else {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      const isKanban = "kanban-plugin" in frontmatter;
      const isDatabase = "database-plugin" in frontmatter;
      this.isValidFile = !(isKanban || isDatabase);
    }
    if (!this.isValidFile) {
      this.currentHeadingText = null;
      this.updateVisibility();
    } else if (this.isValidFile && !previousValidity) {
      this.forceUpdateHeaders();
    }
  }
  forceUpdateHeaders() {
    this.currentHeadingText = null;
    if (this.headingTrackerInstance && this.isValidFile && this.activeEditorView) {
      this.headingTrackerInstance.updateHeaders(this.activeEditorView);
    }
  }
  updateHeadingData(text, pos, editorView) {
    if (!this.floatingContainer || !this.isValidFile) return;
    this.activeEditorView = editorView;
    this.currentHeadingPos = pos;
    if (text !== this.currentHeadingText) {
      this.currentHeadingText = text;
      if (this.renderComponent) {
        this.renderComponent.unload();
        this.renderComponent = null;
      }
      Array.from(this.floatingContainer.childNodes).forEach((child) => {
        if (child && child.instanceOf(HTMLElement) && !child.classList.contains("resize-handle")) {
          child.remove();
        }
      });
      if (text) {
        this.floatingContainer.classList.remove("is-empty-logo");
        const textDiv = this.floatingContainer.createDiv({ cls: "floating-heading-text" });
        this.renderComponent = new import_obsidian.Component();
        this.renderComponent.load();
        import_obsidian.MarkdownRenderer.render(this.app, text, textDiv, "", this.renderComponent).catch(console.error);
      } else {
        this.floatingContainer.classList.add("is-empty-logo");
        const iconDiv = this.floatingContainer.createDiv({ cls: "floating-heading-icon" });
        (0, import_obsidian.setIcon)(iconDiv, `heading-${this.settings.headingLevel}`);
      }
      this.updateFloatingWindowStyle();
      this.updateVisibility();
    }
  }
  updateFloatingWindowStyle() {
    if (!this.floatingContainer) return;
    const el = this.floatingContainer;
    el.setCssStyles({
      left: `${this.settings.posX}px`,
      top: `${this.settings.posY}px`,
      fontSize: `${this.settings.fontSize}px`
    });
    if (el.classList.contains("is-empty-logo")) {
      const size = this.settings.fontSize + 16;
      el.setCssStyles({
        width: `${size}px`,
        height: `${size}px`,
        maxWidth: "none",
        borderRadius: "50%",
        padding: "0"
      });
    } else {
      el.setCssStyles({
        height: "auto",
        padding: "8px 16px",
        borderRadius: `${this.settings.borderRadius}px`,
        maxWidth: this.settings.isWidthUnlimited ? "none" : `${this.settings.maxWidth}px`,
        width: "max-content"
      });
    }
    if (this.settings.isLocked) {
      el.classList.remove("is-draggable");
      el.classList.add("is-locked");
    } else {
      el.classList.remove("is-locked");
      el.classList.add("is-draggable");
    }
    if (this.settings.ignoreMarkdownStyle) {
      el.classList.add("ignore-markdown-style");
    } else {
      el.classList.remove("ignore-markdown-style");
    }
    el.setCssProps({
      "--fh-text-color": this.settings.textColor || "",
      "--fh-bg-color": this.settings.backgroundColor || ""
    });
  }
  createFloatingWindow() {
    if (this.floatingContainer) return;
    this.floatingContainer = activeDocument.body.createDiv({ cls: "floating-heading-container" });
    this.floatingContainer.setCssStyles({ display: "none" });
    this.resizeHandleRight = this.floatingContainer.createDiv({ cls: "resize-handle right" });
    this.resizeHandleBottom = this.floatingContainer.createDiv({ cls: "resize-handle bottom" });
    this.resizeHandleCorner = this.floatingContainer.createDiv({ cls: "resize-handle corner" });
    this.updateFloatingWindowStyle();
    this.setupDraggingAndClick(this.floatingContainer);
    this.setupResizing();
    this.floatingContainer.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new import_obsidian.Menu();
      menu.addItem((item) => {
        item.setTitle(this.settings.isLocked ? "\u89E3\u9501\u7A97\u53E3" : "\u9501\u5B9A\u7A97\u53E3").setIcon(this.settings.isLocked ? "unlock" : "lock").onClick(() => {
          this.settings.isLocked = !this.settings.isLocked;
          void this.saveSettings().then(() => {
            new import_obsidian.Notice(this.settings.isLocked ? "\u60AC\u6D6E\u6807\u9898\u5DF2\u9501\u5B9A \u{1F512}" : "\u60AC\u6D6E\u6807\u9898\u5DF2\u89E3\u9501 \u{1F513}", 1500);
          }).catch(console.error);
        });
      });
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle("\u66F4\u6539\u5C42\u7EA7").setIcon("heading");
        const submenu = item.setSubmenu();
        for (let i = 1; i <= 6; i++) {
          submenu.addItem((subItem) => {
            subItem.setTitle(`H${i}`).setChecked(this.settings.headingLevel === i).onClick(() => {
              this.settings.headingLevel = i;
              void this.saveSettings().then(() => this.forceUpdateHeaders()).catch(console.error);
            });
          });
        }
      });
      menu.showAtMouseEvent(e);
    });
  }
  setupResizing() {
    let isResizing = false;
    let currentHandle = null;
    let startX = 0, startY = 0;
    let startWidth = 0, startFontSize = 0, startMaxWidth = 0;
    const onMouseDown = (e) => {
      const target = e.target;
      if (!target || !target.instanceOf(HTMLElement)) return;
      const targetEl = target;
      if (this.settings.isLocked || !targetEl.classList.contains("resize-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      currentHandle = targetEl;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.floatingContainer.getBoundingClientRect();
      startWidth = rect.width;
      startFontSize = this.settings.fontSize;
      startMaxWidth = this.settings.isWidthUnlimited ? startWidth : this.settings.maxWidth;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };
    const onMouseMove = (e) => {
      if (!isResizing || !currentHandle || !this.floatingContainer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (currentHandle.classList.contains("right") || currentHandle.classList.contains("corner")) {
        if (!this.floatingContainer.classList.contains("is-empty-logo")) {
          this.settings.isWidthUnlimited = false;
          this.settings.maxWidth = Math.max(80, startMaxWidth + dx);
          this.floatingContainer.setCssStyles({
            maxWidth: `${this.settings.maxWidth}px`,
            width: `max-content`
          });
        }
      }
      if (currentHandle.classList.contains("bottom") || currentHandle.classList.contains("corner")) {
        let newFontSize = Math.round(startFontSize + dy / 1.5);
        newFontSize = Math.max(10, Math.min(newFontSize, 100));
        this.settings.fontSize = newFontSize;
        this.floatingContainer.setCssStyles({ fontSize: `${this.settings.fontSize}px` });
        if (this.floatingContainer.classList.contains("is-empty-logo")) {
          const size = this.settings.fontSize + 16;
          this.floatingContainer.setCssStyles({
            width: `${size}px`,
            height: `${size}px`
          });
        }
      }
    };
    const onMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        currentHandle = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        void this.saveSettings().catch(console.error);
      }
    };
    this.resizeHandleRight.addEventListener("mousedown", onMouseDown);
    this.resizeHandleBottom.addEventListener("mousedown", onMouseDown);
    this.resizeHandleCorner.addEventListener("mousedown", onMouseDown);
  }
  setupDraggingAndClick(el) {
    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;
    const onMouseDown = (e) => {
      const target = e.target;
      if (!target || !target.instanceOf(HTMLElement)) return;
      const targetEl = target;
      if (e.button !== 0 || targetEl.classList.contains("resize-handle")) return;
      hasMoved = false;
      if (this.settings.isLocked) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.settings.posX;
      initialY = this.settings.posY;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }
      this.settings.posX = initialX + dx;
      this.settings.posY = initialY + dy;
      el.setCssStyles({
        left: `${this.settings.posX}px`,
        top: `${this.settings.posY}px`
      });
    };
    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        if (hasMoved) {
          void this.saveSettings().catch(console.error);
        }
      }
    };
    el.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || !target.instanceOf(HTMLElement)) return;
      const targetEl = target;
      if (e.button !== 0 || targetEl.classList.contains("resize-handle")) return;
      if (!hasMoved && this.activeEditorView && this.currentHeadingPos !== null) {
        this.activeEditorView.dispatch({
          effects: import_view.EditorView.scrollIntoView(this.currentHeadingPos, { y: "start" })
        });
      }
    });
    el.addEventListener("mousedown", onMouseDown);
  }
  createHeadingTrackerPlugin() {
    class HeadingTracker {
      constructor(editorView, plugin) {
        this.plugin = plugin;
        this.view = editorView;
        this.cachedDistance = getDistanceFromContentToScroller(editorView);
        this.plugin.headingTrackerInstance = this;
        this.scrollHandler = throttle(this.handleScroll.bind(this), 100);
        this.view.scrollDOM.addEventListener("scroll", this.scrollHandler, { passive: true });
        this.updateHeaders(this.view);
      }
      plugin;
      view;
      cachedDistance;
      scrollHandler;
      updateTimeout;
      update(update) {
        if (update.geometryChanged) {
          this.cachedDistance = getDistanceFromContentToScroller(update.view);
        }
        if (update.docChanged || update.geometryChanged) {
          if (this.updateTimeout) window.clearTimeout(this.updateTimeout);
          this.updateTimeout = window.setTimeout(() => {
            this.updateHeaders(update.view);
          }, 100);
        }
      }
      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
        if (this.updateTimeout) window.clearTimeout(this.updateTimeout);
        if (this.plugin.headingTrackerInstance === this) {
          this.plugin.headingTrackerInstance = null;
        }
      }
      handleScroll() {
        this.updateHeaders(this.view);
      }
      updateHeaders(editorView) {
        if (!editorView || !this.plugin.isValidFile) return;
        let foundText = "";
        let foundPos = null;
        editorView.requestMeasure({
          read: () => {
            let height = editorView.scrollDOM.scrollTop - this.cachedDistance + 10;
            if (height > 0) {
              const firstElementBlockInfo = editorView.elementAtHeight(height);
              if (firstElementBlockInfo) {
                const targetLevel = this.plugin.settings.headingLevel;
                (0, import_language.syntaxTree)(editorView.state).iterate({
                  from: 0,
                  to: firstElementBlockInfo.from,
                  enter(node) {
                    const match = headingExp.exec(node.name);
                    if (match) {
                      const level = Number(match[1]);
                      if (level === targetLevel) {
                        foundText = editorView.state.sliceDoc(node.from, node.to).trim().replace(/^#+\s/, "");
                        foundPos = node.from;
                      } else if (level < targetLevel) {
                        foundText = "";
                        foundPos = null;
                      }
                    }
                  }
                });
              }
            }
          },
          write: () => {
            this.plugin.updateHeadingData(foundText, foundPos, editorView);
          }
        });
      }
    }
    return import_view.ViewPlugin.define((view) => new HeadingTracker(view, this));
  }
};
var FloatingHeadingSettingTab = class extends import_obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u60AC\u6D6E\u6807\u9898\u8BBE\u7F6E").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u663E\u793A\u7684\u6807\u9898\u5C42\u7EA7").setDesc("\u9009\u62E9\u8981\u5728\u60AC\u6D6E\u7A97\u53E3\u4E2D\u663E\u793A\u7684\u6807\u9898\u7EA7\u522B").addDropdown((drop) => {
      [1, 2, 3, 4, 5, 6].forEach((i) => drop.addOption(i.toString(), `H${i}`));
      drop.setValue(this.plugin.settings.headingLevel.toString());
      drop.onChange((value) => {
        this.plugin.settings.headingLevel = Number(value);
        void this.plugin.saveSettings().then(() => this.plugin.forceUpdateHeaders()).catch(console.error);
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u5B57\u4F53\u5927\u5C0F").setDesc("\u60AC\u6D6E\u7A97\u53E3\u4E2D\u6587\u5B57\u7684\u5927\u5C0F (px)").addSlider((slider) => {
      slider.setLimits(10, 100, 1).setValue(this.plugin.settings.fontSize).setDynamicTooltip().onChange((value) => {
        this.plugin.settings.fontSize = value;
        void this.plugin.saveSettings().catch(console.error);
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u7A97\u53E3\u5706\u89D2").setDesc("\u60AC\u6D6E\u7A97\u53E3\u7684\u5706\u89D2\u5927\u5C0F (px)").addSlider((slider) => {
      slider.setLimits(0, 150, 1).setValue(this.plugin.settings.borderRadius).setDynamicTooltip().onChange((value) => {
        this.plugin.settings.borderRadius = value;
        void this.plugin.saveSettings().catch(console.error);
      });
    });
    let bgPickerComponent;
    new import_obsidian.Setting(containerEl).setName("\u80CC\u666F\u989C\u8272").setDesc("\u81EA\u5B9A\u4E49\u60AC\u6D6E\u7A97\u53E3\u7684\u80CC\u666F\u989C\u8272").addButton((btn) => btn.setButtonText("\u6062\u590D\u9ED8\u8BA4").setTooltip("\u6062\u590D\u4E3A\u4E3B\u9898\u81EA\u5E26\u80CC\u666F\u8272").onClick(() => {
      this.plugin.settings.backgroundColor = "";
      void this.plugin.saveSettings().catch(console.error);
      bgPickerComponent?.setValue("#000000");
    })).addColorPicker((picker) => {
      bgPickerComponent = picker;
      picker.setValue(this.plugin.settings.backgroundColor || "#000000").onChange((value) => {
        this.plugin.settings.backgroundColor = value;
        void this.plugin.saveSettings().catch(console.error);
      });
    });
    let textPickerComponent;
    new import_obsidian.Setting(containerEl).setName("\u5B57\u4F53\u989C\u8272").setDesc("\u81EA\u5B9A\u4E49\u60AC\u6D6E\u7A97\u53E3\u7684\u5B57\u4F53\u989C\u8272\u3002\u5F00\u542F\u201C\u7EDF\u4E00\u6587\u672C\u6837\u5F0F\u201D\u65F6\u4E5F\u4F1A\u8986\u76D6\u5F3A\u5236\u4E3A\u8BE5\u989C\u8272\u3002").addButton((btn) => btn.setButtonText("\u6062\u590D\u9ED8\u8BA4").setTooltip("\u6062\u590D\u4E3A\u4E3B\u9898\u81EA\u5E26\u6587\u5B57\u8272").onClick(() => {
      this.plugin.settings.textColor = "";
      void this.plugin.saveSettings().catch(console.error);
      textPickerComponent?.setValue("#cccccc");
    })).addColorPicker((picker) => {
      textPickerComponent = picker;
      picker.setValue(this.plugin.settings.textColor || "#cccccc").onChange((value) => {
        this.plugin.settings.textColor = value;
        void this.plugin.saveSettings().catch(console.error);
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u7EDF\u4E00\u6587\u672C\u6837\u5F0F (\u5FFD\u7565 Markdown)").setDesc("\u9ED8\u8BA4\u5173\u95ED\u3002\u5F00\u542F\u540E\u5C06\u5F3A\u5236\u62B9\u9664\u6807\u9898\u5185\u7684\u7C97\u4F53\u3001\u659C\u4F53\u3001\u53CC\u94FE\u63A5\u7B49\u6392\u7248\u6837\u5F0F\uFF0C\u4F7F\u5176\u5B8C\u5168\u6DF7\u5165\u53F3\u4FA7\u7684\u666E\u901A\u6587\u672C\u3002").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.ignoreMarkdownStyle).onChange((value) => {
        this.plugin.settings.ignoreMarkdownStyle = value;
        void this.plugin.saveSettings().catch(console.error);
      });
    });
    let maxWidthSetting;
    new import_obsidian.Setting(containerEl).setName("\u65E0\u9650\u5236\u7A97\u53E3\u957F\u5EA6").setDesc("\u52FE\u9009\u540E\u7A97\u53E3\u957F\u5EA6\u968F\u6807\u9898\u6587\u5B57\u81EA\u52A8\u5EF6\u4F38\u3002\u53D6\u6D88\u52FE\u9009\u53EF\u9650\u5236\u6700\u5927\u957F\u5EA6\u3002").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.isWidthUnlimited).onChange((value) => {
        this.plugin.settings.isWidthUnlimited = value;
        void this.plugin.saveSettings().catch(console.error);
        this.plugin.forceUpdateHeaders();
        if (maxWidthSetting) {
          maxWidthSetting.settingEl.setCssStyles({ display: value ? "none" : "" });
        }
      });
    });
    maxWidthSetting = new import_obsidian.Setting(containerEl).setName("\u7A97\u53E3\u6700\u5927\u957F\u5EA6").setDesc("\u8BBE\u7F6E\u60AC\u6D6E\u7A97\u53E3\u7684\u6700\u5927\u957F\u5EA6 (px)\uFF0C\u6807\u9898\u8D85\u51FA\u65F6\u4F1A\u81EA\u52A8\u7701\u7565 (...)\u3002").addSlider((slider) => {
      slider.setLimits(100, 1e3, 10).setValue(this.plugin.settings.maxWidth).setDynamicTooltip().onChange((value) => {
        this.plugin.settings.maxWidth = value;
        void this.plugin.saveSettings().then(() => this.plugin.forceUpdateHeaders()).catch(console.error);
      });
    });
    maxWidthSetting.settingEl.setCssStyles({ display: this.plugin.settings.isWidthUnlimited ? "none" : "" });
    new import_obsidian.Setting(containerEl).setName("\u9501\u5B9A\u7A97\u53E3\u4F4D\u7F6E").setDesc("\u4F60\u4E5F\u53EF\u4EE5\u5728\u60AC\u6D6E\u7A97\u53E3\u4E0A\u70B9\u51FB\u3010\u53F3\u952E\u3011\u76F4\u63A5\u9501\u5B9A/\u89E3\u9501\u3002").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.isLocked).onChange((value) => {
        this.plugin.settings.isLocked = value;
        void this.plugin.saveSettings().catch(console.error);
      });
    });
  }
};
