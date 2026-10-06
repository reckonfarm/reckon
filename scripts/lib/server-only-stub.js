// `import 'server-only'` is a marker Next honours at build time. Outside Next
// the npm package of that name throws on import, so a read-only script that
// loads the app's server libs resolves the marker here instead: nothing.
module.exports = {}
