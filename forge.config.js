module.exports = {
  packagerConfig: {
    name: 'electron2pdf',
    asar: true,
  },
  hooks: {
    postMake: require('./scripts/forge-postmake-cli'),
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
  ],
};
