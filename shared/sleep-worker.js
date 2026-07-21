/* Runs off the page main thread so scan sleeps are not throttled in background tabs. */
self.onmessage = function (event) {
  var id = event.data && event.data.id;
  var ms = (event.data && event.data.ms) || 0;
  setTimeout(function () {
    self.postMessage({ id: id });
  }, ms);
};
