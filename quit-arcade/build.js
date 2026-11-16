#!/usr/bin/env node
// Assembles src/ into one self-contained page.
//   node build.js            -> quit-arcade/index.html (standalone, for any static host)
//   node build.js <outfile>  -> also writes the body-only fragment to <outfile>
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const json = (f) => JSON.parse(src(f));
const safe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/[\u2028\u2029]/g, '');

const data = { milestones: json('milestones.json'), methods: json('methods.json'), copy: json('copy.json') };
const games = ['games/surf.js', 'games/breath.js'].map(src).join('\n');

const fragment = src('shell.html')
  .replace('/*__DATA__*/', () => 'window.QUIT_DATA = ' + safe(JSON.stringify(data)) + ';')
  .replace('/*__GAMES__*/', () => safe(games));

const standalone = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + fragment + '\n</body>\n</html>\n';

fs.writeFileSync(path.join(__dirname, 'index.html'), standalone);
if (process.argv[2]) fs.writeFileSync(process.argv[2], fragment);
console.log('built', (standalone.length / 1024).toFixed(1) + ' KB');
