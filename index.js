/*
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
        h(Button, {label: 'Back'}),
        h(Button, {label: 'Forward'}),
        h(Button, {label: 'Home'}),
        h(Input, {value: state.path, style: {flexGrow: 1}})
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

  panes: adapters.panes.state({
    fill: true
  }),

  mountview: adapters.listview.state({
    class: 'osjs-gui-fill',
    columns: ['Name'],
    hideColumns: true,
    rows: [
      ['Filesystem A'],
      ['Filesystem B']
    ]
  }),

  fileview: adapters.listview.state({
    onselect: file => bus.emit('selectFile', file),
    onactivate: file => bus.emit('readFile', file),
    columns: [{
      label: 'Name'
    }, {
      label: 'Type'
    }, {
      label: 'Size'
    }]
  })
});

const actions = (bus, core, proc, win) => {
  return {
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
    fileview: adapters.listview.actions()
  }
};

//
// Our application bootstrapper
//
const createApplication = (core, proc, win, $content) => {
  const bus = core.make('osjs/event-handler', 'FileManager');
  const a = app(state(bus, core, proc, win),
    actions(bus, core, proc, win),
    view(bus, core, proc, win),
    $content);

  bus.on('selectFile', file => {
    a.setStatus(`${file.filename} (${file.size}bytes)`);
  });

  bus.on('readFile', file => {
    if (file.isDirectory) {
      bus.emit('openDirectory', file);
    } else {
      core.open(file);
    }
  });

  bus.on('openDirectory', async (file) => {
    const path = typeof file === 'string' ? file : file.path;

    const files = await core.make('osjs/vfs')
      .readdir(path);

    const rows = files.map(f => ({
      columns: [{label: f.filename}, f.mime, f.humanSize],
      data: f
    }));

    a.setFileList({path, rows});
    a.setStatus(`${path} - ${rows.length} entries`);
  });

  bus.on('openMenu', (item, index, ev) => {
    core.make('osjs/contextmenu').show({
      menu: [
        {label: 'Quit', onclick: () => proc.destroy()}
      ],
      position: ev.target
    });
  });

  bus.emit('openDirectory', '/');
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
