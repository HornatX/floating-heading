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
    setIcon
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
    isManuallyHidden: boolean; // 【新增】：记录窗口显隐状态
}

const DEFAULT_SETTINGS: FloatingHeadingSettings = {
    headingLevel: 2,
    fontSize: 20,
    borderRadius: 8,
    isLocked: false,
    posX: 50,
    posY: 50,
    isWidthUnlimited: true,
    maxWidth: 300,
    isManuallyHidden: false // 【新增】：默认不隐藏
};

const headingExp = /^HyperMD-header_HyperMD-header-(\d)$/;

function getDistanceFromContentToScroller(view: EditorView): number {
    const scroller = view.scrollDOM;
    const contentContainer = view.scrollDOM.querySelector(`.cm-content`) as HTMLElement | null;
    let distance = 0;
    if (scroller == null || contentContainer == null) {
        return distance;
    }
    let currentElement: HTMLElement | null = contentContainer;
    while (currentElement != null && currentElement !== scroller) {
        distance += currentElement.offsetTop;
        currentElement = currentElement.offsetParent as HTMLElement | null;
    }
    return distance;
}

// 节流函数类型化
function throttle<T extends (...args: any[]) => void>(func: T, limit: number): T {
    let inThrottle: boolean;
    return function (this: any, ...args: any[]) {
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            window.setTimeout(() => inThrottle = false, limit); // 使用 window.setTimeout
        }
    } as T;
}

export default class FloatingHeadingPlugin extends Plugin {
    settings: FloatingHeadingSettings;
    floatingContainer: HTMLDivElement | null = null;
    currentHeadingText: string | null = null;
    currentHeadingPos: number | null = null;
    activeEditorView: EditorView | null = null;
    isValidFile: boolean = false;
    headingTrackerInstance: any = null; // 引用当前的 tracker 实例

    resizeHandleRight!: HTMLDivElement;
    resizeHandleBottom!: HTMLDivElement;
    resizeHandleCorner!: HTMLDivElement;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'toggle-floating-heading',
            name: '切换悬浮标题窗口显隐',
            callback: async () => { // 【注意】：加上 async
                // 修改 settings 里的状态
                this.settings.isManuallyHidden = !this.settings.isManuallyHidden;
                // 保存到本地文件 (data.json)
                await this.saveSettings(); 
                
                this.updateVisibility();
                new Notice(this.settings.isManuallyHidden ? "悬浮标题已隐藏" : "悬浮标题已显示", 1500);
            }
        });

        this.addSettingTab(new FloatingHeadingSettingTab(this.app, this));
        this.registerEditorExtension([this.createHeadingTrackerPlugin()]);
        this.createFloatingWindow();

        this.registerEvent(
            this.app.workspace.on('file-open', (file: TFile | null) => {
                this.checkActiveFile(file);
            })
        );
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.checkActiveFile(this.app.workspace.getActiveFile());
            })
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

        // 【修改】：使用 this.settings.isManuallyHidden 进行判断
        const shouldShow = !this.settings.isManuallyHidden && this.isValidFile;

        if (shouldShow) {
            this.floatingContainer.style.display = '';
        } else {
            this.floatingContainer.style.display = 'none';
        }
    }

    checkActiveFile(file: TFile | null) {
        const previousValidity = this.isValidFile;

        // 获取当前激活的视图类型
        const activeView = this.app.workspace.getActiveViewOfType(View);
        const viewType = activeView ? activeView.getViewType() : "";

        // 定义要拦截的视图类型 (白板 canvas, 看板 kanban, 数据库类 database/dbfolder)
        const excludedViewTypes = ['canvas', 'kanban', 'database', 'dbfolder'];

        if (!file) {
            this.isValidFile = false;
        } else if (excludedViewTypes.includes(viewType)) {
            // 通过视图类型拦截
            this.isValidFile = false;
        } else if (file.extension !== 'md') {
            this.isValidFile = false;
        } else {
            // 通过元数据 (frontmatter) 进一步精准拦截
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter || {};

            // 使用 in 操作符检查属性是否存在
            const isKanban = 'kanban-plugin' in frontmatter;
            const isDatabase = 'database-plugin' in frontmatter;

            if (isKanban || isDatabase) {
                this.isValidFile = false;
            } else {
                this.isValidFile = true;
            }
        }

        if (!this.isValidFile) {
            this.currentHeadingText = null;
            this.updateVisibility();
        } else if (this.isValidFile && !previousValidity) {
            this.forceUpdateHeaders();
        }
    }

    forceUpdateHeaders() {
        this.currentHeadingText = null; // 确保立刻重绘
        if (this.headingTrackerInstance && this.isValidFile && this.activeEditorView) {
            this.headingTrackerInstance.updateHeaders(this.activeEditorView);
        }
    }

    updateHeadingData(text: string, pos: number | null, editorView: EditorView) {
        if (!this.floatingContainer) return;
        if (!this.isValidFile) return;

        this.activeEditorView = editorView;
        this.currentHeadingPos = pos;

        if (text !== this.currentHeadingText) {
            this.currentHeadingText = text;
            Array.from(this.floatingContainer.childNodes).forEach(child => {
                const el = child as HTMLElement;
                if (!el.hasClass('resize-handle')) {
                    el.remove();
                }
            });

            if (text) {
                // --- 正常标题模式 ---
                this.floatingContainer.removeClass('is-empty-logo');

                const textDiv = this.floatingContainer.createDiv({ cls: 'floating-heading-text' });
                MarkdownRenderer.render(this.app, text, textDiv, "", this as any);

                const innerP = textDiv.querySelector('p');
                if (innerP) {
                    innerP.style.margin = '0';
                    innerP.style.overflow = 'hidden';
                    innerP.style.textOverflow = 'ellipsis';
                    innerP.style.whiteSpace = 'nowrap';
                }
            } else {
                // --- Logo 模式：使用对应层级的官方 Lucide Icon ---
                this.floatingContainer.addClass('is-empty-logo');

                const iconDiv = this.floatingContainer.createDiv({ cls: 'floating-heading-icon' });
                // 根据当前设置的标题级别，渲染对应的 H1 - H6 图标
                setIcon(iconDiv, `heading-${this.settings.headingLevel}`);
            }

            // 每次内容变化后必须调用样式更新，来决定它是长条还是正圆
            this.updateFloatingWindowStyle();
            this.updateVisibility();
        }
    }

    updateFloatingWindowStyle() {
        if (!this.floatingContainer) return;

        const el = this.floatingContainer;
        el.style.left = `${this.settings.posX}px`;
        el.style.top = `${this.settings.posY}px`;
        el.style.fontSize = `${this.settings.fontSize}px`;

        if (el.hasClass('is-empty-logo')) {
            const size = this.settings.fontSize + 16;
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.style.maxWidth = 'none';
            el.style.borderRadius = '50%';
            el.style.padding = '0';
        } else {
            el.style.height = 'auto';
            el.style.padding = '8px 16px';
            el.style.borderRadius = `${this.settings.borderRadius}px`;

            if (this.settings.isWidthUnlimited) {
                el.style.maxWidth = 'none';
                el.style.width = 'max-content';
            } else {
                el.style.maxWidth = `${this.settings.maxWidth}px`;
                el.style.width = 'max-content';
            }
        }

        if (this.settings.isLocked) {
            el.removeClass('is-draggable');
            el.addClass('is-locked');
        } else {
            el.removeClass('is-locked');
            el.addClass('is-draggable');
        }
    }

    createFloatingWindow() {
        if (this.floatingContainer) return;

        this.floatingContainer = document.body.createDiv({ cls: 'floating-heading-container' });
        this.floatingContainer.style.display = 'none';

        this.resizeHandleRight = this.floatingContainer.createDiv({ cls: 'resize-handle right' });
        this.resizeHandleBottom = this.floatingContainer.createDiv({ cls: 'resize-handle bottom' });
        this.resizeHandleCorner = this.floatingContainer.createDiv({ cls: 'resize-handle corner' });

        this.updateFloatingWindowStyle();
        this.setupDraggingAndClick(this.floatingContainer);
        this.setupResizing();

        this.floatingContainer.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            const menu = new Menu();

            menu.addItem((item) => {
                item.setTitle(this.settings.isLocked ? "解锁窗口" : "锁定窗口")
                    .setIcon(this.settings.isLocked ? "unlock" : "lock")
                    .onClick(async () => {
                        this.settings.isLocked = !this.settings.isLocked;
                        await this.saveSettings();
                        new Notice(this.settings.isLocked ? "悬浮标题已锁定 🔒" : "悬浮标题已解锁 🔓", 1500);
                    });
            });

            menu.addSeparator();

            menu.addItem((item) => {
                item.setTitle("更改显示标题层级").setIcon("heading");

                const submenu = (item as any).setSubmenu();
                for (let i = 1; i <= 6; i++) {
                    submenu.addItem((subItem: any) => {
                        subItem.setTitle(`H${i}`)
                            .setChecked(this.settings.headingLevel === i)
                            .onClick(async () => {
                                this.settings.headingLevel = i;
                                await this.saveSettings();
                                this.forceUpdateHeaders();
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
            const target = e.target as HTMLElement;
            if (this.settings.isLocked) return;
            if (!target.hasClass('resize-handle')) return;

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

            if (currentHandle.hasClass('right') || currentHandle.hasClass('corner')) {
                if (!this.floatingContainer.hasClass('is-empty-logo')) {
                    this.settings.isWidthUnlimited = false;
                    this.settings.maxWidth = Math.max(80, startMaxWidth + dx);
                    this.floatingContainer.style.maxWidth = `${this.settings.maxWidth}px`;
                    this.floatingContainer.style.width = `max-content`;
                }
            }

            if (currentHandle.hasClass('bottom') || currentHandle.hasClass('corner')) {
                let newFontSize = Math.round(startFontSize + (dy / 1.5));
                newFontSize = Math.max(10, Math.min(newFontSize, 100));
                this.settings.fontSize = newFontSize;
                this.floatingContainer.style.fontSize = `${this.settings.fontSize}px`;

                if (this.floatingContainer.hasClass('is-empty-logo')) {
                    const size = this.settings.fontSize + 16;
                    this.floatingContainer.style.width = `${size}px`;
                    this.floatingContainer.style.height = `${size}px`;
                }
            }
        };

        const onMouseUp = async () => {
            if (isResizing) {
                isResizing = false;
                currentHandle = null;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                await this.saveSettings();
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
            const target = e.target as HTMLElement;
            if (e.button !== 0) return;
            if (target.hasClass('resize-handle')) return;

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

            el.style.left = `${this.settings.posX}px`;
            el.style.top = `${this.settings.posY}px`;
        };

        const onMouseUp = async () => {
            if (isDragging) {
                isDragging = false;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                if (hasMoved) {
                    await this.saveSettings();
                }
            }
        };

        el.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (e.button !== 0) return;
            if (target.hasClass('resize-handle')) return;

            if (!hasMoved && this.activeEditorView && this.currentHeadingPos !== null) {
                this.activeEditorView.dispatch({
                    effects: EditorView.scrollIntoView(this.currentHeadingPos, { y: "start" })
                });
            }
        });

        el.addEventListener('mousedown', onMouseDown);
    }

    createHeadingTrackerPlugin() {
        const plugin = this;

        class HeadingTracker implements PluginValue {
            view: EditorView;
            cachedDistance: number;
            scrollHandler: EventListener;
            updateTimeout?: number;

            constructor(editorView: EditorView) {
                this.view = editorView;
                this.cachedDistance = getDistanceFromContentToScroller(editorView);
                plugin.headingTrackerInstance = this;

                this.scrollHandler = throttle(this.handleScroll.bind(this), 100);
                this.view.scrollDOM.addEventListener("scroll", this.scrollHandler, { passive: true });

                this.updateHeaders(this.view);
            }

            update(update: ViewUpdate) {
                if (update.geometryChanged) {
                    this.cachedDistance = getDistanceFromContentToScroller(update.view);
                }

                if (update.docChanged || update.geometryChanged) {
                    if (this.updateTimeout) window.clearTimeout(this.updateTimeout); // 使用 window.clearTimeout
                    this.updateTimeout = window.setTimeout(() => {
                        this.updateHeaders(update.view);
                    }, 100);
                }
            }

            destroy() {
                this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
                if (this.updateTimeout) window.clearTimeout(this.updateTimeout);
                if (plugin.headingTrackerInstance === this) {
                    plugin.headingTrackerInstance = null;
                }
            }

            handleScroll() {
                this.updateHeaders(this.view);
            }

            updateHeaders(editorView: EditorView) {
                if (!editorView || !plugin.isValidFile) return;

                let foundText = "";
                let foundPos: number | null = null;

                editorView.requestMeasure({
                    read: () => {
                        let height = editorView.scrollDOM.scrollTop - this.cachedDistance + 10;

                        if (height > 0) {
                            const firstElementBlockInfo = editorView.elementAtHeight(height);
                            if (firstElementBlockInfo) {
                                const targetLevel = plugin.settings.headingLevel;

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
                        plugin.updateHeadingData(foundText, foundPos, editorView);
                    }
                });
            }
        }

        return ViewPlugin.fromClass(HeadingTracker);
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

        containerEl.createEl('h2', { text: '悬浮标题设置' });

        new Setting(containerEl)
            .setName('显示的标题层级')
            .setDesc('选择要在悬浮窗口中显示的标题级别')
            .addDropdown(drop => {
                drop.addOption('1', 'H1');
                drop.addOption('2', 'H2');
                drop.addOption('3', 'H3');
                drop.addOption('4', 'H4');
                drop.addOption('5', 'H5');
                drop.addOption('6', 'H6');
                drop.setValue(this.plugin.settings.headingLevel.toString());
                drop.onChange(async (value) => {
                    this.plugin.settings.headingLevel = Number(value);
                    await this.plugin.saveSettings();
                    this.plugin.forceUpdateHeaders();
                });
            });

        new Setting(containerEl)
            .setName('字体大小')
            .setDesc('悬浮窗口中文字的大小 (px)')
            .addSlider(slider => {
                slider.setLimits(10, 100, 1)
                    .setValue(this.plugin.settings.fontSize)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.fontSize = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('窗口圆角')
            .setDesc('悬浮窗口的圆角大小 (px)')
            .addSlider(slider => {
                slider.setLimits(0, 30, 1)
                    .setValue(this.plugin.settings.borderRadius)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.borderRadius = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('无限制窗口长度')
            .setDesc('勾选后窗口长度随标题文字自动延伸。取消勾选可限制最大长度。')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.isWidthUnlimited)
                    .onChange(async (value) => {
                        this.plugin.settings.isWidthUnlimited = value;
                        await this.plugin.saveSettings();
                        this.display();
                        this.plugin.forceUpdateHeaders();
                    });
            });

        if (!this.plugin.settings.isWidthUnlimited) {
            new Setting(containerEl)
                .setName('窗口最大长度')
                .setDesc('设置悬浮窗口的最大长度 (px)，标题超出时会自动省略 (...)。')
                .addSlider(slider => {
                    slider.setLimits(100, 1000, 10)
                        .setValue(this.plugin.settings.maxWidth)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.plugin.settings.maxWidth = value;
                            await this.plugin.saveSettings();
                            this.plugin.forceUpdateHeaders();
                        });
                });
        }

        new Setting(containerEl)
            .setName('锁定窗口位置')
            .setDesc('你也可以在悬浮窗口上点击【右键】直接锁定/解锁。')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.isLocked)
                    .onChange(async (value) => {
                        this.plugin.settings.isLocked = value;
                        await this.plugin.saveSettings();
                    });
            });
    }
}