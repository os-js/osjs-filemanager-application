/*!
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2018, Anders Evenrud <andersevenrud@gmail.com>
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

import {
  h,
  app
} from 'hyperapp';

import {
  Box,
  Button,
  TextField,
  Toolbar,
  Menubar,
  MenubarItem,
  Statusbar,
  ListView,
  Panes,
  listView
} from '@osjs/gui';

const getFileStatus = file => `${file.filename} (${file.size} bytes)`;

const getDirectoryStatus = (path, files) => {
  const directoryCount = files.filter(f => f.isDirectory).length;
  const fileCount = files.filter(f => !f.isDirectory).length;
  const totalSize = files.reduce((t, f) => t + (f.size || 0), 0)

  return `${directoryCount} directories, ${fileCount} files, ${totalSize} bytes total`;
};

const getMountpoints = core => core.make('osjs/fs').mountpoints(true).map(m => ({
  columns: [m.label],
  data: {name: m.name}
}));

const rename = (item, to) => {
  const idx = item.path.lastIndexOf(item.filename);
  return item.path.substr(0, idx) + to;
};

//
// Our main window view
//
const view = (bus, core, proc, win) => (state, actions) => {
  const FileView = listView.component(state.fileview, actions.fileview);
  const MountView = listView.component(state.mountview, actions.mountview);

  return h(Box, {}, [
    h(Menubar, {}, [
      h(MenubarItem, {
        onclick: ev => bus.emit('openMenu', ev, {name: 'file'})
      }, 'File'),
      h(MenubarItem, {
        onclick: ev => bus.emit('openMenu', ev, {name: 'view'})
      }, 'View')
    ]),
    h(Toolbar, {}, [
      h(Button, {
        label: 'Back',
        disabled: !state.history.length || state.historyIndex <= 0,
        onclick: () => actions.back()
      }),
      h(Button, {
        label: 'Forward',
        disabled: !state.history.length || (state.historyIndex === state.history.length - 1),
        onclick: () => actions.forward()
      }),
      h(Button, {label: 'Home', onclick: () => bus.emit('goHome')}),
      h(TextField, {
        value: state.path,
        box: {
          grow: 1
        },
        onenter: (ev, value) => bus.emit('openDirectory', {path: value}, 'clear')
      })
    ]),
    h(Panes, {}, [
      h(MountView),
      h(FileView)
    ]),
    h(Statusbar, {}, [
      h('span', {}, state.status)
    ])
  ]);
};

//
// Our main window state and actions
//

const state = (bus, core, proc, win) => ({
  path: '',
  status: '',
  history: [],
  historyIndex: -1,

  mountview: listView.state({
    class: 'osjs-gui-fill',
    columns: ['Name'],
    hideColumns: true,
    rows: getMountpoints(core)
  }),

  fileview: listView.state({
    columns: [{
      label: 'Name'
    }, {
      label: 'Type'
    }, {
      label: 'Size'
    }]
  })
});

const actions = (bus, core, proc, win) => ({
  addHistory: path => state => {
    const history = state.historyIndex === -1 ? [] : state.history;
    const lastHistory = history[history.length - 1];
    const historyIndex = lastHistory === path
      ? history.length - 1
      : history.push(path) - 1;

    return {history, historyIndex};
  },
  clearHistory: () => state => ({historyIndex: -1, history: []}),
  setHistory: history => state => ({history}),
  setPath: path => state => ({path}),
  setStatus: status => state => ({status}),
  setFileList: ({path, rows}) => (state, actions) => {
    actions.fileview.setRows(rows);
    return {path};
  },

  mountview: listView.actions({
    select: ({data}) => bus.emit('selectMountpoint', data)
  }),

  fileview: listView.actions({
    select: ({data}) => bus.emit('selectFile', data),
    activate: ({data}) => bus.emit('readFile', data),
    contextmenu: ({data, index, ev}) => bus.emit('openContextMenu', data, index, ev),
  }),

  back: () => state => {
    const index = Math.max(0, state.historyIndex - 1);
    bus.emit('openDirectory', state.history[index], true);
    return {historyIndex: index};
  },

  forward: () => state => {
    const index = Math.min(state.history.length - 1, state.historyIndex + 1);
    bus.emit('openDirectory', state.history[index], true);
    return {historyIndex: index};
  }
});

//
// Our dialog handler
//
const createDialog = (bus, core, proc, win) => (type, item, cb) => {
  cb = cb || function() {};

  const done = then => (btn, value) => {
    win.setState('loading', false);
    if (btn === 'ok' || btn === 'yes') {
      then(value);
    }
  };

  if (type === 'mkdir') {
    core.make('osjs/dialog', 'prompt', {
      message: `Create new directory`,
      value: 'New directory'
    }, done(value => {
      if (value) {
        const newPath = item.path.replace(/\/?$/, '/') + value;
        core.make('osjs/vfs')
          .mkdir({path: newPath})
          .then(() => cb());
      }
    }));
  } else if (type === 'rename') {
    core.make('osjs/dialog', 'prompt', {
      message: `Rename ${item.filename}`,
      value: item.filename
    }, done(value => {
      if (value) {
        const newPath = rename(item, value);
        core.make('osjs/vfs')
          .rename(item, {path: newPath})
          .then(() => cb());
      }
    }));
  } else if (type === 'delete') {
    core.make('osjs/dialog', 'confirm', {
      message: `Delete ${item.filename}`
    }, () => {
      core.make('osjs/vfs')
        .unlink(item)
        .then(() => cb());
    });
  } else if (type === 'error') {
    core.make('osjs/dialog', 'alert', {
      type: 'error',
      message: item
    }, done(() => {}));

    return;
  }

  win.setState('loading', true);
};

//
// Our application bootstrapper
//
const createApplication = (core, proc, win, $content) => {
  const homePath = {path: 'osjs:/'}; // FIXME
  let currentPath = homePath; // FIXME
  const settings = { // FIXME
    showHiddenFiles: true
  };

  const bus = core.make('osjs/event-handler', 'FileManager');
  const dialog = createDialog(bus, core, proc, win);
  const a = app(state(bus, core, proc, win),
    actions(bus, core, proc, win),
    view(bus, core, proc, win),
    $content);


  const getFileIcon = file => core.make('osjs/fs').icon(file);
  const refresh = () => bus.emit('openDirectory', currentPath);

  bus.on('selectFile', file => a.setStatus(getFileStatus(file)));
  bus.on('selectMountpoint', mount => bus.emit('openDirectory', {path: `${mount.name}:/`})); //  FIXME

  bus.on('readFile', file => {
    if (file.isDirectory) {
      bus.emit('openDirectory', file);
    } else {
      core.open(file);
    }
  });

  bus.on('openDirectory', async (file, history) => {
    const {path} = file;

    win.setState('loading', true);
    const message = `Loading ${path}`;

    a.setStatus(message);
    win.setTitle(`${proc.metadata.title.en_EN} - ${message}`)

    let files;

    try {
      files = await core.make('osjs/vfs')
        .readdir(file, {
          showHiddenFiles: settings.showHiddenFiles
        });
    } catch (e) {
      console.warn(e);
      a.setPath(currentPath);
      dialog('error', e);
      return;
    } finally {
      win.setState('loading', false);
    }

    const rows = files.map(f => ({
      columns: [{label: f.filename, icon: getFileIcon(f)}, f.mime, f.humanSize],
      data: f
    }));

    if (typeof history === 'undefined' || history === false) {
      a.addHistory(file);
    } else if (history ===  'clear') {
      a.clearHistory();
    }

    a.setFileList({path, rows});
    a.setStatus(getDirectoryStatus(path, files));
    win.setTitle(`${proc.metadata.title.en_EN} - ${path}`)

    currentPath = file;
  });

  bus.on('openMenu', (ev, item) => {
    core.make('osjs/contextmenu').show({
      menu: item.name === 'file' ? [
        {label: 'Upload', onclick: () => {
          const field = document.createElement('input');
          field.type = 'file';
          field.onchange = ev => {
            if (field.files.length) {
              const f = field.files[0];
              const uploadpath = currentPath.path.replace(/\/?$/, '/') + f.name;
              core.make('osjs/vfs').writefile({path: uploadpath}, f)
                .then(() => refresh());
            }
          };
          field.click();
        }},
        {label: 'New directory', onclick: () => dialog('mkdir', {path: currentPath.path}, () => refresh())},
        {label: 'Quit', onclick: () => proc.destroy()}
      ] :  [
        {label: 'Refresh', onclick: () => refresh()},
        {label: 'Show hidden files', checked: settings.showHiddenFiles, onclick: () => {
          settings.showHiddenFiles = !settings.showHiddenFiles;
          refresh();
        }}
      ],
      position: ev.target
    });
  });

  bus.on('openContextMenu', (item, index, ev) => {
    if (['..', '.'].indexOf(item.filename) !== -1) {
      return;
    }

    const menu = [
      item.isDirectory ? {
        label: 'Go',
        onclick: () => bus.emit('readFile', item)
      } : {
        label: 'Open',
        onclick: () => bus.emit('readFile', item)
      },
      {
        label: 'Rename',
        onclick: () => dialog('rename', item, () => refresh())
      },
      {
        label: 'Delete',
        onclick: () => dialog('delete', item, () => refresh())
      }
    ];

    core.make('osjs/contextmenu').show({
      position: ev,
      menu
    });
  });

  bus.on('goHome', () => bus.emit('openDirectory', homePath, 'clear'));
  bus.emit('openDirectory', homePath);
};

//
// Callback for launching application
//
OSjs.make('osjs/packages').register('FileManager', (core, args, options, metadata) => {
  const proc = core.make('osjs/application', {
    args,
    options,
    metadata
  });

  proc.createWindow({
    id: 'FileManager',
    title: metadata.title.en_EN,
    dimension: {width: 400, height: 400}
  })
    .on('destroy', () => proc.destroy())
    .on('render', (win) => win.focus())
    .render(($content, win) => createApplication(core, proc, win, $content));

  return proc;
});
