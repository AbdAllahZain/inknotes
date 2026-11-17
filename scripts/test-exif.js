require('./ts-require');
const fs = require('fs');
const { jpegInfo } = require('../src/services/exif.ts');
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ': ' + a + ' !== ' + b); };
let i = jpegInfo(fs.readFileSync('/tmp/exif-o6.jpg')); eq(i.orientation, 6, 'o6 orientation'); eq(i.width, 400, 'o6 w'); eq(i.height, 300, 'o6 h');
i = jpegInfo(fs.readFileSync('/tmp/exif-o8.jpg')); eq(i.orientation, 8, 'o8 orientation'); eq(i.width, 320, 'o8 w');
i = jpegInfo(fs.readFileSync('/tmp/exif-o1.jpg')); eq(i.orientation, 1, 'plain'); eq(i.height, 100, 'plain h');
// only the first ~96 KB are needed
const big = fs.readFileSync('/tmp/exif-o6.jpg'); i = jpegInfo(big.subarray(0, 4000)); eq(i.orientation, 6, 'prefix is enough');
if (jpegInfo(Buffer.from('not a jpeg')) !== null) throw new Error('garbage must give null');
console.log('exif OK');
