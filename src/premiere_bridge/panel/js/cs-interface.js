// Minimal CSInterface: this panel only needs evalScript, so rather than
// vendor Adobe's full ~600-line CSInterface.js we keep just the confirmed
// real implementation of the one method actually used.
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (callback === null || callback === undefined) {
    callback = function (result) {};
  }
  window.__adobe_cep__.evalScript(script, callback);
};
