const path = require('path');
const mode = process.env.NODE_ENV || 'development';
const minimize = mode === 'production';
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  mode,
  devtool: 'source-map',
  entry: [
    path.resolve(__dirname, 'index.js'),
  ],
  externals: {
    osjs: 'OSjs'
  },
  optimization: {
    minimize,
  },
  plugins: [
    new CopyWebpackPlugin([
      path.resolve(__dirname, 'icon.png')
    ])
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules\/(?!@osjs)/,
        use: {
          loader: 'babel-loader'
        }
      }
    ]
  }
};
