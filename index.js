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
  BoxContainer,
  Button,
  Input,
  Toolbar,
  Menubar,
  MenubarItem,
  Statusbar,
  ListView,
  Panes,
  adapters
} from '@osjs/gui';

const getFileStatus = file => `${file.filename} (${file.size}bytes)`;

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

//
// Our main window view
//
const view = (bus, core, proc, win) =>
  (state, actions) => h(Box, {}, [
    h(Menubar, {
      items: [
        {label: 'File'},
        {label: 'View'}
      ],
      onclick: (item, index, ev) => bus.emit('openMenu', item, index, ev)
    }),
    h(BoxContainer, {}, [
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
        h(Input, {
          value: state.path,
          style: {flexGrow: 1},
          onenter: value => bus.emit('openDirectory', value, 'clear')
        })
      ]),
    ]),
    h(Panes, adapters.panes.proxy(state.panes, actions.panes), [
      h(ListView, adapters.listview.proxy(state.mountview, actions.mountview)),
      h(ListView, adapters.listview.proxy(state.fileview, actions.fileview))
    ]),
    h(Statusbar, {}, [
      h('span', {}, state.status)
    ])
  ]);

//
// Our main window state and actions
//

const state = (bus, core, proc, win) => ({
  path: '',
  status: '',
  history: [],
  historyIndex: -1,

  panes: adapters.panes.state({
    fill: true
  }),

  mountview: adapters.listview.state({
    class: 'osjs-gui-fill',
    columns: ['Name'],
    hideColumns: true,
    rows: getMountpoints(core)
  }),

  fileview: adapters.listview.state({
    onselect: item => bus.emit('selectFile', item),
    onactivate: item => bus.emit('readFile', item),
    oncontextmenu: (...args) => bus.emit('openContextMenu', ...args),
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
  setFileList: ({path, rows}) => state => ({
    path,
    fileview: Object.assign({}, state.fileview, {
      selectedIndex: -1,
      rows
    })
  }),
  panes: adapters.panes.actions(),
  mountview: adapters.listview.actions(),
  fileview: adapters.listview.actions(),
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
  const done = (btn, value) => {
    win.setState('loading', false);
    if (btn === 'ok' || btn === 'yes') {
      cb(value);
    }
  };

  if (type === 'rename') {
    core.make('osjs/dialog', 'prompt', {
      message: `Rename ${item.filename}`,
      value: item.filename
    }, done);
  } else if (type === 'delete') {
    core.make('osjs/dialog', 'confirm', {
      message: `Delete ${item.filename}`
    }, done);
  } else if (type === 'error') {
    core.make('osjs/dialog', 'alert', {
      type: 'error',
      message: item
    });

    return;
  }

  win.setState('loading', true);
};

//
// Our application bootstrapper
//
const createApplication = (core, proc, win, $content) => {
  const homePath = '/'; // FIXME
  let currentPath = '/'; // FIXME

  const bus = core.make('osjs/event-handler', 'FileManager');
  const dialog = createDialog(bus, core, proc, win);
  const a = app(state(bus, core, proc, win),
    actions(bus, core, proc, win),
    view(bus, core, proc, win),
    $content);

  bus.on('selectFile', file => a.setStatus(getFileStatus(file)));

  bus.on('readFile', file => {
    if (file.isDirectory) {
      bus.emit('openDirectory', file);
    } else {
      core.open(file);
    }
  });

  bus.on('openDirectory', async (file, history) => {
    let files;

    const path = typeof file === 'undefined'
      ? currentPath
      : typeof file === 'string' ? file : file.path;

    try {
      files = await core.make('osjs/vfs')
        .readdir(path);
    } catch (e) {
      console.warn(e);
      a.setPath(currentPath);
      dialog('error', e);
      return;
    }

    const rows = files.map(f => ({
      columns: [{label: f.filename}, f.mime, f.humanSize],
      data: f
    }));

    if (typeof history === 'undefined' || history === false) {
      a.addHistory(path);
    } else if (history ===  'clear') {
      a.clearHistory();
    }

    a.setFileList({path, rows});
    a.setStatus(getDirectoryStatus(path, files));
    win.setTitle(`${proc.metadata.title.en_EN} - ${path}`)

    currentPath = path;
  });

  bus.on('openMenu', (item, index, ev) => {
    core.make('osjs/contextmenu').show({
      menu: [
        {label: 'Quit', onclick: () => proc.destroy()}
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
        onclick: () => dialog('rename', item, () => bus.emit('openDirectory'))
      },
      {
        label: 'Delete',
        onclick: () => dialog('delete', item, () => bus.emit('openDirectory'))
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
