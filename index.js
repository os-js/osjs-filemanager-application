/*!
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2020, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */

import osjs from 'osjs';
import {h, app} from 'hyperapp';

import './index.scss';
import * as translations from './locales.js';
import {name as applicationName} from './metadata.json';
import {
  Box,
  Button,
  TextField,
  Toolbar,
  Menubar,
  MenubarItem,
  Statusbar,
  Panes,
  listView
} from '@osjs/gui';

/**
 * Creates default settings
 */
const createDefaultSettings =  () => ({
  showHiddenFiles: false,
  showDate: false
});

/**
 * Creates the default window options
 */
const createWindowOptions = (core, proc, title) => ({
  id: 'FileManager',
  icon: proc.resource(proc.metadata.icon),
  title,
  attributes: {
    mediaQueries: {
      small: 'screen and (max-width: 400px)'
    }
  },
  dimension: Object.assign({
    width: 400,
    height: 400
  }, core.config('filemanager.defaultWindowSize', {})),
});

/**
 * Diverts callback based on drop action event
 */
const divertDropAction = (browser, virtual) => (ev, data, files) => {
  if (files.length) {
    browser(files);
  } else if (data && data.path && data.filename) {
    virtual(data);
  }
};

/**
 * HoF for dialogs
 */
const usingPositiveButton = cb => (btn, value) => {
  if (['yes', 'ok'].indexOf(btn) !== -1) {
    cb(value);
  }
};

/**
 * Triggers a browser upload
 */
const triggerBrowserUpload = (cb) => {
  const field = document.createElement('input');
  field.type = 'file';
  field.onchange = () => {
    if (field.files.length > 0) {
      cb(field.files);
    }
  };
  field.click();
};

/**
 * Checks if given fielname is a dotted
 */
const isSpecialFile = filename => ['..', '.'].indexOf(filename) !== -1;

/**
 * Creates initial paths
 */
const createInitialPaths = (core, proc) => {
  const homePath = {path: core.config('vfs.defaultPath', 'home:/')};
  const initialPath = proc.args.path
    ? Object.assign({}, homePath, proc.args.path)
    : homePath;

  return {homePath, initialPath};
};

/**
 * Formats file status message
 */
const formatFileMessage = file => `${file.filename} (${file.size} bytes)`;

/**
 * Formats directory status message
 */
const formatStatusMessage = (path, files) => {
  const directoryCount = files.filter(f => f.isDirectory).length;
  const fileCount = files.filter(f => !f.isDirectory).length;
  const totalSize = files.reduce((t, f) => t + (f.size || 0), 0);

  return `${directoryCount} directories, ${fileCount} files, ${totalSize} bytes total`;
};

/**
 * Mount view rows Factory
 */
const mountViewRowsFactory = (core) => {
  const fs = core.make('osjs/fs');
  const getMountpoints = () => fs.mountpoints(true);

  return () => getMountpoints().map(m => ({
    columns: [{
      icon: m.icon,
      label: m.label
    }],
    data: m
  }));
};

/**
 * File view columns Factory
 */
const listViewColumnFactory = (core, proc, settings) => {
  return () => {
    const columns = [{
      label: 'Name',
      style: {
        minWidth: '20em'
      }
    }];

    if (settings.showDate) {
      columns.push({
        label: 'Date'
      });
    }

    return [
      ...columns,
      {
        label: 'Type',
        style: {
          maxWidth: '150px'
        }
      }, {
        label: 'Size',
        style: {
          flex: '0 0 7em',
          textAlign: 'right'
        }
      }
    ];
  };
};

/**
 * File view rows Factory
 */
const listViewRowFactory = (core, proc, settings) => {
  const fs = core.make('osjs/fs');
  const {format: formatDate} = core.make('osjs/locale');
  const getFileIcon = file => file.icon || fs.icon(file);

  const formattedDate = f => {
    if (f.stat) {
      const rawDate = f.stat.mtime || f.stat.ctime;
      if (rawDate) {
        try {
          const d = new Date(rawDate);
          return `${formatDate(d, 'shortDate')} ${formatDate(d, 'shortTime')}`;
        } catch (e) {
          return rawDate;
        }
      }
    }

    return '';
  };

  return (list) => list.map(f => {
    const columns = [{
      label: f.filename,
      icon: getFileIcon(f)
    }];

    if (settings.showDate) {
      columns.push(formattedDate(f));
    }

    return {
      key: f.path,
      data: f,
      columns: [
        ...columns,
        f.mime,
        f.humanSize
      ]
    };
  });
};

/**
 * VFS action Factory
 */
const vfsActionFactory = (core, proc, win, dialog, settings, state) => {
  const vfs = core.make('osjs/vfs');
  const {pathJoin} = core.make('osjs/fs');

  const refresh = (fileOrWatch) => {
    // FIXME This should be implemented a bit better
    if (fileOrWatch === true && core.config('vfs.watch')) {
      return;
    }

    proc.emit('filemanager:readdir', state.currentPath, undefined, fileOrWatch);
  };

  const action = async (promiseCallback, refreshValue, defaultError) => {
    try {
      win.setState('loading', true);

      const result = await promiseCallback();
      refresh(refreshValue);
      return result;
    } catch (error) {
      dialog('error', error, defaultError || 'An error occured');
    } finally {
      win.setState('loading', false);
    }

    return [];
  };

  const writeRelative = f => vfs.writefile({
    path: pathJoin(state.currentPath.path, f.name)
  }, f);

  const uploadBrowserFiles = (files) => {
    Promise.all(files.map(writeRelative))
      .then(() => refresh(files[0].name)) // FIXME: Select all ?
      .catch(error => dialog('error', error, 'Failed to upload file(s)'));
  };

  const uploadVirtualFile = (data) => {
    const dest = {path: pathJoin(state.currentPath.path, data.filename)};
    if (dest.path !== data.path) {
      action(() => vfs.copy(data, dest), true, 'Failed to upload file(s)');
    }
  };

  const drop = divertDropAction(uploadBrowserFiles, uploadVirtualFile);

  const readdir = async (dir, history, selectFile) => {
    if (win.getState('loading')) {
      return;
    }

    try {
      const message = `Loading ${dir.path}`;
      const options = {
        showHiddenFiles: settings.showHiddenFiles
      };

      win.setState('loading', true);
      win.emit('filemanagerWindow:status', message);

      const list = await vfs.readdir(dir, options);

      // NOTE: This sets a restore argument in the application session
      proc.args.path = dir.path;

      state.currentPath = dir;

      if (typeof history === 'undefined' || history === false) {
        win.emit('filemanagerWindow:historyPush', dir);
      } else if (history ===  'clear') {
        win.emit('filemanagerWindow:historyClear');
      }

      win.emit('filemanagerWindow:readdir', {list, path: dir.path, selectFile});
      win.emit('filemanagerWindow:title', dir.path);
    } catch (error) {
      dialog('error', error, `An error occured while reading directory: ${dir.path}`);
    } finally {
      state.currentFile = undefined;
      win.setState('loading', false);
    }
  };

  const upload = () => triggerBrowserUpload(files => {
    writeRelative(files[0])
      .then(() => refresh(files[0].name))
      .catch(error => dialog('error', error, 'Failed to upload file(s)'));
  });

  const paste = (move, currentPath) => ({item, callback}) => {
    const dest = {path: pathJoin(currentPath.path, item.filename)};

    const fn = move
      ? vfs.move(item, dest)
      : vfs.copy(item, dest);

    return fn
      .then(() => {
        refresh(true);

        if (typeof callback === 'function') {
          callback();
        }
      })
      .catch(error => dialog('error', error, 'Failed to paste file(s)'));
  };

  return {
    download: file => vfs.download(file),
    upload,
    refresh,
    action,
    drop,
    readdir,
    paste
  };
};

/**
 * Dialog Factory
 */
const dialogFactory = (core, proc, win) => {
  const vfs = core.make('osjs/vfs');
  const {pathJoin} = core.make('osjs/fs');

  const dialog = (name, args, cb) => core.make('osjs/dialog', name, args, {
    parent: win,
    attributes: {modal: true}
  }, cb);

  const mkdirDialog = (action, currentPath) => dialog('prompt', {
    message: 'Create new directory',
    value: 'New directory'
  }, usingPositiveButton(value => {
    const newPath = pathJoin(currentPath.path, value);
    action(() => vfs.mkdir({path: newPath}), value, 'Failed to create directory');
  }));

  const renameDialog = (action, file) => dialog('prompt', {
    message: `Rename ${file.filename}`,
    value: file.filename
  }, usingPositiveButton(value => {
    const idx = file.path.lastIndexOf(file.filename);
    const newPath = file.path.substr(0, idx) + value;

    action(() => vfs.rename(file, {path: newPath}), value, 'Failed to rename');
  }));

  const deleteDialog = (action, file) => dialog('confirm', {
    message: `Delete ${file.filename}`
  }, usingPositiveButton(() => {
    action(() => vfs.unlink(file), true, 'Failed to delete');
  }));

  const errorDialog = (error, message) => dialog('alert', {
    type: 'error',
    error,
    message
  }, () => {});

  const dialogs = {
    mkdir: mkdirDialog,
    rename: renameDialog,
    delete: deleteDialog,
    error: errorDialog
  };

  return (name, ...args) => {
    if (dialogs[name]) {
      dialogs[name](...args);
    } else {
      throw new Error(`Invalid dialog: ${name}`);
    }
  };
};

/**
 * Creates Menus
 */
const menuFactory = (core, proc, win, settings) => {
  const fs = core.make('osjs/fs');
  const clipboard = core.make('osjs/clipboard');
  const contextmenu = core.make('osjs/contextmenu');
  const {translate: _, translatable} = core.make('osjs/locale');

  const __ = translatable(translations);
  const getMountpoints = () => fs.mountpoints(true);

  const createFileMenu = () => ([
    {label: _('LBL_UPLOAD'), onclick: () => win.emit('filemanagerWindow:menu:upload')},
    {label: _('LBL_MKDIR'), onclick: () => win.emit('filemanagerWindow:menu:mkdir')},
    {label: _('LBL_QUIT'), onclick: () => win.emit('filemanagerWindow:menu:quit')}
  ]);

  const createEditMenu = (item, isContextMenu) => {
    const emitter = name => win.emit(name, item);

    if (item && isSpecialFile(item.filename)) {
      return [{
        label: _('LBL_GO'),
        onclick: () => emitter('filemanagerWindow:navigate')
      }];
    }

    const isValidFile = item && !isSpecialFile(item.filename);
    const isDirectory = item && item.isDirectory;

    const openMenu = isDirectory ? [{
      label: _('LBL_GO'),
      disabled: !item,
      onclick: () => emitter('filemanagerWindow:navigate')
    }] : [{
      label: _('LBL_OPEN'),
      disabled: !item,
      onclick: () => emitter('filemanagerWindow:open')
    }, {
      label: __('LBL_OPEN_WITH'),
      disabled: !item,
      onclick: () => emitter('filemanagerWindow:openWith')
    }];

    const clipboardMenu = [{
      label: _('LBL_COPY'),
      disabled: !isValidFile,
      onclick: () => emitter('filemanagerWindow:menu:copy')
    }, {
      label: _('LBL_CUT'),
      disabled: !isValidFile,
      onclick: () => emitter('filemanagerWindow:menu:cut')
    }];

    if (!isContextMenu) {
      clipboardMenu.push({
        label: _('LBL_PASTE'),
        disabled: !clipboard.has(/^filemanager:/),
        onclick: () => emitter('filemanagerWindow:menu:paste')
      });
    }

    return [
      ...openMenu,
      {
        label: _('LBL_RENAME'),
        disabled: !isValidFile,
        onclick: () => emitter('filemanagerWindow:menu:rename')
      },
      {
        label: _('LBL_DELETE'),
        disabled: !isValidFile,
        onclick: () => emitter('filemanagerWindow:menu:delete')
      },
      ...clipboardMenu,
      {
        label: _('LBL_DOWNLOAD'),
        disabled: !item || isDirectory || !isValidFile,
        onclick: () => emitter('filemanagerWindow:menu:download')
      }
    ];
  };

  const createViewMenu = (state) => ([
    {label: _('LBL_REFRESH'), onclick: () => win.emit('filemanagerWindow:menu:refresh')},
    {label: __('LBL_MINIMALISTIC'), checked: state.minimalistic, onclick: () => win.emit('filemanagerWindow:menu:toggleMinimalistic')},
    {label: __('LBL_SHOW_DATE'), checked: settings.showDate, onclick: () => win.emit('filemanagerWindow:menu:showDate')},
    {label: __('LBL_SHOW_HIDDEN_FILES'), checked: settings.showHiddenFiles, onclick: () => win.emit('filemanagerWindow:menu:showHidden')}
  ]);

  const createGoMenu = () => getMountpoints().map(m => ({
    label: m.label,
    icon: m.icon,
    onclick: () => win.emit('filemanagerWindow:navigate', {path: m.root})
  }));

  const menuItems = {
    file: createFileMenu,
    edit: createEditMenu,
    view: createViewMenu,
    go: createGoMenu
  };

  return ({name, ev}, args, isContextMenu = false) => {
    if (menuItems[name]) {
      contextmenu.show({
        menu: menuItems[name](args, isContextMenu),
        position: isContextMenu ? ev : ev.target
      });
    } else {
      throw new Error(`Invalid menu: ${name}`);
    }
  };
};

/**
 * Creates a new FileManager user interface view
 */
const createView = (core, proc, win) => {
  const {icon} = core.make('osjs/theme');
  const {translate: _} = core.make('osjs/locale');

  const onMenuClick = (name, args) => ev => win.emit('filemanagerWindow:menu', {ev, name}, args);
  const onInputEnter = (ev, value) => win.emit('filemanagerWindow:navigate', {path: value});

  const canGoBack = ({list, index}) => !list.length || index <= 0;
  const canGoForward = ({list, index}) => !list.length || (index === list.length - 1);

  return (state, actions) => {
    const FileView = listView.component(state.fileview, actions.fileview);
    const MountView = listView.component(state.mountview, actions.mountview);

    return h(Box, {
      class: state.minimalistic ? 'osjs-filemanager-minimalistic' : ''
    }, [
      h(Menubar, {}, [
        h(MenubarItem, {onclick: onMenuClick('file')}, _('LBL_FILE')),
        h(MenubarItem, {onclick: onMenuClick('edit')}, _('LBL_EDIT')),
        h(MenubarItem, {onclick: onMenuClick('view', state)}, _('LBL_VIEW')),
        h(MenubarItem, {onclick: onMenuClick('go')}, _('LBL_GO'))
      ]),
      h(Toolbar, {}, [
        h(Button, {
          title: _('LBL_BACK'),
          icon: icon('go-previous'),
          disabled: canGoBack(state.history),
          onclick: () => actions.history.back()
        }),
        h(Button, {
          title: _('LBL_FORWARD'),
          icon: icon('go-next'),
          disabled: canGoForward(state.history),
          onclick: () => actions.history.forward()
        }),
        h(Button, {
          title: _('LBL_HOME'),
          icon: icon('go-home'),
          onclick: () => win.emit('filemanagerWindow:home')
        }),
        h(TextField, {
          value: state.path,
          box: {grow: 1, shrink: 1},
          onenter: onInputEnter
        })
      ]),
      h(Panes, {style: {flex: '1 1'}}, [
        h(MountView),
        h(FileView)
      ]),
      h(Statusbar, {}, h('span', {}, state.status))
    ]);
  };
};

/**
 * Creates a new FileManager user interface
 */
const createApplication = (core, proc, settings) => {
  const createColumns = listViewColumnFactory(core, proc, settings);
  const createRows = listViewRowFactory(core, proc, settings);
  const createMounts = mountViewRowsFactory(core);
  const {draggable} = core.make('osjs/dnd');

  const initialState = {
    path: '',
    status: '',
    minimalistic: false,

    history: {
      index: -1,
      list: []
    },

    mountview: listView.state({
      class: 'osjs-gui-fill',
      columns: ['Name'],
      hideColumns: true,
      rows: createMounts()
    }),

    fileview: listView.state({
      columns: []
    })
  };

  const createActions = (win) => ({
    history: {
      clear: () => ({index: -1, list: []}),

      push: (path) => ({index, list}) => {
        const newList = index === -1 ? [] : list;
        const lastHistory = newList[newList.length - 1];
        const newIndex = lastHistory === path
          ? newList.length - 1
          : newList.push(path) - 1;

        return {list: newList, index: newIndex};
      },

      back: () => ({index, list}) => {
        const newIndex = Math.max(0, index - 1);
        win.emit('filemanagerWindow:navigate', list[newIndex], true);
        return {index: newIndex};
      },

      forward: () => ({index, list}) => {
        const newIndex = Math.min(list.length - 1, index + 1);
        win.emit('filemanagerWindow:navigate', list[newIndex], true);
        return {index: newIndex};
      }
    },

    toggleMinimalistic: () => ({minimalistic}) => ({minimalistic: !minimalistic}),

    setPath: path => ({path}),
    setStatus: status => ({status}),
    setMinimalistic: minimalistic => ({minimalistic}),
    setList: ({list, path, selectFile}) => ({fileview, mountview}) => {
      let selectedIndex;

      if (selectFile) {
        const foundIndex = list.findIndex(file => file.filename === selectFile);
        if (foundIndex !== -1) {
          selectedIndex = foundIndex;
        }
      }

      return {
        path,
        status: formatStatusMessage(path, list),
        mountview: Object.assign({}, mountview, {
          rows: createMounts()
        }),
        fileview: Object.assign({}, fileview, {
          selectedIndex,
          columns: createColumns(),
          rows: createRows(list)
        })
      };
    },

    mountview: listView.actions({
      select: ({data}) => win.emit('filemanagerWindow:navigate', {path: data.root})
    }),

    fileview: listView.actions({
      select: ({data}) => win.emit('filemanagerWindow:select', data),
      activate: ({data}) => win.emit(`filemanagerWindow:${data.isFile ? 'open' : 'navigate'}`, data),
      contextmenu: args => win.emit('filemanagerWindow:contextmenu', args),
      created: ({el, data}) => {
        if (data.isFile) {
          draggable(el, {data});
        }
      }
    })
  });

  return ($content, win) => {
    const actions = createActions(win);
    const view = createView(core, proc, win);
    return app(initialState, actions, view, $content);
  };
};

/**
 * Creates a new FileManager window
 */
const createWindow = (core, proc, settings) => {
  let wired;
  const {homePath, initialPath} = createInitialPaths(core, proc);

  const title = core.make('osjs/locale').translatableFlat(proc.metadata.title);
  const win = proc.createWindow(createWindowOptions(core, proc, title));
  const render = createApplication(core, proc, settings);

  const onTitle = append => win.setTitle(`${title} - ${append}`);
  const onStatus = message => wired.setStatus(message);
  const onRender = () => proc.emit('filemanager:readdir', initialPath);
  const onDestroy = () => proc.destroy();
  const onDrop = (...args) => proc.emit('filemanager:drop', ...args);
  const onHome = () => proc.emit('filemanager:readdir', homePath, 'clear');
  const onNavigate = (...args) => proc.emit('filemanager:readdir', ...args);
  const onSelectItem = file => proc.emit('filemanager:select', file);
  const onSelectStatus = file => win.emit('filemanagerWindow:status', formatFileMessage(file));
  const onContextMenu = args => proc.emit('filemanager:contextmenu', args);
  const onReaddirRender = args => wired.setList(args);
  const onOpen = file => core.open(file, {useDefault: true});
  const onOpenWith = file => core.open(file, {useDefault: true, forceDialog: true});
  const onHistoryPush = file => wired.history.push(file);
  const onHistoryClear = () => wired.history.clear();
  const onMenu = (props, args) => proc.emit('filemanager:menu', props, args);
  const onMenuUpload = () => proc.emit('filemanager:upload');
  const onMenuMkdir = () => proc.emit('filemanager:mkdir');
  const onMenuQuit = () => proc.destroy();
  const onMenuRefresh = () => proc.emit('filemanager:refresh');
  const onMenuToggleMinimalistic = () => wired.toggleMinimalistic();
  const onMenuShowDate = () => proc.emit('filemanager:setting', 'showDate', !settings.showDate);
  const onMenuShowHidden = () => proc.emit('filemanager:setting', 'showHiddenFiles', !settings.showHiddenFiles);
  const onMenuCopy = file => proc.emit('filemanager:copy', file);
  const onMenuCut = file => proc.emit('filemanager:cut', file);
  const onMenuPaste = () => proc.emit('filemanager:paste');
  const onMenuRename = file => proc.emit('filemanager:rename', file);
  const onMenuDelete = file => proc.emit('filemanager:delete', file);
  const onMenuDownload = file => proc.emit('filemanager:download', file);

  return win
    .once('render', () => win.focus())
    .once('destroy', () => (wired = undefined))
    .once('render', onRender)
    .once('destroy', onDestroy)
    .on('drop', onDrop)
    .on('filemanagerWindow:title', onTitle)
    .on('filemanagerWindow:status', onStatus)
    .on('filemanagerWindow:menu', onMenu)
    .on('filemanagerWindow:home', onHome)
    .on('filemanagerWindow:navigate', onNavigate)
    .on('filemanagerWindow:select', onSelectItem)
    .on('filemanagerWindow:select', onSelectStatus)
    .on('filemanagerWindow:contextmenu', onContextMenu)
    .on('filemanagerWindow:readdir', onReaddirRender)
    .on('filemanagerWindow:open', onOpen)
    .on('filemanagerWindow:openWith', onOpenWith)
    .on('filemanagerWindow:historyPush', onHistoryPush)
    .on('filemanagerWindow:historyClear', onHistoryClear)
    .on('filemanagerWindow:menu:upload', onMenuUpload)
    .on('filemanagerWindow:menu:mkdir', onMenuMkdir)
    .on('filemanagerWindow:menu:quit', onMenuQuit)
    .on('filemanagerWindow:menu:refresh', onMenuRefresh)
    .on('filemanagerWindow:menu:toggleMinimalistic', onMenuToggleMinimalistic)
    .on('filemanagerWindow:menu:showDate', onMenuShowDate)
    .on('filemanagerWindow:menu:showHidden', onMenuShowHidden)
    .on('filemanagerWindow:menu:copy', onMenuCopy)
    .on('filemanagerWindow:menu:cut', onMenuCut)
    .on('filemanagerWindow:menu:paste', onMenuPaste)
    .on('filemanagerWindow:menu:rename', onMenuRename)
    .on('filemanagerWindow:menu:delete', onMenuDelete)
    .on('filemanagerWindow:menu:download', onMenuDownload)
    .render(($content, win) => (wired = render($content, win)));
};

/**
 * Launches the OS.js application process
 */
const createProcess = (core, args, options, metadata) => {
  const state = {currentFile: undefined, currentPath: undefined};
  const settings = createDefaultSettings(); // TODO: Persistence
  const clipboard = core.make('osjs/clipboard');
  const proc = core.make('osjs/application', {args, options, metadata});
  const win = createWindow(core, proc, settings);
  const dialog = dialogFactory(core, proc, win);
  const createMenu = menuFactory(core, proc, win, settings);
  const {action, refresh, drop, upload, readdir, download, paste} = vfsActionFactory(core, proc, win, dialog, settings, state);

  const onMenu = (props, args) => createMenu(props, args || state.currentFile);
  const onContextMenu = ({ev, data}) => createMenu({ev, name: 'edit'}, data, true);
  const onSelect = file => (state.currentFile = file);

  const onCopy = item => clipboard.set(({item}), 'filemanager:copy');
  const onCut = item => clipboard.set(({
    item,
    callback: () => proc.emit('filemanager:refresh', true)
  }), 'filemanager:move');
  const onPaste = () => {
    if (clipboard.has(/^filemanager:/)) {
      const move = clipboard.has('filemanager:move');
      clipboard.get(move)
        .then(paste(move, state.currentPath));
    }
  };

  const onUpload = (...args) => upload(...args);
  const onDrop = (...args) => drop(...args);
  const onReaddir = (...args) => readdir(...args);
  const onDownload = (...args) => download(...args);
  const onMkdir = () => dialog('mkdir', action, state.currentPath);
  const onRename = file => dialog('rename', action, file);
  const onDelete = file => dialog('delete', action, file);
  const onSetting = (key, value) => {
    settings[key] = value;
    refresh();
  };

  return proc
    .on('filemanager:menu', onMenu)
    .on('filemanager:contextmenu', onContextMenu)
    .on('filemanager:upload', onUpload)
    .on('filemanager:select', onSelect)
    .on('filemanager:download', onDownload)
    .on('filemanager:mkdir', onMkdir)
    .on('filemanager:rename', onRename)
    .on('filemanager:delete', onDelete)
    .on('filemanager:refresh', refresh)
    .on('filemanager:copy', onCopy)
    .on('filemanager:paste', onPaste)
    .on('filemanager:cut', onCut)
    .on('filemanager:drop', onDrop)
    .on('filemanager:readdir', onReaddir)
    .on('filemanager:setting', onSetting);
};

osjs.register(applicationName, createProcess);
