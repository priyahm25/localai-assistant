// tsx creates a temporary transpilation directory using os.userInfo(). This
// guard lets the test command run in restricted Windows accounts where libuv's
// identity lookup fails; normal developer machines keep their real user info.
const os = require('node:os');
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME || 'local-test',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE || process.cwd(),
  });
  require('node:module').syncBuiltinESMExports();
}
