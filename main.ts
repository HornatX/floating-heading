import {
    App,
    MarkdownRenderer,
    Menu,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    View,
    setIcon,
    MenuItem,
    ColorComponent
} from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate, PluginValue } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

interface FloatingHeadingSettings {
    headingLevel: number;
    fontSize: number;
    borderRadius: number;
    isLocked: boolean;
    posX: number;
    posY: number;
    isWidthUnlimited: boolean;
    maxWidth: number;
    isManuallyHidden: boolean;
    ignoreMarkdownStyle: boolean;
    textColor: string;
    backgroundColor: string;
}

const DEFAULT_SETTINGS: FloatingHeadingSettings = {
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

const headingExp = /^HyperMD-header_HyperMD-header-(\d)$/;

function getDistanceFromContentToScroller(view: EditorView): number {
    const scroller = view.scrollDOM;
    const contentContainer = view.scrollDOM.querySelector(`.cm-content`);
    let distance = 0;
    
    if (!(scroller instanceof HTMLElement) || !(contentContainer instanceof HTMLElement)) {
        return distance;
    }
    
    let currentElement: HTMLElement | null = contentContainer;
    while (currentElement && currentElement !== scroller) {
        distance += currentElement.offsetTop;
        
        // 1. 显式标注类型为 Element | null
        // 2. 使用一个全新的局部变量名
        const nextParent: Element | null = currentElement.offsetParent;
        
        // 3. 显式类型收窄，确保 currentElement 永远是 HTMLElement 或 null
        if (nextParent instanceof HTMLElement) {
            currentElement = nextParent;
        } else {
            currentElement = null;
        }
    }
    return distance;
}

// 严谨的 TS 节流函数，避免 any 和 this 指向警告
function throttle<Args extends unknown[]>(func: (...args: Args) => void, limit: number): (...args: Args) => void {
    let inThrottle: boolean;
    return function (this: unknown, ...args: Args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            window.setTimeout(() => inThrottle = false, limit);
        }
    };
}

export interface IHeadingTracker extends PluginValue {
    updateHeaders(editorView: EditorView): void;
}

export default class FloatingHeadingPlugin extends Plugin {
    settings: FloatingHeadingSettings = DEFAULT_SETTINGS;
    floatingContainer: HTMLDivElement | null = null;
    currentHeadingText: string | null = null;
    currentHeadingPos: number | null = null;
    activeEditorView: EditorView | null = null;
    isValidFile: boolean = false;
    headingTrackerInstance: IHeadingTracker | null = null;

    resizeHandleRight!: HTMLDivElement;
    resizeHandleBottom!: HTMLDivElement;
    resizeHandleCorner!: HTMLDivElement;

    async onload() {
        await this.loadSettings();

        // 命令 ID 移除包含插件自身的名称（Obsidian 会自动加上前缀）
        this.addCommand({
            id: 'toggle-visibility',
            name: '切换悬浮标题窗口显隐',
            callback: () => {
                this.settings.isManuallyHidden = !this.settings.isManuallyHidden;
                this.saveSettings().then(() => {
                    this.updateVisibility();
                    new Notice(this.settings.isManuallyHidden ? "悬浮标题已隐藏" : "悬浮标题已显示", 1500);
                }).catch(console.error);
            }
        });

        this.addSettingTab(new FloatingHeadingSettingTab(this.app, this));
        this.registerEditorExtension([this.createHeadingTrackerPlugin()]);
        this.createFloatingWindow();

        this.registerEvent(
            this.app.workspace.on('file-open', (file: TFile | null) => this.checkActiveFile(file))
        );
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => this.checkActiveFile(this.app.workspace.getActiveFile()))
        );
        this.registerEvent(
            this.app.metadataCache.on('changed', (file: TFile) => {
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
        if (this.floatingContainer) {
            this.floatingContainer.remove();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.updateFloatingWindowStyle();
    }

    updateVisibility() {
        if (!this.floatingContainer) return;
        const shouldShow = !this.settings.isManuallyHidden && this.isValidFile;
        // 修复：使用 Obsidian 原生 setCssStyles
        this.floatingContainer.setCssStyles({ display: shouldShow ? '' : 'none' });
    }

    checkActiveFile(file: TFile | null) {
        const previousValidity = this.isValidFile;
        const activeView = this.app.workspace.getActiveViewOfType(View);
        const viewType = activeView ? activeView.getViewType() : "";
        const excludedViewTypes = ['canvas', 'kanban', 'database', 'dbfolder'];

        if (!file || excludedViewTypes.includes(viewType) || file.extension !== 'md') {
            this.isValidFile = false;
        } else {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter || {};
            const isKanban = 'kanban-plugin' in frontmatter;
            const isDatabase = 'database-plugin' in frontmatter;
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

    updateHeadingData(text: string, pos: number | null, editorView: EditorView) {
        if (!this.floatingContainer || !this.isValidFile) return;

        this.activeEditorView = editorView;
        this.currentHeadingPos = pos;

        if (text !== this.currentHeadingText) {
            this.currentHeadingText = text;
            Array.from(this.floatingContainer.childNodes).forEach(child => {
                if (child instanceof HTMLElement && !child.classList.contains('resize-handle')) {
                    child.remove();
                }
            });

            if (text) {
                this.floatingContainer.classList.remove('is-empty-logo');
                const textDiv = this.floatingContainer.createDiv({ cls: 'floating-heading-text' });
                // 修复：捕获 Promise 报错，并以安全方式传递组件实例
                MarkdownRenderer.render(this.app, text, textDiv, "", this).catch(console.error);
            } else {
                this.floatingContainer.classList.add('is-empty-logo');
                const iconDiv = this.floatingContainer.createDiv({ cls: 'floating-heading-icon' });
                setIcon(iconDiv, `heading-${this.settings.headingLevel}`);
            }

            this.updateFloatingWindowStyle();
            this.updateVisibility();
        }
    }

    updateFloatingWindowStyle() {
        if (!this.floatingContainer) return;

        const el = this.floatingContainer;
        
        // 修复：严格使用 setCssStyles 代替 style = xxx
        el.setCssStyles({
            left: `${this.settings.posX}px`,
            top: `${this.settings.posY}px`,
            fontSize: `${this.settings.fontSize}px`
        });

        if (el.classList.contains('is-empty-logo')) {
            const size = this.settings.fontSize + 16;
            el.setCssStyles({
                width: `${size}px`,
                height: `${size}px`,
                maxWidth: 'none',
                borderRadius: '50%',
                padding: '0'
            });
        } else {
            el.setCssStyles({
                height: 'auto',
                padding: '8px 16px',
                borderRadius: `${this.settings.borderRadius}px`,
                maxWidth: this.settings.isWidthUnlimited ? 'none' : `${this.settings.maxWidth}px`,
                width: 'max-content'
            });
        }

        if (this.settings.isLocked) {
            el.classList.remove('is-draggable');
            el.classList.add('is-locked');
        } else {
            el.classList.remove('is-locked');
            el.classList.add('is-draggable');
        }

        if (this.settings.ignoreMarkdownStyle) {
            el.classList.add('ignore-markdown-style');
        } else {
            el.classList.remove('ignore-markdown-style');
        }

        // 修复：利用 setCssProps 安全注册 CSS 自定义变量
        el.setCssProps({
            '--fh-text-color': this.settings.textColor || '',
            '--fh-bg-color': this.settings.backgroundColor || ''
        });
    }

    createFloatingWindow() {
        if (this.floatingContainer) return;

        // 修复：使用 activeDocument 代替 document 兼顾弹窗兼容性
        this.floatingContainer = activeDocument.body.createDiv({ cls: 'floating-heading-container' });
        this.floatingContainer.setCssStyles({ display: 'none' });

        this.resizeHandleRight = this.floatingContainer.createDiv({ cls: 'resize-handle right' });
        this.resizeHandleBottom = this.floatingContainer.createDiv({ cls: 'resize-handle bottom' });
        this.resizeHandleCorner = this.floatingContainer.createDiv({ cls: 'resize-handle corner' });

        this.updateFloatingWindowStyle();
        this.setupDraggingAndClick(this.floatingContainer);
        this.setupResizing();

        this.floatingContainer.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            const menu = new Menu();

            menu.addItem((item: MenuItem) => {
                item.setTitle(this.settings.isLocked ? "解锁窗口" : "锁定窗口")
                    .setIcon(this.settings.isLocked ? "unlock" : "lock")
                    .onClick(() => {
                        this.settings.isLocked = !this.settings.isLocked;
                        this.saveSettings().then(() => {
                            new Notice(this.settings.isLocked ? "悬浮标题已锁定 🔒" : "悬浮标题已解锁 🔓", 1500);
                        }).catch(console.error);
                    });
            });

            menu.addSeparator();

            menu.addItem((item: MenuItem) => {
                item.setTitle("更改层级").setIcon("heading");
                
                // 修复：安全断言解决 Any 及 Submenu 未匹配报错
                const submenu = (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
                
                for (let i = 1; i <= 6; i++) {
                    submenu.addItem((subItem: MenuItem) => {
                        subItem.setTitle(`H${i}`)
                            .setChecked(this.settings.headingLevel === i)
                            .onClick(() => {
                                this.settings.headingLevel = i;
                                this.saveSettings().then(() => this.forceUpdateHeaders()).catch(console.error);
                            });
                    });
                }
            });

            menu.showAtMouseEvent(e);
        });
    }

    setupResizing() {
        let isResizing = false;
        let currentHandle: HTMLElement | null = null;
        let startX = 0, startY = 0;
        let startWidth = 0, startFontSize = 0, startMaxWidth = 0;

        const onMouseDown = (e: MouseEvent) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (this.settings.isLocked || !target.classList.contains('resize-handle')) return;

            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            currentHandle = target;
            startX = e.clientX;
            startY = e.clientY;

            const rect = this.floatingContainer!.getBoundingClientRect();
            startWidth = rect.width;
            startFontSize = this.settings.fontSize;
            startMaxWidth = this.settings.isWidthUnlimited ? startWidth : this.settings.maxWidth;

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isResizing || !currentHandle || !this.floatingContainer) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (currentHandle.classList.contains('right') || currentHandle.classList.contains('corner')) {
                if (!this.floatingContainer.classList.contains('is-empty-logo')) {
                    this.settings.isWidthUnlimited = false;
                    this.settings.maxWidth = Math.max(80, startMaxWidth + dx);
                    this.floatingContainer.setCssStyles({
                        maxWidth: `${this.settings.maxWidth}px`,
                        width: `max-content`
                    });
                }
            }

            if (currentHandle.classList.contains('bottom') || currentHandle.classList.contains('corner')) {
                let newFontSize = Math.round(startFontSize + (dy / 1.5));
                newFontSize = Math.max(10, Math.min(newFontSize, 100));
                this.settings.fontSize = newFontSize;
                this.floatingContainer.setCssStyles({ fontSize: `${this.settings.fontSize}px` });

                if (this.floatingContainer.classList.contains('is-empty-logo')) {
                    const size = this.settings.fontSize + 16;
                    this.floatingContainer.setCssStyles({
                        width: `${size}px`,
                        height: `${size}px`
                    });
                }
            }
        };

        // 修复：事件处理器返回值应为 void，移除顶层 async
        const onMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                currentHandle = null;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                this.saveSettings().catch(console.error);
            }
        };

        this.resizeHandleRight.addEventListener('mousedown', onMouseDown);
        this.resizeHandleBottom.addEventListener('mousedown', onMouseDown);
        this.resizeHandleCorner.addEventListener('mousedown', onMouseDown);
    }

    setupDraggingAndClick(el: HTMLElement) {
        let isDragging = false;
        let hasMoved = false;
        let startX = 0, startY = 0;
        let initialX = 0, initialY = 0;

        const onMouseDown = (e: MouseEvent) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (e.button !== 0 || target.classList.contains('resize-handle')) return;

            hasMoved = false;
            if (this.settings.isLocked) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = this.settings.posX;
            initialY = this.settings.posY;

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e: MouseEvent) => {
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
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                if (hasMoved) {
                    this.saveSettings().catch(console.error);
                }
            }
        };

        el.addEventListener('click', (e: MouseEvent) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (e.button !== 0 || target.classList.contains('resize-handle')) return;

            if (!hasMoved && this.activeEditorView && this.currentHeadingPos !== null) {
                this.activeEditorView.dispatch({
                    effects: EditorView.scrollIntoView(this.currentHeadingPos, { y: "start" })
                });
            }
        });

        el.addEventListener('mousedown', onMouseDown);
    }

    // 修复：取消局部变量 this 带来的警告，直接使用闭包安全生成扩展
    createHeadingTrackerPlugin() {
        class HeadingTracker implements PluginValue, IHeadingTracker {
            view: EditorView;
            cachedDistance: number;
            scrollHandler: EventListener;
            updateTimeout?: number;

            constructor(editorView: EditorView, private plugin: FloatingHeadingPlugin) {
                this.view = editorView;
                this.cachedDistance = getDistanceFromContentToScroller(editorView);
                this.plugin.headingTrackerInstance = this;
                this.scrollHandler = throttle(this.handleScroll.bind(this), 100) as EventListener;
                this.view.scrollDOM.addEventListener("scroll", this.scrollHandler, { passive: true });
                this.updateHeaders(this.view);
            }

            update(update: ViewUpdate) {
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

            updateHeaders(editorView: EditorView) {
                if (!editorView || !this.plugin.isValidFile) return;

                let foundText = "";
                let foundPos: number | null = null;

                editorView.requestMeasure({
                    read: () => {
                        let height = editorView.scrollDOM.scrollTop - this.cachedDistance + 10;
                        if (height > 0) {
                            const firstElementBlockInfo = editorView.elementAtHeight(height);
                            if (firstElementBlockInfo) {
                                const targetLevel = this.plugin.settings.headingLevel;
                                syntaxTree(editorView.state).iterate({
                                    from: 0,
                                    to: firstElementBlockInfo.from,
                                    enter(node) {
                                        const match = headingExp.exec(node.name);
                                        if (match) {
                                            const level = Number(match[1]);
                                            if (level === targetLevel) {
                                                foundText = editorView.state.sliceDoc(node.from, node.to).trim().replace(/^#+\s/, '');
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

        return ViewPlugin.define((view) => new HeadingTracker(view, this));
    }
}

class FloatingHeadingSettingTab extends PluginSettingTab {
    plugin: FloatingHeadingPlugin;

    constructor(app: App, plugin: FloatingHeadingPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        // 修复：官方建议标准标题格式替代纯 HTML 构建
        new Setting(containerEl).setName('悬浮标题设置').setHeading();

        new Setting(containerEl)
            .setName('显示的标题层级')
            .setDesc('选择要在悬浮窗口中显示的标题级别')
            .addDropdown(drop => {
                [1, 2, 3, 4, 5, 6].forEach(i => drop.addOption(i.toString(), `H${i}`));
                drop.setValue(this.plugin.settings.headingLevel.toString());
                drop.onChange((value) => {
                    this.plugin.settings.headingLevel = Number(value);
                    this.plugin.saveSettings().then(() => this.plugin.forceUpdateHeaders()).catch(console.error);
                });
            });

        new Setting(containerEl)
            .setName('字体大小')
            .setDesc('悬浮窗口中文字的大小 (px)')
            .addSlider(slider => {
                slider.setLimits(10, 100, 1)
                    .setValue(this.plugin.settings.fontSize)
                    .setDynamicTooltip()
                    .onChange((value) => {
                        this.plugin.settings.fontSize = value;
                        this.plugin.saveSettings().catch(console.error);
                    });
            });

        new Setting(containerEl)
            .setName('窗口圆角')
            .setDesc('悬浮窗口的圆角大小 (px)')
            .addSlider(slider => {
                slider.setLimits(0, 150, 1)
                    .setValue(this.plugin.settings.borderRadius)
                    .setDynamicTooltip()
                    .onChange((value) => {
                        this.plugin.settings.borderRadius = value;
                        this.plugin.saveSettings().catch(console.error);
                    });
            });

        // 修复：移除所有会触发报错的 .display()，改存取 Component 的原生赋值方法
        let bgPickerComponent: ColorComponent | undefined;
        new Setting(containerEl)
            .setName('背景颜色')
            .setDesc('自定义悬浮窗口的背景颜色')
            .addButton(btn => btn
                .setButtonText('恢复默认')
                .setTooltip('恢复为主题自带背景色')
                .onClick(() => {
                    this.plugin.settings.backgroundColor = "";
                    this.plugin.saveSettings().catch(console.error);
                    bgPickerComponent?.setValue('#000000');
                }))
            .addColorPicker(picker => {
                bgPickerComponent = picker;
                picker.setValue(this.plugin.settings.backgroundColor || '#000000')
                .onChange((value) => {
                    this.plugin.settings.backgroundColor = value;
                    this.plugin.saveSettings().catch(console.error);
                });
            });

        let textPickerComponent: ColorComponent | undefined;
        new Setting(containerEl)
            .setName('字体颜色')
            .setDesc('自定义悬浮窗口的字体颜色。开启“统一文本样式”时也会覆盖强制为该颜色。')
            .addButton(btn => btn
                .setButtonText('恢复默认')
                .setTooltip('恢复为主题自带文字色')
                .onClick(() => {
                    this.plugin.settings.textColor = "";
                    this.plugin.saveSettings().catch(console.error);
                    textPickerComponent?.setValue('#cccccc');
                }))
            .addColorPicker(picker => {
                textPickerComponent = picker;
                picker.setValue(this.plugin.settings.textColor || '#cccccc')
                .onChange((value) => {
                    this.plugin.settings.textColor = value;
                    this.plugin.saveSettings().catch(console.error);
                });
            });

        new Setting(containerEl)
            .setName('统一文本样式 (忽略 Markdown)')
            .setDesc('默认关闭。开启后将强制抹除标题内的粗体、斜体、双链接等排版样式，使其完全混入右侧的普通文本。')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.ignoreMarkdownStyle)
                    .onChange((value) => {
                        this.plugin.settings.ignoreMarkdownStyle = value;
                        this.plugin.saveSettings().catch(console.error);
                    });
            });

        // 修复：依赖项动态折叠使用 setCssStyles 代替 UI 重新实例化渲染
        let maxWidthSetting: Setting | undefined;
        new Setting(containerEl)
            .setName('无限制窗口长度')
            .setDesc('勾选后窗口长度随标题文字自动延伸。取消勾选可限制最大长度。')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.isWidthUnlimited)
                    .onChange((value) => {
                        this.plugin.settings.isWidthUnlimited = value;
                        this.plugin.saveSettings().catch(console.error);
                        this.plugin.forceUpdateHeaders();
                        if (maxWidthSetting) {
                            maxWidthSetting.settingEl.setCssStyles({ display: value ? 'none' : '' });
                        }
                    });
            });

        maxWidthSetting = new Setting(containerEl)
            .setName('窗口最大长度')
            .setDesc('设置悬浮窗口的最大长度 (px)，标题超出时会自动省略 (...)。')
            .addSlider(slider => {
                slider.setLimits(100, 1000, 10)
                    .setValue(this.plugin.settings.maxWidth)
                    .setDynamicTooltip()
                    .onChange((value) => {
                        this.plugin.settings.maxWidth = value;
                        this.plugin.saveSettings().then(() => this.plugin.forceUpdateHeaders()).catch(console.error);
                    });
            });
        
        // 初始显隐状态设置
        maxWidthSetting.settingEl.setCssStyles({ display: this.plugin.settings.isWidthUnlimited ? 'none' : '' });

        new Setting(containerEl)
            .setName('锁定窗口位置')
            .setDesc('你也可以在悬浮窗口上点击【右键】直接锁定/解锁。')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.isLocked)
                    .onChange((value) => {
                        this.plugin.settings.isLocked = value;
                        this.plugin.saveSettings().catch(console.error);
                    });
            });
    }
}