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
const view = (core, proc, win) =>
  (state, actions) => h(Box, {}, [
    h(Menubar, {items: state.menu, onclick: (item, index, ev) => actions.menu({item, index, ev})}),
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
// Our main window action
//
const actions = (core, proc, win) => {
  return {
    _readdir: ({path, files}) => (state, actions) => {
      const fileview = state.fileview;
      fileview.selectedIndex = -1;
      fileview.rows = files.map(file => {
        return {
          columns: [{label: file.filename}, file.mime, file.humanSize],
          data: file
        }
      });

      const status = `${path} - ${files.length} entries`;

      return {path, fileview, status};
    },

    setPath: (path = '/') => async (state, actions) => {
      if (typeof path !== 'string') {
        path = path.path;
      }

      const files = await core.make('osjs/vfs')
        .readdir(path);

      actions._readdir({path, files});
    },

    menu: ({item, index, ev}) => state => {
      core.make('osjs/contextmenu').show({
        menu: [
          {label: 'Quit', onclick: () => proc.destroy()}
        ],
        position: ev.target
      });
    },

    setStatus: status => state => ({status}),

    panes: adapters.panes.actions(),
    mountview: adapters.listview.actions(),
    fileview: adapters.listview.actions()
  }
};

const state = (core, proc, win, {onselect, onactivate}) => {
  return {
    path: '',
    status: '',

    menu: [
      {label: 'File'},
      {label: 'View'}
    ],

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
      onselect,
      onactivate,
      columns: [{
        label: 'Name'
      }, {
        label: 'Type'
      }, {
        label: 'Size'
      }]
    })
  };
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
    .render(($content, win) => {
      let a;

      const onactivate = (file) => {
        if (file.isDirectory) {
          a.setPath(file);
        } else {
          core.open(file);
        }
      };

      const onselect = (file) => a.setStatus(`${file.filename} (${file.size}bytes)`);

      a = app(
        state(core, proc, win, {
          onselect,
          onactivate
        }),
        actions(core, proc, win),
        view(core, proc, win),
        $content
      );

      a.setPath('/');
    });

  return proc;
});
