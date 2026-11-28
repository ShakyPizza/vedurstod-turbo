// Start page choice, shared by / and /landid. Runs before the page draws.
//
// - vedurstod:start ('landid' | 'stod') says which page opens first. It is
//   decided once: new visitors get the Landsspá; anyone who already has
//   stations saved keeps their dashboard. The switch on /landid changes it.
// - Only the first page of a browser tab's session follows the choice, so
//   links between the two pages never bounce back.
(function () {
  try {
    var ls = window.localStorage;
    var ss = window.sessionStorage;
    var start = ls.getItem('vedurstod:start');
    if (start !== 'landid' && start !== 'stod') {
      start = ls.getItem('vedurstod:tabs') || ls.getItem('vedurstod:station') ? 'stod' : 'landid';
      ls.setItem('vedurstod:start', start);
    }
    var first = !ss.getItem('vedurstod:entered');
    ss.setItem('vedurstod:entered', '1');
    if (first && start === 'landid' && location.pathname === '/' && !location.search && !location.hash) {
      location.replace('/landid');
    }
  } catch (e) {
    // Storage blocked: stay on the page that was asked for.
  }
})();
