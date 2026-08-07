/**
 * AttachmentService.gs
 * Uploads a file (sent from the browser as base64) to a dedicated Drive
 * folder and returns a shareable link to store on the record. Used by the
 * Returns module for the mandatory tax-invoice copy.
 */

function getAttachmentFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('ATTACHMENT_FOLDER_ID');
  var folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder('Honda Network ERP - Attachments');
    props.setProperty('ATTACHMENT_FOLDER_ID', folder.getId());
  }
  return folder;
}

/** base64Data must NOT include the "data:...;base64," prefix — strip that on the client first. */
function uploadAttachment(token, base64Data, filename, mimeType) {
  return safeRun('uploadAttachment', function () {
    requireRole_(token, [ROLES.ADMIN, ROLES.NETWORK_MANAGER, ROLES.ACCOUNTS, ROLES.DEALER]);
    if (!base64Data) throw new Error('No file data received.');
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', filename || ('upload-' + new Date().getTime()));
    var file = getAttachmentFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { url: file.getUrl(), id: file.getId(), name: file.getName() };
  });
}
