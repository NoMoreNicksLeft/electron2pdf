module.exports = {
  packagerConfig: {
    name: 'electron2pdf',
    asar: true,
    ignore: [
      /^\/homebrew\//,
      /^\/dist\//,
      /^\/out\//,
      /^\/slackware\//,
      /^\/\.git\//,
    ],
  },
  hooks: {
    prePackage: async () => {
      const fs = require('fs');
      const path = require('path');
      const projectRoot = process.cwd();
      await fs.promises.rm(path.join(projectRoot, 'homebrew'), { recursive: true, force: true });
    },
    postMake: require('./scripts/forge-postmake-cli'),
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
  ],
};
