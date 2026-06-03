Floating Heading (悬浮标题)

适用于 Obsidian
的当前标题悬浮追踪插件。在阅读或编辑长笔记时，为您在页面边缘提供一个可移动、可自适应的悬浮指示器，帮助您快速了解当前所处的笔记章节位置并一键返回。

功能特点

  - 标题层级追踪：可自由设定需要追踪并显示的标题级别（H1 到
    H6）。随着页面滚动，悬浮窗将实时反映当前视野上方的最新标题内容，点击该窗口可一键跳转回该标题位置。
  - 自适应 Logo 模式：当笔记上方没有对应级别的标题时，悬浮窗会自动缩起，变为精简的圆形图标，减少对正文的视觉干扰。
  - 直观的交互调节：
      - 支持任意位置拖拽移动。
      - 支持拖拽边缘实时调整字体大小与最大宽度限制。
      - 右键点击悬浮窗可直接呼出快捷菜单，进行快速锁定位置或切换当前追踪的标题级别。
  - 智能视图兼容：自动识别并避开 Canvas（白板）、Kanban（看板）以及第三方
    Database（数据库）等特殊视图，避免在非传统文本编辑区造成视觉混乱。

安装方法

社区插件安装

待插件正式上架后，可在 Obsidian 内直接安装：

1.  打开 Obsidian 设置 > 社区插件。
2.  点击 浏览 并搜索 Floating Heading。
3.  点击 安装，随后启用。

手动安装

1.  下载最新发布的构建包（main.js, manifest.json, styles.css）。
2.  在您的库中创建插件目录：<库路径>/.obsidian/plugins/floating-heading/。
3.  将下载的文件放入该目录中。
4.  打开 Obsidian 设置 > 社区插件，开启该插件。

使用说明

1.  开启插件后，页面上会出现一个带有当前设置标题层级（默认 H2）图标或文字的悬浮窗。
2.  移动位置：直接左键按住悬浮窗非边缘区域拖拽即可。
3.  调整大小：在非锁定状态下，将鼠标指针悬停于悬浮窗边缘，按住右侧或底部边缘手柄拖动，即可调整窗口最大宽度或文字大小。
4.  快速操作：在悬浮窗上点击 右键，可快速锁定当前位置（防止误触移动）或更改要追踪的标题级别。
5.  快捷键显隐：支持通过命令面板或为其绑定快捷键，快速切换悬浮窗的显示或隐藏。

English

An Obsidian plugin that displays a customizable floating indicator tracking the
active heading as you read or edit long notes, helping you maintain context and
quickly jump back to sections.

Features

  - Active Heading Tracking: Tracks your chosen heading level (H1 to H6). As you
    scroll through a note, the indicator dynamically updates to display the
    active section header. Click it to scroll instantly back to that heading.
  - Adaptive Logo Mode: When no heading of your target level is currently in
    view, the floating container automatically collapses into a compact, round
    icon, reducing visual clutter.
  - Intuitive Interactions:
      - Drag anywhere on the container to reposition it freely.
      - Drag the handles on the edges to resize the font size and customize the
        maximum width constraint in real time.
      - Right-click the container to open a context menu for locking its
        position or changing the tracked heading level on the fly.
  - Smart View Interception: Automatically detects and bypasses Canvas, Kanban,
    and Database views to prevent interface layout issues in specialized
    workspaces.

Installation

Community Plugins

Once approved, you can install this plugin directly within Obsidian:

1.  Open Obsidian Settings > Community plugins.
2.  Click Browse and search for Floating Heading.
3.  Click Install, then Enable.

Manual Installation

1.  Download the compiled files (main.js, manifest.json, styles.css) from the
    release page.
2.  Create a folder named floating-heading under your vault's plugin directory:
    <vault>/.obsidian/plugins/floating-heading/.
3.  Copy the downloaded files into that folder.
4.  Go to Obsidian Settings > Community plugins and enable the plugin.

Usage

1.  Upon enablement, a floating window showing either the heading content or its
    level icon (defaulting to H2) will appear on your screen.
2.  Move: Click and drag the main body of the container to position it anywhere
    in your workspace.
3.  Resize: When unlocked, hover over the edges and drag the right or bottom
    handles to scale the font size or adjust the maximum width.
4.  Quick Menu: Right-click the container to lock/unlock its position or switch
    the active heading level.
5.  Toggle Command: Use the Command Palette or assign a hotkey to easily show or
    hide the floating window whenever needed.
